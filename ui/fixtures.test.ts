import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let base: string, proc: ReturnType<typeof Bun.spawn>, port: number;
const get = async (p: string) => (await fetch(`http://127.0.0.1:${port}${p}`)).json() as Promise<any>;

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-fixture-"));
  const build = Bun.spawnSync([process.execPath, join(import.meta.dir, "fixtures", "review", "build.ts"), join(base, "home")], { stdout: "pipe", stderr: "pipe" });
  if (build.exitCode !== 0) throw new Error(build.stderr.toString());
  const env: Record<string, string> = { ...process.env as Record<string, string>, LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "" };
  for (const l of build.stdout.toString().trim().split("\n")) env[l.slice(0, l.indexOf("="))] = l.slice(l.indexOf("=") + 1);
  proc = Bun.spawn([process.execPath, join(import.meta.dir, "server.ts"), "--port", "0"], { env: { ...env, HOME: join(base, "empty") }, stdout: "pipe", stderr: "ignore" });
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const line = new TextDecoder().decode((await reader.read()).value);
  port = Number(new URL(line.trim()).port);
});
afterAll(() => { proc.kill(); rmSync(base, { recursive: true, force: true }); });

test("the review fixture gives the one-off server jobs, issues, projects and notes", async () => {
  const jobs = await get("/api/jobs");
  const count = (state: string) => jobs.filter((j: any) => j.state === state).length;
  // The old-shape runs and the new-shape ones: every state the fixture shows, and the review runs' needs.
  expect(jobs.length).toBe(16);
  expect(["dropped", "landed", "awaiting", "running", "stuck"].map(count)).toEqual([3, 1, 3, 6, 3]);
  expect(jobs.filter((j: any) => j.state === "awaiting").map((j: any) => j.ask?.reason ?? null).sort()).toEqual(["held-path", "held-path", "review"]);
  // Every stage has an item, and Incoming says the stage.
  const { incoming } = await get("/api/state");
  expect(incoming.every((i: any) => typeof i.stage === "string" && i.stage !== "open")).toBe(true);
  const issues = await get("/api/issues?all=1");
  expect(new Set(issues.map((i: any) => i.repo))).toEqual(new Set(["demo", "tools"]));
  expect(new Set(issues.map((i: any) => i.status))).toEqual(new Set(["open", "done", "dropped"]));
  expect(issues.some((i: any) => i.labels.includes("bug"))).toBe(true);
  expect((await get("/api/memory")).total).toBe(4);
  expect(JSON.stringify(await get("/api/projects"))).toContain("tools");
});

test("the review fixture's speed API fills four Efficiency classes, two or more of them lost", async () => {
  const { classes } = await get("/api/speed?window=week");
  const filled = classes.filter((c: any) => c.hours > 0);
  expect(filled.length).toBeGreaterThanOrEqual(4);
  expect(filled.filter((c: any) => ["nothing", "loop", "restarted", "dropped"].includes(c.key)).length).toBeGreaterThanOrEqual(2);
  expect(filled.some((c: any) => ["nothing", "loop", "restarted", "dropped"].includes(c.key) && c.causes.length >= 2 && c.goals >= 2)).toBe(true);
});

test("project paths come from the project names, never from the fixture's own repos.json", () => {
  const src = mkdtempSync(join(tmpdir(), "aleph-ui-fixture-src-")), dest = join(base, "hostile");
  try {
    cpSync(join(import.meta.dir, "fixtures", "review"), src, { recursive: true });
    const outside = join(base, "outside");
    writeFileSync(join(src, "repos.json"), JSON.stringify({ demo: { path: outside, main: "main" }, "../up": { main: "main" } }));
    expect(Bun.spawnSync([process.execPath, join(import.meta.dir, "fixtures", "review", "build.ts"), dest, src], { stdout: "pipe", stderr: "pipe" }).exitCode).not.toBe(0);
    writeFileSync(join(src, "repos.json"), JSON.stringify({ demo: { path: outside, main: "main" } }));
    expect(Bun.spawnSync([process.execPath, join(import.meta.dir, "fixtures", "review", "build.ts"), dest, src], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(dest, "repos.json"), "utf8")).demo.path).toBe(join(dest, "repos", "demo"));
    expect(existsSync(outside)).toBe(false);
  } finally { rmSync(src, { recursive: true, force: true }); }
});

test("links in the clone's fixture are not followed: nothing outside dest is written or copied", () => {
  const src = mkdtempSync(join(tmpdir(), "aleph-ui-fixture-src-")), dest = join(base, "links");
  const outside = join(base, "outside-links");
  try {
    cpSync(join(import.meta.dir, "fixtures", "review"), src, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.md"), "private");
    const target = join(outside, "state.json");
    writeFileSync(target, JSON.stringify({ started: "2026-10-28T12:00:00Z" }));
    const before = readFileSync(target, "utf8");
    mkdirSync(join(src, "jobs", "planted"));
    symlinkSync(target, join(src, "jobs", "planted", "state.json"));
    symlinkSync(outside, join(src, "vault", "link"));
    symlinkSync(join(outside, "secret.md"), join(src, "vault", "secret.md"));
    const p = Bun.spawnSync([process.execPath, join(import.meta.dir, "fixtures", "review", "build.ts"), dest, src], { stdout: "pipe", stderr: "pipe" });
    expect(p.exitCode).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(before);
    expect(existsSync(join(dest, "vault", "link"))).toBe(false);
    expect(existsSync(join(dest, "vault", "secret.md"))).toBe(false);
    expect(existsSync(join(dest, "jobs", "planted", "state.json"))).toBe(false);
  } finally { rmSync(src, { recursive: true, force: true }); }
});
