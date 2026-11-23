import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memory, use } from "../../lib/langfuse.ts";
import { routes } from "./hooks.ts";
import { withEnv } from "../server.testkit.ts";

// The Hooks page's routes on fixture transcripts, with the clock fixed so the 7-day window is known.
const NOW = new Date("2026-11-19T12:00:00Z"), HOUR_AGO = "2026-11-19T11:00:00.000Z", DAYS_AGO = "2026-11-16T12:00:00.000Z", OLD = "2026-11-10T12:00:00.000Z";
let base: string, restore: () => void;
const call = async (path: string, params: Record<string, string> = {}, query = "") => routes[path](new Request("http://x"), params, new URL(`http://x/${query}`));
const get = async (path: string, params: Record<string, string> = {}, query = "") => (await call(path, params, query)).json() as Promise<any>;

/** A transcript of `lines` (one JSON entry each) in project folder `project`, written now. */
function transcript(project: string, sid: string, lines: object[]) {
  mkdirSync(join(base, project), { recursive: true });
  const f = join(base, project, `${sid}.jsonl`);
  writeFileSync(f, lines.map((l) => JSON.stringify({ sessionId: sid, ...l })).join("\n") + "\n");
  utimesSync(f, NOW, NOW);
}
const holdBy = (command: string, text: string, at: string, who: object) =>
  ({ type: "attachment", timestamp: at, ...who, attachment: { type: "hook_blocking_error", hookEvent: "Stop", blockingError: { command, blockingError: text } } });
const failBy = (command: string, at: string, who: object) =>
  ({ type: "attachment", timestamp: at, ...who, attachment: { type: "hook_non_blocking_error", hookEvent: "SessionStart", command, stderr: 'Failed with non-blocking status code: error: Module not found "/x/jobs/cli.ts"' } });
const terminal = { entrypoint: "cli", cwd: "/home/u/repo" }, worker = { entrypoint: "sdk-cli", cwd: "/home/u/repo/.worktrees/job-issue.9" };

beforeAll(() => {
  setSystemTime(NOW);
  base = mkdtempSync(join(tmpdir(), "aleph-ui-hooks-"));
  restore = withEnv({ ALEPH_CLAUDE_PROJECTS: base, LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "" });
  transcript("-home-u-repo", "s-term", [
    holdBy("verify gate", "Verify gate: The final message cites commit abc123 and no run shows it.", HOUR_AGO, terminal),
    { type: "assistant", timestamp: HOUR_AGO, ...terminal, message: { content: [{ type: "text", text: "I need to correct one claim: the commit is not on main." }] } },
    failBy("factory report", HOUR_AGO, terminal),
    holdBy("verify gate", "Verify gate: The final message cites commit def456 and no run shows it.", DAYS_AGO, terminal),
    holdBy("context gate", "Context gate: this session has compacted.", OLD, terminal),
    failBy("factory report", OLD, terminal),
  ]);
  transcript("-home-u-repo--worktrees-job-issue-9", "s-work", [holdBy("one way", "Refit: x.ts:1-9 repeats y.ts:1-9 (9 lines), a copy the base did not have.", HOUR_AGO, worker)]);
});
afterAll(() => { restore(); setSystemTime(); rmSync(base, { recursive: true, force: true }); });

test("a terminal session's hold has its hook, event, kind, session kind and outcome, and an error its cause and fix", async () => {
  const r = await get("GET /api/hooks");
  expect(r.holds.find((h: any) => h.sid === "s-term")).toEqual({
    t: HOUR_AGO, sid: "s-term", project: "", hook: "verify gate", event: "Stop", kind: "unbacked hash", who: "interactive", out: "caught",
    why: "The final message cites commit abc123 and no run shows it.",
  });
  expect(r.errors).toEqual([{ cause: "Moved hook file", fix: "Stub or stable entry", n: 1, sessions: 1, hooks: ["factory report"], events: ["SessionStart"], last: HOUR_AGO }]);
});

test("a headless worker session's hold counts under Workers, with no effect", async () => {
  const r = await get("GET /api/hooks");
  expect(r.byHook.find((x: any) => x.hook === "one way")).toEqual({ hook: "one way", event: "Stop", kind: "new-copy", holds: 1, interactive: 0, workers: 1, outcomes: { "no effect": 1 } });
});

