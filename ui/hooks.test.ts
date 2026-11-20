import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { routes } from "./api/hooks.ts";
import { withEnv } from "./server.testkit.ts";

// The Hooks page's routes on fixture transcripts, with the clock fixed so the 7-day window is known.
const NOW = new Date("2026-11-19T12:00:00Z"), HOUR_AGO = "2026-11-19T11:00:00.000Z", OLD = "2026-11-10T12:00:00.000Z";
let base: string, restore: () => void;
const get = async (path: string, params: Record<string, string> = {}) =>
  (await routes[path](new Request("http://x"), params, new URL("http://x"))).json() as Promise<any>;

/** A transcript of `lines` (one JSON entry each) in project folder `project`, written now. */
function transcript(project: string, sid: string, lines: object[]) {
  mkdirSync(join(base, project), { recursive: true });
  const f = join(base, project, `${sid}.jsonl`);
  writeFileSync(f, lines.map((l) => JSON.stringify({ sessionId: sid, ...l })).join("\n") + "\n");
  utimesSync(f, NOW, NOW);
}
const holdBy = (command: string, text: string, at: string, who: object) =>
  ({ type: "attachment", timestamp: at, ...who, attachment: { type: "hook_blocking_error", hookEvent: "Stop", blockingError: { command, blockingError: text } } });
const terminal = { entrypoint: "cli", cwd: "/home/u/repo" }, worker = { entrypoint: "sdk-cli", cwd: "/home/u/repo/.worktrees/job-issue.9" };

beforeAll(() => {
  setSystemTime(NOW);
  base = mkdtempSync(join(tmpdir(), "aleph-ui-hooks-"));
  restore = withEnv({ ALEPH_CLAUDE_PROJECTS: base });
  transcript("-home-u-repo", "s-term", [
    holdBy("verify gate", "Verify gate: The final message cites commit abc123 and no run shows it.", HOUR_AGO, terminal),
    { type: "assistant", timestamp: HOUR_AGO, ...terminal, message: { content: [{ type: "text", text: "I need to correct one claim: the commit is not on main." }] } },
    { type: "attachment", timestamp: HOUR_AGO, ...terminal, attachment: { type: "hook_non_blocking_error", hookEvent: "SessionStart", command: "factory report", stderr: 'Failed with non-blocking status code: error: Module not found "/x/jobs/cli.ts"' } },
    holdBy("context gate", "Context gate: this session has compacted.", OLD, terminal),
  ]);
  transcript("-home-u-repo--worktrees-job-issue-9", "s-work", [holdBy("one way", "Refit: x.ts:1-9 repeats y.ts:1-9 (9 lines), a copy the base did not have.", HOUR_AGO, worker)]);
});
afterAll(() => { restore(); setSystemTime(); rmSync(base, { recursive: true, force: true }); });

test("a terminal session's hold has its hook, event, kind, session kind and outcome, and an error its cause and fix", async () => {
  const r = await get("GET /api/hooks");
  expect(r.holds.find((h: any) => h.sid === "s-term")).toEqual({
    t: HOUR_AGO, sid: "s-term", hook: "verify gate", event: "Stop", kind: "unbacked hash", who: "interactive", out: "caught",
    why: "The final message cites commit abc123 and no run shows it.",
  });
  expect(r.errors).toEqual([{ cause: "Moved hook file", fix: "Stub or stable entry", n: 1, sessions: 1, hooks: ["factory report"], events: ["SessionStart"], last: HOUR_AGO }]);
});

test("a headless worker session's hold counts under Workers, with no effect", async () => {
  const r = await get("GET /api/hooks");
  expect(r.byHook.find((x: any) => x.hook === "one way")).toEqual({ hook: "one way", kind: "new-copy", holds: 1, interactive: 0, workers: 1, outcomes: { "no effect": 1 } });
});

test("a hook with no entries in the window has zero holds and zero errors", async () => {
  const r = await get("GET /api/hooks/:event/:name", { event: "Stop", name: "context gate" });
  expect([r.file, r.holds, r.errors]).toEqual(["hooks/context-gate.ts", [], []]);
});
