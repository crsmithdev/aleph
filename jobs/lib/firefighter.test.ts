import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { areasOf, askOf, labels as storeLabels, readList, setAsk, writeList } from "../../todo/lib/store.ts";
import type { Ask } from "./ask.ts";
import { firefighterStep } from "./factory.ts";
import { applyActions, defaultPorts, parseReply, prompt, snapshot, type Ports } from "./firefighter.ts";
import { readRun, stamp, writeRun, type Run } from "./ledger.ts";

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
function fresh(items: { title: string; body?: string; labels?: string[]; notes?: string[]; ask?: Ask }[] = []): void {
  key = `ff${++n}`;
  writeFileSync(join(base, "repos.json"), JSON.stringify({ [key]: { path: repoPath(), sandbox: true, autoland: false } }));
  process.env.ALEPH_JOBS_DIR = join(base, `jobs${n}`);
  process.env.ALEPH_FACTORY_DIR = join(base, `factory${n}`);
  writeList({ key }, "reset", (doc) => {
    for (const i of items) {
      const it = issues.addLegacy(doc, i.title, { labels: i.labels, body: i.body });
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
  writeRun(folder, { kind: "build", job: id, repo: key, state: "awaiting", told: true, shown: true, started: at.toISOString(), ...o } as Run);
  for (const [f, text] of Object.entries(files)) writeFileSync(join(folder, f), text);
  return folder;
}

/** A held run of issue 1 on branch `b`, with both reviews' files. */
const held = (b: string, review = "Looks right.\nVERDICT: land\n") =>
  run({ name: `${key}-1`, on: `${key}-1`, ask: { kind: "approval", reason: "held-path", question: "", options: [], why: [] }, branch: b, reason: "held path x" }, { "review.md": "Fine.\nVERDICT: pass\n", "call.md": review });

let landed: string[] = [];
let dropped: { name: string; reason: string }[] = [];
const ports = (): Ports => ({
  land: async (name) => { landed.push(name); return null; },
  drop: async (name, reason) => { dropped.push({ name, reason }); return null; },
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
  run({ name: `${key}-1`, state: "stuck", reason: "time box", on: `${key}-1` });
  await firefighterStep(ports());
  expect(calls()).toBe(1);
  await firefighterStep(ports());
  expect(calls()).toBe(1);
  expect(firefighterRuns().length).toBe(1);
  expect(readRun(join(process.env.ALEPH_JOBS_DIR!, firefighterRuns()[0]))).toMatchObject({ kind: "firefighter", state: "done", model: "claude-opus-5-5" });
});

test("a new held run whose reviews both say land, off the security paths, is landed", async () => {
  fresh([{ title: "held", labels: ["goal"] }]);
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
  fresh([{ title: "held", labels: ["goal"] }]);
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
  fresh([{ title: "held", labels: ["goal"] }]);
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
  fresh([{ title: "held", labels: ["goal"] }]);
  branch(`b${n}`, "jobs/lib/review.ts", "export const REVIEW_SANDBOX = {};\n");
  held(`b${n}`);
  reply([{ do: "land", job: `${key}-1` }]);
  await firefighterStep(ports());
  expect(landed).toEqual([]);
  expect(told.length).toBe(1);
});

test("a land before the review has a verdict is refused", async () => {
  fresh([{ title: "held", labels: ["goal"] }]);
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
  fresh([{ title: "loops", labels: ["goal"] }]);
  const name = `${key}-1`;
  for (const m of [25, 18, 10]) run({ name, state: "dropped", reason: "no commit", on: `${key}-1` }, {}, m);
  run({ name, state: "stuck", reason: "no commit", on: `${key}-1` }, {}, 2);
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
  fresh([{ title: "met", labels: ["goal"] }]);
  const name = `${key}-1`;
  run({ name, state: "stuck", reason: "no commit", on: `${key}-1` }, {}, 2);
  reply([{ do: "close", repo: key, n: 1, note: "the goal is already met on main" }]);
  await firefighterStep(ports());
  expect(dropped.map((d) => d.name)).toEqual([name]);
  expect(existsSync(join(process.env.ALEPH_FACTORY_DIR!, "rerun", `${name}.md`))).toBe(false);
  expect(issues.status(item(1))).toBe("done");
  expect(item(1).notes.at(-1)).toContain("firefighter: closed: the goal is already met on main");
});

test("three runs in 30 minutes are no loop", () => {
  fresh();
  for (const m of [25, 18]) run({ name: `${key}-1`, state: "dropped", reason: "no commit" }, {}, m);
  run({ name: `${key}-1`, state: "dropped", reason: "no commit" }, {}, 5);
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
  expect(storeLabels(item(2))).not.toContain("goal");
});

test("a paused factory takes no snapshot and starts no run", async () => {
  fresh();
  run({ name: `${key}-1`, state: "stuck", reason: "time box" });
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
  fresh([{ title: "held", labels: ["goal"] }]);
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
  fresh([{ title: "held", labels: ["goal"] }]);
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
const addGoal = (id: number) => writeList({ key }, "a goal", (doc) => { issues.addGoal(doc, issues.find(doc, id)!, { title: "blocker goal", body: "Do it.", repo: key }); return true; });

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
  fresh([{ title: "waiter", labels: ["goal"] }, { title: "blocker" }]);
  addGoal(2);
  run({ name: `${key}-1`, state: "stuck", reason: "time box", on: `${key}-1` });
  reply([{ do: "drop", job: `${key}-1`, reason: "needs the blocker", after: [`${key}-2.1`] }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([]);
  expect(dropped.map((d) => d.name)).toEqual([`${key}-1`]);
  expect(item(1).fm.after).toEqual([`${key}-2.1`]);
  expect(item(1).notes.at(-1)).toContain(`after ${key}-2.1`);
});

test("an edit-goal with only after sets it and leaves the body unchanged", async () => {
  fresh([{ title: "goal", body: "Ship the thing.\n", labels: ["goal"] }, { title: "blocker" }]);
  addGoal(2);
  const r = await applyActions([{ do: "edit-goal", repo: key, n: 1, after: [`${key}-2.1`] }], ports());
  expect(r.refused).toEqual([]);
  expect(item(1).fm.after).toEqual([`${key}-2.1`]);
  expect(item(1).body.trim()).toBe("Ship the thing.");
});

test("an after naming no goal is refused", async () => {
  fresh([{ title: "goal", labels: ["goal"] }]);
  const r = await applyActions([{ do: "edit-goal", repo: key, n: 1, after: [`${key}-9.1`] }], ports());
  expect(r.refused).toEqual([expect.stringContaining("names no goal")]);
});

test("parse keeps well-formed goal ids in after, ignores malformed ones, and refuses an edit-goal with neither body nor after", () => {
  expect(parseReply(JSON.stringify({ actions: [{ do: "drop", job: "x-1", reason: "r", after: ["Not A Ref", "ff-2"] }] }))).toEqual([{ do: "drop", job: "x-1", reason: "r" }]);
  expect(parseReply(JSON.stringify({ actions: [{ do: "drop", job: "x-1", reason: "r", after: ["ff-2.1"] }] }))).toEqual([{ do: "drop", job: "x-1", reason: "r", after: ["ff-2.1"] }]);
  expect(parseReply(JSON.stringify({ actions: [{ do: "edit-goal", repo: "ff", n: 1 }] }))).toEqual(["edit-goal without a repo, n, and a body or after"]);
});

test("prompt lists after in the drop and edit-goal lines, and says a note alone does not stop a rerun", () => {
  const p = prompt([]);
  const lines = p.split("\n");
  expect(lines.find((l) => l.startsWith('- {"do": "drop"'))).toContain('"after"');
  expect(lines.find((l) => l.startsWith('- {"do": "edit-goal"'))).toContain('"after"');
  expect(lines.find((l) => l.startsWith('- {"do": "answer"'))).toContain('"after"');
  expect(p).toContain("A note or a drop reason alone does not stop a rerun.");
  expect(p).not.toContain("clear-needs-chris");
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

test("prompt names the flake action and no longer files every follow-up with add", () => {
  const p = prompt([]);
  expect(p).toContain('{"do": "flake"');
  expect(p).toContain("never an `add`");
  expect(p).not.toContain("File every follow-up you find as an issue");
});
