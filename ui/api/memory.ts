/**
 * `GET /api/memory`, `/api/memory/search?q=`, `/api/memory/notes/:title`, `/api/memory/files/:source/:key`: the Memory view.
 * `?project=<key>` keeps what `memoryIn` in ui/api/scope.ts puts in that project: its own notes and the global ones.
 * The updater (ui/updater.ts) builds every GET in its Worker. The vault's notes, `vault misses` and the memory items are
 * each read once and shared by every build until one of their sources changes; a search only filters and ranks the items.
 * The POST routes are its writes: a note goes through `vault write`, `archive` or `delete`, so each is validated,
 * committed and pushed; a handoff is a file. A write clears nothing: the updater's watchers see it.
 */
import { daysAgo } from "../../lib/day.ts";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Routes } from "../server.ts";
import { aleph, cli, fail, post } from "../action.ts";
import { items, search as searchItems } from "../memory-items.ts";
import { vaultDir } from "../../lib/paths.ts";
import { handoffOf } from "../../lib/handoffs.ts";
import { tickRows, type TickRow } from "../../jobs/lib/gates/tables.ts";
import { parseFrontmatter, serializeFrontmatter, splitFrontmatter } from "../../lib/frontmatter.ts";
import { trackedFiles } from "../../vault/lib/git.ts";
import { backlinks, coreNotes, dailyNotes, isVault, memoryFile, recallSeen, writeMemoryMd, linkTargets, links, lintVault, loadVault, parseOp, scopeOf, RECALL_DAYS, readMemoryMd, readRecallLog, readRun, relativeDates, START_BUDGET, startContext, wikiNotes, type Note } from "../../vault/lib/vault.ts";
import { later, once, touch } from "../../lib/sources.ts";
import { memoryIn, projectOf } from "./scope.ts";
import { errText } from "../../lib/errtext.ts";
import { DAILY_HOUR, DAILY_TEXT } from "../../lib/schedule.ts";

