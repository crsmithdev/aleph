// Archived goal tests from jobs/lib/explain.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../../todo/lib/todo.ts";
import { awaitsChris, readList, writeList } from "../../../todo/lib/store.ts";
import { askOf, plainAsk, setAsk, type Ask } from "../../../jobs/lib/ask.ts";
import { allRuns, stamp, writeRun, type Repo } from "../../../jobs/lib/ledger.ts";
import { readStore, type Lesson } from "../../../jobs/lib/corrections.ts";
import { explainPrompt, explainStep, parseExplain, pendingCases } from "../../../jobs/lib/explain.ts";
import { liveEntries, runsToday } from "../../../jobs/lib/factory-status.ts";
import { triageStep } from "../../../jobs/lib/factory.ts";
import { storeRepos } from "../../../tests/git-fixture.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string;
const repo = { key: "exp", path: "", main: "main", sandbox: true } as Repo;

// The fake explainer: it keeps each prompt, and `FAKE_EXIT` makes it fail.
const FAKE = `#!/bin/bash
prompt=$(cat)
printf '%s' "$prompt" > "$FAKE_DIR/prompt-$(date +%s%N).md"
rec=deny; case $prompt in *"Land x.ts?"*) rec=land ;; esac
echo "$PWD $*" >> "$FAKE_DIR/calls"
if [ -n "$FAKE_HOOK" ]; then eval "$FAKE_HOOK"; fi
if [ -n "$FAKE_EXIT" ]; then echo "boom" >&2; exit "$FAKE_EXIT"; fi
case $prompt in *"approve, decline"*)
echo '{"situation":"The lesson says to check x.ts.","effects":[{"action":"approve","text":"Files a goal."},{"action":"decline","text":"Drops it."}],"recommend":{"action":"decline","why":"Too vague."}}'
exit 0 ;; esac
echo '{"situation":"The run changed x.ts, the parser. I did not check the vault.","effects":[{"action":"checked","text":"Records a claim that the dashboard was looked at; it runs nothing."},{"action":"deny","text":"Leaves the dashboard unchecked."},{"action":"land","text":"Puts x.ts on main."},{"action":"drop","text":"Throws the branch away."}],"recommend":{"action":"'$rec'","why":"Nothing was checked."}}'
`;

let lists = 0;
/** A fresh list with one item that asks `ask`, and a fresh ledger. */
function seed(ask: Ask, notes: string[] = []): number {
  repo.key = `exp${++lists}`;
  process.env.ALEPH_JOBS_DIR = join(base, `jobs-${lists}`);
  let id = 0;
  writeList(repo, "seed", (doc) => {
    const item = issues.add(doc, "Check the dashboard", { request: "Look at the prod dashboard." });
    for (const n of notes) issues.note(item, n);
    setAsk(item, ask);
    id = item.id;
    return true;
  }, true);
  return id;
}
const itemOf = (id: number) => issues.find(readList(repo)!, id)!;
const explains = () => allRuns().filter((e) => e.run.kind === "explain");
const prompts = () => readdirSync(base).filter((f) => f.startsWith("prompt-")).sort().map((f) => readFileSync(join(base, f), "utf8"));

