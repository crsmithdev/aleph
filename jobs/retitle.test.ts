import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../todo/lib/todo.ts";
import * as store from "../todo/lib/store.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string;
let clone: string;

function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

const saved = process.env.ALEPH_ISSUES;
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-retitle-"));
  clone = join(base, "items");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), clone);
  sh(clone, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(clone, "git", "push", "-q", "origin", "main");
  Object.assign(process.env, gitEnv, { ALEPH_ISSUES: clone });
});
afterAll(() => {
  if (saved === undefined) delete process.env.ALEPH_ISSUES; else process.env.ALEPH_ISSUES = saved;
  rmSync(base, { recursive: true, force: true });
});

test("dry run lists open items, asks once, refuses bad titles, changes nothing", async () => {
  store.writeList({ key: "ra" }, "seed", (doc) => {
    const open = issues.add(doc, "open issue");
    issues.addGoal(doc, open, { title: "first goal", body: "x" });
    issues.addGoal(doc, open, { title: "second goal", body: "x" });
    const dropped = issues.addGoal(doc, open, { title: "dropped goal", body: "x" });
    dropped.fm.status = "dropped";
    const done = issues.add(doc, "done issue");
    done.fm.status = "done";
    return true;
  }, true);
  store.writeList({ key: "rb" }, "seed", (doc) => { issues.add(doc, "other open"); return true; }, true);
  sh(clone, "git", "fetch", "-q", "origin");

  const fake = join(base, "fake.sh");
  const reply = join(base, "reply.json");
  const prompt = join(base, "prompt.txt");
  writeFileSync(fake, `#!/bin/sh\ncat > "$FAKE_PROMPT"\ncat "$FAKE_REPLY"\n`);
  chmodSync(fake, 0o755);
  const run = (r: unknown) => {
    writeFileSync(reply, JSON.stringify(r));
    const before = sh(clone, "git", "rev-parse", "origin/main");
    const p = Bun.spawnSync(["bun", join(import.meta.dir, "retitle.ts")], { env: { ...process.env, ALEPH_RETITLE_CMD: fake, FAKE_REPLY: reply, FAKE_PROMPT: prompt }, stdout: "pipe", stderr: "pipe" });
    expect(sh(clone, "git", "rev-parse", "origin/main")).toBe(before);
    return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
  };

  const good = run({ titles: [
    { id: "ra-1", title: "Retitled issue" },
    { id: "ra-1.1", title: "[Group] First" },
    { id: "ra-1.2", title: "[Group] Second" },
    { id: "rb-1", title: "other open" },
  ] });
  expect(good.code).toBe(0);
  expect(good.err).toBe("");
  const rows = good.out.trim().split("\n").slice(1).map((l) => l.split("\t"));
  expect(rows.map((r) => r[0]).sort()).toEqual(["ra-1", "ra-1.1", "ra-1.2", "rb-1"]);
  expect(rows.find((r) => r[0] === "rb-1")![2]).toBe("same");
  expect(rows.find((r) => r[0] === "ra-1.1")![2]).toBe("[Group] First");
  expect(good.out).not.toContain("done issue");
  expect(good.out).not.toContain("dropped goal");

  const sent = readFileSync(prompt, "utf8");
  for (const s of ["ra-1.1", "ra-1.2", "rb-1", "open issue", "first goal", "second goal"]) expect(sent).toContain(s);
  expect(sent).not.toContain("ra-2");
  expect(sent).not.toContain("done issue");
  expect(sent).not.toContain("dropped goal");
  expect(sent).not.toContain("ra-1.3");

  const bad = run({ titles: [
    { id: "ra-1", title: "x".repeat(61) },
    { id: "ra-1.1", title: "" },
    { id: "zz-9", title: "Unknown" },
    { id: "ra-1.2", title: "Fine" },
    { id: "rb-1", title: "Fine too" },
  ] });
  expect(bad.code).toBe(0);
  const lines = bad.err.trim().split("\n");
  expect(lines.length).toBe(3);
  for (const id of ["ra-1:", "ra-1.1:", "zz-9:"]) expect(lines.some((l) => l.startsWith(id))).toBe(true);
  expect(bad.out).toContain("open issue\tsame");
});

test("--apply is refused", () => {
  const p = Bun.spawnSync(["bun", join(import.meta.dir, "retitle.ts"), "--apply"], { env: process.env, stdout: "pipe", stderr: "pipe" });
  expect(p.exitCode).not.toBe(0);
  expect(p.stderr.toString()).toContain("--apply comes later");
});
