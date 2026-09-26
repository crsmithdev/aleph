import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "cli.ts");
let base: string;
let vault: string;
let drafts: string;

const testEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
async function runAsync(env: Record<string, string>, ...args: string[]) {
  const p = Bun.spawn(["bun", CLI, ...args], { env: { ...process.env, ...testEnv, ...env }, stdout: "pipe", stderr: "pipe" });
  const code = await p.exited;
  return { code, stdout: await new Response(p.stdout).text(), stderr: await new Response(p.stderr).text() };
}
function run(env: Record<string, string>, ...args: string[]) {
  const p = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", ...env }, stdout: "pipe", stderr: "pipe" });
  const stdout = p.stdout.toString();
  let json: any = null;
  try { json = JSON.parse(stdout); } catch {}
  return { code: p.exitCode, stdout, stderr: p.stderr.toString(), json };
}
const cli = (...args: string[]) => run({ ALEPH_VAULT: vault }, ...args);
const gitLog = () => Bun.spawnSync(["git", "-C", vault, "log", "--format=%s%n%b"], { stdout: "pipe" }).stdout.toString();
const gitStatus = () => Bun.spawnSync(["git", "-C", vault, "status", "--porcelain"], { stdout: "pipe" }).stdout.toString().trim();

function note(title: string, over: Record<string, string> = {}, body?: string): string {
  const fm = { kind: "gotcha", scope: "aleph", confidence: "measured", updated: "2026-09-04", supersedes: "[]", sources: "[trace:abc123]", ...over };
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

describe("init", () => {
  test("lays down the layout, config and first commit", () => {
    const r = cli("init");
    expect(r.code).toBe(0);
    expect(r.json.commit).toMatch(/^[0-9a-f]{7,}$/);
    for (const p of ["VAULT.md", "Home.md", "MEMORY.md", "wiki/decisions", "wiki/concepts", "wiki/entities", "wiki/projects", "wiki/gotchas", "daily", "archive", "attachments", ".obsidian/daily-notes.json", ".gitignore"]) expect(existsSync(join(vault, p))).toBe(true);
    const daily = JSON.parse(readFileSync(join(vault, ".obsidian/daily-notes.json"), "utf8"));
    expect(daily).toEqual({ folder: "daily", format: "YYYY-MM-DD" });
    expect(JSON.parse(readFileSync(join(vault, ".obsidian/app.json"), "utf8")).attachmentFolderPath).toBe("attachments");
    expect(readFileSync(join(vault, ".gitignore"), "utf8")).toContain("workspace*.json");
    expect(Bun.spawnSync(["git", "-C", vault, "remote"], { stdout: "pipe" }).stdout.toString().trim()).toBe("");
    expect(readFileSync(join(vault, "Home.md"), "utf8").trim().split("\n").at(-1)).toMatch(/^Health: 0 notes, 0 dangling, 0 orphans, 0 stale, lint \d{4}-\d{2}-\d{2}$/);
  });
  test("refuses a second init", () => {
    expect(cli("init").code).toBe(1);
  });
  test("other commands refuse without a vault", () => {
    expect(run({ ALEPH_VAULT: join(base, "nowhere") }, "lint").code).toBe(1);
  });
});

describe("write", () => {
  test("files by kind, logs the day, sets health, commits with the trailer", () => {
    const r = cli("write", note("Stop Hook Block Shape"), "--why", "measured three shapes");
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ op: "write", title: "Stop Hook Block Shape", path: "wiki/gotchas/Stop Hook Block Shape.md", archived: [] });
    expect(existsSync(join(vault, "wiki/gotchas/Stop Hook Block Shape.md"))).toBe(true);
    // The test process can run in UTC while the CLI child runs in local time, so ask a child for the date.
    const date = Bun.spawnSync(["date", "+%F"], { stdout: "pipe" }).stdout.toString().trim();
    expect(readFileSync(join(vault, "daily", `${date}.md`), "utf8")).toMatch(/^- \d\d:\d\d write \[\[Stop Hook Block Shape\]\] — measured three shapes$/m);
    expect(readFileSync(join(vault, "Home.md"), "utf8").trim().split("\n").at(-1)).toBe(`Health: 1 notes, 0 dangling, 0 orphans, 0 stale, lint ${date}`);
    const log = gitLog();
    expect(log).toContain("write: Stop Hook Block Shape");
    expect(log).toContain("Co-Authored-By: Claude");
    expect(gitStatus()).toBe("");
    // Home indexes the standing kinds; a gotcha off Home is not an orphan.
    expect(r.stderr).not.toContain("warn orphan");
  });
  test("a decision off Home is an orphan", () => {
    const r = cli("write", note("Orphaned Decision", { kind: "decision" }), "--why", "x");
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("warn orphan Orphaned Decision");
  });
  test("a decision goes to wiki/decisions", () => {
    const r = cli("write", note("No API Judge", { kind: "decision" }), "--why", "subscription only");
    expect(r.json.path).toBe("wiki/decisions/No API Judge.md");
  });
  test("each write is its own commit", () => {
    expect(gitLog().split("\n").filter((l) => l.startsWith("write: ")).length).toBe(3);
  });
  test("refuses a note in the wrong folder", () => {
    mkdirSync(join(vault, "wiki/concepts"), { recursive: true });
    const p = join(vault, "wiki/concepts/Misfiled.md");
    writeFileSync(p, readFileSync(note("Misfiled"), "utf8"));
    const r = cli("write", p, "--why", "x");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("refuse folder");
    expect(r.stderr).toContain("wiki/gotchas/");
    rmSync(p);
  });
  test("refuses schema violations, listing each", () => {
    const r = cli("write", note("Bad Schema", { confidence: "sure", updated: "yesterday", kind: "gotcha", sources: "[]" }), "--why", "x");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("confidence must be one of");
    expect(r.stderr).toContain("updated must be YYYY-MM-DD");
    expect(existsSync(join(vault, "wiki/gotchas/Bad Schema.md"))).toBe(false);
    expect(gitStatus()).toBe("");
  });
  test("refuses a missing required field but not missing aliases or tags", () => {
    const p = note("Missing Scope");
    writeFileSync(p, readFileSync(p, "utf8").replace(/^scope: .*\n/m, ""));
    const r = cli("write", p, "--why", "x");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("missing scope");
    expect(r.stderr).not.toContain("aliases");
  });
  test("refuses a duplicate title or alias", () => {
    const r = cli("write", note("Another Name", { aliases: "[stop hook block shape]" }), "--why", "x");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("refuse duplicate");
    expect(r.stderr).toContain("Stop Hook Block Shape.md");
  });
  test("refuses a dangling link", () => {
    const body = "**Claim.** x as of 2026-09-04.\n\n## Details\n\n## Evidence\n\n## Related\n[[Nowhere]] and [[Also Nowhere|alias]]\n";
    const r = cli("write", note("Dangling", {}, body), "--why", "x");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("[[Nowhere]] resolves to nothing");
    expect(r.stderr).toContain("[[Also Nowhere]] resolves to nothing");
  });
  test("links inside code are not links", () => {
    const body = "**Claim.** x as of 2026-09-04.\n\n## Details\nuse `[[Title]]` and\n```\n[[Fenced]]\n```\n\n## Evidence\n\n## Related\n[[Home]]\n";
    expect(cli("write", note("Code Links", {}, body), "--why", "x").code).toBe(0);
  });
  test("refuses a body without the template", () => {
    const r = cli("write", note("No Template", {}, "Just prose.\n"), "--why", "x");
    expect(r.code).toBe(1);
    for (const s of ["**Claim.**", "as of YYYY-MM-DD", "## Details", "## Evidence", "## Related"]) expect(r.stderr).toContain(s);
  });
  test("refuses VAULT.md", () => {
    const r = cli("write", join(vault, "VAULT.md"), "--why", "x");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("human-owned");
  });
  test("supersedes: archives the old note with reason, logs, commits", () => {
    const r = cli("write", note("Stop Hook Deny Shape", { supersedes: "[Stop Hook Block Shape]" }), "--why", "renamed");
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ op: "supersede", archived: ["Stop Hook Block Shape"] });
    expect(existsSync(join(vault, "wiki/gotchas/Stop Hook Block Shape.md"))).toBe(false);
    const archived = readFileSync(join(vault, "archive/Stop Hook Block Shape.md"), "utf8");
    expect(archived).toMatch(/^archived: \d{4}-\d{2}-\d{2}$/m);
    expect(archived).toContain('archived_reason: "superseded by [[Stop Hook Deny Shape]]"');
    expect(gitLog()).toContain("supersede: Stop Hook Block Shape → Stop Hook Deny Shape");
  });
  test("refuses supersedes of an unknown note", () => {
    const r = cli("write", note("Supersedes Ghost", { supersedes: "[Ghost]" }), "--why", "x");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no live wiki note has that title");
  });
  test("rewriting an existing title updates it in place", () => {
    const r = cli("write", note("Stop Hook Deny Shape", { updated: "2026-09-05" }), "--why", "update");
    expect(r.code).toBe(0);
    expect(readFileSync(join(vault, "wiki/gotchas/Stop Hook Deny Shape.md"), "utf8")).toContain("updated: 2026-09-05");
  });
  test("Home.md: commits a map edit and refuses over budget", () => {
    const home = join(vault, "Home.md");
    const text = readFileSync(home, "utf8").replace("## Gotchas\n", "## Gotchas\n- [[Stop Hook Deny Shape]] — decision:block only\n");
    writeFileSync(home, text);
    const r = cli("write", home, "--why", "map the gotcha");
    expect(r.code).toBe(0);
    expect(gitLog()).toContain("write: Home");
    expect(readFileSync(home, "utf8").trim().split("\n").at(-1)).toMatch(/orphans, \d+ stale, lint/);
    writeFileSync(home, text + "- filler\n".repeat(150));
    const over = cli("write", home, "--why", "too long");
    expect(over.code).toBe(1);
    expect(over.stderr).toMatch(/Home\.md is \d+ lines; the budget is 150/);
    writeFileSync(home, text);
    cli("write", home, "--why", "restore");
  });
  test("MEMORY.md: commits and refuses a dangling link", () => {
    const memory = join(vault, "MEMORY.md");
    const text = readFileSync(memory, "utf8");
    writeFileSync(memory, text + "\n- Chris, Pacific, WSL2. See [[No API Judge]].\n");
    expect(cli("write", memory, "--why", "profile").code).toBe(0);
    writeFileSync(memory, text + "\n[[Ghost]]\n");
    const r = cli("write", memory, "--why", "bad");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("[[Ghost]] resolves to nothing");
    writeFileSync(memory, text);
    cli("write", memory, "--why", "restore");
  });
});