/** An awaiting build run on the item, with a result and a review Ask. */
function awaitingRun(on: string): string {
  const folder = join(process.env.ALEPH_JOBS_DIR!, `${stamp()}-${on}`);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "build", job: on, name: on, repo: repo.key, on, condition: "awaiting", told: true, started: new Date().toISOString(), ask: { kind: "approval", reason: "review", question: "Land x.ts?", options: [], why: [] } });
  writeFileSync(join(folder, "result.md"), "work done\nRESULT-TAIL-MARK: changed x.ts\n");
  writeFileSync(join(folder, "prompt.md"), "the goal\n");
  return folder;
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-explain-"));
  storeRepos(base);
  writeFileSync(join(base, "fake"), FAKE);
  chmodSync(join(base, "fake"), 0o755);
  repo.path = base;
  writeFileSync(join(base, "repos.json"), JSON.stringify({ exp: { path: base, sandbox: true } }));
  Object.assign(process.env, gitEnv, {
    ALEPH_ISSUES: join(base, "items"), ALEPH_EXPLAIN_CMD: join(base, "fake"), FAKE_DIR: base,
    ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_DISPATCH: "off", ALEPH_REPOS: join(base, "repos.json"),
    XDG_RUNTIME_DIR: join(base, "run"),
  });
});
afterAll(() => rmSync(base, { recursive: true, force: true }));
beforeEach(() => {
  rmSync(join(base, "factory"), { recursive: true, force: true }); delete process.env.FAKE_HOOK;
  delete process.env.FAKE_EXIT; delete process.env.ALEPH_EXPLAIN_TRIES; delete process.env.ALEPH_EXPLAIN_CAP;
  for (const f of readdirSync(base)) if (f.startsWith("prompt-") || f === "calls") rmSync(join(base, f));
});

test("an item's host-check ask gets its situation, effects and recommend, read back by store.askOf", async () => {
  const id = seed(plainAsk("host-check", "check the prod dashboard"));
  await explainStep([repo]);
  const ask = askOf(itemOf(id))!;
  expect(ask.reason).toBe("host-check");
  expect(ask.question).toBe("check the prod dashboard");
  expect(ask.situation).toContain("x.ts, the parser");
  expect(ask.effects).toEqual([
    { action: "checked", text: "Records a claim that the dashboard was looked at; it runs nothing." },
    { action: "deny", text: "Leaves the dashboard unchecked." },
  ]);
  expect(ask.recommend).toEqual({ action: "deny", why: "Nothing was checked." });
  expect(explains().map((e) => [e.run.condition, e.run.reason, e.run.model, e.run.repo])).toEqual([["done", "explained", "claude-opus-5-5", undefined]]);
  expect(explains()[0].run.on).toBe(`${repo.key}-${id}`);
  // The run is in the repo, read-only.
  const call = readFileSync(join(base, "calls"), "utf8");
  expect(call.startsWith(`${base} `)).toBe(true);
  expect(call).toContain("Bash(git log:*)");
  expect(call).toContain("Bash(ls:*)");
  // Explained: the next sweep leaves it.
  await explainStep([repo]);
  expect(explains()).toHaveLength(1);
});

test("a failing explainer leaves the ask raised and unchanged; after two failures no third run opens", async () => {
  const id = seed(plainAsk("host-check", "check the prod dashboard"));
  const before = askOf(itemOf(id));
  process.env.FAKE_EXIT = "1";
  await explainStep([repo]);
  expect(awaitsChris(itemOf(id))).toBe(true);
  expect(askOf(itemOf(id))).toEqual(before);
  expect(explains()).toHaveLength(1);
  expect(explains()[0].run.reason).toStartWith("failed:");
  expect(explains()[0].run.condition).toBe("done");
  await explainStep([repo]);
  expect(explains()).toHaveLength(2);
  await explainStep([repo]);
  expect(explains()).toHaveLength(2);
  expect(pendingCases([repo]).map((c) => c.on)).toEqual([`${repo.key}-${id}`]);
});

test("bad JSON ends the run failed and leaves the ask", async () => {
  const id = seed(plainAsk("host-check", "check it"));
  writeFileSync(join(base, "fake-bad"), `#!/bin/bash\ncat > /dev/null\necho '{"situation":"x","effects":[{"action":"checked","text":"t"}]}'\n`);
  chmodSync(join(base, "fake-bad"), 0o755);
  process.env.ALEPH_EXPLAIN_CMD = join(base, "fake-bad");
  try { await explainStep([repo]); } finally { process.env.ALEPH_EXPLAIN_CMD = join(base, "fake"); }
  expect(explains()[0].run.reason).toBe("failed: bad JSON: no effect for deny");
  expect(askOf(itemOf(id))!.situation).toBeUndefined();
});