test("each hook says from its code whether a factory worker runs it", async () => {
  const r = await get("GET /api/hooks"), of = (name: string) => r.hooks.find((h: any) => h.name === name).workers;
  expect(["verify gate", "context gate", "one way", "vault", "git-guard", "factory report"].map(of)).toEqual(["skips", "skips", "skips", "runs", "runs", "runs"]);
});

test("each hook has the newest commit of its entry file in the window, for the change note, or null", async () => {
  const week = await get("GET /api/hooks"), hour = await get("GET /api/hooks", {}, "?window=hour");
  expect(week.hooks.find((h: any) => h.name === "one way").changed).toEqual({
    hash: "abf2a568feddd16b0da8eb2be9f58c16b1f20fa7", t: "2026-11-17T14:27:57-08:00", subject: "refit-code waste f58: recall from the FTS index keyed by HEAD, not every note",
  });
  expect(hour.hooks.filter((h: any) => h.changed)).toEqual([]);
});

test("a hook's page has its command, and its entry file with the local files it imports; a cli/ hook has no files", async () => {
  const one = await get("GET /api/hooks/:event/:name", { event: "Stop", name: "one way" }), cli = await get("GET /api/hooks/:event/:name", { event: "SessionStart", name: "factory report" });
  expect(one.command).toBe("bun skills/refit-code/hook.ts");
  expect(one.source.map((s: any) => s.file)).toEqual(["skills/refit-code/hook.ts", "lib/env.ts", "lib/git.ts", "lib/json.ts", "hooks/lib/handshake.ts", "skills/refit-code/clones.ts", "skills/refit-code/cochange.ts"]);
  expect(one.source[0].text).toContain('if (input.hook_event_name !== "Stop" || isAgent()) process.exit(0);');
  expect([cli.command, cli.source]).toEqual(["bun cli/cli.ts report --hook", []]);
});

test("a hook with no entries in the window has zero holds and zero errors", async () => {
  const r = await get("GET /api/hooks/:event/:name", { event: "Stop", name: "context gate" });
  expect([r.file, r.holds, r.errors]).toEqual(["hooks/context-gate.ts", [], []]);
});

test("a window keeps only its holds and errors: a day leaves out 3 and 9 days ago, the week default 9 days ago", async () => {
  const day = await get("GET /api/hooks", {}, "?window=day"), week = await get("GET /api/hooks");
  expect(day.holds.map((h: any) => h.t)).toEqual([HOUR_AGO, HOUR_AGO]);
  expect(day.errors.map((e: any) => [e.n, e.last])).toEqual([[1, HOUR_AGO]]);
  expect(week.holds.map((h: any) => h.t)).toEqual([HOUR_AGO, HOUR_AGO, DAYS_AGO]);
  expect(week.errors.map((e: any) => [e.n, e.last])).toEqual([[1, HOUR_AGO]]);
});

test("a window that is not hour, day, week or month is a 400", async () => {
  expect([(await call("GET /api/hooks", {}, "?window=nope")).status, (await call("GET /api/hooks/:event/:name", { event: "Stop", name: "verify gate" }, "?window=nope")).status]).toEqual([400, 400]);
});

test("a project that holds none of the transcripts has no holds and no errors", async () => {
  const r = await get("GET /api/hooks", {}, "?project=aleph"), one = await get("GET /api/hooks/:event/:name", { event: "Stop", name: "verify gate" }, "?project=aleph");
  expect([r.holds, r.errors, r.hooks.filter((h: any) => h.holds), one.holds]).toEqual([[], [], [], []]);
});

test("calls are the hooks' Langfuse counts and the verify gate's denials, and with no Langfuse its state", async () => {
  expect((await get("GET /api/hooks")).calls).toEqual({ langfuse: "off", hooks: [], denials: { total: 0, recent: [] } });
  const span = (metadata: object, output = "") => ({ id: `s${Math.random()}`, traceId: "t", type: "SPAN", name: "verify-gate", level: "DEFAULT", startTime: HOUR_AGO, metadata, output });
  use(memory({ traces: [], observations: [span({ verdict: "deny" }, "deny: nothing was run"), span({ verdict: "pass" })] }));
  try {
    const { hooks, denials } = (await get("GET /api/hooks")).calls;
    expect([hooks.map((h: any) => [h.name, h.calls]), denials]).toEqual([[["verify-gate", 2]], { total: 1, recent: [{ at: HOUR_AGO, reason: "nothing was run" }] }]);
  } finally { use(null); }
});