describe("lint", () => {
  test("reports warnings as JSON, exit 0 when nothing refuses, and sets health", () => {
    const r = cli("lint");
    expect(r.json.refuse).toEqual([]);
    expect(r.code).toBe(0);
    const rules = r.json.warn.map((w: any) => w.rule);
    expect(rules).toContain("orphan");
    expect(readFileSync(join(vault, "Home.md"), "utf8").trim().split("\n").at(-1)).toMatch(/^Health: \d+ notes, 0 dangling, \d+ orphans, \d+ stale, lint \d{4}-\d{2}-\d{2}$/);
  });
  test("warns on stale; overlap is opt-in; exit 1 on a hand-made structural break", () => {
    cli("write", note("Langfuse Ingestion Drops Batches", { updated: "2026-01-01" }), "--why", "x");
    cli("write", note("Langfuse Ingestion Needs Version Header"), "--why", "x");
    const r = cli("lint");
    const find = (rule: string) => r.json.warn.filter((w: any) => w.rule === rule);
    expect(find("stale").map((w: any) => w.note)).toContain("Langfuse Ingestion Drops Batches");
    expect(find("overlap")).toEqual([]);
    const on = cli("lint", "--overlap");
    expect(on.json.warn.filter((w: any) => w.rule === "overlap")[0].detail).toContain("neither supersedes the other");
    const broken = join(vault, "wiki/gotchas/Hand Edited.md");
    writeFileSync(broken, "no frontmatter\n");
    const bad = cli("lint");
    expect(bad.code).toBe(1);
    expect(bad.json.refuse).toContainEqual({ note: "Hand Edited", rule: "schema", detail: "no frontmatter" });
    rmSync(broken);
    cli("lint");
  });
});

