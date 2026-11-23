import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "handoff-start.ts");
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aleph-handoff-"));
  mkdirSync(join(root, "handoffs", "projects"), { recursive: true });
  mkdirSync(join(root, "proj"));
  mkdirSync(join(root, "other"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(cwd: string, env: Record<string, string | undefined> = {}) {
  const r = Bun.spawnSync(["bun", HOOK], {
    stdin: Buffer.from(JSON.stringify({ hook_event_name: "SessionStart", source: "clear", cwd })),
    env: { ...process.env, ALEPH_HANDOFFS_DIR: join(root, "handoffs"), CLAUDE_CODE_ENTRYPOINT: "cli", ALEPH_JOB_ID: undefined, HERDR_ENV: undefined, HERDR_PANE_ID: undefined, HC_RUNTIME: undefined, HC_TERMINAL_ID: undefined, ...env },
    stdout: "pipe", stderr: "pipe",
  });
  expect(r.exitCode).toBe(0);
  return r.stdout.toString().trim();
}

const write = (scope: string, text: string) => writeFileSync(join(root, "handoffs", "projects", `${scope}.md`), text);

test("a project's handoff shows its summary and asks for a pickup", () => {
  write("proj", "summary: fix the two failing recall tests\n\n## Intent\nx\n");
  const out = JSON.parse(run(join(root, "proj")));
  expect(out.systemMessage).toMatch(/^handoff waiting \(proj, \d\d:\d\d\): fix the two failing recall tests$/);
  expect(out.hookSpecificOutput.additionalContext).toContain("run the aleph:pickup skill with no argument");
  expect(out.hookSpecificOutput.additionalContext).toContain(join(root, "handoffs", "projects", "proj.md"));
});

test("another project's handoff prints nothing", () => {
  write("proj", "summary: x\n");
  expect(run(join(root, "other"))).toBe("");
});

test("headless sessions and factory jobs print nothing", () => {
  write("proj", "summary: x\n");
  expect(run(join(root, "proj"), { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" })).toBe("");
  expect(run(join(root, "proj"), { ALEPH_JOB_ID: "j1" })).toBe("");
});

test("a handoff with no summary line shows its Intent line", () => {
  write("proj", "## Intent\nx\n");
  expect(JSON.parse(run(join(root, "proj"))).systemMessage).toEndWith(": x");
});

test("an empty summary line does not take the next line, and the Intent line shows", () => {
  write("proj", `summary:\nstray-line-5521\n\n## Intent\nintent-line-7730\n\n${"x".repeat(10000)}\n`);
  const ctx = JSON.parse(run(join(root, "proj"))).hookSpecificOutput.additionalContext;
  expect(ctx).not.toContain("stray-line-5521");
  expect(ctx).toContain("intent-line-7730");
});

test("the context holds the handoff text, while the system message keeps the summary", () => {
  write("proj", "summary: s1\n\n## Intent\nunique-sentence-4417\n");
  const out = JSON.parse(run(join(root, "proj")));
  expect(out.hookSpecificOutput.additionalContext).toContain("unique-sentence-4417");
  expect(out.systemMessage).toEndWith(": s1");
});

test("the context holds git status and log in a repo, and none outside git", () => {
  write("proj", "summary: s\n");
  expect(JSON.parse(run(join(root, "proj"))).hookSpecificOutput.additionalContext).not.toContain("git status:");
  const dir = join(root, "proj");
  Bun.spawnSync(["git", "init", "-b", "trunk-x"], { cwd: dir });
  Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "marker commit 9921"], { cwd: dir });
  const ctx = JSON.parse(run(dir)).hookSpecificOutput.additionalContext;
  expect(ctx).toContain("marker commit 9921");
  expect(ctx).toContain("On branch trunk-x");
});

test("a handoff that makes the context too long falls back to the summary and path", () => {
  write("proj", `summary: s\n\nnear-limit-marker ${"x".repeat(9000)}\n`);
  const near = JSON.parse(run(join(root, "proj"))).hookSpecificOutput.additionalContext;
  expect(near).toContain("near-limit-marker");
  expect(near.length).toBeLessThanOrEqual(10000);
  write("proj", `summary: s\n\nlong-body-marker ${"x".repeat(10000)}\n`);
  const ctx = JSON.parse(run(join(root, "proj"))).hookSpecificOutput.additionalContext;
  expect(ctx.length).toBeLessThanOrEqual(10000);
  expect(ctx).not.toContain("long-body-marker");
  expect(ctx).toContain(join(root, "handoffs", "projects", "proj.md"));
  expect(ctx).toContain("run the aleph:pickup skill with no argument");
});

const named = (name: string, text: string) => writeFileSync(join(root, "handoffs", `${name}.md`), text);

test("a named handoff whose cwd holds the session's directory asks for a pickup by name", () => {
  named("voice", `summary: finish the bridge\ncwd: ${join(root, "proj")}\n\nnamed-body-3301\n`);
  mkdirSync(join(root, "proj", "sub"));
  for (const dir of [join(root, "proj"), join(root, "proj", "sub")]) {
    const out = JSON.parse(run(dir));
    expect(out.systemMessage).toMatch(/^handoff waiting \(voice, \d\d:\d\d\): finish the bridge$/);
    expect(out.hookSpecificOutput.additionalContext).toContain("run the aleph:pickup skill with the argument voice");
    expect(out.hookSpecificOutput.additionalContext).toContain("named-body-3301");
  }
});

test("a named handoff for another directory, with no cwd, or archived prints nothing", () => {
  named("voice", `summary: x\ncwd: ${join(root, "other")}\n`);
  named("bare", "summary: x\n");
  named("2026-11-10-120000-voice", `summary: x\ncwd: ${join(root, "proj")}\n`);
  mkdirSync(join(root, "proj-2"));
  named("near", `summary: x\ncwd: ${join(root, "proj")}\n`);
  expect(run(join(root, "proj"))).not.toBe("");
  expect(run(join(root, "proj-2"))).toBe("");
  expect(run(join(root, "proj"))).not.toContain("voice");
});

test("a project handoff and a named handoff both show", () => {
  write("proj", "summary: project work\n");
  named("voice", `summary: voice work\ncwd: ${join(root, "proj")}\n`);
  const out = JSON.parse(run(join(root, "proj")));
  expect(out.systemMessage.split("\n")).toHaveLength(2);
  expect(out.hookSpecificOutput.additionalContext).toContain("with no argument");
  expect(out.hookSpecificOutput.additionalContext).toContain("with the argument voice");
});

describe("inside Herdr", () => {
  const bin = () => {
    const dir = join(root, "bin");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "herdr"), `#!/bin/sh\necho '{"result":{"panes":[{"pane_id":"p7"},{"pane_id":"p8"}]}}'\n`, { mode: 0o755 });
    return dir;
  };
  const herdr = () => ({ HERDR_ENV: "1", HERDR_PANE_ID: "p7", PATH: `${bin()}:${process.env.PATH}` });
  const pane = (id: string, text: string) => {
    mkdirSync(join(root, "handoffs", "projects", "proj"), { recursive: true });
    writeFileSync(join(root, "handoffs", "projects", "proj", `${id}.md`), text);
  };

  test("this pane's file asks for a pickup and a live pane's file or a session outside Herdr prints nothing", () => {
    pane("p7", "summary: s1\n");
    pane("p8", "summary: s8\n");
    const out = JSON.parse(run(join(root, "proj"), herdr()));
    expect(out.systemMessage).toMatch(/^handoff waiting \(proj, \d\d:\d\d\): s1$/);
    expect(out.hookSpecificOutput.additionalContext).toContain("aleph:pickup");
    expect(out.hookSpecificOutput.additionalContext).not.toContain("p8.md");
    expect(run(join(root, "proj"), { ...herdr(), HERDR_ENV: undefined })).toBe("");
    rmSync(join(root, "handoffs", "projects", "proj", "p7.md"));
    expect(run(join(root, "proj"), herdr())).toBe("");
  });

  test("a file of a pane Herdr lacks is orphaned and needs the user's word", () => {
    pane("p9", "summary: s2\n");
    const out = JSON.parse(run(join(root, "proj"), herdr()));
    expect(out.systemMessage).toMatch(/orphaned.*s2/);
    expect(out.hookSpecificOutput.additionalContext).toContain(join(root, "handoffs", "projects", "proj", "p9.md"));
    expect(out.hookSpecificOutput.additionalContext).toContain("Ask the user");
  });

  test("the flat file asks for a pickup by its path, since no argument reads this pane's file", () => {
    write("proj", "summary: flat\n");
    const flat = join(root, "handoffs", "projects", "proj.md");
    expect(JSON.parse(run(join(root, "proj"), herdr())).hookSpecificOutput.additionalContext).toContain(`run the aleph:pickup skill with the argument ${flat}`);
  });

  test("an hc file is never orphaned inside the Herdr TUI", () => {
    pane("hc-t9", "summary: s9\n");
    expect(run(join(root, "proj"), herdr())).toBe("");
  });
});

describe("inside the desktop app", () => {
  test("this terminal's file waits, a file of a terminal hc lacks is orphaned, and a pane's file is ignored", () => {
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "hc"), `#!/bin/sh\n[ "$1" = get ] && [ "$2" = t12 ]\n`, { mode: 0o755 });
    mkdirSync(join(root, "handoffs", "projects", "proj"), { recursive: true });
    for (const [id, text] of [["hc-t12", "s12"], ["hc-t9", "s9"], ["p8", "s8"]]) writeFileSync(join(root, "handoffs", "projects", "proj", `${id}.md`), `summary: ${text}\n`);
    const out = JSON.parse(run(join(root, "proj"), { HC_TERMINAL_ID: "t12", PATH: `${bin}:${process.env.PATH}` }));
    const lines = out.systemMessage.split("\n");
    expect(lines.find((l: string) => l.includes("s12"))).toMatch(/^handoff waiting/);
    expect(lines.find((l: string) => l.includes("s9"))).toMatch(/^handoff orphaned/);
    expect(out.hookSpecificOutput.additionalContext).toContain("Ask the user");
    expect(out.hookSpecificOutput.additionalContext).toContain(join(root, "handoffs", "projects", "proj", "hc-t9.md"));
    expect(out.hookSpecificOutput.additionalContext).not.toContain("p8.md");
  });
});
