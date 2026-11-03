import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { actionsOn, always, ASK_REASONS, askFromRun, askIfPartDropped, askNote, askOf, askPartDropped, asked, askChris, clearAsk, decideAsk, editAnswers, grant, kindOf, logAlways, needsOf, may, normalizeAsk, PLAN_REST, plainAsk, readAlways, reasonOf, revoke, routeOf, setAsk, waitOf, waitsForSpecEdit, type Ask } from "./ask.ts";
import { specVersion } from "./goal-spec.ts";

const item = (fm: Record<string, unknown> = {}): issues.Issue => ({ id: 1, title: "t", fm: fm as any, request: "", spec: "", notes: [] });
const ask: Ask = { kind: "approval", reason: "held-path", question: "A or B?", options: [{ label: "A", line: "do a", after: "fac-2.1" }, { label: "B", line: "do b" }], recommended: "B", why: ["w"] };

test("askChris with a null text sets the Ask and adds no note", () => {
  const dir = mkdtempSync(join(tmpdir(), "ask-"));
  const old = process.env.ALEPH_HOME;
  try {
    expect(askChris({ key: "nope" } as any, 1, ask, null)).toBeTruthy();
  } finally { rmSync(dir, { recursive: true, force: true }); if (old !== undefined) process.env.ALEPH_HOME = old; }
});

test("setAsk writes the flat fields and askOf reads them back", () => {
  const i = item();
  setAsk(i, ask);
  expect(i.fm).toMatchObject({ ask: "approval", reason: "held-path", question: "A or B?", options: ["A :: do a :: after fac-2.1", "B :: do b"], recommended: "B", why: ["w"] });
  expect(askOf(i)).toEqual(ask);
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

test("setAsk writes situation, effects and recommend flat and askOf reads them back", () => {
  const i = item();
  setAsk(i, cased);
  expect(i.fm).toMatchObject({
    situation: "The path is held. Chris decides where it goes.",
    effects: ["decide:A :: lands the path on A", "decide:B :: lands the path on B", "drop :: drops the path"],
    recommend: "decide:B :: B keeps the path small",
  });
  expect(askOf(i)).toEqual(cased);
});

test("clearAsk removes situation, effects and recommend with the rest", () => {
  const i = item({ kind: "issue", priority: "low" });
  setAsk(i, cased);
  clearAsk(i);
  expect(i.fm).toEqual({ kind: "issue", priority: "low" });
  expect(askOf(i)).toBeNull();
});

test("an Ask without situation, effects or recommend writes no such key and reads without them", () => {
  const i = item();
  setAsk(i, ask);
  expect("situation" in i.fm).toBe(false);
  expect("effects" in i.fm).toBe(false);
  expect("recommend" in i.fm).toBe(false);
  expect(Object.keys(askOf(i)!).sort()).toEqual(["kind", "options", "question", "reason", "recommended", "why"]);
  setAsk(i, { ...ask, situation: " ", effects: [], recommend: undefined });
  expect("situation" in i.fm || "effects" in i.fm || "recommend" in i.fm).toBe(false);
});

test("a case text with :: or a line break round-trips cleaned", () => {
  const i = item();
  setAsk(i, {
    ...ask,
    situation: "Two lines:\nfirst :: second",
    effects: [{ action: "decide:A :: B", text: "does\nthis \\ that :: now" }],
    recommend: { action: "drop", why: "too\nlong :: a \"quote\"" },
  });
  expect(i.fm.situation).toBe("Two lines: first : second");
  expect(i.fm.effects).toEqual(["decide:A : B :: does this / that : now"]);
  expect(i.fm.recommend).toBe("drop :: too long : a 'quote'");
  expect(askOf(i)).toMatchObject({
    situation: "Two lines: first : second",
    effects: [{ action: "decide:A : B", text: "does this / that : now" }],
    recommend: { action: "drop", why: "too long : a 'quote'" },
  });
});

test("setAsk and clearAsk write and remove every ask field and keep the rest", () => {
  const i = item({ kind: "issue", priority: "low" });
  setAsk(i, ask);
  expect(askOf(i)).toEqual(ask);
  clearAsk(i);
  for (const k of ["ask", "reason", "question", "options", "recommended", "why"]) expect(k in i.fm).toBe(false);
  expect(i.fm).toEqual({ kind: "issue", priority: "low" });
  expect(askOf(i)).toBeNull();
  clearAsk(i);
});

test("normalizeAsk takes after, 2 to 4 options and a recommended label that is one of them", () => {
  const raw = { question: "Q?", options: [{ label: "A", line: "a", after: "fac-4" }, { label: "B", line: "b", after: "fac-5.1" }], recommended: "A", why: ["w"] };
  expect(normalizeAsk(raw)).toEqual({ kind: "input", reason: "question", question: "Q?", options: [{ label: "A", line: "a", after: "fac-4" }, { label: "B", line: "b", after: "fac-5.1" }], recommended: "A", why: ["w"] });
  expect(normalizeAsk({ ...raw, recommended: "C" })).toBeNull();
  expect(normalizeAsk({ ...raw, options: raw.options.slice(0, 1) })).toBeNull();
  expect(normalizeAsk({ ...raw, question: " " })).toBeNull();
  expect(normalizeAsk(raw, { kind: "approval", reason: "review" })).toMatchObject({ kind: "approval", reason: "review" });
});

test("askNote reads as a sentence", () => {
  expect(askNote(ask)).toBe("A or B? Options: A: do a (waits on fac-2.1); B: do b. My recommendation is B. Why: w.");
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

test("askOf needs the ask field and gives no options for a plain question", () => {
  expect(askOf(item({ question: "q", options: ["A :: a"] }))).toBeNull();
  expect(askOf(item({ ask: "input", question: "q" }))).toEqual({ kind: "input", reason: "question", question: "q", options: [], why: [] });
});

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "always-")); process.env.ALEPH_FACTORY_DIR = dir; });
afterEach(() => { delete process.env.ALEPH_FACTORY_DIR; rmSync(dir, { recursive: true, force: true }); });

