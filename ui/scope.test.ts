import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eventIn, inProject, memoryIn, repoIn, scopeOf, traceIn } from "./api/scope.ts";
import { SESSIONS } from "../lib/windows.ts";
import { withEnv } from "./test-server.ts";
import { forProject } from "./api/now.ts";

let dir: string, restore: () => void;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "scope-"));
  writeFileSync(join(dir, "repos.json"), JSON.stringify({ alpha: { path: "/repos/alpha" }, "alpha-ui": { path: "/repos/alpha-ui" } }));
  restore = withEnv({ ALEPH_REPOS: join(dir, "repos.json") });
});
afterAll(() => { restore(); rmSync(dir, { recursive: true, force: true }); });

test("an item belongs to the project that parseId gives as its repo", () => {
  expect(inProject("alpha-ui-3", "alpha-ui")).toBe(true);
  expect(inProject("alpha-ui-3", "alpha")).toBe(false);
  expect(inProject("alpha-3", "alpha")).toBe(true);
  expect(inProject("alpha-3", "zeta")).toBe(false);
  expect(inProject("zeta-3", "zeta")).toBe(false);
});

test("a trace belongs by cwd under the registry path, else by its project tag", () => {
  expect(traceIn({ metadata: { cwd: "/repos/alpha/sub" } }, "alpha")).toBe(true);
  expect(traceIn({ metadata: { cwd: "/other/alpha" } }, "alpha")).toBe(false);
  expect(traceIn({ metadata: {}, tags: ["project:alpha"] }, "alpha")).toBe(true);
  expect(traceIn({ metadata: {}, tags: ["project:zeta"] }, "zeta")).toBe(false);
  expect(traceIn({ metadata: { cwd: "/repos/alpha" } }, "zeta")).toBe(false);
});

test("no project is no filter, and an unknown project matches nothing", () => {
  for (const p of [null, undefined, ""]) {
    expect(inProject("zeta-3", p)).toBe(true);
    expect(repoIn("zeta", p)).toBe(true);
    expect(memoryIn("zeta", p)).toBe(true);
  }
  expect(repoIn("zeta", "zeta")).toBe(false);
  expect(memoryIn("global", "zeta")).toBe(false);
  expect(eventIn("rule-reason", "zeta")).toBe(false);
});

test("an event with an issue subject follows that issue; any other subject is in every known project", () => {
  expect(eventIn("alpha-3", "alpha")).toBe(true);
  expect(eventIn("alpha-ui-3", "alpha")).toBe(false);
  expect(eventIn("protected", "alpha")).toBe(true);
  expect(eventIn(undefined, "alpha")).toBe(true);
});

test("a memory item is in its own project, and a global or unscoped one is in every project", () => {
  expect(memoryIn("alpha", "alpha")).toBe(true);
  expect(memoryIn("alpha-ui", "alpha")).toBe(false);
  expect(memoryIn("global", "alpha")).toBe(true);
  expect(memoryIn("", "alpha-ui")).toBe(true);
});

test("the Status answer for a project keeps its Herald events and the ones of no issue", () => {
  const events = ["alpha-1", "alpha-ui-2", "protected"].map((subject) => ({ at: "2026-11-04T12:00:00Z", by: "rule", subject, action: "changed" }));
  const s: any = { stuck: [], running: [], done: [], doneStamps: [], queued: [], runningIssues: [], asks: [], herald: { history: [], events, titles: {} } };
  expect(forProject(s, "alpha").herald!.events.map((e) => e.subject)).toEqual(["alpha-1", "protected"]);
});

test("scopeOf reads the project and the window by name, with the route's default, and refuses another window", async () => {
  const at = (q: string, fallback?: string, names?: string[]) => scopeOf(new URL(`http://x/api/flow${q}`), fallback, names);
  expect(at("")).toEqual({ project: null, window: "week", ms: 7 * 86_400_000, days: 7 });
  expect(at("?window=&project=")).toEqual({ project: null, window: "week", ms: 7 * 86_400_000, days: 7 });
  expect(at("?window=hour&project=alpha")).toEqual({ project: "alpha", window: "hour", ms: 3_600_000, days: 1 / 24 });
  expect(at("", "month", SESSIONS)).toMatchObject({ window: "month", days: 30 });
  expect(at("?window=quarter", "week", SESSIONS)).toMatchObject({ window: "quarter", days: 90 });
  for (const [q, names] of [["?window=year"], ["?window=7"], ["?window=quarter"], ["?window=day", SESSIONS]] as [string, string[]?][]) {
    const r = at(q, "week", names);
    expect(r, q).toBeInstanceOf(Response);
    expect((r as Response).status, q).toBe(400);
    expect(((await (r as Response).json()) as any).error, q).toStartWith("window must be one of");
  }
});
