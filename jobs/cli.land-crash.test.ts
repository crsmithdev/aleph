import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI, base, env, file, jobRuns, jobsDir, moveMain, remote, sh, state, stateNow, until, setup, teardown } from "./cli.helpers";
import { issueAdd, issueShow, job, land as landJob } from "./inproc";

beforeAll(setup);
afterAll(teardown);

const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
const startLand = (name: string) => Bun.spawn(["bun", CLI, "land", name], { cwd: base, env: env(), stdout: "ignore", stderr: "ignore" });
const landRun = (name: string) => jobRuns(name, "land").at(-1)!;
/** Kills the process that does the land, as a crash or an OOM kill would, and waits for the CLI that started it. */
async function killLand(name: string, cli: ReturnType<typeof startLand>): Promise<void> {
  process.kill(Number(readFileSync(join(jobsDir, landRun(name), "pid"), "utf8")), "SIGKILL");
  cli.kill(9);
  await cli.exited;
}
const itemStatus = async (id: number) => (await issueShow("fac", id)).json;
const fjobFor = (name: string, action: string, id: number) => job("fac", name, `Goal: ${name}\nACTION: ${action}\n`, { on: String(id) });
// The land that is killed is an `aleph land` process: the crash is what the case tests. The rest is in-process.

test("a land killed at its checks leaves main alone, and the next land finishes the job", async () => {
  const id = (await issueAdd("fac", "killed at a check")).json.added;
  await fjobFor("killcheck", "commit gate/a.txt", id);
  moveMain(); // A land reuses the job's checks while main has not moved.
  const before = remoteGit("rev-parse", "main");
  const hold = join(base, "gate-hold"), reached = join(base, "gate-reached");
  rmSync(reached); // The job's own checks ran the gate too.
  writeFileSync(hold, "");
  const land = startLand("killcheck");
  await until(() => existsSync(reached));
  await killLand("killcheck", land);
  expect(remoteGit("rev-parse", "main")).toBe(before);
  rmSync(hold); // The check the killed land left behind ends too.
  rmSync(reached);

  // The dead land's lock must not stop this one.
  const again = await landJob("killcheck");
  expect(state(again.json.run), file(again.json.run, "land.log")).toMatchObject({ condition: "landed" });
  expect(remoteGit("rev-list", "--count", `${before}..main`)).toBe("1");
  expect((await itemStatus(id)).status).toBe("done");
}, 60_000);

test("a land killed after its push went through closes the issue on the next land and does not merge again", async () => {
  const id = (await issueAdd("fac", "killed after the push")).json.added;
  await fjobFor("killpush", "commit killpush.txt", id);
  const hold = join(base, "push-hold"), reached = join(base, "push-reached");
  // The hook runs after the ref moved and before git push returns to the land.
  writeFileSync(join(remote, "hooks", "post-receive"), `#!/bin/sh\n[ -f ${hold} ] || exit 0\ntouch ${reached}\nwhile [ -f ${hold} ]; do sleep 0.05; done\n`, { mode: 0o755 });
  writeFileSync(hold, "");
  const before = remoteGit("rev-parse", "main");
  const land = startLand("killpush");
  await until(() => existsSync(reached));
  await killLand("killpush", land);
  const pushed = remoteGit("rev-parse", "main");
  expect(pushed).not.toBe(before);
  expect(stateNow(landRun("killpush")).condition).not.toBe("landed");
  rmSync(hold);

  const again = await landJob("killpush");
  expect(state(again.json.run), file(again.json.run, "land.log")).toMatchObject({ condition: "landed", commit: pushed });
  expect(remoteGit("rev-parse", "main")).toBe(pushed);
  expect((await itemStatus(id)).status).toBe("done");
}, 60_000);
