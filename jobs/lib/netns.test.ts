import { expect, test } from "bun:test";
import { bridge, sandboxNetnsPid } from "./netns.ts";
import { freePort } from "./review-browser.ts";
import { waitFor } from "../../tests/wait.ts";

const can = (cmd: string[]) => { try { return Bun.spawnSync(cmd, { stdout: "ignore", stderr: "ignore" }).exitCode === 0; } catch { return false; } };
/** Poll for the pid of the sandbox namespace holder until a deadline in time, and say so when it never shows. */
async function findPid(): Promise<number> {
  let pid: number | null = null;
  if (!await waitFor(() => (pid = sandboxNetnsPid(process.pid)) !== null, { timeout: 10_000, every: 50 })) throw new Error("step pid search: no child in another network namespace within 10 s");
  return pid!;
}

const usable = can(["unshare", "-Urn", "true"]) && can(["socat", "-V"]) && can(["nsenter", "--version"]);

test("sandboxNetnsPid is null for a child in the host namespace", async () => {
  const p = Bun.spawn(["sleep", "30"]);
  try { expect(sandboxNetnsPid(process.pid)).toBeNull(); } finally { p.kill(); await p.exited; }
});

test.skipIf(!usable)("bridge keeps the inner socat's connection error", async () => {
  const port = await freePort(3002);
  const holder = Bun.spawn(["unshare", "-Urn", "sh", "-c", "ip link set lo up; exec sleep 30"], { stdout: "ignore", stderr: "ignore" });
  let b: Awaited<ReturnType<typeof bridge>> | undefined;
  try {
    const pid = await findPid();
    try { b = await bridge(pid, port); } catch (e) { throw new Error(`step bridge: ${(e as Error).message}`); }
    try { await (await fetch(b.url)).text(); } catch { /* the relay closes the connection */ }
    const stderr = b.stderr;
    await waitFor(() => /refused/i.test(stderr()), { timeout: 10_000, every: 50 });
    if (!/refused/i.test(b.stderr())) throw new Error(`step stderr: no "refused" within 10 s; bridge stderr: ${b.stderr() || "(empty)"}`);
  } finally {
    await b?.stop();
    holder.kill();
    await holder.exited;
  }
}, 30_000);
