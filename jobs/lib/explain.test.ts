import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { writeList } from "../../todo/lib/store.ts";
import { plainAsk, setAsk, type Ask } from "./ask.ts";
import { allRuns, readRun, stamp, writeRun, type Repo } from "./ledger.ts";
import { readStore, type Lesson } from "./corrections.ts";
import { explainStep } from "./explain.ts";
import { storeRepos } from "../../tests/git-fixture.ts";

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
const explains = () => allRuns().filter((e) => e.run.kind === "explain");

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

const fresh = () => { process.env.ALEPH_JOBS_DIR = join(base, `jobs-${++lists}`); };
function seedLessons(...ls: Partial<Lesson>[]): void {
  mkdirSync(join(base, "factory"), { recursive: true });
  const lessons = ls.map((l, i) => ({
    id: `l${i + 1}`, sentence: `Check x.ts first ${i + 1}`, state: "proposed", count: 1, kind: "claude-md", target: "CLAUDE.md", title: "Check x.ts",
    signals: [{ id: "s1", source: "chris", at: "2026-10-01T00:00:00Z", quote: "QUOTE-MARK you forgot x.ts", link: "https://example.com/1" }], ...l,
  }));
  writeFileSync(join(base, "factory", "corrections.json"), JSON.stringify({ minedAt: "", lessons }));
}

test("a failing explainer leaves the lesson; after two failed sweeps no third run opens", async () => {
  fresh();
  seedLessons({});
  const before = JSON.stringify(readStore());
  process.env.FAKE_EXIT = "1";
  for (let i = 0; i < 3; i++) await explainStep([repo]);
  expect(JSON.stringify(readStore())).toBe(before);
  expect(explains()).toHaveLength(2);
});
