// Archived goal tests from vault/lib/ops.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Exit, run as vaultOp } from "../../../vault/lib/ops.ts";

// Each op runs in-process through `run`, as vault/cli.ts runs it. A test marked as the CLI test of its op spawns
// vault/cli.ts instead, for the op's wiring.
const CLI = join(join(import.meta.dir, "../../../vault/lib"), "..", "cli.ts");
let base: string;
let vault: string;
let drafts: string;

const testEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
type Result = { code: number; stdout: string; stderr: string; json: any };
const parsed = (code: number, stdout: string, stderr: string): Result => {
  let json: any = null;
  try { json = JSON.parse(stdout); } catch {}
  return { code, stdout, stderr, json };
};

/**
 * The machine's time zone. `bun test` runs the test process in UTC, but the CLI runs in this zone: the daily note
 * is named by the local date, so an in-process op runs in it too.
 */
const zone = Bun.spawnSync(["bun", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"]).stdout.toString().trim();

/** `vault <args>` in-process, under the CLI's environment, with what it prints and its exit code. */
async function run(env: Record<string, string>, ...args: string[]): Promise<Result> {
  const saved = { ...process.env };
  const { log, error } = console;
  let stdout = "", stderr = "", code = 0;
  Object.assign(process.env, testEnv, { ALEPH_JUDGE: "haiku", TZ: zone }, env);
  console.log = (...a: unknown[]) => { stdout += a.map(String).join(" ") + "\n"; };
  console.error = (...a: unknown[]) => { stderr += a.map(String).join(" ") + "\n"; };
  try {
    await vaultOp(args);
  } catch (e) {
    if (!(e instanceof Exit)) throw e;
    code = e.code;
  } finally {
    console.log = log;
    console.error = error;
    // Bun reads a new TZ when it is set, not when it is deleted: set UTC back first.
    process.env.TZ = "UTC";
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  return parsed(code, stdout, stderr);
}
const runAsync = run;
/** `vault <args>` as a process: the CLI test of an op. */
async function spawnRun(env: Record<string, string>, ...args: string[]): Promise<Result> {
  const p = Bun.spawn(["bun", CLI, ...args], { env: { ...process.env, ...testEnv, ALEPH_JUDGE: "haiku", ...env }, stdout: "pipe", stderr: "pipe" });
  const code = await p.exited;
  return parsed(code, await new Response(p.stdout).text(), await new Response(p.stderr).text());
}
const cli = (...args: string[]) => run({ ALEPH_VAULT: vault }, ...args);

function note(title: string, over: Record<string, string> = {}, body?: string): string {
  // Today, not a fixed date: the default note must read as freshly written, and a
  // pinned date silently crosses its decay window and fails tests months later.
  const fm = { kind: "gotcha", scope: "aleph", confidence: "measured", updated: new Date().toISOString().slice(0, 10), supersedes: "[]", sources: "[trace:abc123]", ...over };
  const text = `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n` + (body ?? `**Claim.** ${title} does a thing, as of 2026-09-04.\n\n## Details\nd\n\n## Evidence\n- trace abc123\n\n## Related\n[[Home]]\n`);
  const path = join(drafts, `${title}.md`);
  writeFileSync(path, text);
  return path;
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-vault-"));
  vault = join(base, "vault");
  drafts = join(base, "drafts");
  mkdirSync(drafts);
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("misses", () => {
  let server: ReturnType<typeof Bun.serve>;
  const ago = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
  const bash = (traceId: string, cmd: string, output: string, d = 1) => ({ traceId, name: "Bash", type: "SPAN", input: JSON.stringify({ command: cmd }), output, startTime: ago(d) });
  const read = (traceId: string, file_path: string) => ({ traceId, name: "Read", input: { file_path }, output: "x", startTime: ago(1) });
  const hook = (traceId: string, m: any, output?: string) => ({ traceId, name: "vault-recall", metadata: m, output, startTime: ago(1) });
  const data = [
    bash("a", "vault recall jev screen", "[]"),
    bash("a", "vault recall bounded judgment", '[{"title":"Bounded Judgment","path":"wiki/concepts/Bounded Judgment.md"}]'),
    read("a", "/v/wiki/concepts/Bounded Judgment.md"),
    read("a", "/v/wiki/concepts/Other Note.md"),
    bash("b", "vault recall alpha beta", '[{"title":"Alpha"}]'),
    bash("b", "vault recall alpha delta", '[{"title":"Alpha"}]'),
    bash("c", "vault recall gamma", "[]"),
    bash("old", "vault recall ancient", "[]", 30),
    bash("d", "ls", "x"),
    bash("g", 'bun ~/.claude/skills/aleph/vault/cli.ts recall "x"', "[]"),
    bash("g", 'cd ~/.claude/skills/aleph/vault; bun cli.ts recall "y" --scope aleph', "[]"),
    bash("g", 'grep -rn "cli.ts recall" ~/.claude', "x"),
    bash("g", "cat <<'EOF' > n.md\nbun cli.ts recall \"z\"\nEOF", "x"),
    read("d", "/v/wiki/concepts/Offered By Hook.md"),
    hook("d", { candidates: 45, asked: 40, kept: 3, capped: true }, "- Offered By Hook (/v/wiki/concepts/Offered By Hook.md): c"),
    hook("e", { candidates: 0, asked: 0, kept: 0, capped: false }),
    hook("f", { candidates: 2, asked: 2, kept: 0, capped: false }),
    { ...hook("old", { candidates: 0, asked: 0, kept: 0, capped: false }), startTime: ago(30) },
  ];
  let seen: URLSearchParams[] = [];
  beforeAll(() => {
    server = Bun.serve({ port: 0, fetch: (req) => {
      const u = new URL(req.url);
      if (u.pathname !== "/api/public/observations") return new Response("nope", { status: 404 });
      seen.push(u.searchParams);
      const from = new Date(u.searchParams.get("fromStartTime")!).getTime();
      const all = data.filter((o) => new Date(o.startTime).getTime() >= from);
      const page = Number(u.searchParams.get("page"));
      return Response.json({ data: all.slice((page - 1) * 5, page * 5), meta: { page, totalPages: Math.ceil(all.length / 5) } });
    } });
  });
  afterAll(() => server.stop());
  const env = () => ({ ALEPH_VAULT: vault, LANGFUSE_BASE_URL: `http://127.0.0.1:${server.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" });
  const snapshot = () => Bun.spawnSync(["sh", "-c", `cd '${vault}' && find . -type f -not -path './.git/*' | sort | xargs sha256sum`], { stdout: "pipe" }).stdout.toString();

  test("counts the four signals; old observations and the vault are left alone", async () => {
    // The CLI test of this op: it spawns vault/cli.ts.
    const before = snapshot();
    const r = await spawnRun(env(), "misses", "--days", "7");
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.missed).toHaveLength(4);  // the empty recalls, newest first
    expect(out.missed.map((m: any) => m.query)).toEqual(expect.arrayContaining(["x", "y"]));
    expect(out.missed[0].at >= out.missed[1].at).toBe(true);
    delete out.missed;
    expect(out).toEqual({
      days: 7, recalls: 7, empty: 4, empty_share: 4 / 7, reformulated: 3, unoffered_reads: 1,
      hook: { runs: 3, zero_candidates: 1, capped: 1, mean_kept: 1 },
    });
    expect(snapshot()).toBe(before);
  });
});

describe("provenance and the contradiction screen", () => {
  let v: string;
  let server: ReturnType<typeof Bun.serve>;
  let asked: any[];
  let answer: number;
  const env = (extra: Record<string, string> = {}) => ({ ALEPH_VAULT: v, ALEPH_JUDGE: "jev", ALEPH_JEV_URL: `http://127.0.0.1:${server.port}/`, OPENROUTER_API_KEY: "k", CLAUDE_CODE_SESSION_ID: "", ...extra });
  const snapshot = () => Bun.spawnSync(["bash", "-c", `cd ${v} && find . -path ./.git -prune -o -type f -print | sort | xargs cat | sha256sum`], { stdout: "pipe" }).stdout.toString();
  const write = (path: string, extra: Record<string, string> = {}) => runAsync(env(extra), "write", path, "--why", "t");
  const wikiText = (title: string) => readFileSync(join(v, "wiki", "gotchas", `${title}.md`), "utf8");

  beforeAll(async () => {
    v = join(base, "vault-screen");
    expect((await run({ ALEPH_VAULT: v }, "init")).code).toBe(0);
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body: any = await req.json();
        asked.push(body);
        const answers = Object.fromEntries(Object.keys(body.questions).map((k) => [k, { type: "noul", noul: answer }]));
        return Response.json({ answers, model: "m", usage: { cost: 0 } });
      },
    });
  });
  afterAll(() => server.stop(true));
  const reset = (a = 0.9) => { asked = []; answer = a; };
  // Titles share "widget" and nothing else with the other tests' notes.
  const live = async (title: string) => { const r = await write(note(title, { scope: "screen" }), { ALEPH_JUDGE: "haiku" }); expect(r.code).toBe(0); };

  test("stamps claude and the session id", async () => {
    reset();
    const t = "Stamp Alpha";
    expect((await write(note(t), { CLAUDE_CODE_SESSION_ID: "s1", ALEPH_JUDGE: "haiku" })).code).toBe(0);
    const text = wikiText(t);
    expect(text).toContain("written_by: claude");
    expect(text).toContain("session: s1");
  });
  test("stamps chris without a session", async () => {
    const t = "Stamp Beta";
    expect((await write(note(t), { ALEPH_JUDGE: "haiku" })).code).toBe(0);
    const text = wikiText(t);
    expect(text).toContain("written_by: chris");
    expect(text).not.toContain("session:");
  });
  test("a draft's own written_by is kept", async () => {
    const t = "Stamp Gamma";
    expect((await write(note(t, { written_by: "chris" }), { CLAUDE_CODE_SESSION_ID: "s1", ALEPH_JUDGE: "haiku" })).code).toBe(0);
    const text = wikiText(t);
    expect(text).toContain("written_by: chris");
    expect(text).not.toContain("written_by: claude");
  });
  test("a note without the fields passes lint", async () => {
    expect((await run({ ALEPH_VAULT: v }, "lint")).code).toBe(0);
  });

  test("p 0.9 refuses, names the note, changes nothing", async () => {
    await live("Widget Registry");
    reset(0.9);
    const before = snapshot();
    const r = await write(note("Widget Registry Rules", { scope: "screen" }));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Widget Registry");
    expect(r.stderr).toContain("add it to supersedes or fix the draft");
    expect(r.stderr).toContain("name it in consistent_with");
    expect(snapshot()).toBe(before);
    expect(asked.length).toBe(1);
  });
  test("superseding the note writes and does not ask about it", async () => {
    reset(0.9);
    const r = await write(note("Widget Registry Rules", { scope: "screen", supersedes: "[Widget Registry]" }));
    expect(r.code).toBe(0);
    expect(JSON.stringify(asked)).not.toContain("`Widget Registry`");
  });
  test("p 0.5 writes", async () => {
    await live("Gadget Ledger");
    reset(0.5);
    expect((await write(note("Gadget Ledger Rules", { scope: "screen" }))).code).toBe(0);
    expect(asked.length).toBe(1);
  });
  test("under judge haiku the server gets no request", async () => {
    await live("Flange Ledger");
    reset(0.9);
    expect((await write(note("Flange Ledger Rules", { scope: "screen" }), { ALEPH_JUDGE: "haiku" })).code).toBe(0);
    expect(asked.length).toBe(0);
  });
  test("one request holds at most 20 questions", async () => {
    // 25 live notes put on disk as one commit, not 25 CLI writes: the screen reads the notes from disk.
    for (const c of "abcdefghijklmnopqrstuvwxy") copyFileSync(note(`Turbine Number ${c}`, { scope: "screen" }), join(v, "wiki", "gotchas", `Turbine Number ${c}.md`));
    for (const args of [["add", "-A"], ["commit", "-qm", "turbines"]]) expect(Bun.spawnSync(["git", "-C", v, ...args], { env: { ...process.env, ...testEnv } }).exitCode).toBe(0);
    reset(0.1);
    expect((await write(note("Turbine Summary", { scope: "screen" }))).code).toBe(0);
    expect(asked.length).toBe(1);
    expect(Object.keys(asked[0].questions).length).toBe(20);
  });
});

describe("episode", () => {
  // The land suite's init case lays the vault down before these cases.
  beforeAll(async () => { await cli("init"); });
  const episodeBody = (word: string, skip?: string) => ["Goal", "What landed", "How it went", "Cost", "What went wrong"]
    .filter((h) => h !== skip).map((h) => `## ${h}\n${word} ${h.toLowerCase()}\n`).join("\n");
  const episode = (title: string, word: string, skip?: string) => note(title, { kind: "episode" }, episodeBody(word, skip));
  test("a draft with the five sections is written to wiki/episodes/", async () => {
    const r = (await cli("write", episode("Ledger Episode", "ledger"), "--why", "x"));
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain("refuse template");
    expect(r.json.path).toBe("wiki/episodes/Ledger Episode.md");
  });
  test("a draft without ## Cost is refused", async () => {
    const r = (await cli("write", episode("Costless Episode", "ledger", "Cost"), "--why", "x"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("## Cost");
  });
  test("recall --episodes returns only episodes, plain recall none", async () => {
    (await cli("write", note("Ledger Gotcha", {}, "**Claim.** the ledger lies, as of 2026-09-04.\n\n## Details\nledger\n\n## Evidence\n\n## Related\n[[Home]]\n"), "--why", "x"));
    expect((await cli("recall", "--episodes", "ledger")).json.map((h: any) => h.title)).toEqual(["Ledger Episode"]);
    expect((await cli("recall", "ledger")).json.map((h: any) => h.title)).toEqual(["Ledger Gotcha"]);
  });
});
