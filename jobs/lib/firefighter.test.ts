import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as todos from "../../todo/lib/todo.ts";
import { labels as storeLabels, readList, writeList } from "../../todo/lib/store.ts";
import { writeDecision, type Decision } from "./decision.ts";
import { firefighterStep } from "./factory.ts";
import { parseReply, prompt, snapshot, type Ports } from "./firefighter.ts";
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
function fresh(items: { title: string; labels?: string[]; notes?: string[]; reason?: string; decision?: Decision }[] = []): void {
  key = `ff${++n}`;
  writeFileSync(join(base, "repos.json"), JSON.stringify({ [key]: { path: repoPath(), sandbox: true, autoland: false } }));
  process.env.ALEPH_JOBS_DIR = join(base, `jobs${n}`);
  process.env.ALEPH_FACTORY_DIR = join(base, `factory${n}`);
  writeList({ key }, "reset", (doc) => {
    for (const i of items) {
      const it = todos.add(doc, i.title, { labels: i.labels });
      for (const note of i.notes ?? []) todos.note(it, note);
      if (i.reason) it.fm.reason = i.reason;
      if (i.decision) writeDecision(it, i.decision);
    }
    return true;
  }, true);
}
const decision = (kind: Decision["kind"]): Decision => ({ question: "Which page?", options: [{ label: "A", line: "page A" }, { label: "B", line: "page B" }], recommended: "A", why: [], kind });
const item = (id: number) => todos.find(readList({ key })!, id)!;
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
  writeRun(folder, { kind: "agent", job: id, repo: key, state: "needs-you", told: true, shown: true, started: at.toISOString(), ...o } as Run);
  for (const [f, text] of Object.entries(files)) writeFileSync(join(folder, f), text);
  return folder;
}

/** A held run of issue 1 on branch `b`, with both reviews' files. */
const held = (b: string, review2 = "Looks right.\nVERDICT: land\n") =>
  run({ name: `${key}-1`, needs: "held", todo: 1, branch: b, reason: "held path x" }, { "review.md": "Fine.\nVERDICT: pass\n", "review2.md": review2 });

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
    ALEPH_ITEMS: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_FIREFIGHTER_CMD: join(base, "fake"), FF_DIR: base,
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
  run({ name: `${key}-1`, state: "stuck", reason: "time box", todo: 1 });
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

test("the same run with a diff in jobs/lib/sandbox.ts is not landed: needs-chris and one tell", async () => {
  fresh([{ title: "held", labels: ["goal"] }]);
  branch(`b${n}`, "jobs/lib/sandbox.ts");
  const folder = held(`b${n}`);
  reply([{ do: "land", job: `${key}-1` }]);
  const f = await firefighterStep(ports());
  expect(landed).toEqual([]);
  expect(f?.chris.length).toBe(1);
  expect(storeLabels(item(1))).toContain("needs-chris");
  expect(item(1).notes.at(-1)).toContain("jobs/lib/sandbox.ts");
  expect(existsSync(join(folder, "needs-chris"))).toBe(true);
  expect(told.length).toBe(1);
  expect(JSON.parse(told[0]).text).toContain("needs your review");
});

test("a diff that changes REVIEW2_SANDBOX in jobs/lib/review2.ts is not landed", async () => {
  fresh([{ title: "held", labels: ["goal"] }]);
  branch(`b${n}`, "jobs/lib/review2.ts", "export const REVIEW2_SANDBOX = {};\n");
  held(`b${n}`);
  reply([{ do: "land", job: `${key}-1` }]);
  await firefighterStep(ports());
  expect(landed).toEqual([]);
  expect(told.length).toBe(1);
});

test("a land before review2 has a verdict is refused", async () => {
  fresh([{ title: "held", labels: ["goal"] }]);
  branch(`b${n}`, "ui/views/y.js");
  held(`b${n}`, "PENDING\n");
  reply([{ do: "land", job: `${key}-1` }]);
  const f = await firefighterStep(ports());
  expect(landed).toEqual([]);
  expect(f?.refused).toEqual([expect.stringContaining("review2 has no verdict yet")]);
  expect(log()).toContain("firefighter: tell: refused land");
  expect(told).toEqual([]);
});

