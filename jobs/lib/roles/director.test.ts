// The director: every new Ask goes to it; it decides with actions code applies, or escalates with case text. The escalation
// list, the action bound, the once-per-goal rerun and the record are code's, whatever the fake replies.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../../../issues/lib/todo.ts";
import { markAsked, plainAsk, setAsk, awaitsChris } from "../asks/ask.ts";
import { specVersion } from "./issue-spec.ts";
import { DIRECTOR_SCHEMA, directAll, MAX_ACTIONS, parseReply, pendingCases, readRecord } from "./director.ts";
import { directorStep } from "../transitions/factory.ts";
import { allRuns, jobIdOf, loadRegistry, readRun } from "../records/ledger.ts";
import { jobId } from "../../../lib/naming.ts";
import { setPaused } from "../gates/factory-status.ts";
import { readStore } from "../learning/corrections.ts";
import { lastEvent, read as readJobRecord } from "../records/record.ts";
import { asked, base, branch, calls, choice, dropped, fresh, item, key, events, landed, n, plain, ports, reply, replyWith, repoPath, run, sh, useDirectorFixture } from "./director.fixture.ts";

useDirectorFixture();

const repo = () => loadRegistry()[key];
const direct = () => directAll([repo()], ports());
const directorRuns = () => allRuns().filter((e) => e.run.kind === "director");
const prompt = () => readFileSync(join(base, "prompt.md"), "utf8");
const TEXT = { situation: "The goal asks for page A or B.", effects: [{ action: "decide:A", text: "Builds page A." }, { action: "decide:B", text: "Builds page B." }, { action: "deny", text: "Closes the question." }], recommend: { action: "decide:A", why: "Chris chose A before." } };

test("a decided Ask: code applies the answer, clears the Ask, and logs a Director decision and its record", async () => {
  fresh([{ title: "product", ask: choice() }]);
  writeFileSync(join(base, "needs-you-log.md"), "- 2026-11-01: NEEDS-MARK Chris chose A\n");
  reply([{ do: "answer", option: "A", note: "page A, as before" }]);
  const [d] = await direct();
  expect(d).toMatchObject({ outcome: "decided", ref: `${key}-1`, reason: "question", applied: ["answer: A: page A, as before"] });
  expect(asked(1)).toBeNull();
  expect(item(1).notes.at(-1)).toContain("director decided: A: page A. page A, as before");
  expect(events()).toContainEqual(expect.objectContaining({ by: "director", subject: `${key}-1`, action: "answered", sub: "question", note: "A: page A, as before" }));
  expect(readRecord()).toEqual([expect.objectContaining({ ref: `${key}-1`, outcome: "decided" })]);
  const [r] = directorRuns();
  expect(r.run).toMatchObject({ condition: "done", model: "claude-opus-5-5", on: `${key}-1` });
  // The prompt names the vault decisions and the needs-you log under the test's base, never ~/.aleph.
  expect(prompt()).toContain(join(base, "vault", "wiki", "decisions"));
  expect(prompt()).toContain(join(base, "needs-you-log.md"));
  expect(prompt()).toContain("NEEDS-MARK Chris chose A");
  // Decided: the next sweep opens no run.
  await direct();
  expect(calls()).toBe(1);
});

test("an escalated Ask gets the director's case text and stays with Chris", async () => {
  fresh([{ title: "product", ask: choice() }]);
  replyWith({ case: TEXT });
  const [d] = await direct();
  expect(d).toMatchObject({ outcome: "escalated", why: "the director did not decide" });
  const a = asked(1)!;
  expect(a.situation).toBe(TEXT.situation);
  expect(a.recommend).toEqual(TEXT.recommend);
  expect(awaitsChris(`${key}-1`)).toBe(true);
  expect(events()).toContainEqual(expect.objectContaining({ by: "director", subject: `${key}-1`, action: "escalated", sub: "question", to: "human", note: "the director did not decide" }));
  // Escalated once: no second run.
  await direct();
  expect(calls()).toBe(1);
  expect(pendingCases([repo()])).toEqual([]);
});

