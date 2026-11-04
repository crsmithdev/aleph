import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { isSorted, readList, writeList } from "../../todo/lib/store.ts";

import { parseRoute, prompt, triageOpen } from "./triage.ts";
import { readRun, stamp, writeRun, type Repo } from "./ledger.ts";
import { askOf, setAsk } from "./ask.ts";
import { factoryRepos } from "../../tests/git-fixture.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string;
// The factory dir for the whole file: nothing here may read or write ~/.aleph/factory.
let factoryHome: string;
const repo = { key: "tri", path: "", main: "main" } as Repo;

function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

// The fake triage command: the verdict is named by a `VERDICT:<word>` line in the issue's body.
const FAKE = `#!/bin/bash
prompt=$(cat)
echo "$PWD $*" >> "$FAKE_LOG"
case $prompt in
  *VERDICT:goal*) echo '{"route":"build","spec":"## Goal\\nDo it.\\n## Edit surface\\nx.ts\\n## Oracle\\nbun test\\n## Time box\\n45 minutes"}' ;;
  *VERDICT:close*) echo 'Looked at it. {"route":"close","reason":"duplicate of tri-1"}' ;;
  *VERDICT:chris*) echo '{"route":"ask","question":"Which plan, A or B?"}' ;;
  *VERDICT:structured*) echo '{"route":"ask","question":"A or B?","options":[{"label":"A","line":"do a"},{"label":"B","line":"do b"}],"recommended":"B","why":["one","two"]}' ;;
  *VERDICT:build*) echo '{"route":"ask","question":"Ship it?","options":[{"label":"A","line":"ship"},{"label":"B","line":"wait"}],"recommended":"A","kind":"build"}' ;;
  *VERDICT:live*) echo '{"route":"live","note":"check the prod dashboard"}' ;;
  *VERDICT:flake*) echo '{"route":"flake","note":"a.test.ts > does x: timed out under load"}' ;;
  *VERDICT:fail*) exit 3 ;;
  *VERDICT:bad*) echo '{"route":"maybe"}' ;;
  *) echo 'no json here' ;;
esac
`;

// Each test gets its own list: the store keeps an item's file until something replaces it.
let lists = 0;
// A seeded item: `route` sorts it, `ask` gives it an Ask, `after` makes it wait, `goal` gives it a spec.
type Seed = { title: string; body?: string; ask?: boolean; after?: string[]; goal?: { title: string; body: string } };
function reset(items: Seed[]): void {
  repo.key = `tri${++lists}`;
  writeList(repo, "reset", (doc) => {
    for (const i of items) {
      const item = issues.add(doc, i.title, { request: i.body });
      if (i.ask) setAsk(item, { kind: "input", reason: "question", question: "Which plan, A or B?", options: [], why: [] });
      if (i.after) item.fm.after = i.after;
      if (i.goal) item.spec = i.goal.body;
    }
    return true;
  }, true);
}
const item = (id: number) => issues.find(readList(repo)!, id)!;
const run = (done: (r: string) => boolean = () => false) => triageOpen([repo], done);

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-triage-"));
  factoryHome = join(base, "factory");
  // `repo` with its origin `repo.git`, and the store.
  factoryRepos(base);
  writeFileSync(join(base, "fake"), FAKE);
  chmodSync(join(base, "fake"), 0o755);
  repo.path = join(base, "repo");
  Object.assign(process.env, gitEnv, {
    ALEPH_ISSUES: join(base, "items"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_TRIAGE_CMD: join(base, "fake"),
    FAKE_LOG: join(base, "calls"), ALEPH_LIVE_CAP: "10", ALEPH_FACTORY_DIR: factoryHome, ALEPH_DISPATCH: "off",
    // Locks live in $XDG_RUNTIME_DIR/aleph, shared by every process on the machine; keep this process's own.
    XDG_RUNTIME_DIR: join(base, "run"),
  });
});
afterAll(() => rmSync(base, { recursive: true, force: true }));
beforeEach(() => { delete process.env.ALEPH_TRIAGE_CAP; delete process.env.ALEPH_TRIAGE_TRIES; writeFileSync(join(base, "calls"), ""); });
const runOf = (id: number) => readdirSync(join(base, "jobs")).filter((d) => d.includes(`-triage-${repo.key}-`)).map((d) => readRun(join(base, "jobs", d))!).find((r) => r.name === `triage-${repo.key}-${id}`);
const calls = () => readFileSync(join(base, "calls"), "utf8").split("\n").filter(Boolean).length;

