import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { actionsOn, always, ASK_REASONS, askFromRun, askIfPartDropped, askOf, askPartDropped, asked, askChris, clearAsk, decideAsk, refIn, grant, kindOf, needsOf, may, normalizeAsk, PLAN_REST, plainAsk, readAlways, reasonOf, revoke, setAsk, waitOf, waitsForSpecEdit, type Ask } from "./ask.ts";
import { specVersion } from "./goal-spec.ts";
import * as record from "./record.ts";

const item = (fm: Record<string, unknown> = {}): issues.Issue => ({ id: 1, title: "t", fm: fm as any, request: "", spec: "", notes: [] });
const ask: Ask = { kind: "approval", reason: "held-path", question: "A or B?", options: [{ label: "A", line: "do a", after: "fac-2.1" }, { label: "B", line: "do b" }], recommended: "B", why: ["w"] };

test("askChris with a null text sets the Ask and adds no note", () => {
  const dir = mkdtempSync(join(tmpdir(), "ask-"));
  const old = process.env.ALEPH_HOME;
  try {
    expect(askChris({ key: "nope" } as any, 1, ask, null)).toBeTruthy();
  } finally { rmSync(dir, { recursive: true, force: true }); if (old !== undefined) process.env.ALEPH_HOME = old; }
});

test("setAsk keeps the Ask whole in the issue's job record, and askOf reads it back", () => {
  setAsk("fac-11", ask);
  expect(askOf("fac-11")).toEqual(ask);
  expect(record.read("fac-11")).toMatchObject({ ask });
  clearAsk("fac-11");
  expect(askOf("fac-11")).toBeNull();
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
  setAsk("fac-12", cased);
  expect(askOf("fac-12")).toEqual(cased);
});

test("a run's Ask is the run's: the issue has none, and clearing the issue's Ask leaves it", () => {
  record.putRun("r1", { kind: "build", job: "r1", name: "fac-13", on: "fac-13", condition: "awaiting", ask, told: true, started: "2026-11-04T10:00:00Z" });
  expect(record.getRun("r1")?.ask).toEqual(ask);
  expect(askOf("fac-13")).toBeNull();
  clearAsk("fac-13");
  expect(record.getRun("r1")?.ask).toEqual(ask);
  record.patchRun("r1", { condition: "dropped", ask: undefined });
  expect(record.read("fac-13")?.ask).toBeNull();
});

test("normalizeAsk takes after, 2 to 4 options and a recommended label that is one of them", () => {
  const raw = { question: "Q?", options: [{ label: "A", line: "a", after: "fac-4" }, { label: "B", line: "b", after: "fac-5.1" }], recommended: "A", why: ["w"] };
  expect(normalizeAsk(raw)).toEqual({ kind: "input", reason: "question", question: "Q?", options: [{ label: "A", line: "a", after: "fac-4" }, { label: "B", line: "b", after: "fac-5.1" }], recommended: "A", why: ["w"] });
  expect(normalizeAsk({ ...raw, recommended: "C" })).toBeNull();
  expect(normalizeAsk({ ...raw, options: raw.options.slice(0, 1) })).toBeNull();
  expect(normalizeAsk({ ...raw, question: " " })).toBeNull();
  expect(normalizeAsk(raw, { kind: "approval", reason: "review" })).toMatchObject({ kind: "approval", reason: "review" });
});

test("reasonOf keeps a known reason and reads any other as a question", () => {
  expect(reasonOf("run-cap")).toBe("run-cap");
  expect(reasonOf("nope")).toBe("question");
  expect(reasonOf(undefined)).toBe("question");
});

test("the table gives the kind, the wait and the plain Ask of a reason", () => {
  expect(kindOf("held-path")).toBe("approval");
  expect(kindOf("question", "approval")).toBe("approval");
  expect(kindOf("nope")).toBe("input");
  expect(needsOf(plainAsk("held-path", "q"))).toBe("held");
  expect(needsOf(plainAsk("no-commit", "q"))).toBeUndefined();
  expect(needsOf(undefined)).toBeUndefined();
  expect(plainAsk("review", "q", ["w"])).toEqual({ kind: "approval", reason: "review", question: "q", options: [], why: ["w"] });
});

