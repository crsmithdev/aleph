/**
 * `GET /api/memory`, `/api/memory/search?q=`, `/api/memory/notes/:title`, `/api/memory/files/:source/:key`: the Memory view.
 * `?project=<key>` keeps what `memoryIn` in ui/api/scope.ts puts in that project: its own notes and the global ones.
 * The updater (ui/updater.ts) builds every GET in its Worker. The vault's notes, `vault misses` and the memory items are
 * each read once and shared by every build until one of their sources changes; a search only filters and ranks the items.
 * The POST routes are its writes: a note goes through `vault write`, `archive` or `delete`, so each is validated,
 * committed and pushed; a handoff or an episode is a file. A write clears nothing: the updater's watchers see it.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Routes } from "../server.ts";
import { aleph, fail, post } from "../action.ts";
import { items, search as searchItems } from "../memory-items.ts";
import { handoffsDir } from "../memory-types.ts";
import { episodesDir } from "../../jobs/lib/learning/episode.ts";
import { parseFrontmatter, serializeFrontmatter, splitFrontmatter } from "../../lib/frontmatter.ts";
import { memoryTypes } from "../memory-types.ts";
import { trackedFiles } from "../../vault/lib/git.ts";
import { KINDS, linkTargets, links, lintVault, loadVault, relativeDates, today, vaultDir, wikiNotes, type Note } from "../../vault/lib/vault.ts";
import { later, once } from "../../jobs/lib/infra/sources.ts";
import { memoryIn, projectOf } from "./scope.ts";

const CLI = join(import.meta.dir, "..", "..", "vault", "cli.ts");
const scopeOf = (n: Note) => String(n.fm.scope ?? "");
const inScope = (project: string | null) => (n: Note) => memoryIn(scopeOf(n), project);
const count = (xs: string[]) => Object.fromEntries([...new Set(xs)].sort().map((x) => [x, xs.filter((y) => y === x).length]));
const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Home's `## Section` headings, each with its `- [[Title]] — hook` lines. Entries outside the project's scope are dropped. */
function homeSections(notes: Note[], keep: (n: Note) => boolean, project: string | null) {
  const home = notes.find((n) => n.rel === "Home.md");
  if (!home) return [];
  const targets = linkTargets(notes);
  const sections: { heading: string; entries: { title: string; hook: string }[] }[] = [];
  for (const line of home.body.split("\n")) {
    const h = /^##\s+(.*?)\s*$/.exec(line);
    if (h) { sections.push({ heading: h[1], entries: [] }); continue; }
    const m = /^\s*-\s*\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]\s*(?:[—–-]+\s*)?(.*)$/.exec(line);
    if (!m || !sections.length) continue;
    const hit = targets.get(m[1].trim().toLowerCase());
    if (project && !(hit && keep(hit))) continue;
    sections.at(-1)!.entries.push({ title: hit?.title ?? m[1].trim(), hook: m[2].trim() });
  }
  return project ? sections.filter((s) => s.entries.length) : sections;
}

/** The last 20 lines the vault's CLI appended to its daily notes, newest first; `at` is the line's local time as ISO UTC. */
function recentWrites(root: string, notes: Note[], keep: (n: Note) => boolean, project: string | null) {
  const dir = join(root, "daily");
  if (!existsSync(dir)) return [];
  const targets = linkTargets(notes);
  const out: { at: string; text: string }[] = [];
  for (const f of readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse()) {
    const lines = readFileSync(join(dir, f), "utf8").split("\n").reverse();
    for (const l of lines) {
      const m = /^- (\d{2}:\d{2}) (.*)$/.exec(l);
      if (!m) continue;
      if (project) {
        const t = links(m[2])[0];
        const hit = t ? targets.get(t.toLowerCase()) : undefined;
        if (!hit || !keep(hit)) continue;
      }
      out.push({ at: new Date(`${f.slice(0, 10)}T${m[1]}`).toISOString(), text: m[2] });
      if (out.length === 20) return out;
    }
  }
  return out;
}

