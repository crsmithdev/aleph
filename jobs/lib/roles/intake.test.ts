import { afterAll, beforeAll, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import * as issues from "../../../issues/lib/todo.ts";
import { buildableIssues, isBuildable, isSorted, mediaDir, mediaPath, partsOf, readList, writeList, type File } from "../../../issues/lib/store.ts";

import { INTAKE_SCHEMA, addParts, intakeIssue, parseRoute, problems, prompt, realOracle, type Counts } from "./intake.ts";
import type { Spec } from "./issue-spec.ts";
import { allRuns, stamp, type Repo } from "../records/ledger.ts";
import { getRun, putRun } from "../records/record.ts";
import { askOf, setAsk } from "../asks/ask.ts";
import { factoryRepos } from "../../../tests/git-fixture.ts";
import { readEvents } from "../../../lib/layout.ts";

// The test's clock: the counts and the fixtures read it.
const NOW = Date.parse("2026-11-04T12:00:00Z");
beforeAll(() => setSystemTime(NOW));
afterAll(() => setSystemTime());

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string;
// The factory dir for the whole file: nothing here may read or write ~/.aleph/factory.
let factoryHome: string;
const repo = { key: "int", path: "", main: "main" } as Repo;

function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

const spec = (o: Partial<{ goal: string; edit_surface: { path: string; new: boolean }[]; oracle: string[] }> = {}) =>
  ({ goal: "Do it.", edit_surface: [{ path: "x.ts", new: false }], oracle: ["`bun test x.test.ts` passes"], ...o });
const GOOD = { route: "build", reason: "one run", spec: spec() };
const VERDICTS: Record<string, object> = {
  goal: GOOD,
  parts: { route: "build", reason: "two runs", after: ["int-9"], parts: [{ title: "[Big] Do the first half", spec: spec({ goal: "Half one." }), after: [] }, { title: "[Big] Do the second half", spec: spec({ goal: "Half two.", edit_surface: [{ path: "y.ts", new: true }] }), after: [1] }] },
  waits: { ...GOOD, after: ["FAKEKEY-1", "FAKEKEY-2"] },
  close: { route: "close", reason: "duplicate of int-1" },
  structured: { route: "ask", reason: "a product choice", question: "A or B?", options: [{ label: "A", line: "do a" }, { label: "B", line: "do b" }], recommended: "B", why: ["one", "two"] },
  chris: { route: "ask", reason: "a product choice", question: "Which plan, A or B?" },
  missing: { route: "build", reason: "one run", spec: spec({ edit_surface: [{ path: "nope.ts", new: false }] }) },
  testonly: { route: "build", reason: "one run", spec: spec({ edit_surface: [{ path: "x.test.ts", new: false }] }) },
  bad: { route: "maybe", reason: "x" },
};

// The fake intake command. The verdict is named by a `VERDICT:<word>` line in the issue's body; a second turn
// (`--resume`) gives the verdict named by `AGAIN:<word>`, or the same one. Each call logs its directory and its arguments.
const FAKE = `#!/bin/bash
prompt=$(cat)
echo "$PWD $*" >> "$FAKE_LOG"
if [[ " $* " == *" --resume "* ]]; then prompt=$(cat "$FAKE_LOG.prompt"); word=$(echo "$prompt" | grep -o 'AGAIN:[a-z]*' | head -1 | cut -d: -f2); fi
[ -z "$word" ] && word=$(echo "$prompt" | grep -o 'VERDICT:[a-z]*' | head -1 | cut -d: -f2)
echo "$prompt" > "$FAKE_LOG.prompt"
case $word in
  fail) exit 3 ;;
  "") echo 'no json here'; exit 0 ;;
esac
v=$(jq -c --arg w "$word" '.[$w]' "$FAKE_VERDICTS" | sed "s/FAKEKEY/$FAKE_KEY/g")
echo "{\\"type\\":\\"result\\",\\"is_error\\":false,\\"result\\":\\"\\",\\"session_id\\":\\"s-$word\\",\\"total_cost_usd\\":0.25,\\"structured_output\\":{\\"verdict\\":$v}}"
`;

// Each test gets its own list: the store keeps an item's file until something replaces it.
let lists = 0;
type Seed = { title: string; body?: string; ask?: boolean; after?: string[]; spec?: string; kind?: string; source?: "worker"; redMain?: boolean };
function reset(items: Seed[], o: { author?: boolean } = {}): void {
  repo.key = `int${++lists}`;
  repo.author = o.author;
  process.env.FAKE_KEY = repo.key;
  writeList(repo, "reset", (doc) => {
    for (const i of items) {
      const item = issues.add(doc, i.title, { request: i.body, kind: i.kind, ...(i.source ? { source: i.source } : {}) });
      if (i.ask) setAsk(`${repo.key}-${item.id}`, { kind: "input", reason: "question", question: "Which plan, A or B?", options: [], why: [] });
      if (i.after) item.fm.after = i.after;
      if (i.spec) item.spec = i.spec;
      if (i.redMain) item.fm.areas = ["red-main"];
    }
    return true;
  }, true);
}
const item = (id: number | string) => issues.find(readList(repo)!, id)!;
/** A `File` that adds to `doc` with no write, for a test of what goes in. */
const fileIn = (doc: issues.Doc): File => (f) => issues.add(doc, f.title, f);
/** The full id of each issue a filing in `run` passed to `after`. */
let started: string[] = [];
/** Take in each open issue that is not sorted, in id order, as the intake queue starts them; the counts summed. */
async function run(): Promise<{ counts: Counts; skipped: string[] }> {
  const counts: Counts = {};
  const skipped: string[] = [];
  const doc = readList(repo)!;
  for (const i of doc.items) {
    if (issues.status(i) !== "open" || isSorted(doc, i, repo)) continue;
    const t = await intakeIssue(repo, i.id, () => true, { after: (r, x) => { started.push(`${r.key}-${x.id}`); } });
    for (const [k, v] of Object.entries(t.counts)) counts[k as keyof Counts] = (counts[k as keyof Counts] ?? 0) + (v ?? 0);
    skipped.push(...t.skipped);
  }
  return { counts, skipped };
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-intake-"));
  factoryHome = join(base, "factory");
  factoryRepos(base);
  repo.path = join(base, "repo");
  // Main holds x.ts and its test, which the specs above name.
  writeFileSync(join(repo.path, "x.ts"), "export const x = 1;\n");
  writeFileSync(join(repo.path, "x.test.ts"), "test('x', () => {});\n");
  sh(repo.path, "git", "add", "-A");
  sh(repo.path, "git", "commit", "-q", "-m", "x");
  sh(repo.path, "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "fake"), FAKE);
  chmodSync(join(base, "fake"), 0o755);
  writeFileSync(join(base, "verdicts.json"), JSON.stringify(VERDICTS));
  Object.assign(process.env, gitEnv, {
    ALEPH_ISSUES: join(base, "items"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_INTAKE_CMD: join(base, "fake"),
    FAKE_LOG: join(base, "calls"), FAKE_VERDICTS: join(base, "verdicts.json"), ALEPH_LIVE_CAP: "10", ALEPH_FACTORY_DIR: factoryHome, ALEPH_DISPATCH: "off",
    // Locks live in $XDG_RUNTIME_DIR/aleph, shared by every process on the machine; keep this process's own.
    XDG_RUNTIME_DIR: join(base, "run"),
  });
});
afterAll(() => rmSync(base, { recursive: true, force: true }));
beforeEach(() => { delete process.env.ALEPH_INTAKE_TRIES; writeFileSync(join(base, "calls"), ""); });
const runs = () => allRuns().filter((e) => e.run.kind === "intake" && e.run.repo === repo.key).map((e) => e.run);
const runOf = (id: number) => runs().find((r) => r.name === `intake-${repo.key}-${id}`);
const calls = () => readFileSync(join(base, "calls"), "utf8").split("\n").filter(Boolean);

test("an intake run records its route, the issue it is on and its cost", async () => {
  reset([{ title: "a", body: "VERDICT:goal" }, { title: "b", body: "VERDICT:chris" }, { title: "c", body: "VERDICT:close" }]);
  const t = await run();
  expect(t.counts).toEqual({ build: 1, ask: 1, close: 1 });
  expect(runOf(1)).toMatchObject({ kind: "intake", route: "build", on: `${repo.key}-1`, reason: "one run", cost: 0.25 });
  expect(runOf(2)!.route).toBe("ask");
  expect(runOf(3)!.route).toBe("close");
  expect(item(1).spec).toBe("## Goal\nDo it.\n\n## Edit surface\n- x.ts\n\n## Oracle\n- `bun test x.test.ts` passes");
  expect(item(1).fm.intake).toBe("build");
  expect(issues.status(item(3))).toBe("done");
  expect(askOf(`${repo.key}-2`)).toMatchObject({ reason: "question" });
});

test("a reply that fails the code check goes back once in the same session; a fixed reply is applied and the cost is the sum", async () => {
  reset([{ title: "a", body: "VERDICT:missing AGAIN:goal" }]);
  const t = await run();
  expect(t.counts).toEqual({ build: 1 });
  const c = calls();
  expect(c).toHaveLength(2);
  expect(c[1]).toContain("--resume s-missing");
  const r = runOf(1)!;
  expect(r.cost).toBe(0.5);
  const sent = readFileSync(join(allRuns().find((e) => e.run.name === `intake-${repo.key}-1`)!.folder, "prompt.md"), "utf8");
  expect(sent).toContain("the Edit surface names nope.ts, which is not on main");
});

test("a reply that fails the code check twice asks Chris with the reason intake-failed", async () => {
  reset([{ title: "a", body: "VERDICT:missing" }]);
  const t = await run();
  expect(t.counts).toEqual({});
  expect(calls()).toHaveLength(2);
  expect(askOf(`${repo.key}-1`)).toMatchObject({ reason: "intake-failed" });
  expect(askOf(`${repo.key}-1`)!.question).toContain("nope.ts");
  expect(runOf(1)!.cause).toBe("unanswered");
});

test("a malformed verdict is sent back once, then asks Chris", async () => {
  reset([{ title: "a", body: "VERDICT:bad" }]);
  await run();
  expect(calls()).toHaveLength(2);
  expect(askOf(`${repo.key}-1`)).toMatchObject({ reason: "intake-failed" });
  expect(askOf(`${repo.key}-1`)!.question).toContain('unknown route "maybe"');
});

test("an issue an Issue trailer on main names is done with no run", async () => {
  reset([{ title: "a", body: "VERDICT:goal" }]);
  writeFileSync(join(repo.path, "z.ts"), "1\n");
  sh(repo.path, "git", "add", "-A");
  sh(repo.path, "git", "commit", "-q", "-m", `z\n\nIssue: ${repo.key}-1`);
  sh(repo.path, "git", "push", "-q", "origin", "main");
  const sha = sh(repo.path, "git", "rev-parse", "--short=7", "HEAD");
  const t = await run();
  expect(t.counts).toEqual({ done: 1 });
  expect(calls()).toHaveLength(0);
  expect(runs()).toHaveLength(0);
  expect(issues.status(item(1))).toBe("done");
  expect(item(1).notes.at(-1)).toContain(`intake: already on main in ${sha}`);
});

test("an issue of kind flake is a note on the flake tracker with no run", async () => {
  reset([{ title: "a.test.ts times out under load", kind: "flake", body: "VERDICT:goal" }]);
  const t = await run();
  expect(t.counts).toEqual({ close: 1 });
  expect(calls()).toHaveLength(0);
  expect(issues.status(item(1))).toBe("done");
  const tracker = readList(repo)!.items.find((i) => i.fm.tracker === "true")!;
  expect(tracker.notes.join("\n")).toContain("a.test.ts times out under load");
});

test("a worker's follow-up whose Edit surface is only test files is closed as test-only", async () => {
  reset([{ title: "a", body: "VERDICT:testonly", source: "worker" }, { title: "b", body: "VERDICT:testonly" }]);
  await run();
  expect(issues.status(item(1))).toBe("done");
  expect(item(1).fm.closed_why).toBe("test-only follow-up");
  expect(issues.status(item(2))).toBe("open");
  expect(item(2).spec).toContain("x.test.ts");
});

test("parts are filed in the intake run as new issues from the issue; each waits on what the issue waits on and on its earlier parts", async () => {
  reset([{ title: "a", body: "VERDICT:parts" }]);
  started = [];
  const before = readEvents().length;
  const t = await run();
  expect(t.counts).toEqual({ build: 1 });
  const doc = readList(repo)!;
  const parts = partsOf(doc, item(1));
  expect(parts.map((p) => [p.id, p.sub, p.fm.from])).toEqual([[2, undefined, `${repo.key}-1`], [3, undefined, `${repo.key}-1`]]);
  expect(parts.map((p) => p.title)).toEqual(["[Big] Do the first half", "[Big] Do the second half"]);
  expect(parts.map((p) => p.fm.after)).toEqual([["int-9"], ["int-9", `${repo.key}-2`]]);
  expect(parts[1].spec).toContain("- y.ts (new)");
  expect(parts.map((p) => [isSorted(doc, p, repo), isBuildable(doc, p, repo)])).toEqual([[true, true], [true, true]]);
  expect(isBuildable(doc, item(1), repo)).toBe(false);
  expect(item(1).spec).toBe("");
  expect(item(1).notes.at(-1)).toContain(`intake: split into ${repo.key}-2`);
  expect(calls()).toHaveLength(1);
  // Each part is filed through writeFiling: one filed event by intake, and its effects.
  expect(readEvents().slice(before).filter((e) => e.action === "filed").map((e) => [e.by, e.subject])).toEqual([["intake", `${repo.key}-2`], ["intake", `${repo.key}-3`]]);
  expect(started).toEqual([`${repo.key}-2`, `${repo.key}-3`]);
});

test("a split gives the parts task when the parent's stored kind is one the store dropped, and a current kind as it is", () => {
  reset([{ title: "a", kind: "task" }, { title: "b", kind: "bug" }]);
  const doc = readList(repo)!;
  const parent = item(1);
  parent.fm.kind = "goal";
  const half = { goal: "Half.", surface: [{ path: "x.ts", new: false }], oracle: ["`bun test x.test.ts` passes"] };
  const refs = addParts(repo, fileIn(doc), parent, [{ title: "[Big] Do the first half", spec: half, after: [] }, { title: "[Big] Do the second half", spec: half, after: [1] }]);
  const parts = refs.map((r) => issues.find(doc, r.slice(repo.key.length + 1))!);
  expect(parts.map((p) => p.fm.from)).toEqual([`${repo.key}-1`, `${repo.key}-1`]);
  expect(parts.map((p) => p.fm.after ?? [])).toEqual([[], [`${repo.key}-3`]]);
  expect(parts.map((p) => p.fm.kind)).toEqual(["task", "task"]);
  const bugs = addParts(repo, fileIn(doc), item(2), [{ title: "[Bug] Do the fix", spec: half, after: [] }]).map((r) => issues.find(doc, r.slice(repo.key.length + 1))!);
  expect(bugs.map((p) => p.fm.kind)).toEqual(["bug"]);
});

test("a build drops an after-link to an item that waits for Chris and keeps one to an ordinary open issue", async () => {
  reset([{ title: "asks", ask: true }, { title: "plain", spec: "## Goal\nx" }, { title: "a", body: "VERDICT:waits" }]);
  await run();
  expect(item(3).fm.after).toEqual([`${repo.key}-2`]);
  expect(item(3).notes.some((n) => n.includes(`dropped after ${repo.key}-1`) && n.includes("waits for Chris"))).toBe(true);
});

describe("a repo with author", () => {
  test("an issue filed with a spec is taken in before it builds; in a repo without author it builds as filed", async () => {
    reset([{ title: "a", body: "VERDICT:goal", spec: "## Goal\nOld.\n## Edit surface\nx.ts\n## Oracle\n`bun test x.test.ts`" }], { author: true });
    const doc = readList(repo)!;
    expect(isBuildable(doc, item(1), repo)).toBe(false);
    expect(isSorted(doc, item(1), repo)).toBe(false);
    expect(isSorted(doc, item(1), { key: repo.key })).toBe(true);
    expect(buildableIssues([repo], { list: () => readList(repo), item: (_k, id) => item(id) })).toEqual([]);
    expect((await run()).counts).toEqual({ build: 1 });
    expect(prompt(repo, { ...item(1), spec: "## Goal\nOld." } as issues.Issue)).toContain("# Its spec now\n\n## Goal\nOld.");
    expect(isBuildable(readList(repo)!, item(1), repo)).toBe(true);
    expect(isSorted(readList(repo)!, item(1), repo)).toBe(true);
    repo.author = undefined;
  });

  test("an issue triaged before intake counts as taken in", () => {
    reset([{ title: "a", spec: "## Goal\nx" }], { author: true });
    writeList(repo, "note", (doc) => { issues.note(issues.find(doc, 1)!, "triage: build"); return true; });
    expect(isBuildable(readList(repo)!, item(1), repo)).toBe(true);
    repo.author = undefined;
  });
});

test("an issue to plan must be split: a single spec goes back", () => {
  reset([{ title: "a", spec: "## Goal\nx" }]);
  const i = { ...item(1), fm: { ...item(1).fm, plan: "true" } } as issues.Issue;
  expect(problems(repo, i, { route: "build", reason: "r", spec: parseSpec(spec()), after: [] })).toContain("a run of this issue reached its time box: split it into parts");
});

const parseSpec = (raw: object): Spec => (parseRoute({ verdict: { route: "build", reason: "r", spec: raw } }) as any).spec;

test("the code checks of a spec", () => {
  reset([{ title: "a" }, { title: "b" }]);
  const check = (raw: object, after: string[] = []) => problems(repo, item(1), { route: "build", reason: "r", spec: parseSpec(spec(raw)), after });
  expect(check({})).toEqual([]);
  expect(check({ oracle: ["it works"] })).toEqual(["the spec: the Oracle names no command or test file (and there is no `aleph check`)"]);
  expect(check({ oracle: ["`aleph check tests`"] })[0]).toContain("names no command");
  expect(check({ goal: "Do ??? here." })[0]).toContain("the Goal holds a placeholder");
  expect(check({ oracle: ["`bun test <file>` passes"] })[0]).toContain("holds a placeholder");
  expect(check({ edit_surface: [{ path: "x.ts", new: false }, { path: "a/b.accept.ts", new: true }], oracle: ["`bun test a/b.accept.ts` passes"] })).toEqual(["the spec: `bun test a/b.accept.ts` names a/b.accept.ts, which bun reads as a name filter: write ./a/b.accept.ts"]);
  expect(check({ oracle: ["`bun test ./a/b.accept.ts` passes"] })).toEqual([]);
  expect(check({ oracle: ["`bun test w.test.ts` passes"] })).toEqual(["the spec: the Oracle names w.test.ts, which is not on main and not in the Edit surface"]);
  expect(check({ edit_surface: [{ path: "x.ts", new: false }, { path: "w.test.ts", new: true }], oracle: ["`bun test w.test.ts` passes"] })).toEqual([]);
  expect(check({ oracle: ["`bun run test`: a test writes a report for the file `w.test.ts` and expects `passed([\"w.test.ts\"])` to hold it"] })).toEqual([]);
  expect(check({ oracle: ["`bun run test` passes and the new w.test.ts passes"] })).toEqual(["the spec: the Oracle names w.test.ts, which is not on main and not in the Edit surface"]);
  expect(check({ edit_surface: [{ path: "../etc/x", new: true }] })[0]).toContain("is not a path in the repo");
  expect(check({}, [`${repo.key}-1`, `${repo.key}-2`, `${repo.key}-77`])).toEqual([`after names this issue, ${repo.key}-1`, `after names ${repo.key}-77, which is not an issue of ${repo.key}`]);
  const part = (title: string, after: number[] = []) => ({ title, spec: parseSpec(spec()), after });
  expect(problems(repo, item(1), { route: "build", reason: "r", parts: [part("one")], after: [] })).toEqual(["1 parts: give 2 to 6, or one spec and no parts"]);
  expect(problems(repo, item(1), { route: "build", reason: "r", parts: [part("one", [2]), part("Check foo: bar")], after: [] })).toEqual(["part 1: its after names a part that is not an earlier part", expect.stringContaining("part 2: the title has a ': ' prefix")]);
  expect(problems(repo, item(1), { route: "build", reason: "r", after: [] })).toEqual(["a build gives a spec or parts"]);
  expect(realOracle("the new ui/plan.test.ts passes")).toBe(true);
});

test("the schema keeps the union under a property and limits a part's title to 60 characters", () => {
  expect(INTAKE_SCHEMA.type).toBe("object");
  expect(Object.keys(INTAKE_SCHEMA)).not.toContain("oneOf");
  const build = INTAKE_SCHEMA.properties.verdict.oneOf.find((r) => r.properties.route.const === "build")!.properties as any;
  expect(build.parts.items.properties.title.maxLength).toBe(60);
  expect(build.spec.required).toEqual(["goal", "edit_surface", "oracle"]);
});

test("the prompt keeps the spec close to the request and how-to-build questions away from Chris", () => {
  const p = prompt(repo, { id: 1, title: "t", request: "", spec: "", notes: [], fm: {} } as unknown as issues.Issue);
  expect(p).toContain("Never ask Chris how to build it");
  expect(p).toContain("no file paths, function names or code");
  expect(p).toContain("The request is the ground truth");
  expect(p).toContain('("perhaps", "maybe", "could") leaves that choice to the worker');
  expect(p).toContain("not just because the two issues touch the same file or table");
  expect(p).toContain("a small change in several folders is still one spec");
  expect(p).toContain("do not chain parts in a line by habit");
});

const factory = () => process.env.ALEPH_FACTORY_DIR!;
const grant = (reason: string, action: string) => {
  mkdirSync(factory(), { recursive: true });
  writeFileSync(join(factory(), "always.json"), JSON.stringify({ [reason]: { action, at: new Date(NOW).toISOString() } }));
};

describe("a run with no reply", () => {
  beforeEach(() => { process.env.ALEPH_FACTORY_DIR = join(base, `factory-${++lists}`); });
  afterAll(() => { process.env.ALEPH_FACTORY_DIR = factoryHome; });

  test("an exit that is not zero counts toward the limit, and the second asks Chris", async () => {
    reset([{ title: "a", body: "VERDICT:fail" }]);
    await run();
    expect(askOf(`${repo.key}-1`)).toBeNull();
    await run();
    expect(askOf(`${repo.key}-1`)).toMatchObject({ reason: "intake-failed" });
    expect(item(1).notes.at(-1)).toContain("no verdict in 2 runs: failed: intake exited 3");
  });

  test("no structured output is not sent back; it counts toward the limit", async () => {
    reset([{ title: "a", body: "nothing" }]);
    await run();
    expect(calls()).toHaveLength(1);
    expect(askOf(`${repo.key}-1`)).toBeNull();
  });

  test("retry: no Ask, and a third intake runs the command", async () => {
    grant("intake-failed", "retry");
    reset([{ title: "a", body: "nothing" }]);
    await run();
    const t = await run();
    expect(askOf(`${repo.key}-1`)).toBeNull();
    expect(t.skipped).toEqual([`${repo.key}-1: no verdict in 2 intake runs; standing: intake again next tick`]);
    const n = calls().length;
    await run();
    expect(calls().length).toBe(n + 1);
    expect(readEvents()).toContainEqual(expect.objectContaining({ by: "rule", subject: `${repo.key}-1`, action: "reran", sub: "intake" }));
  });

  test("close: the item is done with the note", async () => {
    grant("intake-failed", "close");
    reset([{ title: "a", body: "nothing" }]);
    await run();
    await run();
    expect(issues.status(item(1))).toBe("done");
    expect(item(1).notes.at(-1)).toEndWith("intake: no verdict in 2 runs; standing: closed");
  });

  test("recommended: an ask with options leaves no Ask and a note naming the recommendation", async () => {
    grant("question", "recommended");
    reset([{ title: "a", body: "VERDICT:structured" }]);
    const t = await run();
    expect(t.counts).toEqual({ ask: 1 });
    expect(askOf(`${repo.key}-1`)).toBeNull();
    expect(isSorted(readList(repo)!, item(1))).toBe(false);
    expect(item(1).notes.at(-1)).toEndWith("always: took the recommendation B: do b");
  });
});

test("an intake run whose process ended before a verdict is ended as failed by the next intake", async () => {
  reset([]);
  const folder = join(base, "jobs", `${stamp()}-intake-${repo.key}-1-intake`);
  mkdirSync(folder, { recursive: true });
  putRun(basename(folder), { kind: "intake", job: folder.split("/").at(-1)!, name: `intake-${repo.key}-1`, repo: repo.key, on: `${repo.key}-1`, condition: "running", phase: "intake", told: true, shown: true, started: new Date(NOW).toISOString(), made: NOW });
  await intakeIssue(repo, 1, () => true);
  expect(getRun(basename(folder))).toMatchObject({ condition: "done", reason: "failed: its process ended before a verdict" });
});

test("intake reads a clone at origin/main, and the clone is gone after", async () => {
  reset([{ title: "a", body: "VERDICT:goal" }]);
  await run();
  const pwd = calls()[0].split(" ")[0];
  expect(pwd).not.toBe(repo.path);
  expect(existsSync(pwd)).toBe(false);
});

test("intakeNow takes in one issue with no tick, and leaves a sorted one alone", async () => {
  reset([{ title: "a", body: "VERDICT:close" }, { title: "b", body: "VERDICT:close", spec: "## Goal\ng" }]);
  const { intakeNow } = await import("../transitions/factory.ts");
  expect((await intakeNow(repo, 1)).counts).toEqual({ close: 1 });
  expect((await intakeNow(repo, 2)).counts).toEqual({});
  expect(calls()).toHaveLength(1);
});

test("intake does not close a red-main issue while its main is still red: it asks Chris; once main is green it closes", async () => {
  reset([{ title: "Fix the red main at abc1234", body: "VERDICT:close", redMain: true }]);
  const file = join(factoryHome, "baseline.json");
  writeFileSync(file, JSON.stringify({ [repo.key]: { repo: repo.key, commit: "abc1234", ok: false, failed: "setup" } }));
  const red = await run();
  expect(red.counts).toEqual({ ask: 1 });
  expect(issues.status(item(1))).toBe("open");
  expect(askOf(`${repo.key}-1`)!.question).toContain("Main is still red (main is red at abc1234: setup)");
  expect(askOf(`${repo.key}-1`)!.question).toContain("duplicate of int-1");

  reset([{ title: "Fix the red main at abc1234", body: "VERDICT:close", redMain: true }]);
  writeFileSync(file, JSON.stringify({ [repo.key]: { repo: repo.key, commit: "abc1234", ok: true } }));
  expect((await run()).counts).toEqual({ close: 1 });
  expect(issues.status(item(1))).toBe("done");
});

test("intake reads the media attached to the issue", async () => {
  reset([{ title: "a", body: "VERDICT:goal" }]);
  writeList(repo, "media", (doc) => {
    const i = issues.find(doc, 1)!;
    i.fm.media = ["shot.png"];
    blobs[mediaPath(repo.key, i, "shot.png")] = new Uint8Array([1, 2, 3]);
    return true;
  }, false, blobs);
  await run();
  const file = join(mediaDir(), `${repo.key}-1`, "shot.png");
  expect(readFileSync(file)).toEqual(Buffer.from([1, 2, 3]));
  expect(readFileSync(join(base, "calls.prompt"), "utf8")).toContain(`# Media\n\nThe issue has these files attached`);
  expect(readFileSync(join(base, "calls.prompt"), "utf8")).toContain(`- ${file}`);
  expect(calls()[0]).toContain(`--add-dir ${mediaDir()}`);
});
const blobs: Record<string, Uint8Array> = {};

test("the prompt's 'Commits on main since' heading and window come from created_time, to the second", () => {
  const item = (created_time: string) => ({ id: 1, title: "t", request: "", spec: "", notes: [], fm: { created_time } }) as unknown as issues.Issue;
  expect(prompt(repo, item("2020-01-02T03:04:05.000Z"))).toContain("# Commits on main since 2020-01-02T03:04:05.000Z\n\n" + sh(repo.path, "git", "log", "--oneline", "--no-decorate", "-n", "50", "origin/main") + "\n");
  const after = new Date((+sh(repo.path, "git", "log", "-1", "--format=%ct", "--all") + 1) * 1000).toISOString();
  expect(prompt(repo, item(after))).toContain(`# Commits on main since ${after}\n\n(none)\n`);
});
