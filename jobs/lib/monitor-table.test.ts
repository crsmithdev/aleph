import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptanceLine, acceptanceOf, flakeHealth, flakeSection, measure, notesOf, renderTable, storeLog, type Sources } from "./monitor-table.ts";
import type { Entry, Run } from "./ledger.ts";
import type { Issue } from "../../todo/lib/todo.ts";

const DAY = "2026-10-20";
/** A local time on a day, as an ISO string. */
const at = (day: string, hh: number, mm = 0) => new Date(`${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`).toISOString();
/** A store note line at a local time. */
const note = (day: string, hh: number, text: string) => `- ${day} ${String(hh).padStart(2, "0")}:00: ${text}`;

let n = 0;
function run(o: Partial<Run> & { kind: Run["kind"]; started: string }): Entry {
  const id = `r${++n}`;
  return { id, folder: `/x/${id}`, run: { job: id, name: o.on ?? id, condition: "done", told: true, ...o } as Run };
}
const item = (status: string, notes: string[]): Issue => ({ id: 1, title: "t", fm: (status === "open" ? {} : { closed_as: status }) as any, request: "", spec: "", notes });
const empty: Sources = { runs: [], holds: [], specChecks: [], items: [], storeLog: [], flakes: [], trackers: [], usage: [] };

describe("acceptance: the share of failures that led to a real fix", () => {
  const fail = (h: number) => note(DAY, h, "acceptance: fail at abc1234: scenarios 1 failed");
  const land = (h: number) => note(DAY, h, "job p-1 landed");
  const pass = (h: number) => note(DAY, h, "acceptance: pass at def5678");
  const items = [
    { name: "p-1", item: item("done", [fail(9), land(10), pass(11)]) },
    { name: "p-2", item: item("open", [fail(9), land(10), note(DAY, 11, "acceptance: fail again at x: y")]) },
    { name: "p-3", item: item("done", [fail(9), note(DAY, 10, "closed by hand")]) },
    { name: "p-4", item: item("open", [fail(9)]) },
    { name: "p-5", item: item("open", [fail(9), land(10)]) },
  ];

  test("a land that the next acceptance passed is a fix; a land it failed is not; no acceptance yet is pending", () => {
    expect(acceptanceOf(notesOf({ items, storeLog: [] }), -Infinity, Infinity))
      .toEqual({ failures: 6, fixed: 1, notFixed: 1, pending: 1, closed: 1, open: 2 });
  });

  test("a failure with no land after it is closed or open by the item's status; the second failure of p-2 is open", () => {
    const a = acceptanceOf(notesOf({ items: items.slice(1, 2), storeLog: [] }), -Infinity, Infinity);
    expect(a).toEqual({ failures: 2, fixed: 0, notFixed: 1, pending: 0, closed: 0, open: 1 });
  });

  test("an item only the store's history has counts, and is closed", () => {
    const storeLog = [{ at: at(DAY, 9), item: "p-9", added: [fail(9), note(DAY, 10, "job p-9 landed"), pass(12)], removed: [] }];
    expect(acceptanceOf(notesOf({ items: [], storeLog }), -Infinity, Infinity)).toMatchObject({ failures: 1, fixed: 1 });
  });

  test("only failures noted inside the window count", () => {
    expect(acceptanceOf(notesOf({ items, storeLog: [] }), Date.parse(at(DAY, 10)), Infinity).failures).toBe(1);
  });

  test("the first metric is one sentence over the day and the 7 days before it, and over all time", () => {
    const t = measure({ ...empty, items }, DAY, Date.parse(at(DAY, 23)));
    expect(acceptanceLine(t)).toBe("Acceptance failures that led to a real fix: 1 of 6 in the 8 days to 2026-10-20 (17%); 1 of 6 in all (17%).");
  });
});

