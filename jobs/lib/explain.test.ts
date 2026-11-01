import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { askOf, awaitsChris, readList, setAsk, writeList } from "../../todo/lib/store.ts";
import { plainAsk, type Ask } from "./ask.ts";
import { allRuns, readRun, stamp, writeRun, type Repo } from "./ledger.ts";
import { explainPrompt, explainStep, parseExplain, pendingCases } from "./explain.ts";
import { liveEntries, runsToday, triageStep } from "./factory.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string;
const repo = { key: "exp", path: "", main: "main", sandbox: true } as Repo;

function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

// The fake explainer: it keeps each prompt, and `FAKE_EXIT` makes it fail.
const FAKE = `#!/bin/bash
prompt=$(cat)
printf '%s' "$prompt" > "$FAKE_DIR/prompt-$(date +%s%N).md"
rec=deny; case $prompt in *"Land x.ts?"*) rec=land ;; esac
echo "$PWD $*" >> "$FAKE_DIR/calls"
if [ -n "$FAKE_EXIT" ]; then echo "boom" >&2; exit "$FAKE_EXIT"; fi
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
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
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

test("an awaiting run's state.json gets the text on run.ask", async () => {
  seed(plainAsk("host-check", "done elsewhere"));
  const folder = awaitingRun(`${repo.key}-1`);
  process.env.ALEPH_EXPLAIN_CAP = "5";
  await explainStep([repo]);
  const run = readRun(folder)!;
  expect(run.condition).toBe("awaiting");
  expect(run.ask).toMatchObject({ reason: "review", question: "Land x.ts?", situation: expect.stringContaining("x.ts"), recommend: { action: "land", why: "Nothing was checked." } });
  expect(run.ask!.effects!.map((e) => e.action)).toEqual(["land", "drop"]);
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