test("the prompt names the reason's actions, the item's notes and the run's result tail", async () => {
  const id = seed({ kind: "input", reason: "question", question: "A or B?", options: [{ label: "A", line: "do a" }, { label: "B", line: "do b" }], why: ["one"] }, ["NOTE-MARK: tried once"]);
  awaitingRun(`${repo.key}-${id}`);
  const cases = pendingCases([repo]);
  const item = explainPrompt(cases.find((c) => c.at === "item")!);
  expect(item).toContain("decide:A, decide:B, deny");
  expect(item).toContain("NOTE-MARK: tried once");
  expect(item).toContain("A or B?");
  const run = explainPrompt(cases.find((c) => c.at === "run")!);
  expect(run).toContain("land, drop");
  expect(run).toContain("RESULT-TAIL-MARK: changed x.ts");
  expect(run).toContain("NOTE-MARK: tried once");
  // The sweep sends the same text.
  process.env.ALEPH_EXPLAIN_CAP = "5";
  await explainStep([repo]);
  expect(prompts().some((p) => p.includes("RESULT-TAIL-MARK"))).toBe(true);
  expect(prompts().some((p) => p.includes("NOTE-MARK") && p.includes("decide:A"))).toBe(true);
  expect(askOf(itemOf(id))!.situation).toBeUndefined(); // the fake gave no decide:A effect
});

test("parseExplain wants a situation and an effect per action", () => {
  expect(parseExplain("no", ["a"])).toBe("no JSON");
  expect(parseExplain('{"situation":"","effects":[]}', ["a"])).toBe("no situation");
  expect(parseExplain('{"situation":"s","effects":[{"action":"a","text":"t"},{"action":"z","text":"u"}],"recommend":null}', ["a"])).toEqual({ situation: "s", effects: [{ action: "a", text: "t" }] });
});

test("an explain run is not a live entry and not in runsToday", () => {
  seed(plainAsk("host-check", "x"));
  const folder = join(process.env.ALEPH_JOBS_DIR!, `${stamp()}-explain-x-explain`);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "explain", job: "explain-x", name: "explain-x", on: "exp-1", condition: "running", told: true, shown: true, started: new Date().toISOString(), made: Date.now() });
  writeFileSync(join(folder, "pid"), String(process.pid));
  expect(existsSync(folder)).toBe(true);
  expect(allRuns().map((e) => e.run.kind)).toEqual(["explain"]);
  expect(liveEntries()).toEqual([]);
  expect(runsToday()).toEqual([]);
});

test("the tick's triage step runs the sweep", async () => {
  const id = seed(plainAsk("host-check", "check the prod dashboard"));
  writeFileSync(join(base, "repos.json"), JSON.stringify({ [repo.key]: { path: base, sandbox: true } }));
  await triageStep();
  expect(askOf(itemOf(id))!.situation).toContain("x.ts");
});

// ---- lessons
const lessonId = "l1";
const fresh = () => { process.env.ALEPH_JOBS_DIR = join(base, `jobs-${++lists}`); };
function seedLessons(...ls: Partial<Lesson>[]): void {
  mkdirSync(join(base, "factory"), { recursive: true });
  const lessons = ls.map((l, i) => ({
    id: `l${i + 1}`, sentence: `Check x.ts first ${i + 1}`, state: "proposed", count: 1, kind: "claude-md", target: "CLAUDE.md", title: "Check x.ts",
    signals: [{ id: "s1", source: "chris", at: "2026-10-01T00:00:00Z", quote: "QUOTE-MARK you forgot x.ts", link: "https://example.com/1" }], ...l,
  }));
  writeFileSync(join(base, "factory", "corrections.json"), JSON.stringify({ minedAt: "", lessons }));
}
const lesson = (id = lessonId) => readStore().lessons.find((l) => l.id === id)!;