test("a failed run or a malformed reply sends the Ask to Chris with a fallback case text", async () => {
  fresh([{ title: "q", ask: plain() }, { title: "r", ask: plain("which test?") }]);
  replyWith("not json");
  const out = await direct();
  expect(out.map((d) => d.outcome)).toEqual(["escalated", "escalated"]);
  expect(asked(1)!.situation).toStartWith("The director did not decide this Ask: its reply was malformed");
  expect(asked(2)!.situation).toStartWith("The director did not decide this Ask");
  fresh([{ title: "q", ask: choice() }]);
  const cmd = process.env.ALEPH_DIRECTOR_CMD;
  process.env.ALEPH_DIRECTOR_CMD = "false";
  try { await direct(); } finally { process.env.ALEPH_DIRECTOR_CMD = cmd; }
  expect(asked(1)!.situation).toStartWith("The director did not decide this Ask: its run failed");
});

test("actions that leave the Ask open send it to Chris with the director's case text and what it did and could not do", async () => {
  fresh([{ title: "q", ask: choice() }]);
  reply([{ do: "note", text: "looked at it" }, { do: "close", note: "met on main" }], TEXT);
  const [d] = await direct();
  expect(d).toMatchObject({ outcome: "escalated", applied: ["note: looked at it"] });
  const a = asked(1)!;
  expect(a.situation).toBe(TEXT.situation);
  expect(a.recommend).toEqual(TEXT.recommend);
  expect(a.details).toContain("It did: note: looked at it.");
  expect(a.details).toContain(`It could not: close: met on main: ${key}-1 was filed by Chris`);
});

test("the schema requires the case text with actions, and parseReply returns it with the actions", () => {
  expect(DIRECTOR_SCHEMA.required).toEqual(["case"]);
  expect(parseReply({ actions: [{ do: "rerun" }], case: TEXT }, ["decide:A", "decide:B", "deny"])).toEqual({ actions: [{ do: "rerun" }], text: TEXT });
});

test("the escalation list: a land on a security path gets case text and no action; a stored host-check Ask is not on it", async () => {
  fresh([{ title: "held", specced: true }, { title: "check", ask: { ...plainAsk("question", "look at the dashboard"), reason: "host-check" } }]);
  branch(`b${n}`, "hooks/x.ts");
  const folder = run({ name: `${key}-1`, on: `${key}-1`, ask: { kind: "approval", reason: "held-path", question: "Land it?", options: [], why: [] }, branch: `b${n}` });
  reply([{ do: "land" }, { do: "answer", note: "checked" }]);
  const out = await direct();
  expect(out.map((d) => [d.ref, d.outcome, d.why])).toEqual([
    [`${key}-2`, "decided", undefined],
    [`${key}-1`, "escalated", "the run changes hooks/x.ts, a security path or bun.lock, so its land is Chris's"],
  ]);
  expect(out[1].applied).toEqual([]);
  expect(out[1].refused.every((r) => r.endsWith("the Ask is on the escalation list"))).toBe(true);
  expect(landed).toEqual([]);
  expect(awaitsChris(`${key}-2`)).toBe(false);
  expect(readRun(folder)!.ask!.situation).toStartWith("The director did not decide this Ask");
  expect(prompt()).toContain("This Ask is on the escalation list");
});

test("a review Ask on a run that changes bun.lock or a security path is Chris's; one that changes neither the director lands", async () => {
  fresh([{ title: "lock", specced: true }]);
  branch(`lock${n}`, "bun.lock");
  run({ name: `${key}-1`, on: `${key}-1`, ask: { kind: "approval", reason: "review", question: "Land?", options: [], why: [] }, branch: `lock${n}` });
  reply([{ do: "land" }]);
  const [d] = await direct();
  expect(d).toMatchObject({ outcome: "escalated", why: "the run changes bun.lock, a security path or bun.lock, so its land is Chris's" });
  expect(landed).toEqual([]);

  fresh([{ title: "plain", specced: true }]);
  branch(`ok${n}`, "src/a.ts");
  const folder = run({ name: `${key}-1`, on: `${key}-1`, ask: { kind: "approval", reason: "review", question: "Land?", options: [], why: [] }, branch: `ok${n}` });
  const [e] = await direct();
  expect(e).toMatchObject({ outcome: "decided", applied: ["land"] });
  expect(landed).toEqual([`${key}-1`]);
  // The land runs in its own unit and the run still awaits: the Ask gets no "with you" text, so Chris sees no buttons on a landing run.
  expect(readRun(folder)!.condition).toBe("waiting");
  expect(readRun(folder)!.ask!.situation ?? "").toBe("");
});

