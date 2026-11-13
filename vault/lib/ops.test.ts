import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recallQuery } from "./recall-query.ts";
import { use } from "../../lib/langfuse.ts";
import { Exit, run as vaultOp } from "./ops.ts";

// The test's clock: the code under test reads it, and the fixtures sit at known distances from it.
const NOW = Date.parse("2026-11-04T12:00:00Z");
beforeAll(() => setSystemTime(NOW));
afterAll(() => setSystemTime());

// Each op runs in-process through `run`, as `aleph memory` runs it. A test marked as the CLI test of its op spawns
// `bun jobs/cli.ts memory` instead, for the op's wiring.
const CLI = join(import.meta.dir, "..", "..", "jobs", "cli.ts");
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
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    // Bun reads a new TZ when it is set, not when it is deleted: a deleted TZ leaves the machine zone, so set UTC last.
    if (!saved.TZ) process.env.TZ = "UTC";
  }
  return parsed(code, stdout, stderr);
}
const runAsync = run;
/** `aleph memory <args>` as a process: the CLI test of an op. */
async function spawnRun(env: Record<string, string>, ...args: string[]): Promise<Result> {
  const p = Bun.spawn(["bun", CLI, "memory", ...args], { env: { ...process.env, ...testEnv, ALEPH_JUDGE: "haiku", ...env }, stdout: "pipe", stderr: "pipe" });
  const code = await p.exited;
  return parsed(code, await new Response(p.stdout).text(), await new Response(p.stderr).text());
}
const cli = (...args: string[]) => run({ ALEPH_VAULT: vault }, ...args);
const spawnCli = (...args: string[]) => spawnRun({ ALEPH_VAULT: vault }, ...args);
const gitLog = () => Bun.spawnSync(["git", "-C", vault, "log", "--format=%s%n%b"], { stdout: "pipe" }).stdout.toString();
const gitStatus = () => Bun.spawnSync(["git", "-C", vault, "status", "--porcelain"], { stdout: "pipe" }).stdout.toString().trim();

function note(title: string, over: Record<string, string> = {}, body?: string): string {
  // Today, not a fixed date: the default note must read as freshly written, and a
  // pinned date silently crosses its decay window and fails tests months later.
  const fm = { kind: "gotcha", scope: "aleph", confidence: "measured", updated: new Date(NOW).toISOString().slice(0, 10), supersedes: "[]", sources: "[trace:abc123]", ...over };
  const text = `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n` + (body ?? `**Claim.** ${title} does a thing, as of 2026-09-04.\n\n## Details\nd\n\n## Evidence\n- trace abc123\n\n## Related\n[[Home]]\n`);
  const path = join(drafts, `${title}.md`);
  writeFileSync(path, text);
  return path;
}

// Each test gets a vault of its own, made by init, and writes the notes it reads.
beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-vault-"));
  vault = join(base, "vault");
  drafts = join(base, "drafts");
  mkdirSync(drafts);
  expect((await cli("init")).code).toBe(0);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("init", () => {
  test("lays down the layout, config and first commit", async () => {
    // The CLI test of this op: it spawns `bun jobs/cli.ts memory`, on a path no vault holds yet.
    vault = join(base, "fresh");
    const r = (await spawnCli("init"));
    expect(r.code).toBe(0);
    expect(r.json.commit).toMatch(/^[0-9a-f]{7,}$/);
    for (const p of ["VAULT.md", "Home.md", "MEMORY.md", "wiki/decisions", "wiki/concepts", "wiki/entities", "wiki/projects", "wiki/gotchas", "daily", "archive", "attachments", ".obsidian/daily-notes.json", ".gitignore"]) expect(existsSync(join(vault, p))).toBe(true);
    const daily = JSON.parse(readFileSync(join(vault, ".obsidian/daily-notes.json"), "utf8"));
    expect(daily).toEqual({ folder: "daily", format: "YYYY-MM-DD" });
    expect(JSON.parse(readFileSync(join(vault, ".obsidian/app.json"), "utf8")).attachmentFolderPath).toBe("attachments");
    expect(readFileSync(join(vault, ".gitignore"), "utf8")).toContain("workspace*.json");
    expect(readFileSync(join(vault, ".gitignore"), "utf8")).toContain(".recall-log.jsonl");
    expect(Bun.spawnSync(["git", "-C", vault, "remote"], { stdout: "pipe" }).stdout.toString().trim()).toBe("");
    expect(readFileSync(join(vault, "Home.md"), "utf8").trim().split("\n").at(-1)).toMatch(/^Health: 0 notes, 0 dangling, 0 stale, lint \d{4}-\d{2}-\d{2}$/);
  });
  test("refuses a second init", async () => {
    expect((await cli("init")).code).toBe(1);
  });
  test("other commands refuse without a vault", async () => {
    const r = await run({ ALEPH_VAULT: join(base, "nowhere") }, "lint");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("run: aleph memory init");
  });
});

