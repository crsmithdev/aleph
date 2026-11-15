import { afterEach, beforeEach, expect, test } from "bun:test";
import { getJson, putJson } from "../../../lib/db.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../../issues/lib/todo.ts";
import { actionsOn, always, ASK_REASONS, asking, askFromRun, askIfPartDropped, askOf, askPartDropped, asked, askChris, clearAsk, decideAsk, refIn, grant, needsOf, may, normalizeAsk, PLAN_REST, plainAsk, readAlways, reasonOf, revoke, setAsk, waitOf, waitsForSpecEdit, type Ask } from "./ask.ts";
import { specVersion } from "../roles/issue-spec.ts";
import * as record from "../records/record.ts";
import { readList } from "../../../issues/lib/store.ts";
import { seed } from "../../job.testkit.ts";
import { newIssue, setup, teardown } from "../transitions/factory.helpers.ts";

const item = (fm: Record<string, unknown> = {}): issues.Issue => ({ id: 1, title: "t", fm: fm as any, request: "", spec: "", notes: [] });
const ask: Ask = { reason: "held-path", question: "A or B?", options: [{ label: "A", line: "do a", after: "fac-2.1" }, { label: "B", line: "do b" }], recommended: "B", why: ["w"] };

test("askChris with a null text sets the Ask and adds no note; an unknown issue gets none", () => {
  setup();
  try {
    const id = newIssue();
    expect(askChris({ key: "fac" }, id, ask, null)).toBeNull();
    expect(askOf(`issue.${id}`)).toEqual(ask);
    expect(issues.find(readList({ key: "fac" })!, id)!.notes).toEqual([]);
    expect(askChris({ key: "fac" }, 999, ask, null)).toBe("no issue 999");
    expect(askOf("issue.999")).toBeNull();
  } finally { teardown(); }
});

test("setAsk keeps the Ask whole in the issue's job record, and askOf reads it back", () => {
  setAsk("issue.11", ask);
  expect(askOf("issue.11")).toEqual(ask);
  expect(record.read("issue.11")).toMatchObject({ ask });
  clearAsk("issue.11");
  expect(askOf("issue.11")).toBeNull();
});

const cased: Ask = {
  ...ask,
  situation: "The path is held. Chris decides where it goes.",
  effects: [
    { action: "decide:A", text: "lands the path on A" },
    { action: "decide:B", text: "lands the path on B" },
    { action: "drop", text: "drops the path" },
  ],
  recommend: { action: "decide:B", why: "B keeps the path small" },
};

test("setAsk keeps situation, effects and recommend, and askOf reads them back", () => {
  setAsk("issue.12", cased);
  expect(askOf("issue.12")).toEqual(cased);
});

test("a run's Ask is the run's: the issue has none, and clearing the issue's Ask leaves it", () => {
  const { id } = seed({ role: "build", name: "issue.13", target: "issue.13", state: "waiting", ask, started: "2026-11-04T10:00:00Z" });
  expect(record.getRun(id)?.ask).toEqual(ask);
  expect(askOf("issue.13")).toBeNull();
  clearAsk("issue.13");
  expect(record.getRun(id)?.ask).toEqual(ask);
  record.setState(id, "dropped", { ask: undefined });
  expect(record.read("issue.13")?.ask ?? null).toBeNull();
});

test("normalizeAsk takes after, 2 to 4 options and a recommended label that is one of them", () => {
  const raw = { question: "Q?", options: [{ label: "A", line: "a", after: "issue.4" }, { label: "B", line: "b", after: "i-00005" }], recommended: "A", why: ["w"] };
  expect(normalizeAsk(raw)).toEqual({ reason: "question", question: "Q?", options: [{ label: "A", line: "a", after: "issue.4" }, { label: "B", line: "b", after: "issue.5" }], recommended: "A", why: ["w"] });
  expect(normalizeAsk({ ...raw, recommended: "C" })).toBeNull();
  expect(normalizeAsk({ ...raw, options: raw.options.slice(0, 1) })).toBeNull();
  expect(normalizeAsk({ ...raw, question: " " })).toBeNull();
  expect(normalizeAsk(raw, { reason: "review-held" })).toMatchObject({ reason: "review-held" });
  expect(normalizeAsk({ ...raw, kind: "approval" })).not.toHaveProperty("kind");
});

test("normalizeAsk drops an after that is not an issue ID", () => {
  const raw = { question: "Q?", options: [{ label: "A", line: "a", after: "My_Repo-3" }, { label: "B", line: "b" }], recommended: "A", why: ["w"] };
  expect(normalizeAsk(raw)!.options[0]).toEqual({ label: "A", line: "a" });
});

test("reasonOf keeps a known reason and reads any other as a question", () => {
  expect(reasonOf("run-cap")).toBe("run-cap");
  expect(reasonOf("nope")).toBe("question");
  expect(reasonOf(undefined)).toBe("question");
});

