import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI } from "./cli.helpers.ts";
import { renderItem } from "../todo/lib/todo.ts";
import { config } from "../todo/lib/store.ts";

// A fixture store and ledger with one item of every old status and label, migrated through the `aleph migrate` seam.
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string;
const dir = (n: string) => join(base, n);

function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

const env = () => ({
  ...process.env, ...gitEnv, ALEPH_ITEMS: dir("items"), ALEPH_JOBS_DIR: dir("jobs"), ALEPH_RUNS_DIR: dir("runs"), ALEPH_FACTORY_DIR: dir("factory"),
  ALEPH_REPOS: dir("repos.json"), ALEPH_BACKUPS_DIR: dir("backups"), ALEPH_NOW: "2026-10-30T14:15:16",
});

async function aleph(args: string[], over: Record<string, string> = {}) {
  const p = Bun.spawn(["bun", CLI, ...args], { env: { ...env(), ...over }, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, stdout, stderr };
}

/** Every file under `root` with its bytes' hash, so a restore can be compared byte for byte. */
function snapshot(root: string, at = "", skipGit = false): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(join(root, at)).sort()) {
    const rel = join(at, name);
    if (rel === ".git/FETCH_HEAD" || (skipGit && rel === ".git")) continue;
    if (statSync(join(root, rel)).isDirectory()) Object.assign(out, snapshot(root, rel, skipGit));
    else out[rel] = new Bun.CryptoHasher("sha256").update(readFileSync(join(root, rel))).digest("hex");
  }
  return out;
}
const world = () => ({ items: snapshot(dir("items")), origin: snapshot(dir("items.git")), jobs: snapshot(dir("jobs")), runs: snapshot(dir("runs")), factory: snapshot(dir("factory")) });

/** What an undo gives back: the item files (not .git: undo adds a commit), the ledger and the factory's files. */
const files = () => ({ items: snapshot(dir("items"), "", true), jobs: snapshot(dir("jobs")), runs: snapshot(dir("runs")), factory: snapshot(dir("factory")) });
const originTree = () => sh(dir("items.git"), "git", "rev-parse", "main^{tree}");

type Fm = Record<string, unknown>;
let n = 0;
function item(title: string, fm: Fm = {}, body = "Body.", notes: string[] = [], id = ++n): number {
  const task = { id, title, fm: { id: String(id), status: "open", created: "2026-10-01", updated: "2026-10-02", priority: "medium", labels: [], ...fm }, body, notes, legacy: false };
  writeFileSync(join(dir("items"), "aleph", "backlog", "tasks", `aleph-${id}.md`), renderItem("aleph", task as any));
  return id;
}
let runs = 0;
function run(todo: number | undefined, r: Fm, files: Record<string, string> = {}): void {
  const id = `20261030-${String(++runs).padStart(6, "0")}-aleph-j${runs}-${r.kind}`;
  mkdirSync(join(dir("jobs"), id), { recursive: true });
  writeFileSync(join(dir("jobs"), id, "state.json"), JSON.stringify({ job: id, name: `j${runs}`, repo: "aleph", told: true, started: "2026-10-30T10:00:00Z", ...(todo === undefined ? {} : { todo }), ...r }, null, 2) + "\n");
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir("jobs"), id, f), text);
}