describe("stages", () => {
  const runs = [
    run({ kind: "build", on: "p-1", started: at(DAY, 9), ended: at(DAY, 9, 10), condition: "passed", cost: 1, review: { call: "land" } }),
    run({ kind: "build", on: "p-1", started: at(DAY, 10), ended: at(DAY, 10, 20), condition: "stuck", cause: "no-commit", cost: 2, review: { call: "error" } }),
    run({ kind: "build", on: "p-2", started: at(DAY, 11), ended: at(DAY, 11, 30), condition: "passed", cost: 3 }),
    run({ kind: "build", on: "p-3", started: at(DAY, 12), condition: "running" }),
    run({ kind: "triage", on: "p-1", started: at(DAY, 8), ended: at(DAY, 8, 1), reason: "failed: no reply", cause: "no-answer" }),
    run({ kind: "firefighter", started: at(DAY, 8), ended: at(DAY, 8, 2) }),
    run({ kind: "firefighter", started: at(DAY, 9), ended: at(DAY, 9, 2) }),
    // The trailing 7 days: two builds on one item.
    run({ kind: "build", on: "p-0", started: at("2026-10-15", 9), ended: at("2026-10-15", 9, 40), condition: "passed", cost: 7 }),
    run({ kind: "build", on: "p-0", started: at("2026-10-16", 9), ended: at("2026-10-16", 10), condition: "dropped", cost: 7 }),
    // Out of both windows.
    run({ kind: "build", on: "p-0", started: at("2026-10-01", 9), condition: "passed", cost: 100 }),
  ];
  const t = measure({ ...empty, runs, specChecks: [{ at: at(DAY, 7), name: "p-1", cost: 0.5 }, { at: at(DAY, 7, 5), name: "p-1", cost: 0.5 }] }, DAY, Date.parse(at(DAY, 23)));
  const row = (stage: string, w = t.today) => w.stages.find((s) => s.stage === stage);

  test("runs per item, runs with no usable result, cost and the median time; a live run is left out", () => {
    expect(row("build")).toEqual({ stage: "build", runs: 3, items: 2, unusable: 1, cost: 6, minutes: 20 });
    expect(row("build", t.trailing)).toEqual({ stage: "build", runs: 2, items: 1, unusable: 1, cost: 14, minutes: 50 });
  });

  test("a role run that states a cause has no usable result; a run on no item is its own item", () => {
    expect(row("triage")).toMatchObject({ runs: 1, unusable: 1 });
    expect(row("firefighter")).toMatchObject({ runs: 2, items: 2, unusable: 0 });
  });

  test("the reviewer is a stage of its own, and its error is no usable result; a spec check has only its cost", () => {
    expect(row("review")).toMatchObject({ runs: 2, items: 1, unusable: 1, cost: null });
    expect(row("spec-check")).toEqual({ stage: "spec-check", runs: 2, items: 1, unusable: null, cost: 1, minutes: null });
  });

  test("the table puts the day's value first and the trailing mean per day in brackets", () => {
    const text = renderTable(t);
    expect(text).toContain("| build | 3 (0.3) | 1.5 (2) | 1, 33% (50%) | $6.00 ($2.00) | $3.00 ($14.00) | 20 (50) |");
    expect(text).toContain("| spec-check | 2 (0) | 2 (-) | - |");
  });
});

describe("Asks, reopens, holds and set-asides", () => {
  const storeLog = [
    { at: at(DAY, 9), item: "p-1", added: ["reason: spec-check"], removed: [] },
    { at: at(DAY, 10), item: "p-2", added: ["reason: spec-check"], removed: ["reason: question"] },
    { at: at(DAY, 11), item: "p-3", added: [], removed: ["closed_as: done"] },
    // A close that rewrites closed_as is no reopen.
    { at: at(DAY, 12), item: "p-4", added: ["closed_as: dropped"], removed: ["closed_as: done"] },
    { at: at("2026-10-14", 9), item: "p-5", added: ["reason: question"], removed: [] },
  ];
  const runs = [run({ kind: "build", on: "p-6", started: at(DAY, 9), ended: at(DAY, 10), condition: "awaiting", ask: { kind: "approval", reason: "held-path", question: "q", options: [], why: [] } })];
  const holds = [
    { at: at(DAY, 9), name: "p-1", kind: "spec-check", text: "" },
    { at: at(DAY, 11), name: "p-1", kind: "started", text: "" },
    { at: at(DAY, 9), name: "p-2", kind: "open", text: "" },
    // The last record of a goal has no known end: it counts as a record and as no time.
    { at: at(DAY, 10), name: "p-3", kind: "busy", text: "" },
  ];
  const items = [
    { name: "p-1", item: item("open", [note(DAY, 9, "sealed checks: the reviewer set aside: 3 asks for more"), note(DAY, 9, "sealed checks: the reviewer set aside: 4 too")]) },
  ];
  const reviewed = [run({ kind: "build", on: "p-1", started: at(DAY, 8), ended: at(DAY, 9), review: { call: "land" } }), run({ kind: "build", on: "p-2", started: at(DAY, 8), ended: at(DAY, 9), review: { call: "back" } })];
  const t = measure({ ...empty, storeLog, runs: [...runs, ...reviewed], holds, items }, DAY, Date.parse(at(DAY, 23)));

  test("each reason line a store commit adds is an Ask, and so is a run's own Ask", () => {
    expect(t.today.asks).toEqual({ "spec-check": 2, "held-path": 1 });
    expect(t.trailing.asks).toEqual({ question: 1 });
  });

  test("a reopen is a removed closed_as that the same change does not add back", () => {
    expect(t.today.reopens).toBe(1);
  });

  test("a hold kind's records, goals and hours until the goal's next record; the held share leaves out open and started", () => {
    expect(t.today.holds).toEqual([
      { kind: "spec-check", records: 1, goals: 1, hours: 2 },
      { kind: "started", records: 1, goals: 1, hours: 0 },
      { kind: "open", records: 1, goals: 1, hours: 0 },
      { kind: "busy", records: 1, goals: 1, hours: 0 },
    ]);
    expect(t.today.held).toEqual({ goals: 2, seen: 3 });
  });

  test("the 7 gate kinds count as the old kinds did: not-ready on an open job or a done goal holds nothing, the other gates hold", () => {
    const rec = (name: string, kind: string, text: string) => ({ at: at(DAY, 10), name, kind, text });
    const v6 = measure({ ...empty, holds: [
      rec("g-1", "not-ready", "its job is running"), rec("g-2", "not-ready", "the item is already done"),
      rec("g-3", "not-ready", "blocked: after g-1"), rec("g-4", "baseline", "main baseline running"), rec("g-5", "red", "an old record"),
    ] }, DAY, Date.parse(at(DAY, 23)));
    expect(v6.today.held).toEqual({ goals: 3, seen: 5 });
  });

  test("the set-aside share is of the goals whose build was reviewed that day", () => {
    expect(t.today.setAside).toEqual({ goals: 1, notes: 2, reviewed: 2 });
  });
});