test("grant then always round-trips; revoke removes it", () => {
  expect(always("held-path")).toBeNull();
  expect(grant("held-path", "land")).toBeNull();
  expect(always("held-path")?.action).toBe("land");
  expect(routeOf("held-path")).toBe("chris");
  expect(grant("held-path", "firefighter")).toBeNull();
  expect(routeOf("held-path")).toBe("firefighter");
  revoke("held-path");
  expect(always("held-path")).toBeNull();
  expect(readAlways()).toEqual({});
});

test("grant refuses an unknown reason and an action the reason does not list", () => {
  expect(grant("nope", "land")).toContain("unknown reason");
  expect(grant("held-path", "rerun")).toContain("no action");
  expect(readAlways()).toEqual({});
});

test("grant accepts proposal-<kind>:<place> only", () => {
  expect(grant("proposal-claude-md:global", "approve")).toBeNull();
  expect(always("proposal-claude-md:global")?.action).toBe("approve");
  expect(grant("held:x", "land")).toContain("unknown reason");
  expect(grant("proposal-nope:global", "approve")).toContain("unknown reason");
});

test("ASK_REASONS names every reason with actions and an always", () => {
  expect(Object.keys(ASK_REASONS).sort()).toEqual(["acceptance-failed", "firefighter", "held-path", "host-check", "no-commit", "part-dropped", "proposal", "proposal-check", "proposal-claude-md", "proposal-skill", "question", "rescue", "review", "run-cap", "spec-check", "triage-failed"]);
  for (const r of Object.values(ASK_REASONS)) {
    expect(r.actions.length).toBeGreaterThan(0);
    expect([...r.actions, "firefighter", "recommended", ""]).toContain(r.always);
    expect(new Set(r.actions).size).toBe(r.actions.length);
  }
  expect(ASK_REASONS.question.always).toBe("recommended");
  expect(ASK_REASONS["triage-failed"].always).toBe("retry");
  expect(ASK_REASONS.proposal.always).toBe("start");
  expect(ASK_REASONS["host-check"].always).toBe("");
});

