import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const fm = { kind: "gotcha", scope: "aleph-next", confidence: "measured", updated: "2026-09-04", supersedes: "[]", sources: "[trace:abc123]", ...over };
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
    expect(readFileSync(join(vault, "Home.md"), "utf8").trim().split("\n").at(-1)).toMatch(/^Health: 0 notes, 0 dangling, 0 orphans, lint \d{4}-\d{2}-\d{2}$/);
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
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(readFileSync(join(vault, "daily", `${date}.md`), "utf8")).toMatch(/^- \d\d:\d\d write \[\[Stop Hook Block Shape\]\] — measured three shapes$/m);
    expect(readFileSync(join(vault, "Home.md"), "utf8").trim().split("\n").at(-1)).toBe(`Health: 1 notes, 0 dangling, 1 orphans, lint ${date}`);
    const log = gitLog();
    expect(log).toContain("write: Stop Hook Block Shape");
    expect(log).toContain("Co-Authored-By: Claude");
    expect(gitStatus()).toBe("");
    expect(r.stderr).toContain("warn orphan");
  });
  test("a decision goes to wiki/decisions", () => {
    const r = cli("write", note("No API Judge", { kind: "decision" }), "--why", "subscription only");
    expect(r.json.path).toBe("wiki/decisions/No API Judge.md");
  });
  test("two writes are two commits", () => {
    expect(gitLog().split("\n").filter((l) => l.startsWith("write: ")).length).toBe(2);
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
    expect(readFileSync(home, "utf8").trim().split("\n").at(-1)).toMatch(/orphans, lint/);
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
    expect(readFileSync(join(vault, "Home.md"), "utf8").trim().split("\n").at(-1)).toMatch(/^Health: \d+ notes, 0 dangling, \d+ orphans, lint \d{4}-\d{2}-\d{2}$/);
  });
  test("warns on stale measured and same-scope overlap; exit 1 on a hand-made structural break", () => {
    cli("write", note("Langfuse Ingestion Drops Batches", { updated: "2026-01-01" }), "--why", "x");
    cli("write", note("Langfuse Ingestion Needs Version Header"), "--why", "x");
    const r = cli("lint");
    const find = (rule: string) => r.json.warn.filter((w: any) => w.rule === rule);
    expect(find("stale").map((w: any) => w.note)).toContain("Langfuse Ingestion Drops Batches");
    expect(find("overlap")[0].detail).toContain("neither supersedes the other");
    const broken = join(vault, "wiki/gotchas/Hand Edited.md");
    writeFileSync(broken, "no frontmatter\n");
    const bad = cli("lint");
    expect(bad.code).toBe(1);
    expect(bad.json.refuse).toContainEqual({ note: "Hand Edited", rule: "schema", detail: "no frontmatter" });
    rmSync(broken);
    cli("lint");
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
});

describe("compile", () => {
  let server: ReturnType<typeof Bun.serve>;
  let failing: ReturnType<typeof Bun.serve>;
  const trace = {
    id: "t1", name: "aleph-next", metadata: { cwd: "/home/x/aleph-next" },
    observations: [
      { id: "turn1", type: "AGENT", name: "turn", output: "Done. Ran bun test, 12 pass.", startTime: "2026-09-04T10:00:00Z" },
      { id: "p1", type: "EVENT", name: "prompt", parentObservationId: "turn1", input: "fix the gate" },
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
  });
  afterAll(() => { server.stop(); failing.stop(); });
  const env = (port: number) => ({ ALEPH_VAULT: vault, LANGFUSE_BASE_URL: `http://127.0.0.1:${port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" });

  test("digests turns, handoffs, daily note and cited traces", async () => {
    const r = await runAsync(env(server.port), "compile", "2026-09-04");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("### trace t1 (/home/x/aleph-next)");
    expect(r.stdout).toContain("- prompt: fix the gate");
    expect(r.stdout).toContain("ran: bun test");
    expect(r.stdout).toContain("verify: pass backed by bun test");
    expect(r.stdout).toContain("final: Done. Ran bun test, 12 pass.");
    expect(r.stdout).toContain("### 2026-09-04-101001.md");
    expect(r.stdout).toContain("- trace:abc123");
    expect(r.stdout).toMatch(/## Daily note\n\n# \d{4}-\d{2}-\d{2}/);
  });
  test("Langfuse down: still prints handoffs and daily, notes the failure, exit 0", async () => {
    const r = await runAsync(env(failing.port), "compile", "2026-09-04");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Langfuse failed: 503");
    expect(r.stdout).toContain("### 2026-09-04-101001.md");
  });
});
