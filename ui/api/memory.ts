/**
 * `GET /api/memory`, `/api/memory/search?q=`, `/api/memory/notes/:title`, `/api/memory/files/:source/:key`: the Memory view.
 * `?project=<key>` keeps what `memoryIn` in ui/api/scope.ts puts in that project: its own notes and the global ones.
 * The updater (ui/updater.ts) builds every GET in its Worker. The vault's notes, `vault misses` and the memory items are
 * each read once and shared by every build until one of their sources changes; a search only filters and ranks the items.
 * The POST routes are its writes: a note goes through `vault write`, `archive` or `delete`, so each is validated,
 * committed and pushed; a handoff or an episode is a file. A write clears nothing: the updater's watchers see it.
 */
import { readJsonOr } from "../../lib/json.ts";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Routes } from "../server.ts";
import { aleph, fail, post } from "../action.ts";
import { items, search as searchItems } from "../memory-items.ts";
import { handoffsDir } from "../../lib/paths.ts";
import { episodesDir, KEEP_DAYS } from "../../jobs/lib/learning/episode.ts";
import { factoryDir } from "../../jobs/lib/gates/factory-status.ts";
import { readEvents } from "../../lib/layout.ts";
import { parseFrontmatter, serializeFrontmatter, splitFrontmatter } from "../../lib/frontmatter.ts";
import { trackedFiles } from "../../vault/lib/git.ts";
import { backlinks, coreNotes, KINDS, linkTargets, links, lintVault, loadVault, relativeDates, START_BUDGET, startContext, today, vaultDir, wikiNotes, type Note } from "../../vault/lib/vault.ts";
import { later, once } from "../../lib/sources.ts";
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

/** Every line the vault's CLI appended to its daily notes, newest first; `at` is the line's local time as ISO UTC. */
function opLines(root: string) {
  const dir = join(root, "daily");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse().flatMap((f) =>
    readFileSync(join(dir, f), "utf8").split("\n").reverse().flatMap((l) => {
      const m = /^- (\d{2}:\d{2}) (.*)$/.exec(l);
      return m ? [{ at: new Date(`${f.slice(0, 10)}T${m[1]}`).toISOString(), text: m[2] }] : [];
    }));
}

/** The last 20 op lines, newest first. Lines about a note outside the project's scope are dropped. */
function recentWrites(root: string, notes: Note[], keep: (n: Note) => boolean, project: string | null) {
  const targets = linkTargets(notes);
  return opLines(root).filter((l) => {
    if (!project) return true;
    const t = links(l.text)[0], hit = t ? targets.get(t.toLowerCase()) : undefined;
    return hit && keep(hit);
  }).slice(0, 20);
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
  return readJsonOr(join(root, ".recall.json"), {});
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

/** Each scope's core lines and the bytes of its start context against the budget. */
function start(root: string, all: Note[]) {
  return Object.fromEntries(["aleph", "global"].map((scope) => {
    const { text, cut } = startContext(root, all, scope);
    return [scope, { core: coreNotes(all, scope).map((n) => ({ title: n.title, core: String(n.fm.core).trim() })), bytes: Buffer.byteLength(text), budget: START_BUDGET, cut }];
  }));
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
  body.start = start(root, all);
  const m = await slow;
  if (m) body.misses = m;
  return json(body);
}

const LOG_DAYS = 30;
/** One recall event per call: the recall log appends a call's titles in a row, in rank order, so a run of lines with one day and query is one call. */
function recallEvents(root: string, since: string) {
  const out: { date: string; query: string; titles: string[] }[] = [];
  let lines: string[] = [];
  try { lines = readFileSync(join(root, ".recall-log.jsonl"), "utf8").split("\n"); } catch { /* no log yet */ }
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      if (e.date < since) continue;
      const last = out.at(-1);
      if (last && last.date === e.date && last.query === e.query && !last.titles.includes(e.title)) last.titles.push(e.title);
      else out.push({ date: e.date, query: e.query, titles: [e.title] });
    } catch { /* a bad line is skipped */ }
  }
  return out;
}

