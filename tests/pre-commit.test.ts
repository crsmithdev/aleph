import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hooks = join(import.meta.dir, "..", ".githooks");
let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const git = (cwd: string, env: Record<string, string>, ...a: string[]) =>
  Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, env, stdout: "pipe", stderr: "pipe" });

/** A repo with the hook on and a stub `agnix` that exits `code` and records its arguments; `PATH` has the stub when `stub`. */
function setup(code: number, stub = true) {
  dir = mkdtempSync(join(tmpdir(), "precommit-"));
  const w = join(dir, "work");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "agnix"), `#!/bin/sh\necho "$@" > ${join(dir, "record")}\nexit ${code}\n`, { mode: 0o755 });
  // The tools the hook needs, linked into a PATH of their own: the real PATH may hold a real agnix.
  const tools = join(dir, "tools");
  mkdirSync(tools);
  for (const t of ["git", "grep", "tr", "xargs"]) symlinkSync(Bun.which(t)!, join(tools, t));
  const env = { ...process.env, PATH: stub ? `${bin}:${tools}` : tools } as Record<string, string>;
  mkdirSync(w);
  git(w, env, "init", "-q");
  git(w, env, "config", "core.hooksPath", hooks);
  git(w, env, "commit", "-q", "--allow-empty", "-m", "start");
  const head = () => git(w, env, "rev-parse", "HEAD").stdout.toString().trim();
  const commit = (path: string) => {
    mkdirSync(join(w, path, ".."), { recursive: true });
    writeFileSync(join(w, path), "x\n");
    git(w, env, "add", path);
    return git(w, env, "commit", "-qm", "x");
  };
  return { head, commit, git: (...a: string[]) => git(w, env, ...a), work: w, record: join(dir, "record") };
}

test("an agnix that exits 1 refuses the commit of a CLAUDE.md", () => {
  const s = setup(1);
  const before = s.head();
  expect(s.commit("CLAUDE.md").exitCode).not.toBe(0);
  expect(s.head()).toBe(before);
});

test("a commit of a skill file runs agnix with -t claude-code and the file", () => {
  const s = setup(0);
  expect(s.commit("skills/x/SKILL.md").exitCode).toBe(0);
  const args = readFileSync(s.record, "utf8").trim().split(" ");
  expect(args).toContain("claude-code");
  expect(args.slice(0, 2)).toEqual(["-t", "claude-code"]);
  expect(args).toContain("skills/x/SKILL.md");
});

test("a commit of only a .ts file does not run agnix", () => {
  const s = setup(1);
  expect(s.commit("a.ts").exitCode).toBe(0);
  expect(existsSync(s.record)).toBe(false);
  // The hook is on: the next commit, of an agent file, runs agnix.
  expect(s.commit("CLAUDE.md").exitCode).not.toBe(0);
  expect(existsSync(s.record)).toBe(true);
});

test("git commit -a of a changed CLAUDE.md runs agnix on it", () => {
  const s = setup(1);
  writeFileSync(join(s.work, "CLAUDE.md"), "x\n");
  s.git("add", "CLAUDE.md");
  s.git("commit", "-qm", "x", "--no-verify");
  writeFileSync(join(s.work, "CLAUDE.md"), "y\n");
  const before = s.head();
  expect(s.git("commit", "-qam", "y").exitCode).not.toBe(0);
  expect(readFileSync(s.record, "utf8")).toContain("CLAUDE.md");
  expect(s.head()).toBe(before);
});

test("a commit of a CLAUDE.md with no agnix on PATH is refused with a message that names agnix", () => {
  const s = setup(0, false);
  const p = s.commit("CLAUDE.md");
  expect(p.exitCode).not.toBe(0);
  expect(p.stderr.toString()).toContain("agnix");
});
