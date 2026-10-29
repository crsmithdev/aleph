import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Run on the host, not in a sandbox: ALEPH_SHOT_LIVE=1 bun test jobs/lib/shot.live.test.ts
const live = process.env.ALEPH_SHOT_LIVE === "1";
const base = mkdtempSync(join(tmpdir(), "shot-live-"));
if (live) process.env.ALEPH_RUNS_DIR = join(base, "runs");
afterAll(() => rmSync(base, { recursive: true, force: true }));

test.skipIf(!live)("a sandboxed step serves its UI and aleph-shot takes the shot outside", async () => {
  const { makeRunFolder, sandboxed } = await import("./sandbox.ts");
  const { serveShots } = await import("./shot.ts");
  const { bridge, sandboxNetnsPid } = await import("./netns.ts");
  const repo = join(import.meta.dir, "../..");
  const dir = makeRunFolder("shot-live");
  const git = Bun.spawnSync(["git", "-C", repo, "bundle", "create", join(dir, "in.bundle"), "HEAD"]);
  expect(git.exitCode).toBe(0);
  let child: ReturnType<typeof Bun.spawn> | null = null;
  const shots = serveShots(dir, {
    reach: async (url) => {
      const pid = child ? sandboxNetnsPid(child.pid) : null;
      if (pid === null) return { url, stop: async () => {} };
      const u = new URL(url);
      const b = await bridge(pid, Number(u.port));
      return { url: new URL(u.pathname + u.search + u.hash, b.url).href, stop: b.stop };
    },
  });
  const script = [
    "set -e", "git init -q .", "git fetch -q ../in.bundle HEAD", "git checkout -q FETCH_HEAD",
    "LANGFUSE_PUBLIC_KEY= LANGFUSE_SECRET_KEY= bun ui/server.ts --port 3100 &",
    "sleep 3",
    "aleph-shot 'http://127.0.0.1:3100/#/' shot.png --width 1440 --height 900",
  ].join("\n");
  try {
    const r = await sandboxed(dir, script, {
      read: ["in.bundle"], write: ["home", "work", "tmp"], cwd: "work", net: { domains: ["registry.npmjs.org"], localBinding: true },
      stdout: join(dir, "out.log"), stderr: join(dir, "err.log"), limit: 120, onSpawn: (p) => { child = p; },
    });
    expect(r.code, readFileSync(join(dir, "err.log"), "utf8")).toBe(0);
  } finally { await shots.stop(); }
  const png = join(dir, "work/shot.png");
  expect(existsSync(png)).toBe(true);
  expect(readFileSync(png).readUInt32BE(16)).toBe(1440);
}, 180_000);