/** `GET /api/memory/log`: the last 30 days of writes (daily op lines), recalls (recall log) and misses (`vault misses`), newest first. */
async function log(url: URL): Promise<Response> {
  const slow = misses();
  const project = projectOf(url), root = vaultDir(), keep = inScope(project);
  const all = await allNotes(root), targets = linkTargets(all);
  const since = today(new Date(Date.now() - LOG_DAYS * 86400_000));
  const mine = (title: string) => { const hit = targets.get(title.toLowerCase()); return !project || (!!hit && keep(hit)); };
  const rows: { at: string; kind: string; op: string; note: string; why: string; titles: string[] }[] = [];
  for (const l of opLines(root)) {
    const m = /^(write|update|supersede|archive|adopt) \[\[([^\]]+)\]\]\s*(.*)$/.exec(l.text);
    if (l.at.slice(0, 10) >= since && m && mine(m[2])) rows.push({ at: l.at, kind: "write", op: m[1], note: m[2], why: m[3].replace(/\[\[|\]\]/g, "").replace(/^[—–-]\s*/, ""), titles: [] });
  }
  for (const e of recallEvents(root, since)) {
    const titles = e.titles.filter(mine);
    if (titles.length) rows.push({ at: e.date, kind: "recall", op: "recall", note: titles[0], why: e.query, titles });
  }
  const m: any = await slow;
  for (const x of m?.missed ?? []) rows.push({ at: x.at, kind: "miss", op: "miss", note: "", why: x.query, titles: [] });
  return json({ project, rows: rows.sort((a, b) => b.at.localeCompare(a.at)) });
}

const MIN = 60_000;
/** The local 03:00 after `at`: when the daily corrections step is next due. */
function nextDaily(at: string): string {
  const d = new Date(at);
  d.setDate(d.getDate() + 1);
  d.setHours(3, 0, 0, 0);
  return d.toISOString();
}

/** `GET /api/memory/processes`: the memory steps of the tick, and what each memory process left on disk. The corrections
 * store is read as a file: corrections.ts loads the factory's actions, which the server must not. */
async function processes(): Promise<Response> {
  const root = vaultDir(), now = Date.now();
  const tick = readJsonOr<{ last?: Record<string, string> }>(join(factoryDir(), "tick.json"), {});
  const store = readJsonOr<{ minedAt: string; lessons: { sentence: string; state: string }[] }>(join(factoryDir(), "corrections.json"), { minedAt: "", lessons: [] });
  const failed = (subject: string, last: string) => readEvents(now - 2 * 86400_000).some((e) => e.subject === subject && e.action === "failed" && e.at >= last);
  const step = (name: string, runs: string, last: string | undefined, next: string | null, does: string) =>
    ({ name, runs, last: last ?? null, next, result: last ? (failed(name, last) ? "failed" : "ok") : null, does });
  const steps = [
    step("episodes", "every 30 min", tick.last?.episodes, tick.last?.episodes ? new Date(Date.parse(tick.last.episodes) + 30 * MIN).toISOString() : null, `writes a page for each finished issue and deletes pages older than ${KEEP_DAYS} days`),
    step("corrections", "daily after 03:00", store.minedAt || undefined, store.minedAt ? nextDaily(store.minedAt) : null, "mines lessons from transcripts, gate denials and drop reasons"),
  ];
  const dir = episodesDir();
  const mtimes = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => statSync(join(dir, f)).mtimeMs) : [];
  const days = Array.from({ length: KEEP_DAYS }, (_, i) => today(new Date(now - (KEEP_DAYS - 1 - i) * 86400_000)));
  const perDay = days.map((date) => ({ date, pages: mtimes.filter((t) => today(new Date(t)) === date).length }));
  const all = await allNotes(root);
  const stale = lintVault(all, { read: readLog(root) }).warn.filter((f) => f.rule === "stale");
  return json({
    steps,
    episodes: { pages: mtimes.length, keep: KEEP_DAYS, days: perDay, prunes: opLines(root).filter((l) => l.text.startsWith("prune episodes")).slice(0, 5) },
    corrections: { states: count(store.lessons.map((l) => l.state)), waiting: store.lessons.filter((l) => l.state === "open" || l.state === "proposed").map((l) => ({ sentence: l.sentence, state: l.state })) },
    decay: { stale: stale.map((f) => ({ note: f.note, detail: f.detail })) },
  });
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
  const from = backlinks(all, hit).filter((n) => keep(n) && !n.archived);
  const ref = (n: Note) => ({ title: n.title, kind: String(n.fm.kind ?? ""), scope: scopeOf(n) });
  return json({ title: hit.title, path: hit.rel, archived: hit.archived, frontmatter: hit.fm, body: hit.body, text: hit.text, links: [...new Map(to.map((n) => [n.title, ref(n)])).values()], backlinks: from.map(ref).sort((a, b) => a.title.localeCompare(b.title)) });
}

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
  "GET /api/memory/log": (_req, _p, url) => log(url),
  "GET /api/memory/processes": () => processes(),
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
