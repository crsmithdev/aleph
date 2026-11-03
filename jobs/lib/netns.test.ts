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

// bwrap, under srt, puts the worker in a second user namespace inside the one that owns its network namespace.
for (const nested of [false, true]) test.skipIf(!usable)(`bridge reaches a server bound inside a network namespace${nested ? " from a nested user namespace" : ""}`, async () => {
  const port = await freePort(3002);
  const script = `Bun.serve({port: ${port}, hostname: "127.0.0.1", fetch: () => new Response("inside")})`;
  const server = Bun.spawn(["unshare", "-Urn", "sh", "-c", `ip link set lo up; exec ${nested ? "unshare -U " : ""}${process.execPath} -e '${script}'`], { stdout: "ignore", stderr: "ignore" });
  let b: Awaited<ReturnType<typeof bridge>> | undefined;
  try {
    const pid = await findPid();
    try { b = await bridge(pid, port); } catch (e) { throw new Error(`step bridge: ${(e as Error).message}`); }
    let text = "";
    let lastErr = "no attempt ran";
    const url = b.url;
    await waitFor(async () => {
      try { text = await (await fetch(url)).text(); if (text !== "inside") lastErr = `got ${JSON.stringify(text.slice(0, 80))}`; }
      catch (e) { lastErr = String(e); }
      return text === "inside";
    }, { timeout: 15_000, every: 50 });
    if (text !== "inside") throw new Error(`step fetch ${b.url}: no "inside" within 15 s; last: ${lastErr}; bridge stderr: ${b.stderr() || "(empty)"}`);
  } finally {
    await b?.stop();
    server.kill();
    await server.exited;
  }
}, 30_000);

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