test("a triage run records its route and the issue it is on", async () => {
  reset([{ title: "a", body: "VERDICT:goal" }, { title: "b", body: "VERDICT:live" }, { title: "c", body: "VERDICT:flake" }, { title: "d", body: "VERDICT:close" }]);
  await run();
  const runs = Object.fromEntries(readdirSync(join(base, "jobs")).filter((d) => d.includes(`-triage-${repo.key}-`)).map((d) => readRun(join(base, "jobs", d))!).map((r) => [r.name, r]));
  expect(runs[`triage-${repo.key}-1`]).toMatchObject({ route: "build", on: `${repo.key}-1`, reason: "build" });
  expect(runs[`triage-${repo.key}-2`]).toMatchObject({ route: "ask", reason: "live" });
  expect(runs[`triage-${repo.key}-3`]!.route).toBe("close");
  expect(runs[`triage-${repo.key}-4`]!.route).toBe("close");
});

test("a malformed verdict leaves the item unchanged and is skipped", async () => {
  reset([{ title: "a", body: "VERDICT:bad" }, { title: "b", body: "nothing" }]);
  const before = [item(1), item(2)].map((i) => issues.renderItem(repo.key, i));
  const t = await run();
  expect(t.triaged).toEqual({});
  expect(t.skipped).toEqual([expect.stringContaining(`${repo.key}-1: triage gave a malformed verdict`), expect.stringContaining(`${repo.key}-2: triage gave a malformed verdict: no JSON`)]);
  expect([item(1), item(2)].map((i) => issues.renderItem(repo.key, i))).toEqual(before);
});

const factory = () => process.env.ALEPH_FACTORY_DIR!;
const grant = (reason: string, action: string) => {
  mkdirSync(factory(), { recursive: true });
  writeFileSync(join(factory(), "always.json"), JSON.stringify({ [reason]: { action, at: new Date().toISOString() } }));
};
const tickLog = () => readFileSync(join(factory(), "tick.log"), "utf8");

describe("standing permissions", () => {
  beforeEach(() => { process.env.ALEPH_FACTORY_DIR = join(base, `factory-${++lists}`); });
  afterAll(() => { process.env.ALEPH_FACTORY_DIR = factoryHome; });

  test("retry: no label, the count starts again, and a third triage runs the command", async () => {
    grant("triage-failed", "retry");
    reset([{ title: "a", body: "nothing" }]);
    await run();
    const t = await run();
    expect(item(1).fm.ask).toBeUndefined();
    expect(t.skipped).toEqual([`${repo.key}-1: no verdict in 2 triages; standing: triage again next tick`]);
    const n = calls();
    const t3 = await run();
    expect(calls()).toBe(n + 1);
    expect(t3.skipped[0]).toContain("malformed verdict");
    expect(tickLog()).toContain("always: triage-failed: retry");
  });

  test("close: the item is done with the note", async () => {
    grant("triage-failed", "close");
    reset([{ title: "a", body: "nothing" }]);
    await run();
    await run();
    expect(issues.status(item(1))).toBe("done");
    expect(item(1).notes.at(-1)).toEndWith("triage: no verdict in 2 runs; standing: closed");
    expect(tickLog()).toContain("always: triage-failed: close");
  });

  test("recommended: an ask with options leaves no Ask and a note naming the recommendation; a prose question is asked", async () => {
    grant("question", "recommended");
    reset([{ title: "a", body: "VERDICT:structured" }, { title: "b", body: "VERDICT:chris" }]);
    const t = await run();
    expect(t.triaged).toEqual({ ask: 2 });
    expect(runOf(1)!.route).toBe("ask");
    expect(item(1).fm.ask).toBeUndefined();
    expect(isSorted(readList(repo)!, item(1))).toBe(false);
    expect(item(1).notes.at(-1)).toEndWith("always: took the recommendation B: do b");
    expect(askOf(item(2))).toMatchObject({ reason: "question" });
    expect(tickLog()).toContain(`always: question: recommended on ${repo.key}-1`);
  });
});