test("a memory proposal is on the escalation list: the director's case text goes on the lesson, and no action is taken", async () => {
  fresh();
  mkdirSync(process.env.ALEPH_FACTORY_DIR!, { recursive: true });
  const issue = `${key}-1`;
  const lesson = { id: "l-1", sentence: "Check x.ts first", state: "proposed", count: 3, kind: "claude-md", target: "global", title: "Check x.ts", issue, signals: [{ id: "s1", source: "chris", at: "2026-10-01T00:00:00Z", quote: "you forgot x.ts", link: "" }] };
  writeFileSync(join(process.env.ALEPH_FACTORY_DIR!, "corrections.json"), JSON.stringify({ minedAt: "", lessons: [lesson] }));
  replyWith({ case: { situation: "The lesson says to check x.ts.", effects: [{ action: "approve", text: "Files a goal." }, { action: "decline", text: "Drops it." }], recommend: { action: "decline", why: "Too vague." } }, actions: [{ do: "note", text: "x" }] });
  const [d] = await direct();
  expect(d).toMatchObject({ ref: issue, on: issue, reason: "proposal-claude-md", outcome: "escalated", why: "a memory proposal is Chris's", applied: [] });
  expect(directorRuns()[0].run.on).toBe(issue);
  const l = readStore().lessons[0];
  expect(l.situation).toBe("The lesson says to check x.ts.");
  expect(l.recommend).toEqual({ action: "decline", why: "Too vague." });
  expect(l.state).toBe("proposed");
  // The case text says approve reopens the parked issue; it does not say approve files a goal.
  expect(prompt()).toContain("reopens");
  expect(prompt()).not.toContain("files a goal");
});

test("a proposed lesson with no issue is no case", async () => {
  fresh();
  mkdirSync(process.env.ALEPH_FACTORY_DIR!, { recursive: true });
  const lesson = { id: "l-1", sentence: "Check x.ts first", state: "proposed", count: 3, kind: "claude-md", target: "global", signals: [] };
  writeFileSync(join(process.env.ALEPH_FACTORY_DIR!, "corrections.json"), JSON.stringify({ minedAt: "", lessons: [lesson] }));
  expect(await direct()).toEqual([]);
  expect(calls()).toBe(0);
});

test("closing or dropping an issue Chris filed is refused; the same on an agent's issue is applied", async () => {
  fresh([{ title: "mine", specced: true, ask: plainAsk("no-commit", "3 runs, no commit") }, { title: "agent's", specced: true, source: "agent", ask: plainAsk("no-commit", "3 runs, no commit") }]);
  reply([{ do: "close", note: "met on main" }]);
  const [a, b] = await direct();
  expect(a).toMatchObject({ ref: `${key}-1`, outcome: "escalated" });
  expect(a.refused).toEqual([`close: met on main: ${key}-1 was filed by Chris, so closing or dropping it is his`]);
  expect(issues.status(item(1))).toBe("open");
  expect(b).toMatchObject({ ref: `${key}-2`, outcome: "decided", applied: ["close: met on main"] });
  expect(issues.status(item(2))).toBe("done");
});

test(`at most ${MAX_ACTIONS} actions: the 11th is refused`, async () => {
  fresh([{ title: "q", ask: plain() }]);
  reply([...Array.from({ length: 10 }, (_, i) => ({ do: "note", text: `note ${i + 1}` })), { do: "rerun" }]);
  const [d] = await direct();
  expect(d.applied.length).toBe(10);
  expect(d.refused).toEqual(["rerun: more than 10 actions in one run"]);
  expect(awaitsChris(`${key}-1`)).toBe(true);
});

test("a run-cap Ask: the director reruns the goal once; the second run-cap Ask on it goes to Chris", async () => {
  fresh([{ title: "loops", specced: true, ask: plainAsk("run-cap", "3 starts in an hour") }]);
  reply([{ do: "rerun" }]);
  const [first] = await direct();
  expect(first).toMatchObject({ outcome: "decided", applied: ["rerun"] });
  expect(asked(1)).toBeNull();
  setAsk(`${key}-1`, plainAsk("run-cap", "3 starts in an hour, again"));
  const [d] = await direct();
  expect(d).toMatchObject({ outcome: "escalated", why: `the director already decided a run-cap Ask on ${key}-1; the second goes to Chris` });
  expect(awaitsChris(`${key}-1`)).toBe(true);
  expect(prompt()).toContain("This Ask is on the escalation list");
});