test("the table gives the wait and the plain Ask of a reason, and no row or Ask has a kind", () => {
  for (const r of Object.values(ASK_REASONS)) expect(r).not.toHaveProperty("kind");
  expect(needsOf(plainAsk("held-path", "q"))).toBe("protected");
  expect(needsOf(plainAsk("no-commit", "q"))).toBeUndefined();
  expect(needsOf(undefined)).toBeUndefined();
  expect(plainAsk("review-held", "q", ["w"])).toEqual({ reason: "review-held", question: "q", options: [], why: ["w"] });
});

test("waitOf reads a run with no ask as a question", () => {
  expect(waitOf(undefined)).toEqual({ reason: "question" });
  expect(waitOf(ask)).toEqual({ reason: "held-path" });
});

test("actionsOn picks by context for a question and a dropped part", () => {
  expect(actionsOn("question", { run: true, decision: false })).toEqual(["answer", "drop"]);
  expect(actionsOn("question", { run: false, decision: true })).toEqual(["decide", "deny"]);
  expect(actionsOn("part-dropped", { run: false, decision: true })).toEqual(["decide", "close"]);
  expect(actionsOn("part-dropped", { run: false, decision: false })).toEqual(["rerun", "close"]);
  expect(actionsOn("review-held", { run: true, decision: false })).toEqual(["land", "drop"]);
});


let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "always-")); process.env.ALEPH_FACTORY_DIR = dir; process.env.ALEPH_DB = join(dir, "aleph.db"); });
afterEach(() => { delete process.env.ALEPH_FACTORY_DIR; delete process.env.ALEPH_DB; rmSync(dir, { recursive: true, force: true }); });

test("grant then always round-trips; revoke removes it", () => {
  expect(always("held-path")).toBeNull();
  expect(grant("held-path", "land")).toBeNull();
  expect(always("held-path")?.action).toBe("land");
  revoke("held-path");
  expect(always("held-path")).toBeNull();
  expect(readAlways()).toEqual({});
});

test("user is granted on any reason but a memory proposal, and a stored grant stays", () => {
  expect(grant("question", "user")).toBeNull();
  expect(always("question")?.action).toBe("user");
  expect(readAlways().question?.action).toBe("user");
  expect(grant("review", "user")).toContain("unknown reason review;");
  expect(grant("review-held", "user")).toBeNull();
  revoke("review-held");
  expect(grant("proposal-skill", "user")).not.toBeNull();
  expect(grant("proposal-skill:aleph", "user")).not.toBeNull();
  revoke("question");
  expect(always("question")).toBeNull();
});

const CLI = join(import.meta.dir, "..", "..", "cli.ts");
const cli = (...args: string[]) => {
  const p = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, ALEPH_FACTORY_DIR: dir, ALEPH_DB: join(dir, "aleph.db") }, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};

test("aleph always grant, list and revoke work on the always setting", () => {
  const g = cli("always", "grant", "rescue", "recommended");
  expect(g.code).toBe(0);
  const saved = getJson("settings", "always", {});
  expect(saved).toEqual({ rescue: { action: "recommended", at: expect.any(String) } });
  const l = cli("always", "list");
  expect(l.code).toBe(0);
  expect(JSON.parse(l.out).rescue.action).toBe("recommended");
  expect(cli("always", "revoke", "rescue").code).toBe(0);
  expect(getJson("settings", "always", {})).toEqual({});
  expect(cli("always", "list").out).not.toContain("rescue");
});

// The lifecycle: who may act, what clears an Ask, and the marks a run leaves.

test("no reason can be handed to the firefighter: an Ask is the director's, then Chris's", () => {
  for (const reason of Object.keys(ASK_REASONS)) expect(grant(reason, "firefighter")).not.toBeNull();
  expect(readAlways()).toEqual({});
});

test("readAlways ignores a grant that grant() would refuse, and the next write drops it", () => {
  const at = "2026-11-04T12:00:00Z";
  const dead = Object.fromEntries(["held-path", "review-held", "no-commit", "run-cap"].map((k) => [k, { action: "firefighter", at }]));
  putJson("settings", "always", { ...dead, rescue: { action: "recommended", at } });
  expect(Object.keys(readAlways())).toEqual(["rescue"]);
  expect(always("held-path")).toBeNull();
  expect(grant("rescue", "recommended")).toBeNull();
  expect(Object.keys(getJson("settings", "always", {}))).toEqual(["rescue"]);
});

const choice: Ask = { reason: "question", question: "A or B?", options: [{ label: "A", line: "a" }, { label: "B", line: "b" }], why: [] };
const plain = plainAsk("question", "Which module?");

test("may: the director answers a plain question and a product choice alike", () => {
  expect(may("director", "answer", null)).toBe("it has no Ask");
  expect(may("director", "answer", plain)).toBeNull();
  expect(may("director", "answer", choice)).toBeNull();
});

test("may: the director does not answer an Ask whose run waits for a spec edit", () => {
  expect(may("director", "answer", plain, { waiting: "fac-3" })).toBe("the run fac-3 asked about the spec and waits for a spec edit; use edit, or drop it");
  expect(may("director", "edit-goal", plain, { waiting: "fac-3" })).toBeNull();
  expect(may("director", "close", choice)).toBeNull();
});