/** `vault misses --days 7`'s JSON, or null when it fails (no Langfuse keys, offline). It runs in a subprocess that reads
 * Langfuse for about 45 s, so it declares the source `usage`: one run serves every build until the 10 min usage poll,
 * and the 30 s Langfuse poll does not hold the build Worker with it. */
const misses = (): Promise<unknown | null> => later("memory:misses", ["usage"], runMisses, null);
/** The vault's notes, read once until a file in the vault changes or the UI writes: a page that wrote reads its write
 * even when the watcher's event comes after its request. */
const vaultNotes = (root: string): Promise<Note[]> => once(`memory:notes:${root}`, ["vault", "action"], () => loadVault(root));
async function runMisses(): Promise<unknown | null> {
  try {
    const p = Bun.spawn(["bun", CLI, "misses", "--days", "7"], { env: process.env, stdout: "pipe", stderr: "ignore", timeout: 60_000 });
    const text = await new Response(p.stdout).text();
    if ((await p.exited) !== 0) return null;
    return JSON.parse(text);
  } catch { return null; }
}

/** When `vault recall` last returned each note, by title; empty when the log is absent. */
function readLog(root: string): Record<string, string> {
  try { return JSON.parse(readFileSync(join(root, ".recall.json"), "utf8")); } catch { return {}; }
}

/** Each note's recall count per day for the last 30 days, oldest first, from the recall log. */
function recallDays(root: string): Map<string, number[]> {
  const days = Array.from({ length: 30 }, (_, i) => today(new Date(Date.now() - (29 - i) * 86400_000)));
  const by = new Map<string, number[]>();
  let lines: string[] = [];
  try { lines = readFileSync(join(root, ".recall-log.jsonl"), "utf8").split("\n"); } catch { /* no log yet */ }
  for (const l of lines) {
    try {
      const e = JSON.parse(l), i = days.indexOf(e.date);
      if (i >= 0) { const c = by.get(e.title) ?? Array(30).fill(0); c[i]++; by.set(e.title, c); }
    } catch { /* a bad line is skipped */ }
  }
  return by;
}

/** One row per note for the note browser: what it is, when it was written and last returned, and its refusals. */
function noteRows(wiki: Note[], root: string, refuse: { note: string; rule: string; detail: string }[]) {
  const read = readLog(root), hist = recallDays(root);
  const problems = new Map<string, { rule: string; detail: string }[]>();
  for (const f of refuse) problems.set(f.note, [...(problems.get(f.note) ?? []), { rule: f.rule, detail: f.detail }]);
  return wiki.map((n) => ({ title: n.title, kind: String(n.fm.kind ?? "none"), scope: scopeOf(n), updated: String(n.fm.updated ?? ""), read: read[n.title] ?? null, history: hist.get(n.title) ?? Array(30).fill(0), problems: problems.get(n.title) ?? [] }));
}

async function overview(url: URL): Promise<Response> {
  const slow = misses();
  const project = projectOf(url);
  const root = vaultDir();
  const all = existsSync(join(root, "Home.md")) ? await vaultNotes(root) : [];
  const keep = inScope(project);
  const wiki = wikiNotes(all).filter(keep);
  const names = new Set(wiki.map((n) => n.title));
  const lint = lintVault(all, { read: readLog(root), tracked: trackedFiles(root, "wiki") });
  lint.warn.push(...relativeDates(all));
  const mine = (f: { note: string }) => !project || names.has(f.note);
  const body: Record<string, unknown> = {
    project,
    exists: all.length > 0,
    total: wiki.length,
    byKind: { ...Object.fromEntries(KINDS.map((k) => [k, 0])), ...count(wiki.map((n) => String(n.fm.kind ?? "none"))) },
    byScope: count(wiki.map(scopeOf)),
    scopes: [...new Set(wikiNotes(all).map(scopeOf).filter(Boolean))].sort(),
    home: homeSections(all, keep, project),
    lint: { refuse: lint.refuse.filter(mine), warn: lint.warn.filter(mine) },
    writes: recentWrites(root, all, keep, project),
  };
  body.notes = noteRows(wiki, root, lint.refuse);
  const m = await slow;
  if (m) body.misses = m;
  body.types = await memoryTypes(root, wiki, m, all);
  return json(body);
}