describe("commit scope", () => {
  test("a stray note in wiki/ does not ride into history on another write", () => {
    const stray = join(vault, "wiki/gotchas/Never Accepted.md");
    writeFileSync(stray, "no frontmatter, never written\n");
    expect(cli("write", note("Scoped Commit Check"), "--why", "x").code).toBe(0);
    expect(gitStatus().replace(/"/g, "")).toBe("?? wiki/gotchas/Never Accepted.md");
    expect(Bun.spawnSync(["git", "-C", vault, "ls-files", "--", "wiki/gotchas/Never Accepted.md"], { stdout: "pipe" }).stdout.toString().trim()).toBe("");
    rmSync(stray);
  });
  test("a refusal names a file in the vault that no write has accepted", () => {
    const p = join(vault, "wiki/gotchas/Half Written.md");
    writeFileSync(p, readFileSync(note("Half Written"), "utf8").replace("## Evidence\n", ""));
    const r = cli("write", p, "--why", "x");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("missing section ## Evidence");
    expect(r.stderr).toContain("no write has accepted it");
    expect(existsSync(p)).toBe(true);
    rmSync(p);
  });
});

describe("lint --fix", () => {
  test("repairs frontmatter, leaves the body, and reports what it cannot judge", () => {
    const p = join(vault, "wiki/gotchas/Needs Repair.md");
    const body = "**Claim.** repairs happen in frontmatter only, as of 2026-09-04.\n\n## Details\nd\n\n## Evidence\n- run\n\n## Related\n[[Home]]\n";
    writeFileSync(p, "---\naliases: one name\nkind: gotcha\nscope: aleph\nconfidence: sure\nupdated: 2026-09-04\nsources: [chris]\n---\n" + body);
    const r = cli("lint", "--fix");
    expect(r.json.fixed).toContainEqual({ note: "Needs Repair", path: "wiki/gotchas/Needs Repair.md", repairs: ["aliases wrapped in a list", "added supersedes: []"] });
    const after = readFileSync(p, "utf8");
    expect(after).toContain("aliases: [one name]");
    expect(after).toContain("supersedes: []");
    expect(after).toContain(body);
    // confidence is a claim about how the fact was learned, so --fix leaves it.
    expect(after).toContain("confidence: sure");
    expect(r.json.refuse).toContainEqual({ note: "Needs Repair", rule: "schema", detail: "confidence must be one of measured|reported|inferred, got sure" });
    expect(gitLog()).toContain("lint --fix: 1 notes");
    cli("archive", "Needs Repair", "--why", "test fixture");
  });
  test("a missing updated comes from the date the note entered git, not its last commit", () => {
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
    const r = cli("lint", "--fix");
    expect(readFileSync(p, "utf8")).toContain("updated: 2026-01-15");
    expect(r.json.fixed.find((f: any) => f.note === "Entered Long Ago").repairs)
      .toEqual(["added updated: 2026-01-15, the date the note entered git"]);
    cli("archive", "Entered Long Ago", "--why", "test fixture");
  });
  test("many template breaks collapse to a count; --template names them", () => {
    const thin = (t: string) => {
      const p = join(vault, `wiki/gotchas/${t}.md`);
      writeFileSync(p, readFileSync(note(t), "utf8").replace(/\*\*Claim\.\*\*[\s\S]*/, "Just prose.\n\n## Details\nd\n"));
      return p;
    };
    const made = ["Thin One", "Thin Two"].map(thin);
    const r = cli("lint");
    const w = r.json.warn.filter((f: any) => f.rule === "template");
    expect(w).toHaveLength(1);
    expect(w[0].note).toBe("2 notes");
    expect(w[0].detail).toContain("lint --template");

    const named = cli("lint", "--template").json.warn.filter((f: any) => f.rule === "template");
    expect(named.map((f: any) => f.note).sort()).toEqual(["Thin One", "Thin Two"]);
    for (const p of made) rmSync(p);
    Bun.spawnSync(["git", "-C", vault, "checkout", "--", "wiki"]);
    for (const t of ["Thin One", "Thin Two"]) cli("archive", t, "--why", "test fixture");
    expect(gitStatus()).toBe("");
  });
  test("a # inside a list is content, and --fix leaves a line it cannot rebuild", () => {
    const r = cli("write", note("Hash In A List", { aliases: "[url scheme, #go]" }), "--why", "x");
    expect(r.code).toBe(0);
    const p = join(vault, "wiki/gotchas/Hash In A List.md");
    expect(readFileSync(p, "utf8")).toContain("aliases: [url scheme, #go]");
    expect(cli("recall", "#go").json[0]).toMatchObject({ title: "Hash In A List", rank: 1 });
    const fix = cli("lint", "--fix");
    expect(fix.json.fixed.map((f: any) => f.note)).not.toContain("Hash In A List");
    expect(readFileSync(p, "utf8")).toContain("aliases: [url scheme, #go]");
  });
  test("a template break warns once per note and does not refuse", () => {
    const p = join(vault, "wiki/gotchas/Thin Body.md");
    writeFileSync(p, readFileSync(note("Thin Body"), "utf8").replace(/\*\*Claim\.\*\*[\s\S]*/, "Just prose.\n\n## Details\nd\n"));
    const r = cli("lint");
    expect(r.json.refuse.filter((f: any) => f.note === "Thin Body")).toEqual([]);
    const w = r.json.warn.filter((f: any) => f.note === "Thin Body" && f.rule === "template");
    expect(w).toHaveLength(1);
    expect(w[0].detail).toContain("**Claim.**");
    expect(w[0].detail).toContain("## Evidence");
    rmSync(p);
    cli("lint");
  });
});

describe("budget", () => {
  test("an over-budget Home refusal ranks the lines to remove", () => {
    const home = join(vault, "Home.md");
    const text = readFileSync(home, "utf8");
    writeFileSync(home, text.replace("## Gotchas\n", "## Gotchas\n- [[Ghost Target]] — points at nothing\n") + "- filler\n".repeat(150));
    const r = cli("write", home, "--why", "too long");
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/Home\.md is \d+ lines; the budget is 150/);
    expect(r.stderr).toContain("ranked for removal");
    expect(r.stderr).toContain("[[Ghost Target]] resolves to nothing");
    writeFileSync(home, text);
    cli("write", home, "--why", "restore");
  });
});

describe("symlinked vault", () => {
  test("a write through the other spelling of the same file does not truncate it", () => {
    // ~/.aleph/vault is a symlink to /mnt/c/Users/crsmi/vault, so one note has
    // two absolute paths. A string compare guarding copyFileSync could not see
    // that, and the copy-onto-itself emptied the file.
    const link = join(base, "vault-link");
    if (!existsSync(link)) symlinkSync(vault, link);
    const r = cli("write", note("Two Paths One File"), "--why", "seed it");
    expect(r.code).toBe(0);
    const real = join(vault, "wiki/gotchas/Two Paths One File.md");
    const before = readFileSync(real, "utf8");
    expect(before.length).toBeGreaterThan(100);

    // Same file, reached through the symlink, written again.
    const viaLink = join(link, "wiki/gotchas/Two Paths One File.md");
    expect(run({ ALEPH_VAULT: vault }, "write", viaLink, "--why", "rewrite in place").code).toBe(0);
    expect(readFileSync(real, "utf8")).toBe(before);

    // And with the vault itself named through the link.
    expect(run({ ALEPH_VAULT: link }, "write", real, "--why", "rewrite the other way").code).toBe(0);
    expect(readFileSync(real, "utf8")).toBe(before);
    cli("archive", "Two Paths One File", "--why", "test fixture");
    expect(gitStatus()).toBe("");
  });
});

describe("consolidate", () => {
  test("read-only by default; --apply drops gotcha and dead lines, keeps the standing kinds", () => {
    const home = join(vault, "Home.md");
    const text = readFileSync(home, "utf8");
    writeFileSync(home, text
      .replace("## Gotchas\n", "## Gotchas\n- [[Stop Hook Deny Shape]] — a gotcha, not a router entry\n- [[Ghost Note]] — points at nothing\n")
      .replace("## Decisions\n", "## Decisions\n- [[No API Judge]] — subscription only\n"));
    const dry = cli("consolidate");
    expect(dry.json.applied).toBe(false);
    const why = dry.json.dropped.map((d: any) => d.why);
    expect(why).toContain("gotchas are not indexed; recall finds them");
    expect(why).toContain("[[Ghost Note]] resolves to nothing");
    expect(dry.stderr).toContain("changed nothing");
    expect(readFileSync(home, "utf8")).toContain("Stop Hook Deny Shape");
    expect(dry.json.missing.map((m: any) => m.title)).toContain("Orphaned Decision");

    const r = cli("consolidate", "--apply");
    expect(r.json.applied).toBe(true);
    const after = readFileSync(home, "utf8");
    expect(after).not.toContain("Stop Hook Deny Shape");
    expect(after).not.toContain("Ghost Note");
    expect(after).toContain("- [[No API Judge]] — subscription only");
    expect(gitLog()).toContain("consolidate: Home");
    expect(gitStatus()).toBe("");
  });
  test("reports a relative date without rewriting the note", () => {
    const body = "**Claim.** the run passed yesterday, as of 2026-09-04.\n\n## Details\nd\n\n## Evidence\ne\n\n## Related\n[[Home]]\n";
    cli("write", note("Says Yesterday", {}, body), "--why", "x");
    const r = cli("consolidate");
    expect(r.json.relativeDates).toContainEqual({ note: "Says Yesterday", rule: "relative-date", detail: 'says "yesterday"; give the date' });
    expect(readFileSync(join(vault, "wiki/gotchas/Says Yesterday.md"), "utf8")).toContain("passed yesterday");
  });
});

describe("archive", () => {
  test("retires a note with no replacement, drops its Home line, names its callers", () => {
    cli("write", note("Retired Subject", { kind: "decision" }), "--why", "x");
    const home = join(vault, "Home.md");
    writeFileSync(home, readFileSync(home, "utf8").replace("## Decisions\n", "## Decisions\n- [[Retired Subject]] — about to go\n"));
    cli("write", home, "--why", "map it");
    const body = "**Claim.** a caller, as of 2026-09-04.\n\n## Details\nd\n\n## Evidence\ne\n\n## Related\n[[Retired Subject]]\n";
    cli("write", note("Points At The Retired One", {}, body), "--why", "x");

    const r = cli("archive", "Retired Subject", "--why", "the subject is over");
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ op: "archive", title: "Retired Subject", path: "archive/Retired Subject.md", inbound: ["Points At The Retired One"] });
    expect(existsSync(join(vault, "wiki/decisions/Retired Subject.md"))).toBe(false);
    const archived = readFileSync(join(vault, "archive/Retired Subject.md"), "utf8");
    expect(archived).toContain("archived_reason: the subject is over");
    expect(readFileSync(home, "utf8")).not.toContain("Retired Subject");
    expect(r.stderr).toContain("warn inbound Points At The Retired One");
    // An archived note is still a link target, so its caller does not dangle.
    expect(cli("lint").json.refuse.filter((f: any) => f.rule === "dangling")).toEqual([]);
    expect(gitLog()).toContain("archive: Retired Subject");
    expect(gitStatus()).toBe("");
  });
  test("a note deleted by hand is named, and points at archive", () => {
    cli("write", note("Deleted By Hand"), "--why", "x");
    rmSync(join(vault, "wiki/gotchas/Deleted By Hand.md"));
    const r = cli("lint");
    const w = r.json.warn.find((f: any) => f.rule === "deleted" && f.note === "Deleted By Hand");
    expect(w.detail).toContain("tracked but gone from disk");
    expect(w.detail).toContain('vault archive "Deleted By Hand"');
    // A tracked non-markdown file is not a deleted note.
    expect(r.json.warn.filter((f: any) => f.rule === "deleted").map((f: any) => f.note)).toEqual(["Deleted By Hand"]);
    Bun.spawnSync(["git", "-C", vault, "checkout", "--", "wiki/gotchas/Deleted By Hand.md"]);
    cli("archive", "Deleted By Hand", "--why", "test fixture");
    expect(gitStatus()).toBe("");
  });
  test("a note git has never seen is named, and points at write", () => {
    const p = join(vault, "wiki/gotchas/Never Written.md");
    writeFileSync(p, readFileSync(note("Never Written"), "utf8"));
    const w = cli("lint").json.warn.find((f: any) => f.rule === "untracked" && f.note === "Never Written");
    expect(w.detail).toContain("git has never seen it");
    expect(w.detail).toContain('vault write "wiki/gotchas/Never Written.md"');
    // Putting it through the gate clears the warning.
    expect(cli("write", p, "--why", "reconciled").code).toBe(0);
    expect(cli("lint").json.warn.filter((f: any) => f.rule === "untracked")).toEqual([]);
    cli("archive", "Never Written", "--why", "test fixture");
    expect(gitStatus()).toBe("");
  });
  test("refuses a title no live note has", () => {
    const r = cli("archive", "Never Existed", "--why", "x");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no live wiki note has that title");
  });
});