const ID: Record<string, number> = {};
const by = (name: string, id: number) => (ID[name] = id);

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-migrate-"));
  sh(base, "git", "init", "-q", "--bare", "-b", "main", dir("items.git"));
  sh(base, "git", "clone", "-q", dir("items.git"), dir("items"));
  mkdirSync(join(dir("items"), "aleph", "backlog", "tasks"), { recursive: true });
  writeFileSync(join(dir("items"), "aleph", "backlog", "config.yml"), config("aleph"));
  for (const d of ["jobs", "runs", "factory", "repo"]) mkdirSync(dir(d), { recursive: true });
  mkdirSync(join(dir("runs"), "sandbox-run"), { recursive: true });
  writeFileSync(join(dir("runs"), "sandbox-run", "note.txt"), "a sandbox folder\n");
  writeFileSync(dir("repos.json"), JSON.stringify({ aleph: { path: dir("repo"), sandbox: true } }));
  writeFileSync(join(dir("factory"), "standing.json"), JSON.stringify({ held: { action: "land", at: "2026-10-01T00:00:00Z" }, "triage-no-verdict": { action: "retry", at: "2026-10-01T00:00:00Z" }, decision: { action: "recommended", at: "2026-10-01T00:00:00Z" }, review: { action: "land", at: "2026-10-01T00:00:00Z" } }, null, 2) + "\n");
  writeFileSync(join(dir("factory"), "caps.json"), JSON.stringify({ day: 12, waiting: 5 }, null, 2) + "\n");

  by("untriaged", item("an untriaged issue", {}, "Please look at X."));
  by("sorted", item("a sorted issue", { labels: ["triaged", "jobs"] }));
  by("waiting", item("an issue waiting on Chris", { labels: ["needs-chris"] }, "Body.", ["- 2026-10-02 10:00: needs-chris: Which database?"]));
  by("queued", item("a queued goal", { labels: ["goal", "ui"] }, "## Goal\n\nDo it."));
  by("blocked", item("a blocked goal", { labels: ["goal"], waiting_on: `aleph-${ID.queued}` }));
  const building = by("building", item("a building goal", { labels: ["goal"] }));
  run(building, { kind: "agent", state: "running" });
  const landing = by("landing", item("a landing goal", { labels: ["goal"] }));
  run(landing, { kind: "land", state: "running" });
  const needs = by("needs", item("a goal that needs you", { labels: ["goal"] }));
  run(needs, { kind: "agent", state: "needs-you", needs: "held", stat: "1 file changed" }, { "review2.md": "Looks fine.\n\nVERDICT: back needs a test\n" });
  const stuck = by("stuck", item("a stuck goal", { labels: ["goal"] }));
  run(stuck, { kind: "agent", state: "stuck" });
  const landed = by("landed", item("a landed goal still open", { labels: ["goal"] }));
  run(landed, { kind: "land", state: "landed", commit: "abc1234" });
  by("done", item("a done goal", { labels: ["goal"], status: "done" }));
  by("dropped", item("a dropped issue", { status: "dropped" }));
  const parent = by("parent", item("a planned parent", { labels: ["goal", "planned"], waiting_on: "aleph-14,aleph-15" }, "Plan this."));
  run(parent, { kind: "plan", state: "done" });
  by("child1", item("child one", { labels: ["goal", "memory"], status: "done" }, "Part of aleph-13.\n\n## Goal\n\nOne."));
  by("child2", item("child two", { labels: ["goal"], waiting_on: "aleph-14" }, "Part of aleph-13.\n\n## Goal\n\nTwo."));
  by("followup", item("a followup", { labels: ["followup"] }));
  by("proposal", item("bump left-pad", { labels: ["proposal", "deps"], priority: "low" }));
  by("memory", item("a lesson", { labels: ["memory"] }));
  by("live", item("check on the host", { labels: ["live-check", "triaged"] }));
  by("goalAsk", item("a goal awaiting Chris", { labels: ["goal", "needs-chris"] }, "## Goal\n\nDo it.", ["- 2026-10-02 10:00: needs-chris: the last 3 runs of this goal ended with no commit, so the factory stopped starting it; rewrite the goal."]));
  for (const [k, f, text] of [["child2", "h.test.ts", "// hidden child\n"], ["queued", "g.test.ts", "// hidden goal\n"]]) {
    mkdirSync(join(dir("items"), "aleph", "hidden", String(ID[k])), { recursive: true });
    writeFileSync(join(dir("items"), "aleph", "hidden", String(ID[k]), f), text);
  }
  sh(dir("items"), "git", "add", "-A");
  sh(dir("items"), "git", "commit", "-qm", "seed");
  sh(dir("items"), "git", "push", "-q", "origin", "main");
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

const tasks = (root: string) => join(root, "aleph", "backlog", "tasks");
const fileOf = (root: string, ref: string) => readFileSync(join(tasks(root), `aleph-${ref}.md`), "utf8");

