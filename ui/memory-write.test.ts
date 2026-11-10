import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer } from "./test-server.ts";
import { withAlias, withCore, withLink, withoutLink } from "./api/memory.ts";
import { updater } from "./updater.ts";

// The Memory page's search and writes against a real vault: `vault init`, then notes through `vault write`.
const CLI = join(import.meta.dir, "..", "vault", "cli.ts");
const day = "2026-11-04";  // write checks only the date format, so a fixed one serves
let base: string, vault: string, hand: string, eps: string, restore: () => void, stop: () => void;
let at: (p: string, init?: RequestInit) => Promise<Response>;
const post = (p: string, b: unknown, headers: Record<string, string> = { "X-Aleph-UI": "1" }) =>
  at(p, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(b) });
const noteAt = (title: string, act = "") => `/api/memory/notes/${encodeURIComponent(title)}${act ? `/${act}` : ""}`;
const fileAt = (source: string, key: string, act = "") => `/api/memory/files/${source}/${encodeURIComponent(key)}${act ? `/${act}` : ""}`;
const noteFile = (kind: string, title: string) => readFileSync(join(vault, "wiki", kind, `${title}.md`), "utf8");
const gitLog = () => Bun.spawnSync(["git", "-C", vault, "log", "--format=%s"], { stdout: "pipe" }).stdout.toString();

function write(title: string, body: string, kind = "gotcha") {
  const f = join(base, `${title}.md`);
  writeFileSync(f, `---\nkind: ${kind}\nscope: aleph\nconfidence: measured\nupdated: ${day}\nsupersedes: []\nsources: [trace:abc123]\n---\n${body}`);
  const p = Bun.spawnSync(["bun", CLI, "write", f, "--why", "fixture"], { env: process.env, stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
}
const body = (claim: string, related = "[[Home]]") => `**Claim.** ${claim}, as of 2026-09-04.\n\n## Details\nd\n\n## Evidence\n- trace abc123\n\n## Related\n${related}\n`;

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-memory-write-"));
  vault = join(base, "vault"); hand = join(base, "handoffs"); eps = join(base, "factory", "episodes");
  mkdirSync(join(hand, "projects"), { recursive: true }); mkdirSync(eps, { recursive: true });
  writeFileSync(join(hand, "current.md"), "## Intent\n\nMove the worktree serve to its own port.\n");
  writeFileSync(join(eps, "aleph-9 Port.md"), `---\nkind: episode\nscope: aleph\nupdated: ${day}\n---\n## Goal\nServe a worktree on a port.\n`);
  writeFileSync(join(base, "repos.json"), "{}");
  restore = withEnv({ ALEPH_VAULT: vault, ALEPH_JUDGE: "haiku", ALEPH_HANDOFFS_DIR: hand, ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_REPOS: join(base, "repos.json"),
    ALEPH_SKILLS_DIR: join(base, "skills"), ALEPH_CLAUDE_SETTINGS: join(base, "settings.json"),
    LANGFUSE_BASE_URL: "http://127.0.0.1:9", LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });
  Bun.spawnSync(["bun", CLI, "init"], { env: process.env });
  write("Land From The Main Checkout", body("A squash merge from inside the worktree lands nothing"));
  write("Worktree Serve Needs A Port", body("A worktree serve needs its own port", "[[Land From The Main Checkout]]"));
  write("Unrelated Fact", body("Bun runs the tests"), "decision");
  const s = await withServer();
  at = s.at; stop = s.stop;
});
afterAll(() => { stop(); restore(); rmSync(base, { recursive: true, force: true }); });

test("search finds a term in notes, handoffs and episodes, says how each reaches the agent, and drops bodies", async () => {
  const r: any = await (await at("/api/memory/search?q=worktree")).json();
  const by = (s: string) => r.results.filter((x: any) => x.source === s);
  expect(by("note").map((x: any) => x.title).sort()).toEqual(["Land From The Main Checkout", "Worktree Serve Needs A Port"]);
  expect(by("handoff")[0]).toMatchObject({ type: "working", key: "current.md", text: "Move the worktree serve to its own port." });
  expect(by("episode")[0]).toMatchObject({ type: "episodic", title: "aleph-9 Port", text: "Serve a worktree on a port." });
  expect(by("note")[0].effect).toContain("vault recall");
  // A note's line is its claim, not its title.
  expect(by("note").find((x: any) => x.title === "Land From The Main Checkout").text).toContain("A squash merge from inside the worktree");
  expect(r.results.some((x: any) => "body" in x)).toBe(false);
  expect(r.results.map((x: any) => x.title)).not.toContain("Unrelated Fact");
  const all: any = await (await at("/api/memory/search")).json();
  expect(all.results.map((x: any) => x.title)).toContain("Unrelated Fact");
});

test("the text changes: core, alias, link and unlink", () => {
  const t = "---\nkind: gotcha\naliases: [a]\n---\n**Claim.** see [[X|the x]] and [[Y]].\n\n## Related\n- [[X]]\n";
  expect(withCore(t, "a line")).toContain("core: a line");
  expect(withCore(withCore(t, "a line"), " ")).not.toContain("core:");
  expect(withAlias(t, "b")).toContain("aliases: [a, b]");
  expect(withLink(t, "Z")).toContain("## Related\n[[Z]]\n- [[X]]");
  expect(withLink("**Claim.** c.\n", "Z")).toBe("**Claim.** c.\n\n## Related\n[[Z]]\n");
  expect(withLink(t, "y")).toBe(t);
  expect(withoutLink(t, "X")).toBe("---\nkind: gotcha\naliases: [a]\n---\n**Claim.** see the x and [[Y]].\n\n## Related\n");
});