describe("health", () => {
  test("the line carries the stale count, so a closing window is in context", () => {
    const staleCount = () => {
      cli("lint");
      const line = readFileSync(join(vault, "Home.md"), "utf8").trim().split("\n").at(-1)!;
      return Number(/, (\d+) stale, lint /.exec(line)![1]);
    };
    const before = staleCount();
    cli("write", note("Long Past Its Window", { confidence: "inferred", updated: "2026-01-01" }), "--why", "x");
    expect(staleCount()).toBe(before + 1);
    cli("recall", "long past its window");
    expect(staleCount()).toBe(before);
  });
});

describe("decay", () => {
  test("the window is per kind and confidence, and a recall resets it", () => {
    // gotcha 60 days x inferred 0.5 = a 30-day window.
    cli("write", note("Rots Fast", { confidence: "inferred", updated: "2026-01-01" }), "--why", "x");
    // decision 180 days x measured 1.5 = 270 days, so the same date is fresh.
    cli("write", note("Ages Well", { kind: "decision", confidence: "measured", updated: "2026-01-01" }), "--why", "x");
    const stale = (r: any) => r.json.warn.filter((w: any) => w.rule === "stale").map((w: any) => w.note);
    const before = cli("lint");
    expect(stale(before)).toContain("Rots Fast");
    expect(stale(before)).not.toContain("Ages Well");
    expect(before.json.warn.find((w: any) => w.note === "Rots Fast" && w.rule === "stale").detail)
      .toContain("gotcha/inferred wants a re-check every 30 days");

    cli("recall", "rots fast");
    expect(stale(cli("lint"))).not.toContain("Rots Fast");
    expect(existsSync(join(vault, ".recall.json"))).toBe(true);
    expect(gitStatus()).toBe("");
  });
});

