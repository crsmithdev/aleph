import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, jobsDir, patchItem, repo, seedItem, setup, specFile, state, teardown } from "./cli.helpers";

beforeAll(() => {
  setup();
  const regs = JSON.parse(readFileSync(join(base, "repos.json"), "utf8"));
  regs.resfac = { path: repo, sandbox: true, autoland: true, checks: [] };
  writeFileSync(join(base, "repos.json"), JSON.stringify(regs));
});
afterAll(teardown);

test("a research goal runs with search and fetch only, brings no repo and does not land", async () => {
  const worker = join(base, "fake-research");
  const args = join(base, "research-args");
  writeFileSync(worker, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${args}\ncat > /dev/null\necho '{"type":"result","is_error":false,"result":"A report with no links."}'\n`);
  chmodSync(worker, 0o755);
  const id = seedItem("resfac", "Find it out", { areas: ["research"] }, "Goal: find it out");
  const r = await aleph(["job", "resfac", "res1", "--on", String(id), "--spec", specFile("Goal: find it out\n")], { ALEPH_WORKER_CMD: worker });
  const run = state(r.json.run);
  expect(run.condition).toBe("stuck");
  expect(run.reason).toBe("the report cites no source");
  expect(run.next).toBeUndefined();
  expect(run.kind).toBe("research");
  const argv = readFileSync(args, "utf8").split("\n");
  expect(argv[argv.indexOf("--tools") + 1]).toBe("WebSearch");
  expect(argv).toContain("--strict-mcp-config");
  expect(existsSync(join(repo, ".git", "refs", "heads", "factory", "res1"))).toBe(false);
}, 60_000);

test("a run already marked research goes to the research path again, even when the issue no longer says research", async () => {
  const worker = join(base, "fake-research2");
  const args = join(base, "research-args2");
  writeFileSync(worker, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${args}\ncat > /dev/null\necho '{"type":"result","is_error":false,"result":"A report with no links."}'\n`);
  chmodSync(worker, 0o755);
  const id = seedItem("resfac", "Find it again", { areas: ["research"] }, "Goal: find it again");
  const r = await aleph(["job", "resfac", "res2", "--on", String(id), "--spec", specFile("Goal: find it again\n")], { ALEPH_WORKER_CMD: worker });
  expect(state(r.json.run).kind).toBe("research");
  patchItem("resfac", id, { areas: [] });
  rmSync(args, { force: true });
  const folder = join(jobsDir, r.json.run);
  const p = JSON.parse(readFileSync(join(folder, "state.json"), "utf8"));
  writeFileSync(join(folder, "state.json"), JSON.stringify({ ...p, condition: "running", ended: undefined, reason: undefined }));
  await aleph(["unit", folder], { ALEPH_WORKER_CMD: worker });
  const again = state(r.json.run);
  expect(again.kind).toBe("research");
  expect(again.reason).toBe("the report cites no source");
  expect(existsSync(args)).toBe(true);
  expect(readFileSync(args, "utf8")).toContain("WebSearch");
  expect(existsSync(join(repo, ".git", "refs", "heads", "factory", "res2"))).toBe(false);
}, 60_000);
