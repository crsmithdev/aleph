import { openRun } from "./agent-run.ts";
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import * as store from "../../todo/lib/store.ts";
import { areasOf, readList, writeList } from "../../todo/lib/store.ts";
import type { Ask } from "./ask.ts";
import { firefighterStep } from "./factory.ts";
import { layout } from "./layout.ts";
import { MAX_RUNS_PER_HOUR } from "./goal-decision.ts";
import { MAX_SPEC_EDITS, applyActions, defaultPorts, firefight, parseReply, prompt, snapshot, type Ports } from "./firefighter.ts";
import { readRun, stamp, writeRun, type Run } from "./ledger.ts";
import { askOf, plainAsk, setAsk } from "./ask.ts";
import { checkSpec } from "./spec-check.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string;
let server: ReturnType<typeof Bun.serve>;
let told: string[] = [];

function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

// The fake firefighter: it counts its calls, keeps the prompt, and prints the reply the test wrote.
const FAKE = `#!/bin/bash
cat > "$FF_DIR/prompt.md"
echo x >> "$FF_DIR/calls"
cat "$FF_DIR/reply.json"
`;

let n = 0;
let key = "";
const repoPath = () => join(base, "repo");

/** A new repo key, ledger and factory directory, with these items in its list. */
function fresh(items: { title: string; body?: string; goal?: boolean; notes?: string[]; ask?: Ask }[] = []): void {
  key = `ff${++n}`;
  writeFileSync(join(base, "repos.json"), JSON.stringify({ [key]: { path: repoPath(), sandbox: true, autoland: false } }));
  process.env.ALEPH_JOBS_DIR = join(base, `jobs${n}`);
  process.env.ALEPH_FACTORY_DIR = join(base, `factory${n}`);
  writeList({ key }, "reset", (doc) => {
    for (const i of items) {
      const it = issues.add(doc, i.title, i.goal ? { spec: i.body ?? "Ship the thing." } : { request: i.body });
      for (const note of i.notes ?? []) issues.note(it, note);
      if (i.ask) setAsk(it, i.ask);
    }
    return true;
  }, true);
}
/** An Ask that offers options: a product choice. */
const choice = (reason = "question"): Ask => ({ kind: "input", reason, question: "Which page?", options: [{ label: "A", line: "page A" }, { label: "B", line: "page B" }], recommended: "A", why: [] });
/** A plain question with no options: a how-to-build one. */
const plain = (question = "which module?"): Ask => ({ kind: "input", reason: "question", question, options: [], why: [] });
const asked = (id: number) => askOf(item(id));
const item = (id: number) => issues.find(readList({ key })!, id)!;
const reply = (actions: object[]) => writeFileSync(join(base, "reply.json"), JSON.stringify({ actions }));
const calls = () => (existsSync(join(base, "calls")) ? readFileSync(join(base, "calls"), "utf8").split("\n").filter(Boolean).length : 0);
const log = () => readFileSync(join(process.env.ALEPH_FACTORY_DIR!, "tick.log"), "utf8");

/** A branch off main that changes `file`. */
function branch(name: string, file: string, content = "x\n"): void {
  sh(repoPath(), "git", "checkout", "-q", "-b", name, "main");
  mkdirSync(join(repoPath(), file, ".."), { recursive: true });
  writeFileSync(join(repoPath(), file), content);
  sh(repoPath(), "git", "add", "-A");
  sh(repoPath(), "git", "commit", "-q", "-m", name);
  sh(repoPath(), "git", "checkout", "-q", "main");
}

let runs = 0;
/** One run in the ledger, with its files; returns its folder. */
function run(o: Partial<Run> & { name: string }, files: Record<string, string> = {}, minutesAgo = 0): string {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  const id = `${stamp(at)}-${key}-${o.name}-${++runs}-agent`;
  const folder = join(process.env.ALEPH_JOBS_DIR!, id);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "build", job: id, repo: key, condition: "awaiting", told: true, shown: true, started: at.toISOString(), ...o } as Run);
  for (const [f, text] of Object.entries(files)) writeFileSync(join(folder, f), text);
  return folder;
}

/** A held run of issue 1 on branch `b`, with both reviews' files. */
const held = (b: string, review = "Looks right.\nVERDICT: land\n") =>
  run({ name: `${key}-1`, on: `${key}-1`, ask: { kind: "approval", reason: "held-path", question: "", options: [], why: [] }, branch: b, reason: "held path x" }, { "review.md": "Fine.\nVERDICT: pass\n", "call.md": review });