test("a note's core line, alias and links are written through vault write and committed", async () => {
  const title = "Worktree Serve Needs A Port";
  expect((await post(noteAt(title, "core"), { core: "A worktree serve takes its own port." })).status).toBe(200);
  expect(noteFile("gotchas", title)).toContain("core: A worktree serve takes its own port.");
  expect((await post(noteAt(title, "alias"), { alias: "worktree port clash" })).status).toBe(200);
  expect(noteFile("gotchas", title)).toContain("aliases: [worktree port clash]");
  expect((await post(noteAt(title, "link"), { target: "Unrelated Fact" })).status).toBe(200);
  expect(noteFile("gotchas", title)).toContain("[[Unrelated Fact]]");
  expect((await post(noteAt(title, "link"), { target: "Land From The Main Checkout", unlink: true })).status).toBe(200);
  expect(noteFile("gotchas", title)).not.toContain("[[Land From The Main Checkout]]");
  expect(gitLog()).toContain(`write: ${title}`);
  const n: any = await (await at(noteAt(title))).json();
  expect(n.text).toContain("core: A worktree serve takes its own port.");
});

test("an edit that vault write refuses changes nothing and says why", async () => {
  const title = "Unrelated Fact", before = noteFile("decisions", title);
  const r = await post(noteAt(title, "edit"), { text: before.replace(/^kind: decision$/m, "kind: nonsense") });
  expect(r.status).toBe(422);
  expect(((await r.json()) as any).error).toContain("refuse");
  expect(noteFile("decisions", title)).toBe(before);
  expect((await post(noteAt(title, "edit"), { text: before.replace("Bun runs the tests", "Bun runs every test") })).status).toBe(200);
  expect(noteFile("decisions", title)).toContain("Bun runs every test");
});

test("delete refuses a note with a caller; archive and delete commit", async () => {
  const r = await post(noteAt("Unrelated Fact", "delete"), {});
  expect(r.status).toBe(422);
  expect(((await r.json()) as any).error).toContain("inbound");
  expect((await post(noteAt("Unrelated Fact", "archive"), { why: "over" })).status).toBe(200);
  expect(existsSync(join(vault, "archive", "Unrelated Fact.md"))).toBe(true);
  expect((await post(noteAt("Land From The Main Checkout", "delete"), {})).status).toBe(200);
  expect(existsSync(join(vault, "wiki", "gotchas", "Land From The Main Checkout.md"))).toBe(false);
  expect(gitLog()).toContain("delete: Land From The Main Checkout");
});

test("handoffs and episodes are edited and deleted as files; MEMORY.md through vault write; a key outside its folder is 404", async () => {
  expect(((await (await at(fileAt("handoff", "current.md"))).json()) as any).text).toContain("worktree serve");
  expect((await post(fileAt("handoff", "current.md", "edit"), { text: "## Intent\n\nNew.\n" })).status).toBe(200);
  expect(readFileSync(join(hand, "current.md"), "utf8")).toBe("## Intent\n\nNew.\n");
  expect((await post(fileAt("episode", "aleph-9 Port.md", "delete"), {})).status).toBe(200);
  expect(existsSync(join(eps, "aleph-9 Port.md"))).toBe(false);
  expect((await post(fileAt("handoff", "../vault/Home.md", "delete"), {})).status).toBe(404);
  expect((await post(fileAt("memory-md", "MEMORY.md", "delete"), {})).status).toBe(404);
  const mem = readFileSync(join(vault, "MEMORY.md"), "utf8");
  expect((await post(fileAt("memory-md", "MEMORY.md", "edit"), { text: `${mem}\n- Chris likes short answers.\n` })).status).toBe(200);
  expect(gitLog()).toContain("write: MEMORY");
});

test("a write without the UI header is forbidden", async () => {
  expect((await post(noteAt("Worktree Serve Needs A Port", "archive"), { }, {})).status).toBe(403);
  expect(existsSync(join(vault, "wiki", "gotchas", "Worktree Serve Needs A Port.md"))).toBe(true);
});

test("a vault write outside the UI: the watcher sees it, and change names the memory keys once they hold the new text", async () => {
  const title = "Fresh From The CLI", key = noteAt(title);
  await at("/api/memory");
  expect((await at(key)).status).toBe(404);
  // Each key is signalled when its own build ends: wait until both have been.
  const seen = new Set<string>();
  const heard = new Promise<void>((ok) => updater.onChange((keys) => { keys.forEach((k) => seen.add(k)); if (seen.has(key) && seen.has("/api/memory")) ok(); }));
  write(title, body("The watcher sees a note the CLI writes"));
  await heard;
  expect(((await (await at(key)).json()) as any).title).toBe(title);
});

test("the old Memory paths are gone", async () => {
  expect((await at("/api/memory/note?title=Unrelated%20Fact")).status).toBe(404);
  expect((await at("/api/memory/file?source=handoff&key=current.md")).status).toBe(404);
});