test("a goal with 4 runs in 30 minutes is an event, and a drop from the reply is applied", async () => {
  fresh([{ title: "loops", labels: ["goal"] }]);
  const name = `${key}-1`;
  for (const m of [25, 18, 10]) run({ name, state: "dropped", reason: "no commit", todo: 1 }, {}, m);
  run({ name, state: "stuck", reason: "no commit", todo: 1 }, {}, 2);
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
  run({ name, state: "stuck", reason: "no commit", todo: 1 }, {}, 2);
  reply([{ do: "close", repo: key, n: 1, note: "the goal is already met on main" }]);
  await firefighterStep(ports());
  expect(dropped.map((d) => d.name)).toEqual([name]);
  expect(existsSync(join(process.env.ALEPH_FACTORY_DIR!, "rerun", `${name}.md`))).toBe(false);
  expect(todos.status(item(1))).toBe("done");
  expect(item(1).notes.at(-1)).toContain("firefighter: closed: the goal is already met on main");
});

test("three runs in 30 minutes are no loop", () => {
  fresh();
  for (const m of [25, 18]) run({ name: `${key}-1`, state: "dropped", reason: "no commit" }, {}, m);
  run({ name: `${key}-1`, state: "dropped", reason: "no commit" }, {}, 5);
  expect(snapshot().map((e) => e.kind)).not.toContain("loop");
});

test("an 11th action in one reply is not applied", async () => {
  fresh([{ title: "q", labels: ["needs-chris"], notes: ["needs-chris: which helper?"] }]);
  reply(Array.from({ length: 11 }, (_, i) => ({ do: "note", repo: key, n: 1, text: `note ${i + 1}` })));
  const f = await firefighterStep(ports());
  expect(f?.applied.length).toBe(10);
  expect(f?.refused).toEqual([expect.stringContaining("more than 10 actions")]);
  const notes = item(1).notes.filter((x) => x.includes("firefighter: note"));
  expect(notes.length).toBe(10);
  expect(notes.some((x) => x.includes("note 11"))).toBe(false);
});