let landed: string[] = [];
let dropped: { name: string; reason: string; fate?: string }[] = [];
const ports = (): Ports => ({
  land: async (name) => { landed.push(name); return null; },
  drop: async (name, reason, fate) => { dropped.push({ name, reason, fate }); return null; },
  tell: (line) => fetch(`http://127.0.0.1:${server.port}/tell`, { method: "POST", body: JSON.stringify({ text: line }) }).then((r) => r.ok),
});

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-firefighter-"));
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  sh(base, "git", "init", "-q", "-b", "main", repoPath());
  writeFileSync(join(repoPath(), "README"), "r\n");
  sh(repoPath(), "git", "add", "-A");
  sh(repoPath(), "git", "commit", "-q", "-m", "start");
  writeFileSync(join(base, "fake"), FAKE);
  chmodSync(join(base, "fake"), 0o755);
  server = Bun.serve({ port: 0, fetch: async (req) => { told.push(await req.text()); return new Response("ok"); } });
  Object.assign(process.env, gitEnv, {
    ALEPH_ISSUES: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_FIREFIGHTER_CMD: join(base, "fake"), FF_DIR: base,
    ALEPH_DISPATCH: "off", SIDETONE_TELL_URL: `http://127.0.0.1:${server.port}/tell`,
    XDG_RUNTIME_DIR: join(base, "run"),
    // Not the factory's ~/.aleph/sandbox: a concurrent copy of this file names its land folder the same in the same second, and removes it.
    ALEPH_SANDBOX_DIR: join(base, "sandbox"),
  });
});
afterAll(() => { server.stop(true); rmSync(base, { recursive: true, force: true }); });
beforeEach(() => { rmSync(join(base, "calls"), { force: true }); landed = []; dropped = []; told = []; reply([]); });

const firefighterRuns = () => existsSync(process.env.ALEPH_JOBS_DIR!) ? readdirSync(process.env.ALEPH_JOBS_DIR!).filter((d) => d.endsWith("-firefighter")) : [];

test("a tick with no new events starts no firefighter run", async () => {
  fresh([{ title: "a" }]);
  expect(await firefighterStep(ports())).toMatchObject({ events: [] });
  expect(calls()).toBe(0);
  expect(firefighterRuns()).toEqual([]);
  // An event is judged once: the next tick with the same snapshot starts nothing.
  run({ name: `${key}-1`, condition: "stuck", reason: "time box", on: `${key}-1` });
  await firefighterStep(ports());
  expect(calls()).toBe(1);
  await firefighterStep(ports());
  expect(calls()).toBe(1);
  expect(firefighterRuns().length).toBe(1);
  expect(readRun(join(process.env.ALEPH_JOBS_DIR!, firefighterRuns()[0]))).toMatchObject({ kind: "firefighter", condition: "done", model: "claude-opus-5-5" });
});

test("a firefighter run that a dead process left running is ended as failed by the next look", async () => {
  fresh();
  const left = openRun({ role: "firefighter", who: "firefighter", model: "m", seconds: 60, flags: [], name: "firefighter", command: "firefighter", shown: true });
  await firefighterStep(ports());
  expect(readRun(left.folder)).toMatchObject({ condition: "done", reason: "failed: its process ended before a reply" });
});

test("a new held run whose reviews both say land, off the security paths, is landed", async () => {
  fresh([{ title: "held", goal: true }]);
  branch(`b${n}`, "ui/views/x.js");
  held(`b${n}`);
  reply([{ do: "land", job: `${key}-1` }]);
  const f = await firefighterStep(ports());
  expect(calls()).toBe(1);
  expect(landed).toEqual([`${key}-1`]);
  expect(f?.applied).toEqual([`land ${key}-1`]);
  expect(told).toEqual([]);
  expect(log()).toContain(`firefighter: did land ${key}-1`);
  // The prompt carries the run's review files and the issue.
  const p = readFileSync(join(base, "prompt.md"), "utf8");
  expect(p).toContain("VERDICT: land");
  expect(p).toContain(`Issue ${key}-1: held`);
});

test("a land by the firefighter writes Held-by: firefighter, not Held-by: Chris", async () => {
  fresh([{ title: "held", goal: true }]);
  // A real remote for the land to push to, and a stand-in for srt; the land unit runs in the foreground.
  writeFileSync(join(base, "repos.json"), JSON.stringify({ [key]: { path: repoPath(), sandbox: true, autoland: false, checks: [] } }));
  writeFileSync(join(base, "pass"), "#!/bin/bash\nshift\nexec env -i \"$@\"\n", { mode: 0o755 });
  process.env.ALEPH_SANDBOX_CMD = join(base, "pass");
  const remote = join(base, `remote${n}.git`);
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(repoPath(), "git", "remote", "add", "origin", remote);
  sh(repoPath(), "git", "push", "-q", "origin", "main");
  branch(`b${n}`, "ui/views/x.js");
  held(`b${n}`);
  reply([{ do: "land", job: `${key}-1` }]);
  process.env.ALEPH_JOB_FOREGROUND = "1";
  try {
    const f = await firefighterStep(defaultPorts);
    expect(f?.applied).toEqual([`land ${key}-1`]);
  } finally {
    delete process.env.ALEPH_JOB_FOREGROUND;
    delete process.env.ALEPH_SANDBOX_CMD;
  }
  const trailers = sh(base, "git", "--git-dir", remote, "log", "-1", "--format=%(trailers:only)", "main");
  expect(trailers).toContain("Held-by: firefighter");
  expect(trailers).not.toContain("Held-by: Chris");
});