/** The vault's notes, or none when it has no Home.md. */
const allNotes = async (root: string) => (existsSync(join(root, "Home.md")) ? await vaultNotes(root) : []);

/** Every memory item of every type, built once until one of its sources changes. */
const ITEM_SOURCES = ["vault", "handoffs", "episodes", "usage", "later:memory:misses", "later:memory:calls", "later:memory:sessions", "store", "registry", "factory", "action"];
async function memoryItems(root: string) {
  return once(`memory:items:${root}`, ITEM_SOURCES, async () => {
    const wiki = wikiNotes(await allNotes(root));
    return { wiki, items: await items(root, wiki, readLog(root), await misses()) };
  });
}

/** Every memory that matches `q`, of every type; all of them when `q` is empty. It filters and ranks the items only. */
async function search(url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").trim();
  const project = projectOf(url);
  const root = vaultDir();
  const { wiki, items: all } = await memoryItems(root);
  return json({ q, results: searchItems(all, q, project, root, wiki) });
}

async function note(raw: string, url: URL): Promise<Response> {
  const title = raw.trim();
  const project = projectOf(url);
  const all = await allNotes(vaultDir());
  const targets = linkTargets(all);
  const hit = title ? targets.get(title.toLowerCase()) : undefined;
  // Under a project filter, a note outside the project does not exist.
  if (!hit || !memoryIn(scopeOf(hit), project)) return json({ error: `no note titled ${title || "(none)"}` }, 404);
  const keep = inScope(project);
  const to = [...new Set(links(hit.body))].map((t) => targets.get(t.toLowerCase())).filter((n): n is Note => !!n && keep(n) && n !== hit);
  const from = all.filter((n) => n !== hit && keep(n) && !n.archived && links(n.body).some((t) => targets.get(t.toLowerCase()) === hit));
  const ref = (n: Note) => ({ title: n.title, kind: String(n.fm.kind ?? ""), scope: scopeOf(n) });
  return json({ title: hit.title, path: hit.rel, archived: hit.archived, frontmatter: hit.fm, body: hit.body, text: hit.text, links: [...new Map(to.map((n) => [n.title, ref(n)])).values()], backlinks: from.map(ref).sort((a, b) => a.title.localeCompare(b.title)) });
}

// ---------------------------------------------------------------- writes

const WHY = "edited on the Memory page";

/** `vault <args>` through ui/action.ts. */
const vault = (...args: string[]): Promise<unknown> => aleph(args, { cli: "vault" });