test("clear-needs-chris is refused on a product choice and applied on a how-to-build one", async () => {
  fresh([
    { title: "product", labels: ["needs-chris"], notes: ["triage: for Chris: Which page shows it?"], decision: decision("product") },
    { title: "build", labels: ["needs-chris"], notes: ["needs-chris: which module?"] },
  ]);
  reply([{ do: "clear-needs-chris", repo: key, n: 1, note: "page A" }, { do: "clear-needs-chris", repo: key, n: 2, note: "put it in x.ts" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([expect.stringContaining("product choice")]);
  expect(storeLabels(item(1))).toContain("needs-chris");
  expect(storeLabels(item(2))).not.toContain("needs-chris");
  expect(storeLabels(item(2))).toContain("goal");
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
const standingFile = (s: object) => {
  mkdirSync(process.env.ALEPH_FACTORY_DIR!, { recursive: true });
  writeFileSync(join(process.env.ALEPH_FACTORY_DIR!, "standing.json"), JSON.stringify(s));
};
const FIREFIGHTER = { action: "firefighter", at: "2026-10-28T00:00:00.000Z" };

test("a decision handed to the firefighter: its product choice is cleared, its event is marked handed and named in the prompt", async () => {
  fresh([{ title: "product", labels: ["needs-chris"], notes: ["triage: for Chris: Which page shows it?"], decision: decision("product") }]);
  standingFile({ decision: FIREFIGHTER });
  const e = snapshot().find((x) => x.kind === "needs-chris");
  expect(e).toMatchObject({ handed: true, reason: "decision" });
  expect(e?.line.endsWith("(handed to you by Chris)")).toBe(true);
  expect(prompt([e!])).toContain("Chris has handed these reasons to you: decision.");
  expect(prompt([e!])).toContain("Decide every event marked handed yourself");
  reply([{ do: "clear-needs-chris", repo: key, n: 1, note: "page A" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([]);
  expect(f?.applied).toEqual([`clear-needs-chris ${key}-1: page A`]);
  expect(storeLabels(item(1))).toContain("goal");
  expect(storeLabels(item(1))).not.toContain("needs-chris");
});

test("a triage question on a mark whose reason Chris handed is cleared; without the handed reason it is refused", async () => {
  fresh([{ title: "product", labels: ["needs-chris"], notes: ["triage: for Chris: Which page shows it?"], decision: decision("product"), reason: "acceptance-failed" }]);
  standingFile({ "acceptance-failed": { action: "firefighter", at: "2026-10-28T00:00:00.000Z" } });
  reply([{ do: "clear-needs-chris", repo: key, n: 1, note: "page A" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([]);
  expect(f?.applied).toEqual([`clear-needs-chris ${key}-1: page A`]);
  expect(storeLabels(item(1))).not.toContain("needs-chris");
});

test("the same triage question with no standing for its reason is refused", async () => {
  fresh([{ title: "product", labels: ["needs-chris"], notes: ["triage: for Chris: Which page shows it?"], decision: decision("product"), reason: "acceptance-failed" }]);
  reply([{ do: "clear-needs-chris", repo: key, n: 1, note: "page A" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([expect.stringContaining("product choice")]);
  expect(storeLabels(item(1))).toContain("needs-chris");
});

test("a decision mark is refused as a product choice without a decision standing", async () => {
  fresh([{ title: "product", labels: ["needs-chris"], notes: ["triage: for Chris: Which page shows it?"], decision: decision("product"), reason: "decision" }]);
  standingFile({ "acceptance-failed": { action: "firefighter", at: "2026-10-28T00:00:00.000Z" } });
  reply([{ do: "clear-needs-chris", repo: key, n: 1, note: "page A" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([expect.stringContaining("product choice")]);
  expect(storeLabels(item(1))).toContain("needs-chris");
});

test("without a handed reason a product choice is still refused, and the prompt has no handed rule", () => {
  fresh([{ title: "product", labels: ["needs-chris"], notes: ["triage: for Chris: Which page shows it?"], decision: decision("product") }]);
  const e = snapshot().find((x) => x.kind === "needs-chris");
  expect(e?.handed).toBeUndefined();
  expect(e?.line.endsWith("(handed to you by Chris)")).toBe(false);
  expect(prompt([e!])).not.toContain("Chris has handed these reasons");
});

test("a firefighter land standing lets the firefighter land a held run on a security path, and logs it", async () => {
  fresh([{ title: "held", labels: ["goal"] }]);
  branch(`b${n}`, "hooks/x.ts");
  const folder = held(`b${n}`);
  standingFile({ firefighter: { action: "land", at: "2026-10-28T00:00:00.000Z" } });
  reply([{ do: "land", job: `${key}-1` }]);
  const f = await firefighterStep(ports());
  expect(landed).toEqual([`${key}-1`]);
  expect(f?.chris).toEqual([]);
  expect(existsSync(join(folder, "needs-chris"))).toBe(false);
  expect(told).toEqual([]);
  expect(log()).toContain("standing: firefighter: land");
});

test("the same held hooks/ run without a land standing goes to Chris", async () => {
  fresh([{ title: "held", labels: ["goal"] }]);
  branch(`b${n}`, "hooks/x.ts");
  const folder = held(`b${n}`);
  reply([{ do: "land", job: `${key}-1` }]);
  const f = await firefighterStep(ports());
  expect(landed).toEqual([]);
  expect(f?.chris.length).toBe(1);
  expect(existsSync(join(folder, "needs-chris"))).toBe(true);
  expect(log()).not.toContain("standing: firefighter: land");
});

test("parseReply reads each action, and names a malformed one", () => {
  expect(parseReply('Here: {"actions":[{"do":"tell","text":"hi"},{"do":"land"}]}')).toEqual([{ do: "tell", text: "hi" }, "land without a job"]);
  expect(parseReply("nothing")).toBe("no JSON object with an actions list");
});

test("clear-needs-chris is refused on a product decision whose notes have no triage text", async () => {
  fresh([{ title: "product", labels: ["needs-chris"], notes: ["needs-chris: pick a page"], decision: decision("product") }]);
  reply([{ do: "clear-needs-chris", repo: key, n: 1, note: "page A" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([expect.stringContaining("product choice")]);
  expect(storeLabels(item(1))).toContain("needs-chris");
});

test("clear-needs-chris is applied on a build decision or no decision, even with a triage: for Chris: note", async () => {
  fresh([
    { title: "build", labels: ["needs-chris"], notes: ["triage: for Chris: which module?"], decision: decision("build") },
    { title: "none", labels: ["needs-chris"], notes: ["triage: for Chris: which module?"] },
  ]);
  reply([{ do: "clear-needs-chris", repo: key, n: 1, note: "x.ts" }, { do: "clear-needs-chris", repo: key, n: 2, note: "y.ts" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([]);
  for (const id of [1, 2]) {
    expect(storeLabels(item(id))).not.toContain("needs-chris");
    expect(storeLabels(item(id))).toContain("goal");
  }
});
