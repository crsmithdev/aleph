import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "unit-alert.ts");
let dir: string, posts: string[], status: number, server: ReturnType<typeof Bun.serve>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "unit-alert-"));
  posts = [];
  status = 200;
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (r) => { posts.push(((await r.json()) as { text: string }).text); return new Response("ok", { status }); } });
});
afterEach(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); });

// Async: a sync spawn would block the event loop that serves the tell.
const run = (unit: string) => Bun.spawn(["bun", script, unit], {
  env: { ...process.env, ALEPH_FACTORY_DIR: dir, SIDETONE_TELL_URL: `http://127.0.0.1:${server.port}/tell` },
  stdout: "pipe", stderr: "pipe",
}).exited;

test("one tell names the failed unit, a second within 30 minutes sends none, and a stamp older than 30 minutes sends one again", async () => {
  expect(await run("aleph-tick.service")).toBe(0);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toContain("aleph-tick.service");
  await run("aleph-tick.service");
  expect(posts).toHaveLength(1);
  const old = new Date("2020-01-01");
  utimesSync(join(dir, "alert-aleph-tick.service.stamp"), old, old);
  await run("aleph-tick.service");
  expect(posts).toHaveLength(2);
});

test("the stamp is for one unit: the suite's failure still tells", async () => {
  await run("aleph-tick.service");
  await run("aleph-suite.service");
  expect(posts.map((p) => p.includes("aleph-suite.service"))).toEqual([false, true]);
});

test("a tell that is refused exits 1 and leaves no stamp, so the next failure tells", async () => {
  status = 500;
  expect(await run("aleph-tick.service")).toBe(1);
  status = 200;
  await run("aleph-tick.service");
  expect(posts).toHaveLength(2);
});

for (const svc of ["aleph-tick", "aleph-suite"]) {
  test(`${svc}.service names the alert template in OnFailure=`, () => {
    const unit = readFileSync(join(import.meta.dir, `../../systemd/${svc}.service`), "utf8");
    expect(unit).toMatch(/^OnFailure=.*aleph-alert@/m);
  });
}