test("readAlways reads always.json only; a bad file is empty and a write goes to always.json", () => {
  expect(readAlways()).toEqual({});
  writeFileSync(join(dir, "always.json"), JSON.stringify({ "held-path": { action: "firefighter", at: "t" } }));
  expect(Object.keys(readAlways())).toEqual(["held-path"]);
  expect(routeOf("held-path")).toBe("firefighter");
  expect(grant("rescue", "recommended")).toBeNull();
  expect(Object.keys(readAlways()).sort()).toEqual(["held-path", "rescue"]);
  writeFileSync(join(dir, "always.json"), "not json");
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

test("aleph always grant refuses an unknown reason and takes held-path", () => {
  const bad = cli("always", "grant", "held", "firefighter");
  expect(bad.code).toBe(1);
  expect(existsSync(join(dir, "always.json"))).toBe(false);
  expect(cli("always", "grant", "held-path", "firefighter").code).toBe(0);
  expect(cli("always", "grant", "held-path", "land").code).toBe(0);
  expect(JSON.parse(readFileSync(join(dir, "always.json"), "utf8"))["held-path"].action).toBe("land");
  expect(JSON.parse(cli("always", "list").out)["held-path"].action).toBe("land");
});

test("logAlways appends one always line to tick.log", () => {
  logAlways("held-path", "land", "fac-1");
  const lines = readFileSync(join(dir, "tick.log"), "utf8").trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("always: held-path: land on fac-1");
});

// The lifecycle: routing, who may act, what clears an Ask, and the marks a run leaves.

test("routeOf sends each reason to Chris, and to the firefighter only once Chris hands it over", () => {
  const handable: string[] = [];
  for (const reason of Object.keys(ASK_REASONS)) {
    expect(routeOf(reason)).toBe("chris");
    if (grant(reason, "firefighter") === null) handable.push(reason);
    expect(routeOf(reason)).toBe(handable.includes(reason) ? "firefighter" : "chris");
  }
  expect(handable.sort()).toEqual(["acceptance-failed", "held-path", "no-commit", "question", "review", "run-cap", "spec-check"]);
  grant("spec-check", "rerun");
  expect(routeOf("spec-check")).toBe("chris");
});

const choice: Ask = { kind: "input", reason: "question", question: "A or B?", options: [{ label: "A", line: "a" }, { label: "B", line: "b" }], why: [] };
const plain = plainAsk("question", "Which module?");

test("may: the firefighter answers a plain question, but not a product choice until Chris hands its reason over", () => {
  expect(may("firefighter", "answer", null)).toBe("it has no Ask");
  expect(may("firefighter", "answer", plain)).toBeNull();
  expect(may("firefighter", "answer", choice)).toBe("its question is a product choice, which is Chris's");
  grant("question", "firefighter");
  expect(may("firefighter", "answer", choice)).toBeNull();
});

test("may: the firefighter does not answer an Ask whose run waits for a spec edit", () => {
  expect(may("firefighter", "answer", plain, { waiting: "fac-3" })).toBe("the run fac-3 asked about the spec and waits for a spec edit; use edit, or drop it");
  expect(may("firefighter", "edit-goal", plain, { waiting: "fac-3" })).toBeNull();
  expect(may("firefighter", "close", choice)).toBeNull();
});

test("may: Chris takes the actions the card offers, on a run and on an issue", () => {
  expect(may("chris", "answer", plain, { run: true })).toBeNull();
  expect(may("chris", "answer", plain)).toBe("its question Ask offers no answer");
  expect(may("chris", "decide", plain)).toBeNull();
  expect(may("chris", "answer", plainAsk("held-path", "x"), { run: true })).toBe("its held-path Ask offers no answer");
  expect(may("chris", "land", plainAsk("held-path", "x"), { run: true })).toBeNull();
  expect(may("chris", "rerun", plainAsk("spec-check", "x"))).toBeNull();
  expect(may("chris", "answer", { ...plain, reason: "nope" }, { run: true })).toBe("its nope Ask offers no answer");
  expect(may("chris", "answer", undefined, { run: true })).toBe("it has no Ask");
});

const full = "## Goal\ng\n\n## Edit surface\n- a.ts: x\n\n## Oracle\n- passes";

test("editAnswers: only a full spec answers a spec-check Ask, and only once spec-check is handed to the firefighter", () => {
  const held = plainAsk("spec-check", "the spec has no Oracle");
  expect(editAnswers(held, full)).toBe(false);
  grant("spec-check", "firefighter");
  expect(editAnswers(held, full)).toBe(true);
  expect(editAnswers(held, "## Goal\ng")).toBe(false);
  expect(editAnswers(held, undefined)).toBe(false);
  grant("no-commit", "firefighter");
  expect(editAnswers(plainAsk("no-commit", "x"), full)).toBe(false);
  expect(editAnswers(null, full)).toBe(false);
});

test("decideAsk clears the Ask; on part-dropped the plan option sets plan and any other answer closes the issue", () => {
  const i = item({ status: "To Do" });
  setAsk(i, plain);
  decideAsk(i, "Chris: use b.ts");
  expect(askOf(i)).toBeNull();
  expect(issues.status(i)).toBe("open");
  for (const [said, plan, status] of [[`Chris chose ${PLAN_REST}`, "true", "open"], ["Chris chose Close with what landed", undefined, "done"]] as const) {
    const p = item({ status: "To Do" });
    askPartDropped(p, "A part was dropped. What now?");
    expect(askOf(p)?.reason).toBe("part-dropped");
    decideAsk(p, said);
    expect(askOf(p)).toBeNull();
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
  expect(askOf(parent)).toBeNull();
  issues.setStatus(b, "dropped");
  askIfPartDropped(doc, b, "too big");
  expect(askOf(parent)).toMatchObject({ reason: "part-dropped", question: `Part fac-${parent.id}.2 was dropped: too big. What now?` });
});

test("askFromRun marks the run asked, and with a spec the run waits for a spec edit", () => {
  const e = { id: "r1", folder: mkdtempSync(join(tmpdir(), "run-")), run: {} as any };
  try {
    expect(asked(e)).toBe(false);
    expect(askFromRun(e, { key: "fac" }, undefined, plain, "Which module?")).toBe("no issue");
    expect(asked(e)).toBe(true);
    expect(waitsForSpecEdit(e)).toBeNull();
    const spec = item();
    askFromRun(e, { key: "fac" }, undefined, plain, "Which spec?", spec);
    expect(waitsForSpecEdit(e)).toEqual({ version: `${specVersion(spec)}\n`, question: "Which spec?" });
  } finally {
    rmSync(e.folder, { recursive: true, force: true });
  }
});

test("revoke writes one tick.log line naming the reason; a revoke with no grant writes none", () => {
  revoke("held-path");
  expect(existsSync(join(dir, "tick.log"))).toBe(false);
  grant("held-path", "land");
  revoke("held-path");
  const lines = readFileSync(join(dir, "tick.log"), "utf8").trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("always: revoked held-path");
  revoke("held-path");
  expect(readFileSync(join(dir, "tick.log"), "utf8").trim().split("\n")).toHaveLength(1);
});

test("every reason has a non-empty display name", () => {
  for (const [reason, r] of Object.entries(ASK_REASONS)) expect(r.name.trim().length, reason).toBeGreaterThan(0);
  expect(ASK_REASONS["spec-check"].name).toBe("Spec check");
  expect(ASK_REASONS["proposal-skill"].name).toBe("Lesson");
});

test("details round-trips through setAsk and askOf", () => {
  const i = item();
  setAsk(i, { ...ask, details: "More text." });
  expect(askOf(i)?.details).toBe("More text.");
  expect(askOf(item({ ask: "input", question: "q" }))?.details).toBeUndefined();
});
