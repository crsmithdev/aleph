// The shared setup of the firefighter.*.test.ts files: one work store, one repo and a fake firefighter per file, and a new repo key per test.
import { afterAll, beforeAll, beforeEach } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { readList, writeList } from "../../todo/lib/store.ts";
import type { Ask } from "./ask.ts";
import type { Ports } from "./firefighter.ts";
import { stamp, writeRun, type Run } from "./ledger.ts";
import { askOf, setAsk } from "./ask.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
export let base: string;
let server: ReturnType<typeof Bun.serve>;
export let told: string[] = [];

export function sh(cwd: string, ...args: string[]): string {
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

export let n = 0;
export let key = "";
export const repoPath = () => join(base, "repo");

/** A new repo key, ledger and factory directory, with these items in its list. */
export function fresh(items: { title: string; body?: string; goal?: boolean; notes?: string[]; ask?: Ask }[] = []): void {
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
export const choice = (reason = "question"): Ask => ({ kind: "input", reason, question: "Which page?", options: [{ label: "A", line: "page A" }, { label: "B", line: "page B" }], recommended: "A", why: [] });
/** A plain question with no options: a how-to-build one. */
export const plain = (question = "which module?"): Ask => ({ kind: "input", reason: "question", question, options: [], why: [] });
export const asked = (id: number) => askOf(item(id));
export const item = (id: number) => issues.find(readList({ key })!, id)!;
export const reply = (actions: object[]) => writeFileSync(join(base, "reply.json"), JSON.stringify({ actions }));
export const calls = () => (existsSync(join(base, "calls")) ? readFileSync(join(base, "calls"), "utf8").split("\n").filter(Boolean).length : 0);
export const log = () => readFileSync(join(process.env.ALEPH_FACTORY_DIR!, "tick.log"), "utf8");

/** A branch off main that changes `file`. */
export function branch(name: string, file: string, content = "x\n"): void {
  sh(repoPath(), "git", "checkout", "-q", "-b", name, "main");
  mkdirSync(join(repoPath(), file, ".."), { recursive: true });
  writeFileSync(join(repoPath(), file), content);
  sh(repoPath(), "git", "add", "-A");
  sh(repoPath(), "git", "commit", "-q", "-m", name);
  sh(repoPath(), "git", "checkout", "-q", "main");
}

let runs = 0;
/** One run in the ledger, with its files; returns its folder. */
export function run(o: Partial<Run> & { name: string }, files: Record<string, string> = {}, minutesAgo = 0): string {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  const id = `${stamp(at)}-${key}-${o.name}-${++runs}-agent`;
  const folder = join(process.env.ALEPH_JOBS_DIR!, id);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "build", job: id, repo: key, condition: "awaiting", told: true, shown: true, started: at.toISOString(), ...o } as Run);
  for (const [f, text] of Object.entries(files)) writeFileSync(join(folder, f), text);
  return folder;
}

/** A held run of issue 1 on branch `b`, with both reviews' files. */
export const held = (b: string, review = "Looks right.\nVERDICT: land\n") =>
  run({ name: `${key}-1`, on: `${key}-1`, ask: { kind: "approval", reason: "held-path", question: "", options: [], why: [] }, branch: b, reason: "held path x" }, { "review.md": "Fine.\nVERDICT: pass\n", "call.md": review });

export let landed: string[] = [];
export let dropped: { name: string; reason: string; fate?: string }[] = [];
export const ports = (): Ports => ({
  land: async (name) => { landed.push(name); return null; },
  drop: async (name, reason, fate) => { dropped.push({ name, reason, fate }); return null; },
  tell: (line) => fetch(`http://127.0.0.1:${server.port}/tell`, { method: "POST", body: JSON.stringify({ text: line }) }).then((r) => r.ok),
});

/** Registers the hooks: the store, the repo, the fake and the tell server for the file, and clean fakes for each test. */
export function useFirefighterFixture(): void {
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
}

export const firefighterRuns = () => existsSync(process.env.ALEPH_JOBS_DIR!) ? readdirSync(process.env.ALEPH_JOBS_DIR!).filter((d) => d.endsWith("-firefighter")) : [];

/** Chris's standing permissions for this test's factory directory. */
export const alwaysFile = (s: object) => {
  mkdirSync(process.env.ALEPH_FACTORY_DIR!, { recursive: true });
  writeFileSync(join(process.env.ALEPH_FACTORY_DIR!, "always.json"), JSON.stringify(s));
};
export const FIREFIGHTER = { action: "firefighter", at: "2026-10-28T00:00:00.000Z" };

/** Goal `.1` under issue `id`, as `fresh` files none: the goal a drop or an answer can wait for. */
export const addGoal = (id: number) => writeList({ key }, "a goal", (doc) => { issues.addPart(doc, issues.find(doc, id)!, { title: "blocker goal", spec: "Do it." }); return true; });