test("a triage that exits non-zero counts toward the limit", async () => {
  reset([{ title: "a", body: "VERDICT:fail" }]);
  await run();
  expect(item(1).fm.ask).toBeUndefined();
  await run();
  expect(item(1).fm.ask).toBe("input");
  expect(item(1).notes.at(-1)).toContain("no verdict in 2 runs: failed: triage exited 3");
});

/** An earlier ended triage run of item 1, with the given fields. */
function earlierTriage(fields: Record<string, unknown>): void {
  const folder = join(base, "jobs", `${stamp()}-earlier-${Math.random().toString(36).slice(2)}-triage`);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "triage", job: folder.split("/").at(-1)!, name: "earlier", repo: repo.key, on: `${repo.key}-1`, condition: "done", phase: "triage", told: true, shown: true, started: new Date().toISOString(), made: Date.now(), ...fields });
}

test("a triage run with the cause no-answer and a free reason counts toward the Ask", async () => {
  reset([{ title: "a", body: "nothing" }]);
  earlierTriage({ cause: "no-answer", reason: "something else entirely" });
  await run();
  expect(item(1).fm.ask).toBe("input");
  expect(item(1).fm.reason).toBe("triage-failed");
});

// A triage run whose process died before its `end()`: `running`, with no pid or exit file.
function lostRun(name: string): string {
  const folder = join(base, "jobs", `${stamp()}-${name}-triage`);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "triage", job: folder.split("/").at(-1)!, name, repo: repo.key, on: `${repo.key}-1`, condition: "running", phase: "triage", told: true, shown: true, started: new Date().toISOString(), made: Date.now() });
  return folder;
}

test("a triage run whose process ended before a verdict is ended as failed by the next triage", async () => {
  reset([]);
  const folder = lostRun(`triage-${repo.key}-1`);
  await run();
  const r = readRun(folder)!;
  expect(r).toMatchObject({ condition: "done", reason: "failed: its process ended before a verdict" });
  expect(typeof r.ended).toBe("string");
});

// Triage at once: `triageNow` is what `aleph triage <repo>-<n>` runs, after an add, an answer or a follow-up.
describe("triage at once", () => {
  beforeAll(() => { process.env.ALEPH_FACTORY_DIR = factoryHome; });
  test("a non-goal issue is triaged with no tick; a goal is not", async () => {
    reset([
      { title: "a", body: "VERDICT:close" },
      { title: "parent", body: "VERDICT:close", goal: { title: "g", body: "## Goal\ng" } },
    ]);
    const { triageNow } = await import("./factory.ts");
    expect(item(2).spec).toContain("## Goal");
    expect((await triageNow(repo, 1)).triaged).toEqual({ close: 1 });
    expect(issues.status(item(1))).toBe("done");
    // Item 2 is sorted by its spec: triageNow on it triages nothing.
    expect((await triageNow(repo, 2)).triaged).toEqual({});
    expect(calls()).toBe(1);
  });
});

test("the prompt keeps how-to-build questions away from Chris and asks him in plain words", () => {
  const p = prompt(repo, { id: 1, title: "t", request: "", spec: "", notes: [], fm: {} } as unknown as issues.Issue);
  expect(p).toContain("Never ask Chris about how to build it");
  expect(p).toContain("no file paths, function names, line numbers or code");
  expect(p).toContain('"after": ["<optional <repo>-<n> or <repo>-<n>.<k>>"]');
});

