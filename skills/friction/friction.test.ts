import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findings, norm, signals } from "./scan.ts";

const line = (session: string, at: string, r: object) => JSON.stringify({ sessionId: session, timestamp: at, entrypoint: "cli", cwd: `/w/${session}`, ...r });
const hook = (s: string, at: string, stderr: string) =>
  line(s, at, { type: "attachment", attachment: { type: "hook_non_blocking_error", hookEvent: "Stop", command: "one way", stderr } });
const user = (s: string, at: string, content: unknown) => line(s, at, { type: "user", message: { role: "user", content } });
const bash = (s: string, at: string, id: string, command: string) =>
  line(s, at, { type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });

let dir = "";
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

test("norm keys one cause the same way across sessions", () => {
  expect(norm("Exit code 1\nerror: Module not found (at 12:3) a1b2c3d4e")).toBe("error: Module not found (…) <sha>");
});

test("signals reads hook errors from attachments and from PreToolUse results", () => {
  const ss = signals([
    hook("a", "2026-11-10T00:00:00Z", 'error: Module not found "/x/hook.ts"'),
    bash("a", "2026-11-10T00:00:01Z", "t1", "git commit -m x"),
    user("a", "2026-11-10T00:00:02Z", [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "PreToolUse:Bash hook error: secret-scan: cannot find the repo (/tmp/x)" }]),
    "{cut off",
  ].join("\n"));
  expect(ss.map((s) => [s.kind, s.key])).toEqual([
    ["hook", 'Stop hook "one way": error: Module not found "/x/hook.ts"'],
    ["command", "git commit -m x"],
    ["hook", "PreToolUse hook: secret-scan: cannot find the repo (…)"],
  ]);
});

test("signals skips commands that only read and errors that name no cause", () => {
  const ss = signals([
    bash("a", "2026-11-10T00:00:00Z", "t1", "cd ~/x && sed -n 1,5p a.ts"),
    bash("a", "2026-11-10T00:00:01Z", "t2", "git diff"),
    user("a", "2026-11-10T00:00:02Z", [{ type: "tool_result", tool_use_id: "t2", is_error: true, content: "Exit code 1\n" }]),
  ].join("\n"));
  expect(ss).toEqual([]);
});

test("signals finds a gate loop, a duplicate skill and a skill loaded twice", () => {
  const deny = (n: number) => user("a", `2026-11-10T00:00:0${n}Z`, "Stop hook feedback: Verify gate: no run backs the claim");
  const skill = (id: string) => line("a", "2026-11-10T00:00:05Z", { type: "assistant", message: { content: [{ type: "tool_use", id, name: "Skill", input: { skill: "aleph:vault" } }] } });
  const listing = line("a", "2026-11-10T00:00:00Z", { type: "attachment", attachment: { type: "skill_listing", names: ["aleph:humanizer", "humanizer:humanizer", "aleph:vault"] } });
  const ss = signals([listing, deny(1), deny(2), deny(3), skill("s1"), skill("s2")].join("\n"));
  expect(ss.filter((s) => s.kind !== "gate").map((s) => s.key)).toEqual([
    "skill listed 2 times: aleph:humanizer, humanizer:humanizer",
    "3+ gate denials in a row",
    "aleph:vault loaded 2 times in one session",
  ]);
  expect(ss.filter((s) => s.kind === "gate").map((s) => s.key)).toEqual(Array(3).fill("denied by Verify gate"));
});

test("findings keeps errors from two sessions and repeated work from three", () => {
  const ss = signals([
    hook("a", "2026-11-10T00:00:00Z", "boom"), hook("a", "2026-11-10T00:00:01Z", "boom"),
    hook("b", "2026-11-11T00:00:00Z", "boom"),
    user("a", "2026-11-10T00:00:02Z", "continue"), user("b", "2026-11-11T00:00:02Z", "continue"),
    hook("c", "2026-11-11T00:00:00Z", "once"),
  ].join("\n"));
  const { findings: fs } = findings(ss, 25);
  expect(fs.map((f) => [f.kind, f.key, f.count, f.sessions, f.days, f.ids, f.cwd])).toEqual([
    ["hook", 'Stop hook "one way": boom', 3, 2, 2, ["b", "a"], "/w/b"],
  ]);
});

test("a finding is fixed when a commit touched its path after the last hit", () => {
  dir = mkdtempSync(join(tmpdir(), "friction-"));
  const git = (...args: string[]) => Bun.spawnSync(["git", "-C", dir, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_COMMITTER_DATE: "2026-11-10T12:00:00Z" } });
  git("init", "-q");
  writeFileSync(join(dir, "hook.ts"), "");
  git("add", "-A");
  git("commit", "-qm", "fix");
  const err = `error: Module not found "${dir}/hook.ts"`;
  const at = (s: string, t: string) => hook(s, t, err);
  const before = findings(signals([at("a", "2026-11-10T00:00:00Z"), at("b", "2026-11-10T01:00:00Z")].join("\n")), 25).findings[0];
  const after = findings(signals([at("a", "2026-11-10T00:00:00Z"), at("b", "2026-11-10T13:00:00Z")].join("\n")), 25).findings[0];
  expect([before.open, after.open, before.changed]).toEqual([false, true, "2026-11-10T12:00:00+00:00"]);
});