test("the same run with a diff in jobs/lib/sandbox.ts is not landed: an Ask of approval and one tell", async () => {
  fresh([{ title: "held", goal: true }]);
  branch(`b${n}`, "jobs/lib/sandbox.ts");
  const folder = held(`b${n}`);
  reply([{ do: "land", job: `${key}-1` }]);
  const f = await firefighterStep(ports());
  expect(landed).toEqual([]);
  expect(f?.chris.length).toBe(1);
  expect(asked(1)).toMatchObject({ kind: "approval", reason: "held-path" });
  expect(item(1).notes.at(-1)).toContain("jobs/lib/sandbox.ts");
  expect(existsSync(join(folder, "asked"))).toBe(true);
  expect(told.length).toBe(1);
  expect(JSON.parse(told[0]).text).toContain("needs your review");
});

test("a diff that changes REVIEW_SANDBOX in jobs/lib/review.ts is not landed", async () => {
  fresh([{ title: "held", goal: true }]);
  branch(`b${n}`, "jobs/lib/review.ts", "export const REVIEW_SANDBOX = {};\n");
  held(`b${n}`);
  reply([{ do: "land", job: `${key}-1` }]);
  await firefighterStep(ports());
  expect(landed).toEqual([]);
  expect(told.length).toBe(1);
});

test("a land before the review has a verdict is refused", async () => {
  fresh([{ title: "held", goal: true }]);
  branch(`b${n}`, "ui/views/y.js");
  held(`b${n}`, "PENDING\n");
  reply([{ do: "land", job: `${key}-1` }]);
  const f = await firefighterStep(ports());
  expect(landed).toEqual([]);
  expect(f?.refused).toEqual([expect.stringContaining("review has no verdict yet")]);
  expect(log()).toContain("firefighter: tell: refused land");
  expect(told).toEqual([]);
});

test("a goal with 4 runs in 30 minutes is an event, and a drop from the reply is applied", async () => {
  fresh([{ title: "loops", goal: true }]);
  const name = `${key}-1`;
  for (const m of [25, 18, 10]) run({ name, condition: "dropped", reason: "no commit", on: `${key}-1` }, {}, m);
  run({ name, condition: "stuck", reason: "no commit", on: `${key}-1` }, {}, 2);
  const kinds = snapshot().map((e) => e.kind);
  expect(kinds).toContain("loop");
  reply([{ do: "drop", job: name, reason: "the goal is already met on main" }]);
  const f = await firefighterStep(ports());
  expect(f?.events.some((l) => l.includes("4 runs in 30 minutes"))).toBe(true);
  expect(dropped).toEqual([{ name, reason: "the goal is already met on main" }]);
  expect(readFileSync(join(process.env.ALEPH_FACTORY_DIR!, "rerun", `${name}.md`), "utf8")).toContain("already met on main");
  expect(item(1).notes.at(-1)).toContain("firefighter: dropped");
});

test("a close reply drops the stuck job, writes no rerun file, and marks the issue done with the note", async () => {
  fresh([{ title: "met", goal: true }]);
  const name = `${key}-1`;
  run({ name, condition: "stuck", reason: "no commit", on: `${key}-1` }, {}, 2);
  reply([{ do: "close", repo: key, n: 1, note: "the goal is already met on main" }]);
  await firefighterStep(ports());
  expect(dropped.map((d) => d.name)).toEqual([name]);
  expect(existsSync(join(process.env.ALEPH_FACTORY_DIR!, "rerun", `${name}.md`))).toBe(false);
  expect(issues.status(item(1))).toBe("done");
  expect(item(1).notes.at(-1)).toContain("firefighter: closed: the goal is already met on main");
});

test("three runs in 30 minutes are no loop", () => {
  fresh();
  for (const m of [25, 18]) run({ name: `${key}-1`, condition: "dropped", reason: "no commit" }, {}, m);
  run({ name: `${key}-1`, condition: "dropped", reason: "no commit" }, {}, 5);
  expect(snapshot().map((e) => e.kind)).not.toContain("loop");
});

test("an 11th action in one reply is not applied", async () => {
  fresh([{ title: "q", ask: plain("which helper?") }]);
  reply(Array.from({ length: 11 }, (_, i) => ({ do: "note", repo: key, n: 1, text: `note ${i + 1}` })));
  const f = await firefighterStep(ports());
  expect(f?.applied.length).toBe(10);
  expect(f?.refused).toEqual([expect.stringContaining("more than 10 actions")]);
  const notes = item(1).notes.filter((x) => x.includes("firefighter: note"));
  expect(notes.length).toBe(10);
  expect(notes.some((x) => x.includes("note 11"))).toBe(false);
});