test("a worker's question on a run: the director's answer drops the job with the answer as the next run's note", async () => {
  fresh([{ title: "goal", specced: true }]);
  run({ name: `${key}-1`, on: `${key}-1`, ask: { kind: "input", reason: "question", question: "which module?", options: [], why: [] } });
  reply([{ do: "answer", note: "use ask.ts" }]);
  const [d] = await direct();
  expect(d).toMatchObject({ outcome: "decided" });
  expect(dropped).toEqual([{ name: `${key}-1`, reason: `The director answered the worker's question "which module?": use ask.ts` }]);
  expect(lastEvent(`${key}-1`, "rerun")?.what).toBe(`The director answered the worker's question "which module?": use ask.ts`);
});

test("a director job on a run's Ask is a job on the run's issue and keeps its record there, not in a record of the run", async () => {
  fresh([{ title: "issue", specced: true }]);
  const folder = run({ name: `${key}-1`, on: `${key}-1`, ask: { kind: "input", reason: "question", question: "which module?", options: [], why: [] } });
  replyWith({ case: TEXT });
  await direct();
  const [r] = directorRuns().filter((e) => e.run.on === `${key}-1`);
  expect(r.id).toEndWith(`-${key}-1-2`);
  expect(r.run.n).toBe(2);
  expect(jobIdOf(r)).toBe(jobId(`${key}-1`, 2));
  expect(readJobRecord(`${key}-1`)!.runs.map((x) => x.id)).toContain(r.id);
  expect(readJobRecord(`${key}-1`)!.events.some((e) => e.kind === "director")).toBe(true);
  expect(readJobRecord(folder.split("/").at(-1)!)).toBeNull();
});

test("a paused factory starts no director run", async () => {
  fresh([{ title: "q", ask: plain() }]);
  setPaused(true);
  try { expect(await directorStep(ports())).toEqual([]); } finally { setPaused(false); }
  expect(calls()).toBe(0);
});

test("a drop reason that names another goal of this repo on main gets the fate duplicate; another repo's goal does not", async () => {
  fresh([{ title: "goal", specced: true }]);
  // origin/main names another goal of this repo: the work the drop is a duplicate of.
  writeFileSync(join(repoPath(), "z.ts"), "1\n");
  sh(repoPath(), "git", "add", "-A");
  sh(repoPath(), "git", "commit", "-q", "-m", `z\n\nIssue: ${key}-2.1`);
  sh(repoPath(), "git", "update-ref", "refs/remotes/origin/main", "HEAD");
  run({ name: `${key}-1`, on: `${key}-1`, ask: { kind: "input", reason: "question", question: "which module?", options: [], why: [] } });
  reply([{ do: "drop", reason: `the work is already in ${key}-2.1` }]);
  await direct();
  expect(dropped.map((d) => d.fate)).toEqual(["duplicate"]);

  fresh([{ title: "goal", specced: true }]);
  run({ name: `${key}-1`, on: `${key}-1`, ask: { kind: "input", reason: "question", question: "which module?", options: [], why: [] } });
  reply([{ do: "drop", reason: "the work is already in gpu-faults-2" }]);
  await direct();
  expect(dropped.map((d) => d.fate)).toEqual(["duplicate", undefined]);
});

test("an edit-goal with a body on the Ask of a run that waits for a spec edit starts a dispatch with no tick", async () => {
  fresh([{ title: "goal", specced: true, body: "Old spec.", ask: plain("which wins?") }]);
  const folder = run({ name: `${key}-1`, on: `${key}-1`, condition: "failed" });
  markAsked({ id: "w1", folder, run: { job: "w1" } as any }, "which wins?", specVersion(item(1)));
  reply([{ do: "edit-goal", body: "A clearer spec." }]);
  let dispatches = 0;
  const [d] = await directAll([repo()], { ...ports(), dispatch: () => { dispatches++; } });
  expect(d.applied).toEqual(["edit-goal (spec)"]);
  expect(item(1).spec).toBe("A clearer spec.");
  expect(dispatches).toBe(1);
});