describe("a goal whose work is already on main", () => {
  // The fake reads the commit list in the prompt: a line naming the file the issue asks for, with the file in its working directory, gives "done", else "build".
  const SMART = `#!/bin/bash
prompt=$(cat)
echo "$PWD" >> "$FAKE_LOG"
file=$(echo "$prompt" | grep -m1 '^# Issue' | grep -o '[a-z]*\.ts')
sha=$(echo "$prompt" | sed -n '/^# Commits on main/,/^Reply/p' | grep -F "$file" | head -1 | cut -d' ' -f1)
if [ -n "$sha" ] && [ -f "$file" ]; then echo "{\\"route\\":\\"done\\",\\"commit\\":\\"$sha\\",\\"reason\\":\\"widget.ts exists\\"}"
else echo '{"route":"build","spec":"## Goal\\nDo it.\\n## Edit surface\\nx.ts\\n## Oracle\\nbun test\\n## Time box\\n45 minutes"}'; fi
`;
  let fixture: string;
  let saved: string | undefined;
  beforeAll(() => {
    fixture = join(base, "fixture");
    sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "fixture.git"));
    sh(base, "git", "clone", "-q", join(base, "fixture.git"), fixture);
    writeFileSync(join(fixture, "README"), "x\n");
    sh(fixture, "git", "add", "-A");
    sh(fixture, "git", "commit", "-q", "-m", "start");
    writeFileSync(join(fixture, "widget.ts"), "export const widget = 1;\n");
    sh(fixture, "git", "add", "-A");
    sh(fixture, "git", "commit", "-q", "-m", "Add widget.ts");
    sh(fixture, "git", "push", "-q", "origin", "main");
    writeFileSync(join(base, "smart"), SMART);
    chmodSync(join(base, "smart"), 0o755);
    saved = process.env.ALEPH_TRIAGE_CMD;
    process.env.ALEPH_TRIAGE_CMD = join(base, "smart");
    repo.path = fixture;
  });
  afterAll(() => { repo.path = join(base, "repo"); process.env.ALEPH_TRIAGE_CMD = saved; });

  test("triage closes it as done with the commit in the note, and starts no worker", async () => {
    reset([{ title: "Add widget.ts", body: "Create widget.ts exporting widget." }]);
    const t = await run();
    expect(t.skipped).toEqual([]);
    expect(t.triaged).toEqual({ done: 1 });
    expect(issues.status(item(1))).toBe("done");
    expect(item(1).spec).toBe("");
    const sha = Bun.spawnSync(["git", "rev-parse", "--short=12", "HEAD"], { cwd: fixture }).stdout.toString().trim();
    expect(item(1).notes.join("\n")).toContain(`triage: already on main in ${sha}`);
    expect(runOf(1)!.route).toBe("done");
  });

  test("triage reads a clone at origin/main: it sees a commit the checkout does not have, and the clone is gone after", async () => {
    const other = join(base, "fixture-other");
    sh(base, "git", "clone", "-q", join(base, "fixture.git"), other);
    writeFileSync(join(other, "gadget.ts"), "export const gadget = 1;\n");
    sh(other, "git", "add", "-A");
    sh(other, "git", "commit", "-q", "-m", "Add gadget.ts");
    sh(other, "git", "push", "-q", "origin", "main");
    const sha = Bun.spawnSync(["git", "rev-parse", "--short=12", "HEAD"], { cwd: other }).stdout.toString().trim();
    const head = () => Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: fixture }).stdout.toString();
    const before = head();
    reset([{ title: "Add gadget.ts", body: "Create gadget.ts exporting gadget." }]);
    const t = await run();
    expect(t.triaged).toEqual({ done: 1 });
    expect(item(1).notes.join("\n")).toContain(`triage: already on main in ${sha}`);
    const pwd = readFileSync(join(base, "calls"), "utf8").trim().split("\n").at(-1)!;
    expect(pwd).not.toBe(fixture);
    expect(existsSync(pwd)).toBe(false);
    expect(existsSync(join(fixture, "gadget.ts"))).toBe(false);
    expect(head()).toBe(before);
  });

  test("a done verdict naming a commit that is not on main is not applied", async () => {
    expect(parseRoute('{"route":"done","commit":"nothex","reason":"x"}')).toBe("done without a commit");
    expect(parseRoute('{"route":"done","commit":"abc1234","reason":"x"}')).toEqual({ route: "done", commit: "abc1234", reason: "x" });
    reset([{ title: "Add widget.ts" }]);
    process.env.ALEPH_TRIAGE_CMD = join(base, "bogus");
    writeFileSync(join(base, "bogus"), `#!/bin/bash\necho '{"route":"done","commit":"deadbeef1","reason":"x"}'\n`);
    chmodSync(join(base, "bogus"), 0o755);
    try {
      const t = await run();
      expect(t.triaged).toEqual({});
      expect(issues.status(item(1))).toBe("open");
    } finally { process.env.ALEPH_TRIAGE_CMD = join(base, "smart"); }
  });
});

describe("the issue keeps its text; the goal gets the four sections", () => {
});

describe("the flake route", () => {
});