describe("flakes: the counts aleph report prints", () => {
  const now = Date.parse(at(DAY, 23));
  const rows = [
    { repo: "p", check: "tests", run: "a", at: at(DAY, 9), tests: ["a.test.ts > one"] },
    { repo: "p", check: "tests", run: "b", at: at(DAY, 10), tests: ["a.test.ts > one"] },
    { repo: "p", check: "tests", run: "c", at: at(DAY, 10) },
    { repo: "p", check: "tests", run: "d", at: at("2026-10-01", 10), tests: ["a.test.ts > one"] },
  ];
  const trackers = [{ ref: "p-7", notes: [
    note(DAY, 9, "acceptance p-1: c.test.ts > twice: failed under load, passed on the quiet rerun at abc1234"),
    note(DAY, 9, "acceptance p-2: c.test.ts > twice: failed twice, in a test the goal did not touch, at abc1234"),
    note(DAY, 9, "job x: d.test.ts > once: flaked"),
    note("2026-10-01", 9, "old: e.test.ts > old"),
  ] }];

  test("two reruns of a test in 7 days make a line; a tracker gives its notes, its files and its most flaked test", () => {
    expect(flakeHealth(flakeSection(rows, trackers, now))).toEqual([
      "health: p test a.test.ts > one passed on rerun 2 times in 7 days",
      "health: p-7 holds 3 flake notes in 7 days, 2 test files",
      "health: most flaked in acceptance in 7 days: c.test.ts > twice (2 times)",
    ]);
  });

  test("nothing in 7 days gives no line", () => {
    expect(flakeHealth(flakeSection(rows.slice(3), [{ ref: "p-7", notes: trackers[0].notes.slice(3) }], now))).toEqual([]);
  });
});

test("storeLog reads the reason, closed_as and kept note lines of each item file from the store's git history", () => {
  const dir = mkdtempSync(join(tmpdir(), "monitor-store-"));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (...a: string[]) => { const p = Bun.spawnSync(["git", ...a], { cwd: dir, env }); if (p.exitCode) throw new Error(p.stderr.toString()); };
  try {
    git("init", "-q", "-b", "main");
    const file = join(dir, "p-1.md");
    writeFileSync(file, "---\nid: p-1\nclosed_as: done\n---\n- 2026-10-20 09:00: job p-1 landed\n");
    git("add", "."); git("commit", "-q", "-m", "one");
    writeFileSync(file, "---\nid: p-1\nreason: spec-check\n---\n- 2026-10-20 09:00: job p-1 landed\n- 2026-10-20 10:00: acceptance: fail at abc: x\n- 2026-10-20 10:01: a note it does not keep\n");
    git("add", "."); git("commit", "-q", "-m", "two");
    const log = storeLog(dir);
    expect(log.map((c) => ({ item: c.item, added: c.added, removed: c.removed }))).toEqual([
      { item: "p-1", added: ["reason: spec-check", "- 2026-10-20 10:00: acceptance: fail at abc: x"], removed: ["closed_as: done"] },
      { item: "p-1", added: ["closed_as: done", "- 2026-10-20 09:00: job p-1 landed"], removed: [] },
    ]);
    expect(Number.isNaN(Date.parse(log[0].at))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