describe("recall", () => {
  test("ranks title, alias, contains, body; empty list otherwise", () => {
    cli("write", note("Verify Gate", { aliases: "[stop gate]" }, "**Claim.** judged at Stop, as of 2026-09-04.\n\n## Details\nnested claude -p haiku\n\n## Evidence\n\n## Related\n[[Home]]\n"), "--why", "x");
    expect(cli("recall", "verify gate").json[0]).toMatchObject({ title: "Verify Gate", rank: 0 });
    expect(cli("recall", "stop gate").json[0]).toMatchObject({ title: "Verify Gate", rank: 1 });
    expect(cli("recall", "gate").json[0]).toMatchObject({ title: "Verify Gate", rank: 2 });
    expect(cli("recall", "haiku").json[0]).toMatchObject({ title: "Verify Gate", rank: 3, path: "wiki/gotchas/Verify Gate.md" });
    expect(cli("recall", "haiku").json[0].frontmatter.kind).toBe("gotcha");
    const none = cli("recall", "zzz-nothing");
    expect(none.code).toBe(0);
    expect(none.json).toEqual([]);
  });
  test("--scope narrows the search, and alone it lists the scope", () => {
    cli("write", note("Scoped To Beamline", { scope: "beamline" }), "--why", "x");
    cli("write", note("Also Beamline", { scope: "beamline" }), "--why", "x");
    const all = cli("recall", "--scope", "beamline");
    expect(all.json.map((h: any) => h.title).sort()).toEqual(["Also Beamline", "Scoped To Beamline"]);
    expect(all.json.every((h: any) => h.scope === "beamline")).toBe(true);
    // The same query, narrowed and not: every fixture body says "does a thing".
    const wide = cli("recall", "does a thing").json.length;
    const narrow = cli("recall", "does a thing", "--scope", "beamline").json;
    expect(wide).toBeGreaterThan(narrow.length);
    expect(narrow.map((h: any) => h.title).sort()).toEqual(["Also Beamline", "Scoped To Beamline"]);
    expect(cli("recall", "also", "--scope", "beamline").json.map((h: any) => h.title)).toEqual(["Also Beamline"]);
    expect(cli("recall", "also", "--scope", "aleph").json).toEqual([]);
  });
  test("an unknown scope names the ones that exist", () => {
    const r = cli("recall", "--scope", "beemline");
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
    mkdirSync(join(base, "handoffs"), { recursive: true });
    writeFileSync(join(base, "handoffs", "2026-09-04-101001.md"), "# Handoff\n\nIntent: vault.\n");
    writeFileSync(join(vault, "daily", "2026-09-04.md"), "# 2026-09-04\n\n- 10:00 wrote Verify Gate\n");
  });
  afterAll(() => { server.stop(); failing.stop(); });
  const env = (port: number | undefined) => ({ ALEPH_VAULT: vault, LANGFUSE_BASE_URL: `http://127.0.0.1:${port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" });

  test("digests turns, handoffs, daily note and cited traces", async () => {
    const r = await runAsync(env(server.port), "compile", "2026-09-04");
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
});
