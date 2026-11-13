// The housekeeper: a land reviews the parked issues that name a changed file, a daily run reviews every parked issue in
// batches, and code checks and applies each typed action whatever the fake replies.
import { beforeAll, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../../../issues/lib/todo.ts";
import { readList, writeList } from "../../../issues/lib/store.ts";
import { allRuns, loadRegistry } from "../records/ledger.ts";
import { readEvents } from "../../../lib/layout.ts";
import { lock } from "../infra/locks.ts";
import { setAsk, type Ask } from "../asks/ask.ts";
import { BATCH, housekeep, housekeepDue, readState, review } from "./housekeeper.ts";
import { base, branch, calls, fresh, item, key, repoPath, replyWith, sh, useDirectorFixture } from "./director.fixture.ts";

useDirectorFixture();
beforeAll(() => { process.env.ALEPH_HOUSEKEEPER_CMD = join(base, "fake"); });

const NOW = Date.parse("2026-11-01T12:00:00Z");
const repo = () => loadRegistry()[key];
const prompt = () => readFileSync(join(base, "prompt.md"), "utf8");
const act = (actions: object[]) => replyWith({ actions });
const runs = () => allRuns().filter((e) => e.run.kind === "housekeeper");

/** A fresh repo key with these issues, each parked unless `open`. */
function seed(items: { title: string; body?: string; open?: boolean; ask?: Ask }[]): void {
  fresh();
  writeList({ key }, "seed", (doc) => {
    for (const i of items) {
      const it = issues.add(doc, i.title, { request: i.body ?? "" });
      if (!i.open) issues.setStatus(it, "parked");
    }
    return true;
  }, true);
  for (const [k, i] of items.entries()) if (i.ask) setAsk(`${key}-${k + 1}`, i.ask);
}

test("the daily run reviews every parked issue in batches of BATCH, and no open one nor one with a core-change Ask", async () => {
  seed([...Array.from({ length: BATCH + 2 }, (_, k) => ({ title: `Parked issue ${k + 1}` })), { title: "Open issue", open: true },
    { title: "Core note X", ask: { kind: "approval", reason: "core-change", question: "Apply the archive verdict to the core note X?", options: [], why: [] } }]);
  act([]);
  expect(housekeepDue(NOW)).toBe(true);
  const out = await housekeep(NOW);
  expect(out!.map((o) => o.ids.length)).toEqual([BATCH, 2]);
  expect(calls()).toBe(2);
  expect(prompt()).toContain(`### ${key}-12: Parked issue 12`);
  expect(prompt()).not.toContain(`### ${key}-13`);
  expect(prompt()).not.toContain(`### ${key}-14`);
  expect(runs().map((e) => e.run.condition)).toEqual(["done", "done"]);
  // The daily review is done: nothing is due until a main moves or a day passes.
  expect(readState().main[key]).toBe(sh(repoPath(), "git", "rev-parse", "main"));
  expect(housekeepDue(NOW + 60_000)).toBe(false);
  expect(housekeepDue(NOW + 86_400_000)).toBe(true);
});

test("code applies each action and refuses one with no evidence, a bad title, or an issue outside the batch", async () => {
  seed([{ title: "Close this one" }, { title: "Drop this one" }, { title: "Keep this one" }, { title: "Retitle this one" },
    { title: "Lower this one" }, { title: "Note this one" }, { title: "Unpark this one" }, { title: "Not in the batch" }]);
  const head = sh(repoPath(), "git", "rev-parse", "main");
  act([
    { do: "close", id: "1", why: "done on main", how: "done", evidence: head },
    { do: "close", id: "1", why: "again", how: "done", evidence: head },
    { do: "drop", id: "2", why: "same task", keep: "3" },
    { do: "retitle", id: "4", why: "stale", title: "Retitle the stale issue" },
    { do: "retitle", id: "4", why: "bad", title: "Retitle it." },
    { do: "reprioritize", id: "5", why: "nobody needs it", priority: "low" },
    { do: "note", id: "6", why: "the file moved to lib/b.ts" },
    { do: "unpark", id: "7", why: "ready now" },
    { do: "close", id: "6", why: "made up", how: "obsolete", evidence: "deadbeef" },
    { do: "note", id: "8", why: "outside" },
  ]);
  const items = readList(repo())!.items.filter((i) => i.id <= 7);
  const o = await review({ repo: repo(), items }, NOW);
  expect(o.applied).toHaveLength(6);
  const tally = { reviewed: 7, closed: 1, dropped: 1, retitled: 1, reprioritized: 1, noted: 1, unparked: 1, refused: 4 };
  const ran = runs().at(-1)!.run;
  expect(ran.tally).toEqual(tally);
  expect(ran.touched).toEqual([1, 2, 4, 5, 6, 7].map((n) => `${key}-${n}`));
  expect(readEvents().findLast((e) => e.action === "done" && e.subject === "housekeeper")).toMatchObject({ tally, on: [expect.stringMatching(/^housekeeper#\d+$/), ...ran.touched!] });
  expect(readEvents().findLast((e) => e.action === "done" && e.subject === "housekeeper")!.changes).toEqual(
    ([[1, "close"], [2, "drop"], [4, "retitle"], [5, "reprioritize"], [6, "note"], [7, "unpark"]] as [number, string][]).map(([n, d]) => ({ id: `${key}-${n}`, do: d })));
  expect(o.refused.map((r) => r.split(": refused: ")[1])).toEqual([
    "no longer parked", expect.stringContaining("ends with a period"), `no commit or path deadbeef in ${key}`, "not an issue of this batch",
  ]);
  expect(issues.status(item(1))).toBe("done");
  expect(item(1).notes.at(-1)).toContain(`housekeeper: done on main (evidence ${head})`);
  expect(issues.status(item(2))).toBe("dropped");
  expect(item(3).notes.at(-1)).toContain(`housekeeper: ${key}-2 was dropped as its duplicate: same task`);
  expect(item(4).title).toBe("Retitle the stale issue");
  expect(item(5).fm.priority).toBe("low");
  expect(item(6).notes.at(-1)).toContain("housekeeper: the file moved to lib/b.ts");
  expect(issues.status(item(7))).toBe("open");
  expect(item(8).notes).toEqual([]);
});

test("a land reviews only the parked issues that name a changed file, with the land in the prompt", async () => {
  seed([{ title: "Fix the parser", body: "The bug is in `src/parse.ts`." }, { title: "Fix the docs", body: "README.md needs a line." }]);
  act([]);
  await housekeep(NOW);
  branch(`land-${key}`, "src/parse.ts");
  sh(repoPath(), "git", "merge", "-q", "--ff-only", `land-${key}`);
  expect(housekeepDue(NOW + 3_600_000)).toBe(true);
  const [o] = (await housekeep(NOW + 3_600_000))!;
  expect(o.ids).toEqual(["1"]);
  expect(prompt()).toContain("## The land");
  expect(prompt()).toContain("src/parse.ts");
  expect(housekeepDue(NOW + 3_660_000)).toBe(false);
});

test("lands within the hour of the last run wait for it, then one sweep covers them all", async () => {
  seed([{ title: "Fix the lexer", body: "The bug is in `src/lex.ts` and `src/emit.ts`." }]);
  act([]);
  await housekeep(NOW);
  const first = sh(repoPath(), "git", "rev-parse", "main");
  for (const f of ["lex", "emit"]) {
    branch(`land-${f}`, `src/${f}.ts`, `${f}\n`);
    sh(repoPath(), "git", "merge", "-q", "--ff-only", `land-${f}`);
  }
  const head = sh(repoPath(), "git", "rev-parse", "main");
  expect(housekeepDue(NOW + 3_599_000)).toBe(false);
  expect(housekeepDue(NOW + 3_600_000)).toBe(true);
  expect(await housekeep(NOW + 3_600_000)).toHaveLength(1);
  expect(calls()).toBe(2);
  expect(prompt()).toContain(`Main moved from ${first.slice(0, 7)} to ${head.slice(0, 7)}`);
  expect(prompt()).toContain("src/lex.ts");
  expect(prompt()).toContain("src/emit.ts");
  expect(housekeepDue(NOW + 7_200_000)).toBe(false);
});

test("a held lock stops both triggers, and a reply with no actions list applies nothing", async () => {
  seed([{ title: "Parked issue" }]);
  const release = (await lock("housekeeper", 0))!;
  try {
    expect(housekeepDue(NOW)).toBe(false);
    expect(await housekeep(NOW)).toBeNull();
  } finally { release(); }
  writeFileSync(join(base, "reply.json"), "not json");
  const [o] = (await housekeep(NOW))!;
  expect(o.error).toBeDefined();
  expect(o.applied).toEqual([]);
  expect(runs().at(-1)!.run.reason).toStartWith("failed:");
});
