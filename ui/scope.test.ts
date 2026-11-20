import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eventIn, inProject, memoryIn, repoIn, scopeOf, traceIn, withProjects } from "./api/scope.ts";
import { log } from "./api/gates.ts";
import { logEvent, readEvents } from "../lib/layout.ts";
import type { EventRow } from "../lib/naming.ts";
import { writeList } from "../lib/store.ts";
import { add } from "../lib/todo.ts";
import { SESSIONS } from "../lib/windows.ts";
import { withEnv } from "./server.testkit.ts";
import { forProject } from "./api/now.ts";
import { seed } from "../jobs/job.testkit.ts";
import { newItems, writeRepos } from "../tests/projects.testkit.ts";

let dir: string, restore: () => void;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "scope-"));
  const items = newItems(dir, "items");
  writeRepos({ alpha: { path: "/repos/alpha" }, "alpha-ui": { path: "/repos/alpha-ui" } }, items);
  restore = withEnv({ ALEPH_ITEMS: items, ALEPH_DB: join(dir, "aleph.db") });
  writeList({ key: "alpha" }, "seed", (doc) => { add(doc, "an issue of alpha"); return true; }, true);
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

test("an event on an issue key takes its issue's project, and keeps a job's project or none to give", () => {
  const time = "2026-11-04T12:00:00Z", now = Date.parse(time) + 1000;
  for (const n of [1, 99]) logEvent({ time, subject: "rule", action: "changed", object: `issue.${n}` });
  const rows = (project?: string) => log(now, 10, 60_000, project);
  const row = rows().find((e) => e.object === "issue.1")!;
  expect(row.project).toBe("alpha");
  expect(eventIn(row.object, "alpha", row.project)).toBe(true);
  expect(eventIn(row.object, "alpha-ui", row.project)).toBe(false);
  expect(rows("alpha-ui").map((e) => e.object)).not.toContain("issue.1");
  expect(withProjects([{ ...row, project: "alpha-ui" }])[0].project).toBe("alpha-ui");
  expect(rows().find((e) => e.object === "issue.99")!.project ?? null).toBeNull();
  expect(withProjects<EventRow>([{ time, subject: "rule", action: "changed", object: "protected" }])[0].project ?? null).toBeNull();
});

test("a memory item is in its own project, and a global or unscoped one is in every project", () => {
  expect(memoryIn("alpha", "alpha")).toBe(true);
  expect(memoryIn("alpha-ui", "alpha")).toBe(false);
  expect(memoryIn("global", "alpha")).toBe(true);
  expect(memoryIn("", "alpha-ui")).toBe(true);
});

test("the Status answer for a project keeps its Herald events and the ones of no issue", () => {
  const events = ["alpha-1", "alpha-ui-2", "protected"].map((object) => ({ time: "2026-11-04T12:00:00Z", subject: "rule", object, action: "changed" }));
  const s: any = { errored: [], running: [], done: [], doneStamps: [], queued: [], runningIssues: [], asks: [], herald: { history: [], events, titles: {} } };
  expect(forProject(s, "alpha").herald!.events.map((e) => e.object)).toEqual(["alpha-1", "protected"]);
});

test("an event of a factory-wide job, with no project, is in the Herald of no project filter and not in a project's", () => {
  const { id } = seed({ role: "director", name: "director", state: "running" });
  const own = seed({ role: "build", repo: "alpha", name: "issue.1", state: "running" }).id;
  const before = readEvents().length;
  for (const job of [id, own]) logEvent({ subject: job, action: "running", object: job });
  const s: any = { errored: [], running: [], done: [], doneStamps: [], queued: [], runningIssues: [], asks: [], herald: { history: [], events: readEvents().slice(before), titles: {}, runs: {}, attempts: {} } };
  expect(forProject(s, null).herald!.events.map((e) => e.object)).toEqual([id, own]);
  expect(forProject(s, "alpha").herald!.events.map((e) => e.object)).toEqual([own]);
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