test("answer is refused on a product choice and applied on a how-to-build one", async () => {
  fresh([
    { title: "product", ask: choice() },
    { title: "build", ask: plain() },
  ]);
  reply([{ do: "answer", repo: key, n: 1, note: "page A" }, { do: "answer", repo: key, n: 2, note: "put it in x.ts" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([expect.stringContaining("product choice")]);
  expect(asked(1)).not.toBeNull();
  expect(asked(2)).toBeNull();
});

test("a paused factory takes no snapshot and starts no run", async () => {
  fresh();
  run({ name: `${key}-1`, condition: "stuck", reason: "time box" });
  mkdirSync(process.env.ALEPH_FACTORY_DIR!, { recursive: true });
  writeFileSync(join(process.env.ALEPH_FACTORY_DIR!, "paused"), "x\n");
  expect(await firefighterStep(ports())).toBeNull();
  expect(calls()).toBe(0);
});

/** Chris's standing permissions for this test's factory directory. */
const alwaysFile = (s: object) => {
  mkdirSync(process.env.ALEPH_FACTORY_DIR!, { recursive: true });
  writeFileSync(join(process.env.ALEPH_FACTORY_DIR!, "always.json"), JSON.stringify(s));
};
const FIREFIGHTER = { action: "firefighter", at: "2026-10-28T00:00:00.000Z" };

test("a question handed to the firefighter: its product choice is cleared, its event is marked handed and named in the prompt", async () => {
  fresh([{ title: "product", ask: choice() }]);
  alwaysFile({ question: FIREFIGHTER });
  const e = snapshot().find((x) => x.kind === "ask");
  expect(e).toMatchObject({ handed: true, reason: "question" });
  expect(e?.line.endsWith("(handed to you by Chris)")).toBe(true);
  expect(prompt([e!])).toContain("Chris has handed these reasons to you: question.");
  expect(prompt([e!])).toContain("Decide every event marked handed yourself");
  reply([{ do: "answer", repo: key, n: 1, note: "page A" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([]);
  expect(f?.applied).toEqual([`answer ${key}-1: page A`]);
  expect(asked(1)).toBeNull();
});

test("a triage question on a mark whose reason Chris handed is cleared; without the handed reason it is refused", async () => {
  fresh([{ title: "product", ask: choice("acceptance-failed") }]);
  alwaysFile({ "acceptance-failed": { action: "firefighter", at: "2026-10-28T00:00:00.000Z" } });
  reply([{ do: "answer", repo: key, n: 1, note: "page A" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([]);
  expect(f?.applied).toEqual([`answer ${key}-1: page A`]);
  expect(asked(1)).toBeNull();
});

test("the same triage question with no standing for its reason is refused", async () => {
  fresh([{ title: "product", ask: choice("acceptance-failed") }]);
  reply([{ do: "answer", repo: key, n: 1, note: "page A" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([expect.stringContaining("product choice")]);
  expect(asked(1)).not.toBeNull();
});

test("a question Ask with options is refused as a product choice when only another reason is handed", async () => {
  fresh([{ title: "product", ask: choice("question") }]);
  alwaysFile({ "acceptance-failed": { action: "firefighter", at: "2026-10-28T00:00:00.000Z" } });
  reply([{ do: "answer", repo: key, n: 1, note: "page A" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([expect.stringContaining("product choice")]);
  expect(asked(1)).not.toBeNull();
});

test("without a handed reason a product choice is still refused, and the prompt has no handed rule", () => {
  fresh([{ title: "product", ask: choice() }]);
  const e = snapshot().find((x) => x.kind === "ask");
  expect(e?.handed).toBeUndefined();
  expect(e?.line.endsWith("(handed to you by Chris)")).toBe(false);
  expect(prompt([e!])).not.toContain("Chris has handed these reasons");
});

test("a firefighter land standing lets the firefighter land a held run on a security path, and logs it", async () => {
  fresh([{ title: "held", goal: true }]);
  branch(`b${n}`, "hooks/x.ts");
  const folder = held(`b${n}`);
  alwaysFile({ firefighter: { action: "land", at: "2026-10-28T00:00:00.000Z" } });
  reply([{ do: "land", job: `${key}-1` }]);
  const f = await firefighterStep(ports());
  expect(landed).toEqual([`${key}-1`]);
  expect(f?.chris).toEqual([]);
  expect(existsSync(join(folder, "asked"))).toBe(false);
  expect(told).toEqual([]);
  expect(log()).toContain("always: firefighter: land");
});

test("the same held hooks/ run without a land standing goes to Chris", async () => {
  fresh([{ title: "held", goal: true }]);
  branch(`b${n}`, "hooks/x.ts");
  const folder = held(`b${n}`);
  reply([{ do: "land", job: `${key}-1` }]);
  const f = await firefighterStep(ports());
  expect(landed).toEqual([]);
  expect(f?.chris.length).toBe(1);
  expect(existsSync(join(folder, "asked"))).toBe(true);
  expect(log()).not.toContain("always: firefighter: land");
});

test("parseReply reads each action, and names a malformed one", () => {
  expect(parseReply('Here: {"actions":[{"do":"tell","text":"hi"},{"do":"land"}]}')).toEqual([{ do: "tell", text: "hi" }, "land without a job"]);
  expect(parseReply("nothing")).toBe("no JSON object with an actions list");
});

/** Goal `.1` under issue `id`, as `fresh` files none: the goal a drop or an answer can wait for. */
const addGoal = (id: number) => writeList({ key }, "a goal", (doc) => { issues.addPart(doc, issues.find(doc, id)!, { title: "blocker goal", spec: "Do it." }); return true; });

test("an Ask of reason question is an event, and answer clears it", async () => {
  fresh([{ title: "q", ask: plain("which helper?") }]);
  const e = snapshot().find((x) => x.kind === "ask");
  expect(e).toMatchObject({ repo: key, item: 1, reason: "question" });
  expect(e?.handed).toBeUndefined();
  reply([{ do: "answer", repo: key, n: 1, note: "use helper A" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([]);
  expect(f?.applied).toEqual([`answer ${key}-1: use helper A`]);
  expect(asked(1)).toBeNull();
  expect(item(1).notes.at(-1)).toContain("firefighter decided: use helper A");
});

test("answer is refused on an issue with no Ask", async () => {
  fresh([{ title: "q" }]);
  const r = await applyActions([{ do: "answer", repo: key, n: 1, note: "x" }], ports());
  expect(r.refused).toEqual([expect.stringContaining("no Ask")]);
});

test("answer is applied on a plain question even when its reason is not handed", async () => {
  fresh([{ title: "build", ask: { ...plain(), reason: "no-commit" } }, { title: "none", ask: plain() }]);
  reply([{ do: "answer", repo: key, n: 1, note: "x.ts" }, { do: "answer", repo: key, n: 2, note: "y.ts" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([]);
  for (const id of [1, 2]) expect(asked(id)).toBeNull();
});

test("a drop with after drops the job, and the goal waits after that goal, with the note saying so", async () => {
  fresh([{ title: "waiter", goal: true }, { title: "blocker" }]);
  addGoal(2);
  run({ name: `${key}-1`, condition: "stuck", reason: "time box", on: `${key}-1` });
  reply([{ do: "drop", job: `${key}-1`, reason: "needs the blocker", after: [`${key}-2.1`] }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([]);
  expect(dropped.map((d) => d.name)).toEqual([`${key}-1`]);
  expect(item(1).fm.after).toEqual([`${key}-2.1`]);
  expect(item(1).notes.at(-1)).toContain(`after ${key}-2.1`);
});

test("an edit-goal with only after sets it and leaves the body unchanged", async () => {
  fresh([{ title: "goal", body: "Ship the thing.\n", goal: true }, { title: "blocker" }]);
  addGoal(2);
  const r = await applyActions([{ do: "edit-goal", repo: key, n: 1, after: [`${key}-2.1`] }], ports());
  expect(r.refused).toEqual([]);
  expect(item(1).fm.after).toEqual([`${key}-2.1`]);
  expect(item(1).spec.trim()).toBe("Ship the thing.");
});

test("an after naming no goal is refused", async () => {
  fresh([{ title: "goal", goal: true }]);
  const r = await applyActions([{ do: "edit-goal", repo: key, n: 1, after: [`${key}-9.1`] }], ports());
  expect(r.refused).toEqual([expect.stringContaining("names no issue")]);
});

test("parse keeps well-formed goal ids in after, ignores malformed ones, and refuses an edit-goal with neither body nor after", () => {
  expect(parseReply(JSON.stringify({ actions: [{ do: "drop", job: "x-1", reason: "r", after: ["Not A Ref", "ff-2"] }] }))).toEqual([{ do: "drop", job: "x-1", reason: "r", after: ["ff-2"] }]);
  expect(parseReply(JSON.stringify({ actions: [{ do: "drop", job: "x-1", reason: "r", after: ["ff-2.1"] }] }))).toEqual([{ do: "drop", job: "x-1", reason: "r", after: ["ff-2.1"] }]);
  expect(parseReply(JSON.stringify({ actions: [{ do: "edit-goal", repo: "ff", n: 1 }] }))).toEqual(["edit-goal without a repo, n, and a body or after"]);
});

test("the firefighter prompt limits the Goal of a spec it writes to 3 sentences with no implementation design", () => {
  const p = prompt([]);
  expect(p).toContain("is the behaviour in at most 3 sentences");
  expect(p).toContain("no implementation design");
  expect(p).toContain("no claim about code on main that you did not read");
});

test("answer keeps after in parse, and leaves it out when absent", () => {
  const a = { do: "answer" as const, repo: "ff", n: 1, note: "x" };
  expect(parseReply(JSON.stringify({ actions: [{ ...a, after: ["ff-2.1"] }] }))).toEqual([{ ...a, after: ["ff-2.1"] }]);
  expect(parseReply(JSON.stringify({ actions: [a] }))).toEqual([a]);
});

test("answer with after clears the Ask and sets it; a malformed ref is ignored in parse, a missing goal is refused and keeps the Ask", async () => {
  fresh([{ title: "a", ask: plain() }, { title: "b" }]);
  addGoal(2);
  const r = await applyActions([{ do: "answer", repo: key, n: 1, note: "wait", after: [`${key}-2.1`] }], ports());
  expect(r.refused).toEqual([]);
  expect(asked(1)).toBeNull();
  expect(item(1).fm.after).toEqual([`${key}-2.1`]);
  fresh([{ title: "a", ask: plain() }]);
  const bad = await applyActions([{ do: "answer", repo: key, n: 1, note: "wait", after: [`${key}-7.1`] }], ports());
  expect(bad.refused.length).toBe(1);
  expect(asked(1)).not.toBeNull();
});

test("parseReply reads a flake action and refuses one with no text", () => {
  expect(parseReply('{"actions":[{"do":"flake","repo":"r","text":"a.test.ts > t: slow"},{"do":"flake","repo":"r"}]}')).toEqual([{ do: "flake", repo: "r", text: "a.test.ts > t: slow" }, "flake without a repo and text"]);
});

test("a flake action notes the repo's flake tracker, makes it when missing, files no other item, and logs it", async () => {
  fresh([{ title: "other" }]);
  reply([{ do: "flake", repo: key, text: "a.test.ts > t: timed out" }, { do: "flake", repo: key, text: "b.test.ts > u: slow" }]);
  const f = await applyActions([{ do: "flake", repo: key, text: "a.test.ts > t: timed out" }, { do: "flake", repo: key, text: "b.test.ts > u: slow" }], ports());
  const items = readList({ key })!.items;
  expect(items.length).toBe(2);
  const tracker = items.find((i) => areasOf(i).includes("flakes"))!;
  expect(tracker.notes.filter((x) => x.includes("firefighter: ")).length).toBe(2);
  expect(tracker.notes.join("\n")).toContain("firefighter: a.test.ts > t: timed out");
  expect(f.applied.length).toBe(2);
  expect(log()).toContain(`firefighter: did flake ${key}: a.test.ts > t: timed out`);
});

test("prompt names the flake action and offers add only with a red event", () => {
  const p = prompt([]);
  expect(p).toContain('{"do": "flake"');
  expect(p).not.toContain('{"do": "add"');
  expect(p).not.toContain("with add");
  expect(prompt([{ key: "ci:r:abc", kind: "red", repo: key, line: "r CI red" }])).toContain('{"do": "add"');
  expect(p).not.toContain("File every follow-up you find as an issue");
});

test("parseReply keeps a known fate on a drop and leaves an unknown one off", () => {
  const p = (fate: string) => parseReply(JSON.stringify({ actions: [{ do: "drop", job: "x-1", reason: "r", fate }] }));
  expect(p("duplicate")).toEqual([{ do: "drop", job: "x-1", reason: "r", fate: "duplicate" }]);
  expect(p("bogus")).toEqual([{ do: "drop", job: "x-1", reason: "r" }]);
});

test("an applied drop passes its fate to the drop port", async () => {
  fresh([{ title: "met", goal: true }]);
  const name = `${key}-1`;
  run({ name, condition: "stuck", reason: "no commit", on: `${key}-1` }, {}, 2);
  reply([{ do: "drop", job: name, reason: "another goal did it", fate: "duplicate" }]);
  await firefighterStep(ports());
  expect(dropped.at(-1)?.fate).toBe("duplicate");
});

test("a close action drops the open job with already-met", async () => {
  fresh([{ title: "met", goal: true }]);
  const name = `${key}-1`;
  run({ name, condition: "stuck", reason: "no commit", on: `${key}-1` }, {}, 2);
  reply([{ do: "close", repo: key, n: 1, note: "met on main" }]);
  await firefighterStep(ports());
  expect(dropped.map((d) => d.fate)).toEqual(["already-met"]);
});

test("a firefighter drop of a run whose goal is on main writes fate already-met to the run's state", async () => {
  fresh([{ title: "met", goal: true }]);
  const name = `${key}-1`;
  const remote = join(base, `remote-met${n}.git`);
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  Bun.spawnSync(["git", "remote", "remove", "origin"], { cwd: repoPath() });
  sh(repoPath(), "git", "remote", "add", "origin", remote);
  sh(repoPath(), "git", "commit", "-q", "--allow-empty", "-m", `the goal\n\nJob: ${name}`);
  sh(repoPath(), "git", "push", "-q", "origin", "main");
  sh(repoPath(), "git", "fetch", "-q", "origin");
  const folder = run({ name, job: name, condition: "stuck", reason: "no commit", on: name }, {}, 2);
  reply([{ do: "drop", job: name, reason: "the goal is already met on main" }]);
  const f = await firefighterStep(defaultPorts);
  expect(f?.applied).toEqual([`drop ${name}: the goal is already met on main`]);
  const state = readRun(folder)!;
  expect(state.condition).toBe("dropped");
  expect(state.fate).toBe("already-met");
});

test("a firefighter drop of a run whose goal another job landed writes fate duplicate when the reply names none", async () => {
  fresh([{ title: "dup", goal: true }]);
  const name = `${key}-1`;
  const remote = join(base, `remote-dup${n}.git`);
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  Bun.spawnSync(["git", "remote", "remove", "origin"], { cwd: repoPath() });
  sh(repoPath(), "git", "remote", "add", "origin", remote);
  sh(repoPath(), "git", "commit", "-q", "--allow-empty", "-m", `the work, by another goal\n\nJob: other-job\nIssue: ${key}-2`);
  sh(repoPath(), "git", "push", "-q", "origin", "main");
  sh(repoPath(), "git", "fetch", "-q", "origin");
  const folder = run({ name, job: name, condition: "stuck", reason: "no commit", on: name }, {}, 2);
  reply([{ do: "drop", job: name, reason: `${key}-2 did this work` }]);
  const f = await firefighterStep(defaultPorts);
  expect(f?.applied).toEqual([`drop ${name}: ${key}-2 did this work`]);
  expect(readRun(folder)!.fate).toBe("duplicate");
});

test("a firefighter drop of a run whose goal's own Issue commit is on main writes already-met, not duplicate", async () => {
  fresh([{ title: "met", goal: true }]);
  const name = `${key}-1`;
  const remote = join(base, `remote-own${n}.git`);
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  Bun.spawnSync(["git", "remote", "remove", "origin"], { cwd: repoPath() });
  sh(repoPath(), "git", "remote", "add", "origin", remote);
  sh(repoPath(), "git", "commit", "-q", "--allow-empty", "-m", `the goal, by an earlier job\n\nJob: other-job\nIssue: ${name}`);
  sh(repoPath(), "git", "push", "-q", "origin", "main");
  sh(repoPath(), "git", "fetch", "-q", "origin");
  const folder = run({ name, job: name, condition: "stuck", reason: "no commit", on: name }, {}, 2);
  reply([{ do: "drop", job: name, reason: "nothing left to do" }]);
  await firefighterStep(defaultPorts);
  expect(readRun(folder)!.fate).toBe("already-met");
});

const SPEC = "## Goal\nThe test passes.\n\n## Edit surface\n- ui/browser.test.ts: the row.\n\n## Oracle\n- bun test passes.";

test("an add for a red main files a high priority issue naming the cause; without a red main it is refused", async () => {
  fresh([{ title: "other" }]);
  const add = { do: "add" as const, repo: key, title: "Fix ui/browser.test.ts:172 after 77803ea reordered Queued", body: SPEC };
  const none = await applyActions([add], ports());
  expect(none.refused.length).toBe(1);
  expect(readList({ key })!.items.length).toBe(1);
  mkdirSync(layout().factory, { recursive: true });
  writeFileSync(join(layout().factory, "ci.json"), JSON.stringify({ [key]: { repo: key, ok: false, sha: "77803ea", url: "u", since: "2026-11-02T17:15:00Z", sinceSha: "77803ea4c", runs: 1 } }));
  const f = await applyActions([add, add], ports());
  expect(f.applied.length).toBe(2);
  const items = readList({ key })!.items;
  expect(items.length).toBe(2);
  const it = items.find((i) => i.title === add.title)!;
  expect(it.fm.priority).toBe("high");
  expect(it.notes.join("\n")).toContain("still red");
});

const redCi = () => {
  mkdirSync(layout().factory, { recursive: true });
  writeFileSync(join(layout().factory, "ci.json"), JSON.stringify({ [key]: { repo: key, ok: false, sha: "77803ea", url: "u", since: "2026-11-02T17:15:00Z", sinceSha: "77803ea4c", runs: 1 } }));
};

test("an add for a red repo files the body as the spec", async () => {
  fresh([{ title: "other" }]);
  redCi();
  const f = await applyActions([{ do: "add", repo: key, title: "Fix red", body: SPEC }], ports());
  expect(f.applied.length).toBe(1);
  const it = readList({ key })!.items.find((i) => i.title === "Fix red")!;
  expect(it.fm.priority).toBe("high");
  expect(it.spec).toBe(SPEC);
});

test("an add whose body has no Oracle is refused, names Oracle and files nothing", async () => {
  fresh([{ title: "other" }]);
  redCi();
  const body = "## Goal\nx\n\n## Edit surface\n- a.ts";
  const f = await applyActions([{ do: "add", repo: key, title: "Fix red", body }], ports());
  expect(f.applied.length).toBe(0);
  expect(f.refused.join("\n")).toContain("Oracle");
  expect(readList({ key })!.items.length).toBe(1);
});

test("a saved red CI gives one red event; while a red-main issue is open it gives none; a new head after it is done gives one, and the same head then none", async () => {
  fresh([{ title: "other" }]);
  redCi();
  reply([]);
  const calls0 = calls();
  expect((await firefight(ports())).events.length).toBe(1);
  expect(calls()).toBe(calls0 + 1);
  expect((await firefight(ports())).events).toEqual([]);
  writeList({ key }, "todo: red main", (doc) => {
    issues.add(doc, "Fix red", { priority: "high", labels: ["red-main"], spec: SPEC });
    return true;
  }, true);
  expect((await firefight(ports())).events).toEqual([]);
  expect(calls()).toBe(calls0 + 1);
  const fix = readList({ key })!.items.find((i) => i.title === "Fix red")!;
  expect(store.note({ key }, fix.id, "fixed", { done: true })).toBeNull();
  // The same head, with the fix done: the red head is seen again once the fix closes.
  expect((await firefight(ports())).events.length).toBe(1);
  expect((await firefight(ports())).events).toEqual([]);
  // A newer head is a new event; with no further change to it, none.
  mkdirSync(layout().factory, { recursive: true });
  writeFileSync(join(layout().factory, "ci.json"), JSON.stringify({ [key]: { repo: key, ok: false, sha: "9f8e7d6c", url: "u", since: "2026-11-02T17:15:00Z", sinceSha: "77803ea4c", runs: 2 } }));
  expect((await firefight(ports())).events.length).toBe(1);
  expect((await firefight(ports())).events).toEqual([]);
});

test("the prompt for a red event has the three-header template", () => {
  const p = prompt([{ key: "ci:r:abc", kind: "red", repo: key, line: "r CI red" }]);
  for (const h of ["## Goal", "## Edit surface", "## Oracle"]) expect(p).toContain(h);
});

test("a handed spec-check Ask is an event with handed set, and the firefighter's edit-goal clears it and stores the spec", async () => {
  fresh([{ title: "goal", body: "Ship the thing.\n", goal: true, ask: { ...plain(), reason: "spec-check" } }]);
  alwaysFile({ "spec-check": FIREFIGHTER });
  expect(snapshot().find((x) => x.kind === "ask")).toMatchObject({ reason: "spec-check", handed: true });
  const r = await applyActions([{ do: "edit-goal", repo: key, n: 1, body: "## Goal\nShip.\n## Edit surface\na.ts\n## Oracle\nIt ships.\n" }], ports());
  expect(r.refused).toEqual([]);
  expect(item(1).spec).toContain("## Oracle");
  expect(asked(1)).toBeFalsy();
});

test("with no spec-check standing, the same edit-goal leaves the Ask with Chris and the event has no handed flag", async () => {
  fresh([{ title: "goal", body: "Ship the thing.\n", goal: true, ask: { ...plain(), reason: "spec-check" } }]);
  expect(snapshot().find((x) => x.kind === "ask")?.handed).toBeUndefined();
  const r = await applyActions([{ do: "edit-goal", repo: key, n: 1, body: "## Goal\nShip.\n## Edit surface\na.ts\n## Oracle\nIt ships.\n" }], ports());
  expect(r.refused).toEqual([]);
  expect(item(1).spec).toContain("## Oracle");
  expect(asked(1)?.reason).toBe("spec-check");
});

test("a firefighter edit of only the dependencies leaves a spec-check Ask", async () => {
  fresh([{ title: "goal", body: "Ship the thing.\n", goal: true, ask: { ...plain(), reason: "spec-check" } }]);
  await applyActions([{ do: "edit-goal", repo: key, n: 1, after: [] }], ports());
  expect(asked(1)?.reason).toBe("spec-check");
});

test("a firefighter edit that still lacks Goal, Edit surface or Oracle keeps the spec-check Ask", async () => {
  fresh([{ title: "goal", body: "Ship the thing.\n", goal: true, ask: { ...plain(), reason: "spec-check" } }]);
  await applyActions([{ do: "edit-goal", repo: key, n: 1, body: "## Goal\nShip.\n## Oracle\nIt ships.\n" }], ports());
  expect(asked(1)?.reason).toBe("spec-check");
});

test("a spec check that always holds is edited by the firefighter at most MAX_SPEC_EDITS times; the next Ask goes to Chris", async () => {
  fresh([{ title: "goal", body: "Ship the thing.\n", goal: true }]);
  alwaysFile({ "spec-check": FIREFIGHTER });
  sh(repoPath(), "git", "update-ref", "refs/remotes/origin/main", "HEAD");
  const bin = join(base, "holds.sh");
  const line = JSON.stringify({ type: "result", subtype: "success", result: "VERDICT: hold \"the oracle\": name a test", total_cost_usd: 0 });
  writeFileSync(bin, `#!/bin/sh\ncat > /dev/null\nprintf '%s\\n' '${line}'\n`);
  chmodSync(bin, 0o755);
  const old = process.env.ALEPH_SPECCHECK_CMD;
  process.env.ALEPH_SPECCHECK_CMD = bin;
  try {
    let edits = 0;
    for (let turn = 1; turn <= MAX_SPEC_EDITS + 3; turn++) {
      const c = await checkSpec({ key, path: repoPath(), main: "main" } as any, 1);
      expect(c.verdict).toBe("hold");
      // As unit.ts does on a hold.
      writeList({ key }, "spec check held", (doc) => {
        const it = issues.find(doc, 1)!;
        setAsk(it, plainAsk("spec-check", c.problems ?? ""));
        return issues.note(it, `asks Chris: ${c.problems}`);
      });
      const ev = snapshot().find((x) => x.kind === "ask")!;
      if (edits >= MAX_SPEC_EDITS) {
        expect(ev.handed).toBeUndefined();
        expect(ev.line).not.toContain("(handed to you by Chris)");
        break;
      }
      expect(ev.handed).toBe(true);
      const r = await applyActions([{ do: "edit-goal", repo: key, n: 1, body: `## Goal\nShip ${turn}.\n## Edit surface\na.ts\n## Oracle\nIt ships.\n` }], ports());
      expect(r.refused).toEqual([]);
      edits++;
    }
    expect(edits).toBe(MAX_SPEC_EDITS);
    // The loop reaches Chris within the run-cap: one build start per check, edits + the last check.
    expect(MAX_SPEC_EDITS + 1).toBeLessThanOrEqual(MAX_RUNS_PER_HOUR);
    expect(asked(1)?.reason).toBe("spec-check");
    expect(asked(1)?.question).toBe('"the oracle": name a test');
    // A further edit no longer answers the Ask.
    await applyActions([{ do: "edit-goal", repo: key, n: 1, body: "## Goal\nShip x.\n## Edit surface\na.ts\n## Oracle\nIt ships.\n" }], ports());
    expect(asked(1)?.reason).toBe("spec-check");
  } finally {
    if (old === undefined) delete process.env.ALEPH_SPECCHECK_CMD; else process.env.ALEPH_SPECCHECK_CMD = old;
  }
});