test("a proposed lesson gets its situation, effects and recommend, and the prompt names its parts", async () => {
  seed(plainAsk("host-check", "x"));
  seedLessons({});
  process.env.ALEPH_EXPLAIN_CAP = "5";
  expect(pendingCases([repo]).map((c) => c.at)).toEqual(["item", "lesson"]);
  await explainStep([repo]);
  const l = lesson();
  expect(l.situation).toContain("x.ts");
  expect(l.effects!.map((e) => e.action)).toEqual(["approve", "decline"]);
  expect(l.recommend).toEqual({ action: "decline", why: "Too vague." });
  const e = explains().find((x) => x.run.on === lessonId)!;
  expect([e.run.condition, e.run.reason, e.run.question]).toEqual(["done", "explained", "Check x.ts first 1"]);
  const p = prompts().find((x) => x.includes("approve, decline"))!;
  for (const m of ["Check x.ts first 1", "CLAUDE.md", "claude-md", "QUOTE-MARK", "Approve only files a goal"]) expect(p).toContain(m);
  expect(readFileSync(join(base, "calls"), "utf8")).toContain(`${base} `);
});

test("lessons not proposed, without a kind, or already explained open no run", async () => {
  fresh();
  seedLessons({ state: "open" }, { state: "approved" }, { state: "declined" }, { kind: undefined }, { situation: "already" });
  expect(pendingCases([repo])).toEqual([]);
  await explainStep([repo]);
  expect(explains()).toHaveLength(0);
});

test("a lesson declined during its run gets no text", async () => {
  fresh();
  seedLessons({});
  process.env.FAKE_HOOK = `sed -i 's/"proposed"/"declined"/' "${join(base, "factory", "corrections.json")}"`;
  await explainStep([repo]);
  expect(lesson().situation).toBeUndefined();
  expect(explains()[0].run.reason).toBe("the ask changed during the run");
});

test("ALEPH_EXPLAIN_CAP=1 explains the item first and the lesson in the second sweep", async () => {
  const id = seed(plainAsk("host-check", "check the prod dashboard"));
  seedLessons({});
  process.env.ALEPH_EXPLAIN_CAP = "1";
  await explainStep([repo]);
  expect(askOf(itemOf(id))!.situation).toBeTruthy();
  expect(lesson().situation).toBeUndefined();
  await explainStep([repo]);
  expect(lesson().situation).toBeTruthy();
});

test("parseExplain keeps 3 sentences of the situation and 2 of an effect, and moves the rest to details whole", () => {
  const sit = Array.from({ length: 8 }, (_, i) => `S${i + 1}.`).join(" ");
  const t = parseExplain(JSON.stringify({ situation: sit, effects: [{ action: "a", text: "E1. E2. E3. E4." }], details: "Own." }), ["a"]) as any;
  expect(t.situation).toBe("S1. S2. S3.");
  expect(t.effects[0].text).toBe("E1. E2.");
  expect(t.details).toBe("S4. S5. S6. S7. S8. E3. E4. Own.");
});

test("parseExplain never cuts a sentence: the character limit moves whole sentences, and a long first sentence stays", () => {
  const long = "x".repeat(300) + ".";
  const t = parseExplain(JSON.stringify({ situation: `Short. ${"y".repeat(595)}.`, effects: [{ action: "a", text: long + " Next." }] }), ["a"]) as any;
  expect(t.situation).toBe("Short.");
  expect(t.effects[0].text).toBe(long);
  expect(t.details).toBe(`${"y".repeat(595)}. Next.`);
  const ok = parseExplain(JSON.stringify({ situation: "A. B.", effects: [{ action: "a", text: "C." }] }), ["a"]) as any;
  expect(ok.details).toBeUndefined();
});

test("the explainer prompt states the limits and asks for details", () => {
  seed(plainAsk("host-check", "check it"));
  const p = explainPrompt(pendingCases([repo])[0]);
  expect(p).toContain("at most 3 sentences and 600 characters");
  expect(p).toContain("only risks and gaps");
  expect(p).toContain("not a second summary");
  expect(p).toContain("at most 2 sentences and 220 characters");
  expect(p).toContain('"details"');
});
