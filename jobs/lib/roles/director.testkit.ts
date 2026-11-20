// The shared setup of the director's test files: one work store, one repo and a fake agent per file (the director's
// command), and a new repo key per test.
import { afterAll, beforeAll, beforeEach, setSystemTime } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../../lib/todo.ts";
import { readList, writeList } from "../../../lib/store.ts";
import type { Ask } from "../asks/ask.ts";
import type { Ports } from "./director.ts";
import type { Run } from "../records/ledger.ts";
import { seed, type Seed } from "../../job.testkit.ts";
import { allRuns, makeJob, setState } from "../records/record.ts";
import { askOf, setAsk } from "../asks/ask.ts";
import { readEvents } from "../../../lib/layout.ts";
import { newItems, writeRepos } from "../../../tests/projects.testkit.ts";
import { issueKey } from "../../../lib/naming.ts";
import { keepEnv } from "../../../tests/env.testkit.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
export let base: string;
let server: ReturnType<typeof Bun.serve>;
let told: string[] = [];

export function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

// The fake agent: it counts its calls, keeps the prompt, and prints the reply the test wrote.
const FAKE = `#!/bin/bash
cat > "$FF_DIR/prompt.md"
echo x >> "$FF_DIR/calls"
cat "$FF_DIR/reply.json"
`;

export let n = 0;
export let key = "";
export const repoPath = () => join(base, "repo");

/** A new repo key, ledger and factory directory, with these items in its list. */
export function fresh(items: { title: string; body?: string; specced?: boolean; notes?: string[]; ask?: Ask; source?: issues.Source }[] = []): void {
  key = `ff${++n}`;
  process.env.ALEPH_ITEMS = newItems(base, `items${n}`);
  writeRepos({ [key]: { path: repoPath(), sandbox: true, autoland: false } });
  process.env.ALEPH_JOBS_DIR = join(base, `jobs${n}`);
  process.env.ALEPH_FACTORY_DIR = join(base, `factory${n}`);
  process.env.ALEPH_DB = join(base, `aleph${n}.db`);
  writeList({ key }, "reset", (doc) => {
    for (const i of items) {
      const it = issues.add(doc, i.title, { ...(i.specced ? { spec: i.body ?? "Ship the thing." } : { request: i.body }), ...(i.source ? { source: i.source } : {}) });
      for (const note of i.notes ?? []) issues.note(it, note);
      if (i.ask) setAsk(issueKey(it.id), i.ask);
    }
    return true;
  }, true);
}
/** An Ask that offers options: a product choice. */
export const choice = (reason = "question"): Ask => ({ reason, question: "Which page?", options: [{ label: "A", line: "page A" }, { label: "B", line: "page B" }], recommended: "A", why: [] });
/** A plain question with no options: a how-to-build one. */
export const plain = (question = "which module?"): Ask => ({ reason: "question", question, options: [], why: [] });
export const asked = (id: number) => askOf(issueKey(id));
export const item = (id: number) => issues.find(readList({ key })!, id)!;
/** A stream-json result event whose structured output is `o`. */
const result = (o: object) => JSON.stringify({ type: "result", is_error: false, result: "", structured_output: o });
/** A reply that decides with `actions`, with the case text `text` when given. */
export const reply = (actions: object[], text?: object) => writeFileSync(join(base, "reply.json"), result({ actions, ...(text ? { case: text } : {}) }));
/** The fake's whole reply: an object, such as `{ case: {...} }`, as structured output; a string as plain text. */
export const replyWith = (o: object | string) => writeFileSync(join(base, "reply.json"), typeof o === "string" ? o : result(o));
export const calls = () => (existsSync(join(base, "calls")) ? readFileSync(join(base, "calls"), "utf8").split("\n").filter(Boolean).length : 0);
/** The events of the event log, oldest first, but the gate's: those say a run's state changed. */
export const events = () => readEvents().filter((e) => e.subject !== "gate");

/** A branch off main that changes `file`. */
export function branch(name: string, file: string, content = "x\n"): void {
  sh(repoPath(), "git", "checkout", "-q", "-b", name, "main");
  mkdirSync(join(repoPath(), file, ".."), { recursive: true });
  writeFileSync(join(repoPath(), file), content);
  sh(repoPath(), "git", "add", "-A");
  sh(repoPath(), "git", "commit", "-q", "-m", name);
  sh(repoPath(), "git", "checkout", "-q", "main");
}

const NOW = Date.parse("2026-11-01T12:00:00Z");
/** One run in the ledger, with its files; returns its folder. */
export function run(o: Partial<Run> & { name: string }, files: Record<string, string> = {}, minutesAgo = 0): string {
  const at = new Date(NOW - minutesAgo * 60_000);
  const { folder } = seed({ role: "build", repo: key, state: "waiting", shown: true, started: at.toISOString(), ...o } as Seed);
  for (const [f, text] of Object.entries(files)) writeFileSync(join(folder, f), text);
  return folder;
}

export let landed: string[] = [];
export let dropped: { name: string; reason: string; fate?: string }[] = [];
/** The full id of each issue a filing passed to the ports' `after`. */
export let started: string[] = [];
export const ports = (): Ports => ({
  // The land row that land() writes: it clears a held run's Ask with the lander's answer.
  land: async (name, lander) => {
    landed.push(name);
    const e = allRuns().findLast((x) => x.run.name === name)!;
    makeJob({ role: "land", name, repo: key, target: e.run.target, prev: e.id, held: true, lander });
    return null;
  },
  // As drop() does, the dropped run takes its Ask off with the answer.
  drop: async (name, reason, fate, answer) => {
    dropped.push({ name, reason, fate });
    setState(allRuns().findLast((x) => x.run.name === name)!.id, "dropped", { ask: undefined }, answer);
    return null;
  },
  after: (repo, item) => { started.push(`${repo.key}-${item.id}`); },
});

/** Registers the hooks: the store, the repo, the fake and the tell server for the file, and clean fakes for each test. */
export function useDirectorFixture(): void {
  keepEnv();
  beforeAll(() => {
    setSystemTime(new Date(NOW));
    base = mkdtempSync(join(tmpdir(), "aleph-director-"));
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
      ALEPH_ITEMS: join(base, "items"), ALEPH_DIRECTOR_CMD: join(base, "fake"), FF_DIR: base,
      ALEPH_VAULT: join(base, "vault"),
      ALEPH_DISPATCH: "off", SIDETONE_TELL_URL: `http://127.0.0.1:${server.port}/tell`,
      XDG_RUNTIME_DIR: join(base, "run"),
      // Not the factory's ~/.aleph/sandbox: a concurrent copy of this file names its land folder the same in the same second, and removes it.
    });
  });
  afterAll(() => { setSystemTime(); server.stop(true); rmSync(base, { recursive: true, force: true }); });
  beforeEach(() => { rmSync(join(base, "calls"), { force: true }); landed = []; dropped = []; started = []; told = []; reply([]); });
}