describe("aleph migrate", () => {
  let before: ReturnType<typeof world>;
  let preFiles: ReturnType<typeof files>;
  let preTree: string;
  let preCommit: string;

  test("the dry run lists every old item with its old status and new stage, and writes nothing", async () => {
    before = world();
    const r = await aleph(["migrate", "--dry-run"]);
    expect(r.code, r.stderr).toBe(0);
    const pairs = Object.fromEntries(r.stdout.split("\n").filter((l) => l.startsWith("aleph-")).map((l) => { const [id, old, stage] = l.split("\t"); return [id, `${old} -> ${stage}`]; }));
    const want: Record<string, string> = {
      untriaged: "untriaged -> new", sorted: "sorted -> triaged", waiting: "waiting on Chris -> awaiting", queued: "queued -> queued", blocked: "queued -> blocked",
      building: "building -> building", landing: "landing -> landing", needs: "needs you -> awaiting", stuck: "stuck -> stuck", landed: "landed -> landing",
      done: "done -> done", dropped: "dropped -> dropped", parent: "queued -> building", child1: "done -> done", child2: "queued -> queued", followup: "untriaged -> new",
      proposal: "sorted -> awaiting", memory: "untriaged -> new", live: "sorted -> awaiting", goalAsk: "waiting on Chris -> awaiting",
    };
    for (const [name, pair] of Object.entries(want)) expect(pairs[`aleph-${ID[name]}`], name).toBe(pair);
    expect(Object.keys(pairs).length).toBe(Object.keys(want).length);
    const moves = r.stdout.split("\n").filter((l) => l.startsWith("move\t"));
    expect(moves).toContain(`move\taleph/hidden/${ID.child2}\taleph/hidden/aleph-${ID.child2}`);
    expect(moves).toContain(`move\taleph/hidden/${ID.queued}\taleph/hidden/aleph-${ID.queued}.1`);
    expect(world()).toEqual(before);
  });

  test("a pair outside the mapping table fails the dry run with exit 1", async () => {
    // An untriaged issue with a plan run is planning: the table has no such pair. A separate ledger holds the run.
    const odd = join(base, "jobs-odd");
    mkdirSync(join(odd, "20261030-000001-aleph-odd-plan"), { recursive: true });
    writeFileSync(join(odd, "20261030-000001-aleph-odd-plan", "state.json"), JSON.stringify({ kind: "plan", job: "odd", name: "odd", repo: "aleph", todo: ID.untriaged, state: "running", told: true, started: "2026-10-30T10:00:00Z" }));
    const r = await aleph(["migrate", "--dry-run"], { ALEPH_JOBS_DIR: odd });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(`aleph-${ID.untriaged}\tuntriaged\tplanning\tOUTSIDE THE MAPPING TABLE`);
    expect((await aleph(["migrate", "--apply"], { ALEPH_JOBS_DIR: odd })).code).toBe(1);
  });

  test("apply refuses while the factory is not paused, and while a run is live", async () => {
    const r = await aleph(["migrate", "--apply"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("not paused");
    writeFileSync(join(dir("factory"), "paused"), "now\n");
    // A run is live when its pid names a process whose command line holds the run's folder.
    const liveDir = join(base, "jobs-live");
    const folder = join(liveDir, "20261030-999999-aleph-live-agent");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "state.json"), JSON.stringify({ kind: "agent", job: "live", name: "live", repo: "aleph", state: "running", told: true, started: "2026-10-30T10:00:00Z" }));
    const holder = Bun.spawn(["sh", "-c", "sleep 30", "run", folder], { stdout: "ignore" });
    writeFileSync(join(folder, "pid"), String(holder.pid));
    try {
      const live = await aleph(["migrate", "--apply"], { ALEPH_JOBS_DIR: liveDir });
      expect(live.code).toBe(1);
      expect(live.stderr).toContain("a run is live");
    } finally {
      holder.kill();
    }
    expect(existsSync(dir("backups"))).toBe(false);
    // The baseline for the undo: the fixture as apply finds it, paused.
    before = world();
    preFiles = files();
    preTree = originTree();
    preCommit = sh(dir("items.git"), "git", "rev-parse", "main");
  });

  test("apply migrates the store, the ledger and the folders", async () => {
    const r = await aleph(["migrate", "--apply"]);
    expect(r.code, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
    expect(out.backup).toBe(join(dir("backups"), "20261030-141516-migrate"));

    // The folders: sandbox, ledger and store each in its new place.
    expect(existsSync(dir("items")) || existsSync(dir("jobs"))).toBe(false);
    expect(existsSync(join(dir("sandbox"), "sandbox-run", "note.txt"))).toBe(true);
    expect(readdirSync(dir("runs")).length).toBeGreaterThan(5);
    const issues = dir("issues");

    // The store: no old label or field, every number kept, one commit.
    const names = readdirSync(tasks(issues)).sort();
    for (const id of Object.values(ID)) expect(names, `aleph-${id}`).toContain(`aleph-${id}.md`);
    for (const f of names) {
      const text = readFileSync(join(tasks(issues), f), "utf8");
      expect(text, f).not.toMatch(/^labels:/m);
      expect(text, f).not.toMatch(/^waiting_on:/m);
      expect(text, f).not.toMatch(/- (goal|needs-chris|planned|followup|triaged|live-check|proposal)\b/);
    }
    expect(sh(dir("issues"), "git", "log", "--format=%s", "-2")).toContain("migrate: work model");
    expect(sh(dir("issues"), "git", "rev-list", "--count", "origin/main")).toBe("2");

    // The hidden checks moved in the same commit.
    const hidden = join(issues, "aleph", "hidden");
    expect(readFileSync(join(hidden, `aleph-${ID.child2}`, "h.test.ts"), "utf8")).toBe("// hidden child\n");
    expect(readFileSync(join(hidden, `aleph-${ID.queued}.1`, "g.test.ts"), "utf8")).toBe("// hidden goal\n");
    expect(readdirSync(hidden).filter((d) => /^\d+$/.test(d))).toEqual([]);

    // The rules.
    expect(fileOf(issues, `${ID.queued}`)).toMatch(/kind: issue[\s\S]*goals: \[aleph-\d+\.1\]/);
    expect(fileOf(issues, `${ID.queued}`)).toContain("## Request\n\n## Goal\n\nDo it.");
    expect(fileOf(issues, `${ID.queued}.1`)).toMatch(new RegExp(`kind: goal[\\s\\S]*issue: aleph-${ID.queued}\\b`));
    expect(fileOf(issues, `${ID.blocked}.1`)).toContain(`after: [aleph-${ID.queued}.1]`);
    expect(fileOf(issues, `${ID.parent}`)).toContain(`goals: [aleph-${ID.child1}, aleph-${ID.child2}]`);
    expect(fileOf(issues, `${ID.child1}`)).toMatch(new RegExp(`kind: goal[\\s\\S]*issue: aleph-${ID.parent}\\b`));
    expect(fileOf(issues, `${ID.child1}`)).toContain("source: memory");
    expect(fileOf(issues, `${ID.followup}`)).toContain("source: worker");
    expect(fileOf(issues, `${ID.proposal}`)).toMatch(/source: deps[\s\S]*ask: approval[\s\S]*reason: proposal/);
    expect(fileOf(issues, `${ID.live}`)).toMatch(/ask: input[\s\S]*reason: host-check/);
    expect(fileOf(issues, `${ID.waiting}`)).toMatch(/ask: input[\s\S]*reason: question[\s\S]*question: Which database\?/);
    expect(fileOf(issues, `${ID.goalAsk}.1`)).toMatch(/ask: input[\s\S]*reason: no-commit/);
    expect(fileOf(issues, `${ID.sorted}`)).toMatch(/areas: \[jobs\]/);
    expect(fileOf(issues, `${ID.untriaged}`)).toContain("## Request\n\nPlease look at X.");

    // The ledger: the new shape.
    const states = readdirSync(dir("runs")).filter((d) => existsSync(join(dir("runs"), d, "state.json"))).map((d) => ({ d, run: JSON.parse(readFileSync(join(dir("runs"), d, "state.json"), "utf8")) }));
    for (const { run: s } of states) {
      expect(s.todo).toBeUndefined();
      expect(s.needs).toBeUndefined();
      expect(s.state).not.toBe("needs-you");
      expect(s.kind).not.toBe("agent");
    }
    const held = states.find((s) => s.run.ask?.reason === "held-path")!;
    expect(held.run).toMatchObject({ state: "awaiting", kind: "build", on: `aleph-${ID.needs}.1`, ask: { kind: "approval", reason: "held-path" }, review: { call: "back", reason: "needs a test" } });
    expect(states.find((s) => s.run.kind === "plan")!.run.on).toBe(`aleph-${ID.parent}`);

    // The factory's files.
    const always = JSON.parse(readFileSync(join(dir("factory"), "always.json"), "utf8"));
    expect(Object.keys(always)).toEqual(["held-path", "triage-failed", "question", "review"]);
    expect(existsSync(join(dir("factory"), "standing.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir("factory"), "caps.json"), "utf8"))).toEqual({ day: 12, awaiting: 5 });

    // The lint of the migrated store passes.
    const lint = await aleph(["issue", "lint", "aleph"], { ALEPH_ITEMS: dir("issues"), ALEPH_JOBS_DIR: dir("runs") });
    expect(lint.code, lint.stderr).toBe(0);
  });

  test("a second apply refuses", async () => {
    const r = await aleph(["migrate", "--apply"], { ALEPH_ITEMS: dir("issues"), ALEPH_JOBS_DIR: dir("runs") });
    expect(r.code).toBe(1);
  });

  test("undo pushes a commit with the pre-apply tree on top of the apply commit, and the store follows it", async () => {
    const applyCommit = sh(dir("items.git"), "git", "rev-parse", "main");
    expect(JSON.parse(readFileSync(join(dir("backups"), "20261030-141516-migrate", "meta.json"), "utf8"))).toMatchObject({ preCommit, applyCommit });
    expect(existsSync(join(dir("backups"), "20261030-141516-migrate", "origin"))).toBe(false);
    const r = await aleph(["migrate", "--undo", "20261030-141516"]);
    expect(r.code, r.stderr).toBe(0);
    expect(files()).toEqual(preFiles);
    expect(originTree()).toBe(preTree);
    expect(existsSync(join(dir("items"), "aleph", "hidden", String(ID.child2), "h.test.ts"))).toBe(true);
    expect(existsSync(join(dir("items"), "aleph", "hidden", String(ID.queued), "g.test.ts"))).toBe(true);
    expect(sh(dir("items.git"), "git", "rev-list", "main")).toContain(applyCommit);
    expect(sh(dir("items.git"), "git", "rev-parse", "main~1")).toBe(applyCommit);
    expect(sh(dir("items"), "git", "rev-parse", "HEAD")).toBe(sh(dir("items.git"), "git", "rev-parse", "main"));
    expect(existsSync(dir("issues")) || existsSync(dir("sandbox"))).toBe(false);
    // A fetch in the restored store brings nothing back.
    sh(dir("items"), "git", "fetch", "-q", "origin");
    expect(files().items).toEqual(preFiles.items);
    expect((await aleph(["migrate", "--undo", "20990101-000000"])).code).toBe(1);
  });

  test("undo refuses, changing nothing, when a push came after the apply", async () => {
    const at = { ALEPH_NOW: "2026-10-31T09:00:00" };
    expect((await aleph(["migrate", "--apply"], at)).code).toBe(0);
    const other = dir("other");
    sh(base, "git", "clone", "-q", dir("items.git"), other);
    writeFileSync(join(other, "later.txt"), "pushed after the apply\n");
    sh(other, "git", "add", "-A");
    sh(other, "git", "commit", "-qm", "a later push");
    sh(other, "git", "push", "-q", "origin", "main");
    const later = sh(other, "git", "rev-parse", "--short", "HEAD");
    const tip = sh(dir("items.git"), "git", "rev-parse", "main");
    const state = { issues: snapshot(dir("issues")), runs: snapshot(dir("runs")), factory: snapshot(dir("factory")), sandbox: snapshot(dir("sandbox")) };

    const r = await aleph(["migrate", "--undo", "20261031-090000"]);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain(later);
    expect(sh(dir("items.git"), "git", "rev-parse", "main")).toBe(tip);
    expect({ issues: snapshot(dir("issues")), runs: snapshot(dir("runs")), factory: snapshot(dir("factory")), sandbox: snapshot(dir("sandbox")) }).toEqual(state);
    expect(existsSync(dir("items"))).toBe(false);

    // --discard-later goes on: a plain push on the later commit, with the pre-apply tree.
    const f = await aleph(["migrate", "--undo", "20261031-090000", "--discard-later"]);
    expect(f.code).toBe(0);
    expect(existsSync(dir("items"))).toBe(true);
    expect(existsSync(dir("issues"))).toBe(false);
    expect(sh(dir("items.git"), "git", "rev-parse", "main~1")).toBe(tip);
    expect(sh(dir("items.git"), "git", "ls-tree", "--name-only", "main")).not.toContain("later.txt");
  });

  test("with no mode, or two, it refuses", async () => {
    expect((await aleph(["migrate"])).code).toBe(1);
    expect((await aleph(["migrate", "--dry-run", "--apply"])).code).toBe(1);
  });
});