/** A note's text, rewritten by `change`, through `vault write`. */
async function rewrite(title: string, change: (text: string) => string, why = WHY): Promise<unknown> {
  const hit = linkTargets(await loadVault(vaultDir())).get(title.toLowerCase());
  if (!hit?.wiki || hit.archived) fail(404, `no live note titled ${title}`);
  const dir = mkdtempSync(join(tmpdir(), "aleph-memory-"));
  try {
    writeFileSync(join(dir, `${hit!.title}.md`), change(hit!.text));
    return await vault("write", join(dir, `${hit!.title}.md`), "--why", why);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** `text` with its frontmatter changed by `change`. */
const withFm = (text: string, change: (fm: Record<string, string | string[]>) => void): string => {
  const { frontmatter, body } = splitFrontmatter(text);
  const fm = parseFrontmatter(frontmatter ?? "");
  change(fm);
  return serializeFrontmatter(fm) + body;
};
/** `text` with `core:` set to `core`, or without it when `core` is blank. */
export const withCore = (text: string, core: string) => withFm(text, (fm) => { if (core.trim()) fm.core = core.trim(); else delete fm.core; });
/** `text` with `alias` added to its aliases. */
export const withAlias = (text: string, alias: string) => withFm(text, (fm) => { const xs = [].concat((fm.aliases ?? []) as never); if (!xs.includes(alias as never)) fm.aliases = [...xs, alias]; });
/** `text` with `[[target]]` under its `## Related` heading, which it gets when it has none. */
export function withLink(text: string, target: string): string {
  if (links(text).some((t) => t.toLowerCase() === target.toLowerCase())) return text;
  const lines = text.split("\n"), at = lines.findIndex((l) => /^##\s+related\s*$/i.test(l));
  if (at < 0) return `${text.replace(/\n*$/, "")}\n\n## Related\n[[${target}]]\n`;
  lines.splice(at + 1, 0, `[[${target}]]`);
  return lines.join("\n");
}
/** `text` with no link to `target`: a line that is only the link goes, an inline link becomes its plain text. */
export function withoutLink(text: string, target: string): string {
  const esc = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const link = new RegExp(`\\[\\[${esc}(?:#[^\\]|]*)?(?:\\|([^\\]]*))?\\]\\]`, "gi");
  return text.split("\n").filter((l) => !new RegExp(`^\\s*(?:[-*]\\s*)?${link.source}\\s*$`, "i").test(l)).join("\n").replace(link, (_, alias) => alias ?? target);
}

/** The body's fields as text: a boolean is "1" or "". */
const strings = (b: object): Record<string, string> => Object.fromEntries(Object.entries(b ?? {}).map(([k, v]) => [k, typeof v === "boolean" ? (v ? "1" : "") : String(v ?? "")]));
type Post = (b: Record<string, string>) => Promise<unknown>;
/** A write: the body's fields and the URL's (`title`, `source`, `key`); the URL's win. */
const write = (f: Post) => post((b, params) => f({ ...strings(b), ...params }));

/** The file a handoff, an episode or MEMORY.md is, or null for a key outside its folder. */
function fileOf(source: string, key: string): string | null {
  if (source === "memory-md") return join(vaultDir(), "MEMORY.md");
  if (source === "handoff" && /^(projects\/)?[^/\\.][^/\\]*\.md$/.test(key)) return join(handoffsDir(), key);
  if (source === "episode" && /^[^/\\.][^/\\]*\.md$/.test(key)) return join(episodesDir(), key);
  return null;
}

function file(source: string, key: string): Response {
  const path = fileOf(source, key);
  return path && existsSync(path) ? json({ text: readFileSync(path, "utf8") }) : json({ error: "no such file" }, 404);
}

/** MEMORY.md is written in place, then `vault write` checks it; a refusal puts the old text back. */
const editFile: Post = async ({ source, key, text }) => {
  const path = fileOf(source, key);
  if (!path || !existsSync(path)) fail(404, "no such file");
  const old = readFileSync(path!, "utf8");
  writeFileSync(path!, text);
  if (source !== "memory-md") return { op: "edit", source, key };
  try { return await vault("write", path!, "--why", WHY); } catch (e) { writeFileSync(path!, old); throw e; }
};

const deleteFile: Post = async ({ source, key }) => {
  const path = source === "memory-md" ? null : fileOf(source, key);
  if (!path || !existsSync(path)) fail(404, "no such file");
  unlinkSync(path!);
  return { op: "delete", source, key };
};

export const routes: Routes = {
  "GET /api/memory": (_req, _p, url) => overview(url),
  "GET /api/memory/search": (_req, _p, url) => search(url),
  "GET /api/memory/notes/:title": (_req, { title }, url) => note(title, url),
  "GET /api/memory/files/:source/:key": (_req, { source, key }) => file(source, key),
  "POST /api/memory/notes/:title/edit": write(({ title, text }) => rewrite(title, () => text)),
  "POST /api/memory/notes/:title/core": write(({ title, core }) => rewrite(title, (t) => withCore(t, core))),
  "POST /api/memory/notes/:title/alias": write(async ({ title, alias }) => (alias?.trim() ? rewrite(title, (t) => withAlias(t, alias.trim())) : fail(422, "no alias"))),
  "POST /api/memory/notes/:title/link": write(({ title, target, unlink }) => rewrite(title, (t) => (unlink ? withoutLink(t, target) : withLink(t, target)))),
  "POST /api/memory/notes/:title/archive": write(({ title, why }) => vault("archive", title, "--why", why || WHY)),
  "POST /api/memory/notes/:title/delete": write(({ title, why }) => vault("delete", title, "--why", why || WHY)),
  "POST /api/memory/files/:source/:key/edit": write(editFile),
  "POST /api/memory/files/:source/:key/delete": write(deleteFile),
};
