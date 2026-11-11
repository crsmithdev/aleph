import { afterEach, beforeEach, expect, test } from "bun:test";
import { readList, writeList } from "../../../issues/lib/store.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { plainAsk, setAsk } from "../asks/ask.ts";
import { readEvents } from "../../../lib/layout.ts";
import { loadRegistry } from "../records/ledger.ts";
import { writeBaseline } from "./factory-status.ts";
import { decideIntake } from "./intake-decision.ts";
import { dispatchIssues, intakeQueued, runDispatch, stalled } from "../transitions/factory.ts";
import { change, newIssue, setup, teardown } from "../transitions/factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

/** A new issue in the factory list with the fields of `o`, `plan` set when `plan`; returns its id. */
const add = (o: { spec?: string; from?: string; plan?: boolean } = {}): number =>
  writeList({ key: "fac" }, "add", (doc) => { const i = issues.add(doc, "new thing", o); if (o.plan) i.fm.plan = "true"; return i.id; }, true)!.value;

/** Main's baseline: red at commit `x` with failed tests, or green. */
const baseline = (ok: boolean) => writeBaseline("fac", () => ({ repo: "fac", commit: "x", ok, ...(ok ? {} : { failed: "tests" }) }));

test("decideIntake: closed and sorted items get none; a red main and an open after hold only an issue to plan", () => {
  const blocker = newIssue();
  const parent = add({ plan: true });
  const rows: [string, number, string | null, string, string][] = [
    // name                 id                                 red    kind       why
    ["take in",             add(),                             null,  "take-in", "not sorted"],
    ["take in, red",        add(),                             "red", "take-in", "not sorted"],
    ["with a spec",         blocker,                           null,  "none",    "sorted"],
    ["closed",              add(),                             null,  "none",    "the item is done"],
    ["asking",              add(),                             null,  "none",    "sorted"],
    ["to plan",             parent,                            null,  "plan",    "to plan"],
    ["to plan, red",        parent,                            "red", "none",    "red"],
    ["to plan, after",      add({ plan: true }),               null,  "none",    `after fac-${blocker}`],
    ["take in, after",      add(),                             null,  "take-in", "not sorted"],
    ["a part to plan",      add({ plan: true, from: `fac-${parent}` }), null, "none", "sorted"],
  ];
  const id = (name: string) => rows.find((r) => r[0] === name)![1];
  change(id("closed"), (i) => issues.setStatus(i, "done"));
  change(id("to plan, after"), (i) => { i.fm.after = [`fac-${blocker}`]; });
  change(id("take in, after"), (i) => { i.fm.after = [`fac-${blocker}`]; });
  setAsk(`fac-${id("asking")}`, plainAsk("question", "which?"));
  const repo = loadRegistry().fac, doc = readList({ key: "fac" })!;
  const got = rows.map(([name, n, red]) => [name, n, red, ...Object.values(decideIntake(repo, issues.find(doc, n)!, { doc, done: () => false, red }))]);
  expect(got).toEqual(rows);
});

test("stalled and the intake queue agree on an issue to plan and one to take in, on a green and a red main", async () => {
  const blocker = newIssue();
  const plan = add({ plan: true });
  const waits = add({ plan: true });
  change(waits, (i) => { i.fm.after = [`fac-${blocker}`]; });
  const fresh = add();
  /** The issues the stall check lists for intake and the intake queue starts. */
  const sides = async () => {
    await dispatchIssues(async () => null);
    const swept = (await stalled()).filter((k) => k.startsWith("ingest:")).map((k) => k.slice("ingest:".length));
    return { swept, queued: intakeQueued(() => {}) };
  };
  await baseline(true);
  expect(await sides()).toEqual({ swept: [`fac-${plan}`, `fac-${fresh}`], queued: [`fac-${plan}`, `fac-${fresh}`] });
  await baseline(false);
  expect(await sides()).toEqual({ swept: [`fac-${fresh}`], queued: [`fac-${fresh}`] });
});

test("a dispatch pass leaves the intake of an issue to plan to the intake queue, so it starts once", async () => {
  const plan = add({ plan: true });
  await baseline(true);
  await dispatchIssues(async () => null);
  expect(readEvents().filter((e) => e.subject === `fac-${plan}` && e.sub === "intake")).toEqual([]);
  const calls: string[] = [];
  await runDispatch({ intake: (_r, id) => { calls.push(`fac-${id}`); }, director: () => {} });
  expect(calls).toEqual([`fac-${plan}`]);
});