test("waitOf reads a run with no ask as a question", () => {
  expect(waitOf(undefined)).toEqual({ kind: "input", reason: "question" });
  expect(waitOf(ask)).toEqual({ kind: "approval", reason: "held-path" });
});

test("actionsOn picks by context for a question and a dropped part", () => {
  expect(actionsOn("question", { run: true, decision: false })).toEqual(["answer", "drop"]);
  expect(actionsOn("question", { run: false, decision: true })).toEqual(["decide", "deny"]);
  expect(actionsOn("part-dropped", { run: false, decision: true })).toEqual(["decide", "close"]);
  expect(actionsOn("part-dropped", { run: false, decision: false })).toEqual(["rerun", "close"]);
  expect(actionsOn("review", { run: true, decision: false })).toEqual(["land", "drop"]);
});


let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "always-")); process.env.ALEPH_FACTORY_DIR = dir; });
afterEach(() => { delete process.env.ALEPH_FACTORY_DIR; rmSync(dir, { recursive: true, force: true }); });

test("grant then always round-trips; revoke removes it", () => {
  expect(always("held-path")).toBeNull();
  expect(grant("held-path", "land")).toBeNull();
  expect(always("held-path")?.action).toBe("land");
  revoke("held-path");
  expect(always("held-path")).toBeNull();
  expect(readAlways()).toEqual({});
});

const CLI = join(import.meta.dir, "..", "cli.ts");
const cli = (...args: string[]) => {
  const p = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, ALEPH_FACTORY_DIR: dir }, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};

test("aleph always grant, list and revoke work on always.json", () => {
  const g = cli("always", "grant", "rescue", "recommended");
  expect(g.code).toBe(0);
  const saved = JSON.parse(readFileSync(join(dir, "always.json"), "utf8"));
  expect(saved).toEqual({ rescue: { action: "recommended", at: expect.any(String) } });
  const l = cli("always", "list");
  expect(l.code).toBe(0);
  expect(JSON.parse(l.out).rescue.action).toBe("recommended");
  expect(cli("always", "revoke", "rescue").code).toBe(0);
  expect(JSON.parse(readFileSync(join(dir, "always.json"), "utf8"))).toEqual({});
  expect(cli("always", "list").out).not.toContain("rescue");
});

// The lifecycle: who may act, what clears an Ask, and the marks a run leaves.

test("no reason can be handed to the firefighter: an Ask is the director's, then Chris's", () => {
  for (const reason of Object.keys(ASK_REASONS)) expect(grant(reason, "firefighter")).not.toBeNull();
  expect(readAlways()).toEqual({});
});

test("readAlways ignores a grant that grant() would refuse, and the next write drops it", () => {
  const at = "2026-11-04T12:00:00Z";
  const dead = Object.fromEntries(["held-path", "review", "no-commit", "run-cap"].map((k) => [k, { action: "firefighter", at }]));
  writeFileSync(join(dir, "always.json"), JSON.stringify({ ...dead, rescue: { action: "recommended", at } }));
  expect(Object.keys(readAlways())).toEqual(["rescue"]);
  expect(always("held-path")).toBeNull();
  expect(grant("rescue", "recommended")).toBeNull();
  expect(Object.keys(JSON.parse(readFileSync(join(dir, "always.json"), "utf8")))).toEqual(["rescue"]);
});

const choice: Ask = { kind: "input", reason: "question", question: "A or B?", options: [{ label: "A", line: "a" }, { label: "B", line: "b" }], why: [] };
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
  const a = { ...issues.add(doc, "a"), id: parent.id, sub: 1 };
  const b = { ...issues.add(doc, "b"), id: parent.id, sub: 2 };
  doc.items = [parent, a, b];
  issues.setStatus(a, "dropped");
  askIfPartDropped(doc, a, "too big");
  expect(askOf(refIn("fac", parent))).toBeNull();
  issues.setStatus(b, "dropped");
  askIfPartDropped(doc, b, "too big");
  expect(askOf(refIn("fac", parent))).toMatchObject({ reason: "part-dropped", question: `Part fac-${parent.id}.2 was dropped: too big. What now?` });
});

test("askFromRun marks the run asked, and with a spec the run waits for a spec edit", () => {
  const e = { id: "r1", folder: mkdtempSync(join(tmpdir(), "run-")), run: { job: "r1" } as any };
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