test("may: Chris takes the actions the card offers, on a run and on an issue", () => {
  expect(may("chris", "answer", plain, { run: true })).toBeNull();
  expect(may("chris", "answer", plain)).toBe("its question Ask offers no answer");
  expect(may("chris", "decide", plain)).toBeNull();
  expect(may("chris", "answer", plainAsk("held-path", "x"), { run: true })).toBe("its held-path Ask offers no answer");
  expect(may("chris", "land", plainAsk("held-path", "x"), { run: true })).toBeNull();
  expect(may("chris", "rerun", plainAsk("no-commit", "x"))).toBeNull();
  expect(may("chris", "answer", { ...plain, reason: "nope" }, { run: true })).toBe("its nope Ask offers no answer");
  expect(may("chris", "answer", undefined, { run: true })).toBe("it has no Ask");
});

test("decideAsk leaves a plain Ask's issue open; on part-dropped the plan option sets plan and any other answer closes the issue", () => {
  const i = item({ status: "To Do" });
  decideAsk(plain, i, "Chris: use b.ts");
  expect(issues.status(i)).toBe("open");
  for (const [said, plan, status] of [[`Chris chose ${PLAN_REST}`, "true", "open"], ["Chris chose Close with what landed", undefined, "done"]] as const) {
    const p = { ...item({ status: "To Do" }), id: status === "done" ? 21 : 22 };
    askPartDropped("fac", p, "A part was dropped. What now?");
    const a = askOf(refIn("fac", p));
    expect(a?.reason).toBe("part-dropped");
    decideAsk(a, p, said);
    expect(p.fm.plan as string | undefined).toBe(plan);
    expect(issues.status(p)).toBe(status);
  }
});

test("askIfPartDropped asks on the parent once its last open part is dropped", () => {
  const doc: issues.Doc = { repo: "fac", items: [] };
  const parent = issues.add(doc, "parent");
  const a = issues.add(doc, "a", { from: `issue.${parent.id}` });
  const b = issues.add(doc, "b", { from: `issue.${parent.id}` });
  issues.setStatus(a, "dropped");
  askIfPartDropped(doc, a, "too big");
  expect(askOf(refIn("fac", parent))).toBeNull();
  issues.setStatus(b, "dropped");
  askIfPartDropped(doc, b, "too big");
  const a2 = askOf(refIn("fac", parent));
  expect(a2).toMatchObject({ reason: "part-dropped", question: `Sub-issue fac-${b.id} was dropped: too big. What now?` });
  const lines = (a2?.options ?? []).map((o) => o.line).join("\n");
  expect(lines).toContain("sub-issue");
  expect(lines).not.toContain("part");
});

test("askFromRun marks the run asked, and with a spec the run waits for a spec edit", () => {
  const made = seed({ role: "build", name: "issue.1", state: "running" });
  const e = { id: made.id, folder: made.folder, run: made.run as any };
  try {
    expect(asked(e)).toBe(false);
    expect(askFromRun(e, { key: "fac" }, undefined, plain, "Which module?")).toBe("no issue");
    expect(asked(e)).toBe(true);
    expect(waitsForSpecEdit(e)).toBeNull();
    const spec = item();
    askFromRun(e, { key: "fac" }, undefined, plain, "Which spec?", spec);
    expect(waitsForSpecEdit(e)).toEqual({ version: specVersion(spec), question: "Which spec?" });
  } finally {
    rmSync(e.folder, { recursive: true, force: true });
  }
});

test("ASK_REASONS names no reason that no code raises, and a stored one reads as a question", () => {
  for (const k of ["proposal", "triage-failed", "host-check", "spec-check", "acceptance-failed"]) expect(Object.keys(ASK_REASONS)).not.toContain(k);
  expect(reasonOf("triage-failed")).toBe("question");
});

test("every reason has a card, a name, a line and a problem text, and one that offers rerun says what rerun does", () => {
  for (const [reason, r] of Object.entries(ASK_REASONS)) {
    expect([reason, ["approve", "decide", "unstick"].includes(r.card)]).toEqual([reason, true]);
    expect([reason, !!r.name && !!r.line && !!r.problem]).toEqual([reason, true]);
    const offers = [...actionsOn(reason, { run: false, decision: false }), ...actionsOn(reason, { run: true, decision: false })];
    expect([reason, offers.includes("rerun") ? !!r.rerun : true]).toEqual([reason, true]);
  }
});

test("a parked issue with a blocker-dropped Ask is asking, and its Always rule can be recommended", () => {
  const blocker: Ask = { reason: "blocker-dropped", question: "q?", options: [{ label: "Remove the link", line: "l" }, { label: "Drop the waiter", line: "d" }], why: [] };
  expect(asking(item({ parked: "true" }), blocker)).toBe(true);
  expect(asking(item({ parked: "true" }), { ...blocker, reason: "question" })).toBe(false);
  expect(grant("blocker-dropped", "recommended")).toBeNull();
});