describe("write", () => {
  test("files by kind, logs the day, sets health, commits with the trailer", async () => {
    // The CLI test of this op: it spawns `bun jobs/cli.ts memory`.
    const r = (await spawnCli("write", note("Stop Hook Block Shape"), "--why", "measured three shapes"));
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ op: "write", title: "Stop Hook Block Shape", path: "wiki/gotchas/Stop Hook Block Shape.md", archived: [] });
    expect(existsSync(join(vault, "wiki/gotchas/Stop Hook Block Shape.md"))).toBe(true);
    // The test process can run in UTC while the CLI child runs in local time, so ask a child for the date.
    const date = Bun.spawnSync(["date", "+%F"], { stdout: "pipe" }).stdout.toString().trim();
    expect(readFileSync(join(vault, "daily", `${date}.md`), "utf8")).toMatch(/^- \d\d:\d\d write \[\[Stop Hook Block Shape\]\] — measured three shapes$/m);
    expect(readFileSync(join(vault, "Home.md"), "utf8").trim().split("\n").at(-1)).toBe(`Health: 1 notes, 0 dangling, 0 stale, lint ${date}`);
    const log = gitLog();
    expect(log).toContain("write: Stop Hook Block Shape");
    expect(log).toContain("Co-Authored-By: Claude");
    expect(gitStatus()).toBe("");
  });
  test("Home is generated: a decision gets its line, and two writes in either order give the same Home", async () => {
    const home = join(vault, "Home.md");
    const a = note("Ordered Decision A", { kind: "decision", scope: "order", updated: "2026-09-03", core: "A comes second" });
    const b = note("Ordered Decision B", { kind: "decision", scope: "order", updated: "2026-09-04" });
    expect((await cli("write", a, "--why", "x")).code).toBe(0);
    expect((await cli("write", b, "--why", "x")).code).toBe(0);
    const first = readFileSync(home, "utf8");
    expect(first).toContain("## order\n\n### Decisions\n- [[Ordered Decision B]]\n- [[Ordered Decision A]] — A comes second\n");
    expect(first).not.toContain("[[Stop Hook Block Shape]]");  // a gotcha has no Home line
    expect((await cli("write", note("Ordered Decision B", { kind: "decision", scope: "order", updated: "2026-09-04" }), "--why", "x")).code).toBe(0);
    expect((await cli("write", note("Ordered Decision A", { kind: "decision", scope: "order", updated: "2026-09-03", core: "A comes second" }), "--why", "x")).code).toBe(0);
    expect(readFileSync(home, "utf8")).toBe(first);
  });
  test("a decision goes to wiki/decisions", async () => {
    const r = (await cli("write", note("No API Judge", { kind: "decision" }), "--why", "subscription only"));
    expect(r.json.path).toBe("wiki/decisions/No API Judge.md");
  });
  test("each write is its own commit", async () => {
    for (const t of ["First Write", "Second Write"]) expect((await cli("write", note(t), "--why", "x")).code).toBe(0);
    expect(gitLog().split("\n").filter((l) => l.startsWith("write: ")).length).toBe(2);
  });
  test("refuses a note in the wrong folder", async () => {
    mkdirSync(join(vault, "wiki/concepts"), { recursive: true });
    const p = join(vault, "wiki/concepts/Misfiled.md");
    writeFileSync(p, readFileSync(note("Misfiled"), "utf8"));
    const r = (await cli("write", p, "--why", "x"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("refuse folder");
    expect(r.stderr).toContain("wiki/gotchas/");
    rmSync(p);
  });
  test("refuses schema violations, listing each", async () => {
    const r = (await cli("write", note("Bad Schema", { confidence: "sure", updated: "yesterday", kind: "gotcha", sources: "[]" }), "--why", "x"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("confidence must be one of");
    expect(r.stderr).toContain("updated must be YYYY-MM-DD");
    expect(existsSync(join(vault, "wiki/gotchas/Bad Schema.md"))).toBe(false);
    expect(gitStatus()).toBe("");
  });
  test("refuses a missing required field but not missing aliases or tags", async () => {
    const p = note("Missing Scope");
    writeFileSync(p, readFileSync(p, "utf8").replace(/^scope: .*\n/m, ""));
    const r = (await cli("write", p, "--why", "x"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("missing scope");
    expect(r.stderr).not.toContain("aliases");
  });
  test("refuses a duplicate title or alias", async () => {
    expect((await cli("write", note("Stop Hook Block Shape"), "--why", "x")).code).toBe(0);
    const r = (await cli("write", note("Another Name", { aliases: "[stop hook block shape]" }), "--why", "x"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("refuse duplicate");
    expect(r.stderr).toContain("Stop Hook Block Shape.md");
  });
  test("refuses a dangling link", async () => {
    const body = "**Claim.** x as of 2026-09-04.\n\n## Details\n\n## Evidence\n\n## Related\n[[Nowhere]] and [[Also Nowhere|alias]]\n";
    const r = (await cli("write", note("Dangling", {}, body), "--why", "x"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("[[Nowhere]] resolves to nothing");
    expect(r.stderr).toContain("[[Also Nowhere]] resolves to nothing");
  });
  test("links inside code are not links", async () => {
    const body = "**Claim.** x as of 2026-09-04.\n\n## Details\nuse `[[Title]]` and\n```\n[[Fenced]]\n```\n\n## Evidence\n\n## Related\n[[Home]]\n";
    expect((await cli("write", note("Code Links", {}, body), "--why", "x")).code).toBe(0);
  });
  test("refuses a body without the template", async () => {
    const r = (await cli("write", note("No Template", {}, "Just prose.\n"), "--why", "x"));
    expect(r.code).toBe(1);
    for (const s of ["**Claim.**", "as of YYYY-MM-DD", "## Details", "## Evidence", "## Related"]) expect(r.stderr).toContain(s);
  });
  test("refuses VAULT.md", async () => {
    const r = (await cli("write", join(vault, "VAULT.md"), "--why", "x"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("human-owned");
  });
  test("supersedes: archives the old note with reason, logs, commits", async () => {
    expect((await cli("write", note("Stop Hook Block Shape"), "--why", "x")).code).toBe(0);
    const r = (await cli("write", note("Stop Hook Deny Shape", { supersedes: "[Stop Hook Block Shape]" }), "--why", "renamed"));
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ op: "supersede", archived: ["Stop Hook Block Shape"] });
    expect(existsSync(join(vault, "wiki/gotchas/Stop Hook Block Shape.md"))).toBe(false);
    const archived = readFileSync(join(vault, "archive/Stop Hook Block Shape.md"), "utf8");
    expect(archived).toMatch(/^archived: \d{4}-\d{2}-\d{2}$/m);
    expect(archived).toContain('archived_reason: "superseded by [[Stop Hook Deny Shape]]"');
    expect(gitLog()).toContain("supersede: Stop Hook Block Shape → Stop Hook Deny Shape");
  });
  test("refuses supersedes of an unknown note", async () => {
    const r = (await cli("write", note("Supersedes Ghost", { supersedes: "[Ghost]" }), "--why", "x"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no live wiki note has that title");
  });
  test("rewriting an existing title updates it in place", async () => {
    expect((await cli("write", note("Stop Hook Deny Shape"), "--why", "x")).code).toBe(0);
    const r = (await cli("write", note("Stop Hook Deny Shape", { updated: "2026-09-05" }), "--why", "update"));
    expect(r.code).toBe(0);
    expect(readFileSync(join(vault, "wiki/gotchas/Stop Hook Deny Shape.md"), "utf8")).toContain("updated: 2026-09-05");
  });
  test("Home.md is generated: a write of it is refused", async () => {
    const r = (await cli("write", join(vault, "Home.md"), "--why", "hand edit"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("refuse generated Home");
  });
  test("MEMORY.md: commits and refuses a dangling link", async () => {
    expect((await cli("write", note("No API Judge", { kind: "decision" }), "--why", "x")).code).toBe(0);
    const memory = join(vault, "MEMORY.md");
    const text = readFileSync(memory, "utf8");
    writeFileSync(memory, text + "\n- Chris, Pacific, WSL2. See [[No API Judge]].\n");
    expect((await cli("write", memory, "--why", "profile")).code).toBe(0);
    writeFileSync(memory, text + "\n[[Ghost]]\n");
    const r = (await cli("write", memory, "--why", "bad"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("[[Ghost]] resolves to nothing");
    writeFileSync(memory, text);
    (await cli("write", memory, "--why", "restore"));
  });
});

describe("lint", () => {
  test("reports warnings as JSON, exit 0 when nothing refuses, and sets health", async () => {
    // The CLI test of this op: it spawns `bun jobs/cli.ts memory`.
    const r = (await spawnCli("lint"));
    expect(r.json.refuse).toEqual([]);
    expect(r.code).toBe(0);
    expect(readFileSync(join(vault, "Home.md"), "utf8").trim().split("\n").at(-1)).toMatch(/^Health: \d+ notes, 0 dangling, \d+ stale, lint \d{4}-\d{2}-\d{2}$/);
  });
  test("warns on stale; overlap is opt-in; exit 1 on a hand-made structural break", async () => {
    (await cli("write", note("Langfuse Ingestion Drops Batches", { updated: "2026-01-01" }), "--why", "x"));
    (await cli("write", note("Langfuse Ingestion Needs Version Header"), "--why", "x"));
    const r = (await cli("lint"));
    const find = (rule: string) => r.json.warn.filter((w: any) => w.rule === rule);
    expect(find("stale").map((w: any) => w.note)).toContain("Langfuse Ingestion Drops Batches");
    expect(find("overlap")).toEqual([]);
    const on = (await cli("lint", "--overlap"));
    expect(on.json.warn.filter((w: any) => w.rule === "overlap")[0].detail).toContain("neither supersedes the other");
    const broken = join(vault, "wiki/gotchas/Hand Edited.md");
    writeFileSync(broken, "no frontmatter\n");
    const bad = (await cli("lint"));
    expect(bad.code).toBe(1);
    expect(bad.json.refuse).toContainEqual({ note: "Hand Edited", rule: "schema", detail: "no frontmatter" });
    rmSync(broken);
    (await cli("lint"));
  });
});

describe("commit scope", () => {
  test("a stray note in wiki/ does not ride into history on another write", async () => {
    const stray = join(vault, "wiki/gotchas/Never Accepted.md");
    writeFileSync(stray, "no frontmatter, never written\n");
    expect((await cli("write", note("Scoped Commit Check"), "--why", "x")).code).toBe(0);
    expect(gitStatus().replace(/"/g, "")).toBe("?? wiki/gotchas/Never Accepted.md");
    expect(Bun.spawnSync(["git", "-C", vault, "ls-files", "--", "wiki/gotchas/Never Accepted.md"], { stdout: "pipe" }).stdout.toString().trim()).toBe("");
    rmSync(stray);
  });
  test("a refusal names a file in the vault that no write has accepted", async () => {
    const p = join(vault, "wiki/gotchas/Half Written.md");
    writeFileSync(p, readFileSync(note("Half Written"), "utf8").replace("## Evidence\n", ""));
    const r = (await cli("write", p, "--why", "x"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("missing section ## Evidence");
    expect(r.stderr).toContain("no write has accepted it");
    expect(existsSync(p)).toBe(true);
    rmSync(p);
  });
});

describe("lint --fix", () => {
  test("repairs frontmatter, leaves the body, and reports what it cannot judge", async () => {
    const p = join(vault, "wiki/gotchas/Needs Repair.md");
    const body = "**Claim.** repairs happen in frontmatter only, as of 2026-09-04.\n\n## Details\nd\n\n## Evidence\n- run\n\n## Related\n[[Home]]\n";
    writeFileSync(p, "---\naliases: one name\nkind: gotcha\nscope: aleph\nconfidence: sure\nupdated: 2026-09-04\nsources: [chris]\n---\n" + body);
    const r = (await cli("lint", "--fix"));
    expect(r.json.fixed).toContainEqual({ note: "Needs Repair", path: "wiki/gotchas/Needs Repair.md", repairs: ["aliases wrapped in a list", "added supersedes: []"] });
    const after = readFileSync(p, "utf8");
    expect(after).toContain("aliases: [one name]");
    expect(after).toContain("supersedes: []");
    expect(after).toContain(body);
    // confidence is a claim about how the fact was learned, so --fix leaves it.
    expect(after).toContain("confidence: sure");
    expect(r.json.refuse).toContainEqual({ note: "Needs Repair", rule: "schema", detail: "confidence must be one of measured|reported|inferred, got sure" });
    expect(gitLog()).toContain("lint --fix: 1 notes");
    (await cli("archive", "Needs Repair", "--why", "test fixture"));
  });
  test("a missing updated comes from the date the note entered git, not its last commit", async () => {
    const rel = "wiki/gotchas/Entered Long Ago.md";
    const p = join(vault, rel);
    const text = readFileSync(note("Entered Long Ago"), "utf8").replace(/^updated: .*\n/m, "");
    const commitAt = (msg: string, date: string) => {
      Bun.spawnSync(["git", "-C", vault, "add", "--", rel]);
      Bun.spawnSync(["git", "-C", vault, "-c", "commit.gpgsign=false", "commit", "-q", "-m", msg, "--", rel],
        { env: { ...process.env, ...testEnv, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    };
    writeFileSync(p, text);
    commitAt("seed the note", "2026-01-15T12:00:00");
    writeFileSync(p, text + "\n<!-- a later housekeeping touch -->\n");
    commitAt("touch it later", "2026-06-01T12:00:00");
    const r = (await cli("lint", "--fix"));
    expect(readFileSync(p, "utf8")).toContain("updated: 2026-01-15");
    expect(r.json.fixed.find((f: any) => f.note === "Entered Long Ago").repairs)
      .toEqual(["added updated: 2026-01-15, the date the note entered git"]);
    (await cli("archive", "Entered Long Ago", "--why", "test fixture"));
  });
  test("a re-added note keeps the date it first entered git", async () => {
    const at = (date: string, ...args: string[]) => Bun.spawnSync(["git", "-C", vault, "-c", "commit.gpgsign=false", ...args], { env: { ...process.env, ...testEnv, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    const first = "wiki/gotchas/Moved About Again.md";
    const text = readFileSync(note("Entered Long Ago"), "utf8").replace(/^updated: .*\n/m, "").replaceAll("Entered Long Ago", "Moved About Again");
    writeFileSync(join(vault, first), text);
    at("2026-01-02T12:00:00", "add", "--", first); at("2026-01-02T12:00:00", "commit", "-q", "-m", "enter", "--", first);
    at("2026-02-02T12:00:00", "rm", "-q", "--", first); at("2026-02-02T12:00:00", "commit", "-q", "-m", "gone", "--", first);
    writeFileSync(join(vault, first), text);
    at("2026-03-02T12:00:00", "add", "--", first); at("2026-03-02T12:00:00", "commit", "-q", "-m", "back", "--", first);
    (await cli("lint", "--fix"));
    expect(readFileSync(join(vault, first), "utf8")).toContain("updated: 2026-01-02");
    (await cli("archive", "Moved About Again", "--why", "test fixture"));
  });
  test("many template breaks collapse to a count; --template names them", async () => {
    const thin = (t: string) => {
      const p = join(vault, `wiki/gotchas/${t}.md`);
      writeFileSync(p, readFileSync(note(t), "utf8").replace(/\*\*Claim\.\*\*[\s\S]*/, "Just prose.\n\n## Details\nd\n"));
      return p;
    };
    const made = ["Thin One", "Thin Two"].map(thin);
    const r = (await cli("lint"));
    const w = r.json.warn.filter((f: any) => f.rule === "template");
    expect(w).toHaveLength(1);
    expect(w[0].note).toBe("2 notes");
    expect(w[0].detail).toContain("lint --template");

    const named = (await cli("lint", "--template")).json.warn.filter((f: any) => f.rule === "template");
    expect(named.map((f: any) => f.note).sort()).toEqual(["Thin One", "Thin Two"]);
    for (const p of made) rmSync(p);
    Bun.spawnSync(["git", "-C", vault, "checkout", "--", "wiki"]);
    for (const t of ["Thin One", "Thin Two"]) (await cli("archive", t, "--why", "test fixture"));
    expect(gitStatus()).toBe("");
  });
  test("a # inside a list is content, and --fix leaves a line it cannot rebuild", async () => {
    const r = (await cli("write", note("Hash In A List", { aliases: "[url scheme, #go]" }), "--why", "x"));
    expect(r.code).toBe(0);
    const p = join(vault, "wiki/gotchas/Hash In A List.md");
    expect(readFileSync(p, "utf8")).toContain("aliases: [url scheme, #go]");
    expect((await cli("recall", "#go")).json[0]).toMatchObject({ title: "Hash In A List", rank: 1 });
    const fix = (await cli("lint", "--fix"));
    expect(fix.json.fixed.map((f: any) => f.note)).not.toContain("Hash In A List");
    expect(readFileSync(p, "utf8")).toContain("aliases: [url scheme, #go]");
  });
  test("a template break warns once per note and does not refuse", async () => {
    const p = join(vault, "wiki/gotchas/Thin Body.md");
    writeFileSync(p, readFileSync(note("Thin Body"), "utf8").replace(/\*\*Claim\.\*\*[\s\S]*/, "Just prose.\n\n## Details\nd\n"));
    const r = (await cli("lint"));
    expect(r.json.refuse.filter((f: any) => f.note === "Thin Body")).toEqual([]);
    const w = r.json.warn.filter((f: any) => f.note === "Thin Body" && f.rule === "template");
    expect(w).toHaveLength(1);
    expect(w[0].detail).toContain("**Claim.**");
    expect(w[0].detail).toContain("## Evidence");
    rmSync(p);
    (await cli("lint"));
  });
});

describe("core", () => {
  test("a core line longer than 160 characters is refused", async () => {
    const r = (await cli("write", note("Too Long A Core", { kind: "decision", core: "x".repeat(161) }), "--why", "x"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("core must be one line of 1 to 160 characters");
  });
  test("a core write over the start budget is refused with the scope's core lines ranked, and changes nothing", async () => {
    const line = (i: number) => `Core fact ${i} ${"y".repeat(140)}`;
    let i = 0;
    for (; i < 60; i++) {
      const r = (await cli("write", note(`Budget Core ${i}`, { kind: "decision", scope: "budgetcore", updated: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`, core: line(i) }), "--why", "x"));
      if (r.code !== 0) {
        expect(r.stderr).toContain("refuse core Budget Core");
        expect(r.stderr).toContain("start context of scope budgetcore is over 6000 bytes");
        expect(r.stderr).toContain("ranked for demotion, oldest first");
        expect(r.stderr).toContain("Budget Core 0 (updated 2026-09-01, budgetcore)");
        break;
      }
    }
    expect(i).toBeGreaterThan(20);
    expect(i).toBeLessThan(60);
    expect(existsSync(join(vault, `wiki/decisions/Budget Core ${i}.md`))).toBe(false);
    expect(gitStatus()).toBe("");
    for (let j = 0; j < i; j++) (await cli("archive", `Budget Core ${j}`, "--why", "test fixture"));
  });
});

describe("push", () => {
  test("a write pushes to origin, and a broken origin warns without failing", async () => {
    const bare = join(base, "vault-origin.git");
    Bun.spawnSync(["git", "init", "-q", "--bare", "-b", "main", bare]);
    Bun.spawnSync(["git", "-C", vault, "remote", "add", "origin", bare]);
    const r = (await cli("write", note("Pushed Upstream"), "--why", "x"));
    expect(r.code).toBe(0);
    const remoteLog = Bun.spawnSync(["git", "-C", bare, "log", "--format=%s"], { stdout: "pipe" }).stdout.toString();
    expect(remoteLog).toContain("write: Pushed Upstream");

    // A remote that cannot be reached must not fail the write.
    Bun.spawnSync(["git", "-C", vault, "remote", "set-url", "origin", join(base, "does-not-exist.git")]);
    const broken = (await cli("write", note("Pushed Upstream", { updated: "2026-09-27" }), "--why", "rewrite"));
    expect(broken.code).toBe(0);
    expect(broken.json.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(broken.stderr).toContain("warn push");
    expect(broken.stderr).toContain("the commit stands");
    const run = JSON.parse(readFileSync(join(vault, ".index", "runs", "vault push.json"), "utf8"));
    expect(run).toMatchObject({ result: "failed", detail: expect.stringContaining("repository") });
    expect(Date.parse(run.at)).toBeGreaterThan(0);

    Bun.spawnSync(["git", "-C", vault, "remote", "remove", "origin"]);
    (await cli("archive", "Pushed Upstream", "--why", "test fixture"));
    expect(gitStatus()).toBe("");
  });
});

describe("rename-scope", () => {
  test("read-only by default; --apply moves every note and touches no other line", async () => {
    // The CLI test of this op: it spawns `bun jobs/cli.ts memory`.
    (await cli("write", note("Old Scope One", { scope: "voice-bridge-mcp" }), "--why", "x"));
    (await cli("write", note("Old Scope Two", { scope: "voice-bridge-mcp" }), "--why", "x"));
    const paths = ["Old Scope One", "Old Scope Two"].map((t) => join(vault, `wiki/gotchas/${t}.md`));
    const before = paths.map((p) => readFileSync(p, "utf8"));

    const dry = (await spawnCli("rename-scope", "voice-bridge-mcp", "sidetone"));
    expect(dry.json).toMatchObject({ applied: false, count: 2, commit: null });
    expect(dry.stderr).toContain("rerun with --apply");
    expect(readFileSync(paths[0], "utf8")).toBe(before[0]);

    const r = (await cli("rename-scope", "voice-bridge-mcp", "sidetone", "--apply"));
    expect(r.json).toMatchObject({ applied: true, count: 2 });
    paths.forEach((p, i) => {
      const after = readFileSync(p, "utf8");
      expect(after).toContain("scope: sidetone");
      expect(after).not.toContain("voice-bridge-mcp");
      // Only the scope line moved.
      expect(after.split("\n").length).toBe(before[i].split("\n").length);
      expect(after.replace(/^scope: .*$/m, "")).toBe(before[i].replace(/^scope: .*$/m, ""));
    });
    expect((await cli("recall", "--scope", "sidetone")).json.map((h: any) => h.title).sort()).toEqual(["Old Scope One", "Old Scope Two"]);
    expect((await cli("recall", "--scope", "voice-bridge-mcp")).json).toEqual([]);
    expect(gitLog()).toContain("rename-scope: voice-bridge-mcp → sidetone, 2 notes");
    expect(gitStatus()).toBe("");
    for (const t of ["Old Scope One", "Old Scope Two"]) (await cli("archive", t, "--why", "test fixture"));
  });
  test("refuses a scope no note has, and names the ones that exist", async () => {
    expect((await cli("write", note("In Scope Aleph"), "--why", "x")).code).toBe(0);
    const r = (await cli("rename-scope", "voyce-bridge", "sidetone"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no note has scope voyce-bridge");
    expect(r.stderr).toContain("aleph");
  });
});

describe("adopt", () => {
  test("commits an in-vault draft, forgiving the template but not the schema", async () => {
    // The CLI test of this op: it spawns `bun jobs/cli.ts memory`.
    const rel = "wiki/decisions/Drafted In Place.md";
    const p = join(vault, rel);
    // A real note with real sources, in the looser body shape: no `as of`
    // marker and no ## Evidence, which is what `write` refuses.
    writeFileSync(p, ["---", "aliases: []", "kind: decision", "scope: aleph",
      "confidence: measured", "updated: 2026-09-26", "supersedes: []",
      "sources: [commit abc1234, session 2026-09-26]", "tags: []", "---",
      "**Claim.** A draft written straight into wiki/ needs a door.", "", "## Details", "d", ""].join("\n"));
    expect((await cli("write", p, "--why", "x")).code).toBe(1);

    const r = (await spawnCli("adopt", p, "--why", "reconcile a note drafted in the vault"));
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ op: "adopt", title: "Drafted In Place", path: rel });
    expect(r.json.template.map((f: any) => f.detail).join(" ")).toContain("as of YYYY-MM-DD");
    expect(gitLog()).toContain("adopt: Drafted In Place");
    expect(gitStatus()).toBe("");
    // The note is untouched: no heading nobody wrote.
    expect(readFileSync(p, "utf8")).not.toContain("## Evidence");
    // And lint no longer calls it untracked.
    expect((await cli("lint")).json.warn.filter((f: any) => f.rule === "untracked")).toEqual([]);
  });
  test("refuses a schema break, a tracked note, and a path outside the vault", async () => {
    const bad = join(vault, "wiki/gotchas/Bad Adopt.md");
    writeFileSync(bad, "---\nkind: gotcha\nscope: aleph\nconfidence: sure\nupdated: 2026-09-26\nsupersedes: []\nsources: []\n---\n**Claim.** x\n");
    const r = (await cli("adopt", bad, "--why", "x"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("confidence must be one of");
    expect(r.stderr).toContain("adopt forgives the template, not the schema");
    rmSync(bad);

    expect((await cli("write", note("Drafted In Place", { kind: "decision" }), "--why", "x")).code).toBe(0);
    const already = (await cli("adopt", join(vault, "wiki/decisions/Drafted In Place.md"), "--why", "x"));
    expect(already.code).toBe(1);
    expect(already.stderr).toContain("already tracked");

    const outside = (await cli("adopt", note("Outside The Vault"), "--why", "x"));
    expect(outside.code).toBe(1);
    expect(outside.stderr).toContain("outside the vault");
    expect(outside.stderr).toContain("use: aleph memory write");
    (await cli("archive", "Drafted In Place", "--why", "test fixture"));
    expect(gitStatus()).toBe("");
  });
});

describe("relative dates", () => {
  test("lint reports a relative date without rewriting the note", async () => {
    const body = "**Claim.** the run passed yesterday, as of 2026-09-04.\n\n## Details\nd\n\n## Evidence\ne\n\n## Related\n[[Home]]\n";
    (await cli("write", note("Says Yesterday", {}, body), "--why", "x"));
    const r = (await cli("lint"));
    expect(r.json.warn).toContainEqual({ note: "Says Yesterday", rule: "relative-date", detail: 'says "yesterday"; give the date' });
    expect(readFileSync(join(vault, "wiki/gotchas/Says Yesterday.md"), "utf8")).toContain("passed yesterday");
  });

  test("lint ignores a relative word inside inline code", async () => {
    const body = "**Claim.** `today()` returned the wrong day, as of 2026-09-04.\n\n## Details\nd\n\n## Evidence\ne\n\n## Related\n[[Home]]\n";
    (await cli("write", note("Names A Function", {}, body), "--why", "x"));
    const r = (await cli("lint"));
    expect(r.json.warn.filter((w: { note: string }) => w.note === "Names A Function")).toEqual([]);
  });
});

describe("archive", () => {
  test("retires a note with no replacement, drops its Home line, names its callers", async () => {
    // The CLI test of this op: it spawns `bun jobs/cli.ts memory`.
    (await cli("write", note("Retired Subject", { kind: "decision" }), "--why", "x"));
    const home = join(vault, "Home.md");
    expect(readFileSync(home, "utf8")).toContain("- [[Retired Subject]]");
    const body = "**Claim.** a caller, as of 2026-09-04.\n\n## Details\nd\n\n## Evidence\ne\n\n## Related\n[[Retired Subject]]\n";
    (await cli("write", note("Points At The Retired One", {}, body), "--why", "x"));

    const r = (await spawnCli("archive", "Retired Subject", "--why", "the subject is over"));
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ op: "archive", title: "Retired Subject", path: "archive/Retired Subject.md", inbound: ["Points At The Retired One"] });
    expect(existsSync(join(vault, "wiki/decisions/Retired Subject.md"))).toBe(false);
    const archived = readFileSync(join(vault, "archive/Retired Subject.md"), "utf8");
    expect(archived).toContain("archived_reason: the subject is over");
    expect(readFileSync(home, "utf8")).not.toContain("Retired Subject");
    expect(r.stderr).toContain("warn inbound Points At The Retired One");
    // An archived note is still a link target, so its caller does not dangle.
    expect((await cli("lint")).json.refuse.filter((f: any) => f.rule === "dangling")).toEqual([]);
    expect(gitLog()).toContain("archive: Retired Subject");
    expect(gitStatus()).toBe("");
  });
  test("delete removes a note with no caller and commits; a note with a caller is refused", async () => {
    (await cli("write", note("Deleted Outright", { kind: "decision" }), "--why", "x"));
    const body = "**Claim.** a caller, as of 2026-09-04.\n\n## Details\nd\n\n## Evidence\ne\n\n## Related\n[[Kept By A Caller]]\n";
    (await cli("write", note("Kept By A Caller", { kind: "decision" }), "--why", "x"));
    (await cli("write", note("Calls The Kept One", {}, body), "--why", "x"));
    const no = await cli("delete", "Kept By A Caller", "--why", "y");
    expect(no.code).toBe(1);
    expect(no.stderr).toContain("refuse inbound Calls The Kept One");
    expect(existsSync(join(vault, "wiki/decisions/Kept By A Caller.md"))).toBe(true);

    const r = await cli("delete", "Deleted Outright", "--why", "wrong from the start");
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ op: "delete", title: "Deleted Outright", why: "wrong from the start" });
    expect(existsSync(join(vault, "wiki/decisions/Deleted Outright.md"))).toBe(false);
    expect(existsSync(join(vault, "archive/Deleted Outright.md"))).toBe(false);
    expect(readFileSync(join(vault, "Home.md"), "utf8")).not.toContain("Deleted Outright");
    expect((await cli("lint")).json.warn.filter((f: any) => f.note === "Deleted Outright")).toEqual([]);
    expect(gitLog()).toContain("delete: Deleted Outright");
    expect(gitStatus()).toBe("");
  });
  test("delete refuses and archive names a note that a caller links by an alias", async () => {
    const body = (to: string) => `**Claim.** a caller, as of 2026-09-04.\n\n## Details\nd\n\n## Evidence\ne\n\n## Related\n[[${to}]]\n`;
    (await cli("write", note("Known By Alias", { kind: "decision", aliases: "[the alias]" }), "--why", "x"));
    (await cli("write", note("Also Known By Alias", { kind: "decision", aliases: "[other alias]" }), "--why", "x"));
    (await cli("write", note("Calls By Alias", {}, body("the alias")), "--why", "x"));
    (await cli("write", note("Calls Other Alias", {}, body("other alias")), "--why", "x"));
    const no = await cli("delete", "Known By Alias", "--why", "y");
    expect(no.code).toBe(1);
    expect(no.stderr).toMatch(/refuse inbound Calls By Alias/);
    expect(existsSync(join(vault, "wiki/decisions/Known By Alias.md"))).toBe(true);
    const r = await cli("archive", "Also Known By Alias", "--why", "y");
    expect(r.json.inbound).toEqual(["Calls Other Alias"]);
  });
  test("a note deleted by hand is named, and points at archive", async () => {
    (await cli("write", note("Deleted By Hand"), "--why", "x"));
    rmSync(join(vault, "wiki/gotchas/Deleted By Hand.md"));
    const r = (await cli("lint"));
    const w = r.json.warn.find((f: any) => f.rule === "deleted" && f.note === "Deleted By Hand");
    expect(w.detail).toContain("tracked but gone from disk");
    expect(w.detail).toContain('aleph memory archive "Deleted By Hand"');
    // A tracked non-markdown file is not a deleted note.
    expect(r.json.warn.filter((f: any) => f.rule === "deleted").map((f: any) => f.note)).toEqual(["Deleted By Hand"]);
    Bun.spawnSync(["git", "-C", vault, "checkout", "--", "wiki/gotchas/Deleted By Hand.md"]);
    (await cli("archive", "Deleted By Hand", "--why", "test fixture"));
    expect(gitStatus()).toBe("");
  });
  test("a note git has never seen is named, and points at write", async () => {
    const p = join(vault, "wiki/gotchas/Never Written.md");
    writeFileSync(p, readFileSync(note("Never Written"), "utf8"));
    const w = (await cli("lint")).json.warn.find((f: any) => f.rule === "untracked" && f.note === "Never Written");
    expect(w.detail).toContain("git has never seen it");
    expect(w.detail).toContain('aleph memory write "wiki/gotchas/Never Written.md"');
    // Putting it through the gate clears the warning.
    expect((await cli("write", p, "--why", "reconciled")).code).toBe(0);
    expect((await cli("lint")).json.warn.filter((f: any) => f.rule === "untracked")).toEqual([]);
    (await cli("archive", "Never Written", "--why", "test fixture"));
    expect(gitStatus()).toBe("");
  });
  test("refuses a title no live note has", async () => {
    const r = (await cli("archive", "Never Existed", "--why", "x"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no live wiki note has that title");
  });
});

describe("health", () => {
  test("the line carries the stale count, so a closing window is in context", async () => {
    const staleCount = async () => {
      (await cli("lint"));
      const line = readFileSync(join(vault, "Home.md"), "utf8").trim().split("\n").at(-1)!;
      return Number(/, (\d+) stale, lint /.exec(line)![1]);
    };
    const before = await staleCount();
    (await cli("write", note("Long Past Its Window", { confidence: "inferred", updated: "2026-01-01" }), "--why", "x"));
    expect(await staleCount()).toBe(before + 1);
    (await cli("recall", "long past its window"));
    expect(await staleCount()).toBe(before);
  });
});

describe("decay", () => {
  test("the window is per kind and confidence, and a recall resets it", async () => {
    // One date, two verdicts: past a gotcha/inferred window of 30 days, inside a
    // decision/measured window of 270. Relative to today, because a fixed date
    // crosses the wider window as the calendar moves and the test then fails on
    // a day nobody changed anything (2026-01-01 aged out on 2026-09-29).
    const day = new Date(NOW - 100 * 86400_000).toISOString().slice(0, 10);
    // gotcha 60 days x inferred 0.5 = a 30-day window.
    (await cli("write", note("Rots Fast", { confidence: "inferred", updated: day }), "--why", "x"));
    // decision 180 days x measured 1.5 = 270 days, so the same date is fresh.
    (await cli("write", note("Ages Well", { kind: "decision", confidence: "measured", updated: day }), "--why", "x"));
    const stale = (r: any) => r.json.warn.filter((w: any) => w.rule === "stale").map((w: any) => w.note);
    const before = (await cli("lint"));
    expect(stale(before)).toContain("Rots Fast");
    expect(stale(before)).not.toContain("Ages Well");
    expect(before.json.warn.find((w: any) => w.note === "Rots Fast" && w.rule === "stale").detail)
      .toContain("gotcha/inferred wants a re-check every 30 days");

    (await cli("recall", "rots fast"));
    expect(stale((await cli("lint")))).not.toContain("Rots Fast");
    expect(existsSync(join(vault, ".recall.json"))).toBe(true);
    expect(gitStatus()).toBe("");
  });
});

describe("recall", () => {
  test("a logged recall adds one entry per returned note, drops entries over 30 days, and --unlogged adds none", async () => {
    const file = join(vault, ".recall-log.jsonl");
    const lines = () => readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    (await cli("write", note("Log Probe"), "--why", "x"));
    writeFileSync(file, JSON.stringify({ date: "2000-01-01", title: "Ancient", query: "old" }) + "\n");
    await run({ ALEPH_VAULT: vault, CLAUDE_CODE_SESSION_ID: "sess-1" }, "recall", "log probe");
    await run({ ALEPH_VAULT: vault, CLAUDE_CODE_SESSION_ID: "" }, "recall", "probe");
    const day = JSON.parse(readFileSync(join(vault, ".recall.json"), "utf8"))["Log Probe"];
    expect(day).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(lines()).toEqual([{ date: day, title: "Log Probe", query: "log probe", session: "sess-1", source: "cli" }, { date: day, title: "Log Probe", query: "probe", session: null, source: "cli" }]);
    await run({ ALEPH_VAULT: vault, CLAUDE_CODE_SESSION_ID: "sess-1" }, "recall", "log probe", "--unlogged");
    expect(lines()).toHaveLength(2);
  });
  test("ranks title, alias, contains, body; empty list otherwise", async () => {
    // The CLI test of this op: it spawns `bun jobs/cli.ts memory`.
    (await cli("write", note("Verify Gate", { aliases: "[stop gate]" }, "**Claim.** judged at Stop, as of 2026-09-04.\n\n## Details\nnested claude -p haiku\n\n## Evidence\n\n## Related\n[[Home]]\n"), "--why", "x"));
    expect((await spawnCli("recall", "verify gate")).json[0]).toMatchObject({ title: "Verify Gate", rank: 0 });
    expect((await cli("recall", "stop gate")).json[0]).toMatchObject({ title: "Verify Gate", rank: 1 });
    expect((await cli("recall", "gate")).json[0]).toMatchObject({ title: "Verify Gate", rank: 2 });
    expect((await cli("recall", "haiku")).json[0]).toMatchObject({ title: "Verify Gate", rank: 3, path: "wiki/gotchas/Verify Gate.md" });
    expect((await cli("recall", "haiku")).json[0].frontmatter.kind).toBe("gotcha");
    const none = (await cli("recall", "zzz-nothing"));
    expect(none.code).toBe(0);
    expect(none.json).toEqual([]);
  });
  test("--episodes searches only the episode pages, keeps the next word in the query, and --scope filters them", async () => {
    const factory = join(base, "factory");
    mkdirSync(join(factory, "episodes"), { recursive: true });
    writeFileSync(join(factory, "episodes", "aleph-1 Zebra.md"), "---\nkind: episode\nscope: aleph\nupdated: 2026-11-04\n---\n\nThe zebraquill page.\n");
    (await cli("write", note("Verify Gate"), "--why", "x"));
    const env = { ALEPH_VAULT: vault, ALEPH_FACTORY_DIR: factory };
    const hit = (await run(env, "recall", "--episodes", "zebraquill")).json;
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ title: "aleph-1 Zebra", scope: "aleph", rank: 3, path: join(factory, "episodes", "aleph-1 Zebra.md") });
    expect(hit[0].frontmatter.kind).toBe("episode");
    const use = readFileSync(join(factory, "episode-use.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(use.map(({ title, event, query }) => ({ title, event, query }))).toEqual([{ title: "aleph-1 Zebra", event: "shown", query: "zebraquill" }]);
    expect((await run(env, "recall", "zebraquill")).json).toEqual([]);
    expect((await run(env, "recall", "--episodes", "verify", "gate")).json).toEqual([]);
    expect((await run(env, "recall", "--episodes", "zebraquill", "--scope", "beamline")).json).toEqual([]);
    expect((await run(env, "recall", "--episodes", "zebraquill", "--scope", "aleph")).json).toHaveLength(1);
  });
  test("a query returns the top 10 matches, and --scope alone lists every note", async () => {
    const factory = join(base, "factory");
    mkdirSync(join(factory, "episodes"), { recursive: true });
    mkdirSync(join(vault, "wiki", "gotchas"), { recursive: true });
    for (let i = 0; i < 12; i++) {
      writeFileSync(join(factory, "episodes", `aleph-${i} Page.md`), `---\nkind: episode\nscope: aleph\nupdated: 2026-11-04\n---\n\nThe quokkaflux page.\n`);
      writeFileSync(join(vault, "wiki", "gotchas", `Quokka ${i}.md`), readFileSync(note(`Quokka ${i}`), "utf8"));
    }
    const env = { ALEPH_VAULT: vault, ALEPH_FACTORY_DIR: factory };
    expect((await run(env, "recall", "--episodes", "quokkaflux")).json).toHaveLength(10);
    expect((await run(env, "recall", "quokka")).json).toHaveLength(10);
    expect((await run(env, "recall", "--episodes", "--scope", "aleph")).json).toHaveLength(12);
  });
  test("--scope narrows the search, and alone it lists the scope", async () => {
    (await cli("write", note("Scoped To Beamline", { scope: "beamline" }), "--why", "x"));
    (await cli("write", note("Also Beamline", { scope: "beamline" }), "--why", "x"));
    (await cli("write", note("Outside Beamline"), "--why", "x"));
    const all = (await cli("recall", "--scope", "beamline"));
    expect(all.json.map((h: any) => h.title).sort()).toEqual(["Also Beamline", "Scoped To Beamline"]);
    expect(all.json.every((h: any) => h.scope === "beamline")).toBe(true);
    // The same query, narrowed and not: every fixture body says "does a thing".
    const wide = (await cli("recall", "does a thing")).json.length;
    const narrow = (await cli("recall", "does a thing", "--scope", "beamline")).json;
    expect(wide).toBeGreaterThan(narrow.length);
    expect(narrow.map((h: any) => h.title).sort()).toEqual(["Also Beamline", "Scoped To Beamline"]);
    expect((await cli("recall", "also", "--scope", "beamline")).json.map((h: any) => h.title)).toEqual(["Also Beamline"]);
    expect((await cli("recall", "also", "--scope", "aleph")).json).toEqual([]);
  });
  test("an unknown scope names the ones that exist", async () => {
    (await cli("write", note("Scoped To Beamline", { scope: "beamline" }), "--why", "x"));
    const r = (await cli("recall", "--scope", "beemline"));
    expect(r.code).toBe(0);
    expect(r.json).toEqual([]);
    expect(r.stderr).toContain("no note has scope beemline");
    expect(r.stderr).toContain("beamline");
  });
});

describe("compile", () => {
  let server: ReturnType<typeof Bun.serve>;
  let failing: ReturnType<typeof Bun.serve>;
  const trace = {
    id: "t1", name: "aleph", metadata: { cwd: "/home/x/aleph" },
    observations: [
      { id: "turn1", type: "AGENT", name: "turn", input: "fix the gate", output: "Done. Ran bun test, 12 pass.", startTime: "2026-09-04T10:00:00Z" },
      { id: "b1", type: "TOOL", name: "Bash", parentObservationId: "turn1", input: { command: "bun test" } },
      { id: "g1", type: "GUARDRAIL", name: "verify-gate", parentObservationId: "turn1", metadata: { verdict: "pass", reason: "backed by bun test" } },
    ],
  };
  beforeAll(() => {
    server = Bun.serve({ port: 0, fetch: (req) => {
      const u = new URL(req.url);
      if (u.pathname === "/api/public/traces") return Response.json({ data: [{ id: "t1" }], meta: { page: 1, totalPages: 1, totalItems: 1 } });
      if (u.pathname === "/api/public/traces/t1") return Response.json(trace);
      return new Response("nope", { status: 404 });
    } });
    failing = Bun.serve({ port: 0, fetch: () => new Response("down", { status: 503 }) });
  });
  beforeEach(() => {
    mkdirSync(join(base, "handoffs"), { recursive: true });
    writeFileSync(join(base, "handoffs", "2026-09-04-101001.md"), "# Handoff\n\nIntent: vault.\n");
    writeFileSync(join(vault, "daily", "2026-09-04.md"), "# 2026-09-04\n\n- 10:00 wrote Verify Gate\n");
  });
  afterAll(() => { server.stop(); failing.stop(); });
  const env = (port: number | undefined) => ({ ALEPH_VAULT: vault, LANGFUSE_BASE_URL: `http://127.0.0.1:${port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" });

  test("digests turns, handoffs, daily note and cited traces", async () => {
    // The CLI test of this op: it spawns `bun jobs/cli.ts memory`.
    expect((await cli("write", note("Cites A Trace"), "--why", "x")).code).toBe(0);
    const r = await spawnRun(env(server.port), "compile", "2026-09-04");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("### trace t1 (/home/x/aleph)");
    expect(r.stdout).toContain("- prompt: fix the gate");
    expect(r.stdout).toContain("ran: bun test");
    expect(r.stdout).toContain("verify: pass backed by bun test");
    expect(r.stdout).toContain("final: Done. Ran bun test, 12 pass.");
    expect(r.stdout).toContain("### 2026-09-04-101001.md");
    expect(r.stdout).toContain("- trace:abc123");
    expect(r.stdout).toContain("## Daily note\n\n# 2026-09-04\n\n- 10:00 wrote Verify Gate");
  });
  test("Langfuse down: still prints handoffs and daily, notes the failure, exit 0", async () => {
    const r = await runAsync(env(failing.port), "compile", "2026-09-04");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Langfuse failed: 503");
    expect(r.stdout).toContain("### 2026-09-04-101001.md");
  });
  test("records each compiled day once", async () => {
    await runAsync(env(failing.port), "compile", "2026-09-04");
    await runAsync(env(failing.port), "compile", "2026-09-04");
    await runAsync(env(failing.port), "compile", "2026-09-05");
    expect(JSON.parse(readFileSync(join(vault, ".index/compiled.json"), "utf8"))).toEqual(["2026-09-04", "2026-09-05"]);
    expect(gitStatus()).not.toContain("compiled.json");
  });
  test("symlinked vault: reads handoffs beside the link, not beside its target", async () => {
    const home = mkdtempSync(join(tmpdir(), "aleph-home-"));
    symlinkSync(vault, join(home, "vault"));
    mkdirSync(join(home, "handoffs"));
    writeFileSync(join(home, "handoffs", "2026-09-04-120000-current.md"), "# Handoff\n");
    const r = await runAsync({ ...env(failing.port), ALEPH_VAULT: join(home, "vault") }, "compile", "2026-09-04");
    rmSync(home, { recursive: true });
    expect(r.stdout).toContain("### 2026-09-04-120000-current.md");
  });
});

describe("misses", () => {
  let server: ReturnType<typeof Bun.serve>;
  const ago = (d: number) => new Date(NOW - d * 86400_000).toISOString();
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
  test("without --days the window is 7 days; a wide window counts older calls", async () => {
    expect(JSON.parse((await runAsync(env(), "misses")).stdout).recalls).toBe(7);
    const wide = JSON.parse((await runAsync(env(), "misses", "--days", "60")).stdout);
    expect(wide.recalls).toBe(8);
    expect(wide.hook.runs).toBe(4);
  });
  test("recallQuery takes cli.ts and vault recall as a command word only", async () => {
    expect(recallQuery('bun ~/.claude/skills/aleph/vault/cli.ts recall "x"')).toBe("x");
    expect(recallQuery('cd v && bun cli.ts recall "y z" --scope aleph | head')).toBe("y z");
    expect(recallQuery("vault recall --episodes a b")).toBe("a b");
    expect(recallQuery('aleph memory recall "x" --scope aleph')).toBe("x");
    expect(recallQuery("aleph memory lint")).toBeNull();
    expect(recallQuery('grep "cli.ts recall" f')).toBeNull();
    expect(recallQuery("cat <<EOF\nvault recall q\nEOF")).toBeNull();
  });
});

describe("provenance and the contradiction screen", () => {
  let v: string;
  let server: ReturnType<typeof Bun.serve>;
  let asked: any[];
  let answer: number;
  let factory: string;
  const events = () => { const d = join(factory, "events"); return existsSync(d) ? readdirSync(d).flatMap((f) => readFileSync(join(d, f), "utf8").split("\n").filter(Boolean)) : []; };
  const env = (extra: Record<string, string> = {}) => ({ ALEPH_FACTORY_DIR: factory, ALEPH_VAULT: v, ALEPH_JUDGE: "jev", ALEPH_JEV_URL: `http://127.0.0.1:${server.port}/`, OPENROUTER_API_KEY: "k", CLAUDE_CODE_SESSION_ID: "", ...extra });
  const snapshot = () => Bun.spawnSync(["bash", "-c", `cd ${v} && find . -path ./.git -prune -o -type f -print | sort | xargs cat | sha256sum`], { stdout: "pipe" }).stdout.toString();
  const write = (path: string, extra: Record<string, string> = {}) => runAsync(env(extra), "write", path, "--why", "t");

  // One vault for the describe: each test writes notes of its own titles and reads only those.
  beforeAll(async () => {
    v = join(mkdtempSync(join(tmpdir(), "aleph-vault-screen-")), "vault");
    factory = join(v, "..", "factory");
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
  afterAll(() => { server.stop(true); rmSync(join(v, ".."), { recursive: true, force: true }); });
  const reset = (a = 0.9) => { asked = []; answer = a; };
  // Titles share "widget" and nothing else with the other tests' notes.
  const live = async (title: string) => { const r = await write(note(title, { scope: "screen" }), { ALEPH_JUDGE: "haiku" }); expect(r.code).toBe(0); };
  test("consistent_with writes at p 0.9 and the server is not asked about that note", async () => {
    await live("Cog Pipeline");
    reset(0.9);
    const r = await write(note("Cog Pipeline Agreement", { scope: "screen", consistent_with: "[Cog Pipeline]" }));
    expect(r.code).toBe(0);
    expect(JSON.stringify(asked)).not.toContain("`Cog Pipeline`");
  });
  test("consistent_with naming no live note is refused and changes nothing", async () => {
    reset(0.9);
    const before = snapshot();
    const r = await write(note("Widget Registry Other", { scope: "screen", consistent_with: "[No Such Note]" }));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("No Such Note");
    expect(snapshot()).toBe(before);
  });
  test("a dead Jev writes with a warning", async () => {
    await live("Sprocket Ledger");
    reset(0.9);
    const r = await write(note("Sprocket Ledger Rules", { scope: "screen" }), { ALEPH_JEV_URL: "http://127.0.0.1:1/" });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("warn contradiction");
    expect(events()).toEqual([]);
  });
  test("a refusal at p 0.9 logs one event naming both titles and changes nothing, even when the log fails; p 0.1 logs none", async () => {
    await live("Gear Housing");
    reset(0.1);
    const ok = await write(note("Gear Housing Notes", { scope: "screen" }));
    expect(ok.code).toBe(0);
    expect(events()).toEqual([]);
    reset(0.9);
    const before = snapshot();
    const r = await write(note("Gear Housing Claims", { scope: "screen" }));
    expect(r.code).toBe(1);
    expect(snapshot()).toBe(before);
    const lines = events();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Gear Housing Claims");
    expect(JSON.parse(lines[0]).on).toContain("Gear Housing");
    // An event log that cannot be written still leaves the refusal in force.
    const blocked = join(v, "..", "not-a-folder");
    writeFileSync(blocked, "");
    const r2 = await write(note("Gear Housing Claims", { scope: "screen" }), { ALEPH_FACTORY_DIR: blocked });
    expect(r2.code).toBe(1);
    expect(r2.stderr).toContain("may contradict [Gear Housing]");
    expect(snapshot()).toBe(before);
  });
});

describe("docs/vault.md", () => {
  test("each command in its Commands table is in the CLI's usage line", async () => {
    const doc = readFileSync(join(import.meta.dir, "..", "..", "docs", "vault.md"), "utf8");
    const table = doc.split("## Commands")[1].split("\n## ")[0];
    const commands = table.split("\n").filter((l) => /^\| `/.test(l)).map((l) => l.match(/^\| `([\w-]+)/)![1]);
    expect(commands).toContain("init");
    const usage = (await run({ ALEPH_VAULT: vault }, "no-such-command")).stderr;
    const listed = usage.replace(/^usage: aleph memory </, "").replace(/>\s*$/, "").split("|").map((s) => s.trim().split(" ")[0]);
    for (const c of commands) expect(listed).toContain(c);
  });
});

describe("maintain", () => {
  let handoffs: string, backups: string;
  const env = () => ({ ALEPH_VAULT: vault, ALEPH_HANDOFFS_DIR: handoffs, ALEPH_BACKUPS_DIR: backups, ALEPH_FACTORY_DIR: join(base, "factory") });
  const put = (path: string, text = "x") => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, text); };
  const day = (n: number) => new Date(NOW - n * 86400_000).toISOString().slice(0, 10);
  beforeEach(async () => {
    handoffs = join(base, "handoffs");
    backups = join(base, "backups");
    // Langfuse is unreachable, so the misses queue is left out.
    use({ observations: async () => { throw new Error("down"); } } as any);
    expect((await cli("write", note("Core Twice", { core: "Terse [[UI Text]] [[UI Text]] always" }, undefined), "--why", "x")).code).toBe(0);
    put(join(handoffs, `${day(40)}-101010-old.md`));
    put(join(handoffs, `${day(41)}-101010-not-compiled.md`));
    put(join(handoffs, `${day(5)}-101010-recent.md`));
    put(join(vault, "daily", `${day(40)}.md`), "# d\n");
    put(join(vault, "daily", `${day(41)}.md`), "# d\n");
    put(join(vault, ".index/compiled.json"), JSON.stringify([day(40)]));
  });
  afterEach(() => use(null));

  test("--dry reports every step and changes nothing", async () => {
    const before = gitStatus();
    const r = await run(env(), "maintain", "--dry");
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ op: "maintain", dry: true, ok: true, handoffs: [`${day(40)}-101010-old.md`], counts: { core: 1, handoffs: 1 } });
    expect(r.json.core.fixed[0]).toMatchObject({ note: "Core Twice", now: "Terse [[UI Text]] always" });
    expect(r.json.queues.misses).toBeUndefined();
    expect(readdirSync(handoffs).length).toBe(3);
    expect(readFileSync(join(vault, "wiki/gotchas/Core Twice.md"), "utf8")).toContain("[[UI Text]] [[UI Text]]");
    expect(gitStatus()).toBe(before);
    expect(JSON.parse(readFileSync(join(vault, ".index/runs/maintain.json"), "utf8")).result).toBe("ok");
  });
  test("--dry caps the overlap queue at 10 and counts them all", async () => {
    for (const n of ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]) put(join(vault, "wiki/gotchas", `Shared Gear ${n}.md`), readFileSync(note(`Shared Gear ${n}`), "utf8"));
    const r = await run(env(), "maintain", "--dry");
    expect(r.code).toBe(0);
    expect(r.json.queues.overlap.length).toBe(10);
    expect(r.json.counts.overlap).toBe(15);
  });
  test("moves the old compiled handoff, fixes the core line, commits", async () => {
    const r = await run(env(), "maintain");
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ dry: false, ok: true, counts: { core: 1, handoffs: 1 } });
    const out = join(backups, "maintain", readdirSync(join(backups, "maintain"))[0]);
    expect(readdirSync(join(out, "handoffs"))).toEqual([`${day(40)}-101010-old.md`]);
    expect(readdirSync(handoffs).sort()).toEqual([`${day(41)}-101010-not-compiled.md`, `${day(5)}-101010-recent.md`]);
    expect(readFileSync(join(vault, "wiki/gotchas/Core Twice.md"), "utf8")).toContain("core: Terse [[UI Text]] always");
    expect(gitLog()).toContain("maintain core: 1 notes");
    expect(readFileSync(join(vault, "Home.md"), "utf8")).not.toContain("[[UI Text]] [[UI Text]]");
  });

  describe("episode pages", () => {
    const pages = () => join(base, "factory", "episodes");
    beforeEach(() => {
      const lines = (title: string, event: string, n: number) => Array.from({ length: n }, () => JSON.stringify({ date: day(1), title, event, session: null }) + "\n").join("");
      for (const t of ["aleph-1 A", "aleph-2 B", "aleph-3 C"]) put(join(pages(), `${t}.md`), "---\nkind: episode\n---\n");
      put(join(base, "factory", "episode-use.jsonl"), lines("aleph-1 A", "shown", 8) + lines("aleph-2 B", "shown", 8) + lines("aleph-2 B", "opened", 1) + lines("aleph-3 C", "shown", 7));
    });
    test("moves the page shown 8 times and never opened, and no other", async () => {
      const r = await run(env(), "maintain");
      expect(r.json).toMatchObject({ episodes: ["aleph-1 A"], counts: { episodes: 1 } });
      expect(readdirSync(join(backups, "maintain", readdirSync(join(backups, "maintain"))[0], "episodes"))).toEqual(["aleph-1 A.md"]);
      expect(readdirSync(pages()).sort()).toEqual(["aleph-2 B.md", "aleph-3 C.md"]);
    });
    test("--dry reports the same page and moves none", async () => {
      const r = await run(env(), "maintain", "--dry");
      expect(r.json).toMatchObject({ episodes: ["aleph-1 A"], counts: { episodes: 1 } });
      expect(readdirSync(pages()).sort()).toEqual(["aleph-1 A.md", "aleph-2 B.md", "aleph-3 C.md"]);
    });
  });
});