const inScope = (project: string | null) => (n: Note) => memoryIn(scopeOf(n), project);
const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Every line the vault's CLI appended to its daily notes, newest first; `at` is the line's local time as ISO UTC. */
function opLines(root: string) {
  return dailyNotes(root).flatMap(({ day, text }) =>
    text.split("\n").reverse().flatMap((l) => {
      const m = /^- (\d{2}:\d{2}) (.*)$/.exec(l);
      return m ? [{ at: new Date(`${day}T${m[1]}`).toISOString(), text: m[2] }] : [];
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

/** `aleph memory misses --days 7`'s JSON, or null when it fails (no Langfuse keys, offline). It runs in a subprocess that reads
 * Langfuse for about 35 s, so it declares the source `usage`: one run serves every build until the 10 min usage poll,
 * and the 30 s Langfuse poll does not hold the build Worker with it. */
const misses = (): Promise<Misses | null> => later("memory:misses", ["usage"], runMisses, null);
/** The vault's notes, or none when it has no VAULT.md, read once until a file in the vault changes or the UI writes: a page
 * that wrote reads its write even when the watcher's event comes after its request. */
export const vaultNotes = async (root: string): Promise<Note[]> => (isVault(root) ? await once(`memory:notes:${root}`, ["vault", "action"], () => loadVault(root)) : []);
/** The output of `aleph memory misses`: each recall that found no note. */
type Misses = { missed: { at: string; query: string }[] };
async function runMisses(): Promise<Misses | null> {
  try {
    const p = Bun.spawn([...cli(), "memory", "misses", "--days", "7"], { env: process.env, stdout: "pipe", stderr: "ignore", timeout: 180_000 });
    const text = await new Response(p.stdout).text();
    if ((await p.exited) !== 0) return null;
    return JSON.parse(text);
  } catch (e) { console.error(`ui/memory: no misses: ${errText(e)}`); return null; }
}

/** Each note's recall count per day for the last 30 days, oldest first, from the recall log. */
function recallDays(root: string): Map<string, number[]> {
  const days = Array.from({ length: 30 }, (_, i) => daysAgo(29 - i));
  const by = new Map<string, number[]>();
  for (const e of readRecallLog(root)) {
    const i = days.indexOf(e.date);
    if (i >= 0) { const c = by.get(e.title) ?? Array(30).fill(0); c[i]++; by.set(e.title, c); }
  }
  return by;
}

/** One row per note for the note browser: what it is, when it was written and last returned, and its refusals. */
function noteRows(wiki: Note[], root: string, refuse: { note: string; rule: string; detail: string }[]) {
  const read = recallSeen(root), hist = recallDays(root);
  const problems = new Map<string, { rule: string; detail: string }[]>();
  for (const f of refuse) problems.set(f.note, [...(problems.get(f.note) ?? []), { rule: f.rule, detail: f.detail }]);
  return wiki.map((n) => ({ title: n.title, kind: String(n.fm.kind ?? "none"), scope: scopeOf(n), updated: String(n.fm.updated ?? ""), read: read[n.title] ?? null, history: hist.get(n.title) ?? Array(30).fill(0), problems: problems.get(n.title) ?? [] }));
}

/**
 * Each scope's core lines and the bytes of its start context against the budget. A core line's `bytes` is its line in
 * the start context with its newline; `kept` is false for the lines startContext() cut, the oldest. `memory` is the
 * bytes of MEMORY.md as sent. `demoted` is the scope's lines a write or the maintainer took out, newest first.
 */
export function start(root: string, all: Note[]) {
  const memory = Buffer.byteLength(all.find((n) => n.rel === "MEMORY.md")?.text.trim() ?? "");
  return Object.fromEntries(["aleph", "global"].map((scope) => {
    const { text, cut } = startContext(root, all, scope);
    const notes = coreNotes(all, scope), keep = notes.length - cut;
    const core = notes.map((n, i) => ({ title: n.title, core: String(n.fm.core).trim(), scope: scopeOf(n), bytes: Buffer.byteLength(`- ${String(n.fm.core).trim()} [[${n.title}]]\n`), kept: i < keep }));
    const demoted = wikiNotes(all).filter((n) => !n.archived && typeof n.fm.was_core === "string" && n.fm.core === undefined && [scope, "global"].includes(scopeOf(n)))
      .map((n) => ({ title: n.title, core: String(n.fm.was_core), scope: scopeOf(n), on: String(n.fm.demoted), by: String(n.fm.demoted_by) })).sort((a, b) => b.on.localeCompare(a.on));
    return [scope, { core, bytes: Buffer.byteLength(text), budget: START_BUDGET, cut, memory, demoted }];
  }));
}

/** The vault's lint findings: the refusals and the warnings, with the dates that read relative. */
export function lintOf(root: string, all: Note[]) {
  const lint = lintVault(all, { tracked: trackedFiles(root, "wiki") });
  lint.warn.push(...relativeDates(all));
  return lint;
}

async function overview(url: URL): Promise<Response> {
  const slow = misses();
  const project = projectOf(url);
  const root = vaultDir();
  const all = await vaultNotes(root);
  const keep = inScope(project);
  const wiki = wikiNotes(all).filter(keep);
  const names = new Set(wiki.map((n) => n.title));
  const lint = lintOf(root, all);
  const mine = (f: { note: string }) => !project || names.has(f.note);
  const body: Record<string, unknown> = {
    project,
    exists: all.length > 0,
    total: wiki.length,
    scopes: [...new Set(wikiNotes(all).map(scopeOf).filter(Boolean))].sort(),
    lint: { refuse: lint.refuse.filter(mine), warn: lint.warn.filter(mine) },
    writes: recentWrites(root, all, keep, project),
  };
  body.notes = noteRows(wiki, root, lint.refuse);
  body.start = start(root, all);
  const m = await slow;
  if (m) body.misses = m;
  return json(body);
}

/** One recall event per call: the recall log appends a call's titles in a row, in rank order, so a run of lines with one day and query is one call. */
function recallEvents(root: string, since: string) {
  const out: { date: string; query: string; titles: string[] }[] = [];
  for (const e of readRecallLog(root, since)) {
    const last = out.at(-1);
    if (last && last.date === e.date && last.query === e.query && !last.titles.includes(e.title)) last.titles.push(e.title);
    else out.push({ date: e.date, query: e.query, titles: [e.title] });
  }
  return out;
}

/** `GET /api/memory/log`: the last 30 days of writes (daily op lines), recalls (recall log) and misses (`vault misses`), newest first. */
async function log(url: URL): Promise<Response> {
  const slow = misses();
  const project = projectOf(url), root = vaultDir(), keep = inScope(project);
  const all = await vaultNotes(root), targets = linkTargets(all);
  const since = daysAgo(RECALL_DAYS);
  const mine = (title: string) => { const hit = targets.get(title.toLowerCase()); return !project || (!!hit && keep(hit)); };
  const rows: { at: string; kind: string; op: string; note: string; why: string; titles: string[] }[] = [];
  for (const l of opLines(root)) {
    const o = parseOp(l.text);
    if (l.at.slice(0, 10) >= since && o && mine(o.title)) rows.push({ at: l.at, kind: "write", op: o.op, note: o.title, why: o.why, titles: [] });
  }
  for (const e of recallEvents(root, since)) {
    const titles = e.titles.filter(mine);
    if (titles.length) rows.push({ at: e.date, kind: "recall", op: "recall", note: titles[0], why: e.query, titles });
  }
  const m = await slow;
  for (const x of m?.missed ?? []) rows.push({ at: x.at, kind: "miss", op: "miss", note: "", why: x.query, titles: [] });
  return json({ project, rows: rows.sort((a, b) => b.at.localeCompare(a.at)) });
}

/** The local 03:00 after `at`: when the daily maintainer step is next due. */
function nextDaily(at: string): string {
  const d = new Date(at);
  d.setDate(d.getDate() + 1);
  d.setHours(DAILY_HOUR, 0, 0, 0);
  return d.toISOString();
}

/** The `maintain` row: the tick's last result (else the vault's run record), the queue sizes of the last mechanical pass and the notes of the last compile, the notes of the last re-check and the pairs of the last overlap pass. */
function maintain(root: string, ran: TickRow | undefined) {
  const run = readRun(root, "maintain"), compile = readRun(root, "compile"), recheck = readRun(root, "recheck"), dedupe = readRun(root, "dedupe");
  let counts: Record<string, number> = {};
  try { counts = JSON.parse((run?.detail ?? "").replace(/^dry: /, "")); } catch { /* a failed run's detail is text */ }
  const last = ran?.last ?? run?.at ?? null;
  const notes = /(\d+) notes/.exec(compile?.detail ?? "")?.[1];
  const rechecked = /(\d+) rechecked/.exec(recheck?.detail ?? "")?.[1];
  const resolved = /(\d+) resolved/.exec(dedupe?.detail ?? "")?.[1];
  const detail = [counts.decay !== undefined && `decay ${counts.decay}`, counts.overlap !== undefined && `overlap ${counts.overlap}`, notes && `${notes} notes`, rechecked && `${rechecked} rechecked`, resolved && `${resolved} resolved`].filter(Boolean).join(" · ");
  return { name: "maintain", runs: DAILY_TEXT, last, next: last ? nextDaily(last) : null, result: ran?.result ?? run?.result ?? null, detail: detail || null, does: "fixes the vault, compiles yesterday, re-checks stale notes, resolves overlaps" };
}

/** `GET /api/memory/processes`: the memory steps of the tick, and what each memory process left on disk. */
async function processes(): Promise<Response> {
  const root = vaultDir();
  // The tick table is in the factory's database: a tick write must rebuild this answer.
  touch("factory");
  const tick = tickRows();
  const steps = [
    maintain(root, tick.maintain),
    ...([["seen prune", "with each recall that injects a note", "deletes seen lists older than 7 days"], ["recall trim", "daily with maintain", "keeps 30 days of the recall log"], ["vault push", "with each vault write", "pushes the vault commit to origin"]] as const).map(([name, runs, does]) => {
      const run = readRun(root, name);
      return { name, runs, last: run?.at ?? null, next: null, result: run?.result ?? null, detail: run?.detail ?? null, does };
    }),
  ];
  const all = await vaultNotes(root);
  const stale = lintVault(all).warn.filter((f) => f.rule === "stale");
  // The stale detail is staleness()'s sentence in vault/lib/vault.ts: "... every <window> days; updated <date>, <days> days ago".
  const late = (detail: string) => { const [, window, days] = /every (\d+) days.*, (\d+) days ago/.exec(detail) ?? []; return { window: Number(window), over: Number(days) - Number(window) }; };
  return json({
    steps,
    decay: { stale: stale.map((f) => ({ note: f.note, detail: f.detail, ...late(f.detail) })).sort((a, b) => b.over - a.over) },
  });
}

/** Every memory item of every type, built once until one of its sources changes. */
const ITEM_SOURCES = ["vault", "handoffs", "usage", "later:memory:calls", "later:memory:sessions", "store", "registry", "factory", "action"];
async function memoryItems(root: string) {
  return once(`memory:items:${root}`, ITEM_SOURCES, async () => {
    const wiki = wikiNotes(await vaultNotes(root));
    return { wiki, items: await items(root, wiki, recallSeen(root)) };
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
  const all = await vaultNotes(vaultDir());
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

/** `aleph memory <args>` through ui/action.ts. */
const vault = (...args: string[]): Promise<unknown> => aleph(["memory", ...args]);

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

/** The file a handoff is, or null for a key outside its folder. */
const handoffFile = (key: string): string | null => handoffOf(key)?.path ?? null;

/** The text of a handoff or MEMORY.md, or null when there is none. */
function textOf(source: string, key: string): string | null {
  if (source === "memory-md") return readMemoryMd(vaultDir())?.text ?? null;
  const path = source === "handoff" ? handoffFile(key) : null;
  return path && existsSync(path) ? readFileSync(path, "utf8") : null;
}

function file(source: string, key: string): Response {
  const text = textOf(source, key);
  return text === null ? json({ error: "no such file" }, 404) : json({ text });
}

/** Replaces the text of a file `textOf` finds. */
function setText(source: string, key: string, text: string): void {
  if (source === "memory-md") writeMemoryMd(vaultDir(), text);
  else writeFileSync(handoffFile(key)!, text);
}

/** MEMORY.md is written in place, then `vault write` checks it; a refusal puts the old text back. */
const editFile: Post = async ({ source, key, text }) => {
  const old = textOf(source, key);
  if (old === null) fail(404, "no such file");
  setText(source, key, text);
  if (source !== "memory-md") return { op: "edit", source, key };
  try { return await vault("write", memoryFile(vaultDir()), "--why", WHY); } catch (e) { setText(source, key, old!); throw e; }
};

const deleteFile: Post = async ({ source, key }) => {
  const path = source === "handoff" ? handoffFile(key) : null;
  const gone = !!path && existsSync(path) && (unlinkSync(path), true);
  if (!gone) fail(404, "no such file");
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
