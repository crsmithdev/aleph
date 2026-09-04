/**
 * The vault on disk: notes, links, validation, lint, health. Pure functions
 * over a directory; the CLI decides what to write and commit.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { parseFrontmatter, splitFrontmatter, type Frontmatter } from "./frontmatter.ts";

export const KINDS = ["decision", "concept", "entity", "project", "gotcha"] as const;
export type Kind = (typeof KINDS)[number];
export const FOLDERS: Record<Kind, string> = { decision: "decisions", concept: "concepts", entity: "entities", project: "projects", gotcha: "gotchas" };
export const CONFIDENCE = ["measured", "reported", "inferred"] as const;
export const REQUIRED = ["kind", "scope", "confidence", "updated", "supersedes", "sources"] as const;
export const LISTS = ["aliases", "supersedes", "sources", "tags"] as const;
export const LINE_BUDGET = 150;
export const STALE_DAYS = 90;
export const ROOT_FILES = ["Home", "MEMORY", "VAULT"];

export function vaultDir(): string {
  return process.env.ALEPH_VAULT ?? join(homedir(), ".aleph", "vault");
}

export interface Note {
  path: string;      // absolute
  rel: string;       // relative to the vault
  title: string;     // filename stem
  fm: Frontmatter;
  hasFrontmatter: boolean;
  body: string;
  text: string;
  wiki: boolean;     // lives under wiki/
  archived: boolean; // lives under archive/; a link target, never linted or recalled
}

export interface Finding { note: string; rule: string; detail: string }

export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function clock(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function readNote(path: string, root: string): Note {
  const text = readFileSync(path, "utf8");
  const { frontmatter, body } = splitFrontmatter(text);
  const rel = relative(root, path);
  return { path, rel, title: basename(path, ".md"), fm: frontmatter === null ? {} : parseFrontmatter(frontmatter), hasFrontmatter: frontmatter !== null, body, text, wiki: rel.startsWith("wiki/"), archived: rel.startsWith("archive/") };
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** Every markdown file outside .obsidian/, archive included: archived notes are link targets. */
export function loadVault(root: string): Note[] {
  return walk(root).map((p) => readNote(p, root));
}

export function wikiNotes(notes: Note[]): Note[] {
  return notes.filter((n) => n.wiki);
}

const LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

export function links(text: string): string[] {
  const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...prose.matchAll(LINK)].map((m) => m[1].trim());
}

function list(fm: Frontmatter, key: string): string[] {
  const v = fm[key];
  return Array.isArray(v) ? v : v === undefined ? [] : [v];
}

/** Titles and aliases that a [[link]] may resolve to. Every file stem counts, so daily notes and Home resolve too. */
export function linkTargets(notes: Note[]): Map<string, Note> {
  const m = new Map<string, Note>();
  for (const n of notes) {
    m.set(n.title.toLowerCase(), n);
    for (const a of list(n.fm, "aliases")) m.set(a.toLowerCase(), n);
  }
  return m;
}

export function folderFor(kind: string): string | null {
  return (KINDS as readonly string[]).includes(kind) ? `wiki/${FOLDERS[kind as Kind]}` : null;
}

export function validTitle(title: string): boolean {
  return !/[\/\\:*?"<>|]/.test(title) && title.trim() === title && title.length > 0;
}

/** Refuse-class findings for one wiki note against the rest of the vault. */
export function validateNote(note: Note, others: Note[]): Finding[] {
  const f: Finding[] = [];
  const add = (rule: string, detail: string) => f.push({ note: note.title, rule, detail });
  if (!validTitle(note.title)) add("title", `title has a forbidden character or surrounding whitespace: ${JSON.stringify(note.title)}`);
  if (!note.hasFrontmatter) { add("schema", "no frontmatter"); return f; }
  for (const key of REQUIRED) if (note.fm[key] === undefined) add("schema", `missing ${key}`);
  const kind = String(note.fm.kind ?? "");
  if (note.fm.kind !== undefined && !(KINDS as readonly string[]).includes(kind)) add("schema", `kind must be one of ${KINDS.join("|")}, got ${kind}`);
  if (note.fm.confidence !== undefined && !(CONFIDENCE as readonly string[]).includes(String(note.fm.confidence))) add("schema", `confidence must be one of ${CONFIDENCE.join("|")}, got ${note.fm.confidence}`);
  if (note.fm.updated !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(note.fm.updated))) add("schema", `updated must be YYYY-MM-DD, got ${note.fm.updated}`);
  if (note.fm.scope !== undefined && (Array.isArray(note.fm.scope) || !String(note.fm.scope).trim())) add("schema", "scope must be a repo name or global");
  for (const key of LISTS) if (note.fm[key] !== undefined && !Array.isArray(note.fm[key])) add("schema", `${key} must be a list`);
  const folder = folderFor(kind);
  if (folder && dirname(note.rel) !== folder) add("folder", `kind ${kind} belongs in ${folder}/, note is in ${dirname(note.rel)}/`);

  const mine = [note.title, ...list(note.fm, "aliases")].map((s) => s.toLowerCase());
  const targets = linkTargets(others.filter((o) => o.path !== note.path));
  for (const name of mine) {
    const hit = targets.get(name);
    if (hit) add("duplicate", `"${name}" is already the title or an alias of ${hit.rel}`);
  }
  const all = linkTargets([...others.filter((o) => o.path !== note.path), note]);
  for (const target of links(note.body)) if (!all.has(target.toLowerCase())) add("dangling", `[[${target}]] resolves to nothing`);

  const body = note.body.replace(/^\s*#[^\n]*\n/, "").trimStart();
  const claim = body.split(/\n\s*\n/)[0] ?? "";
  if (!claim.startsWith("**Claim.**")) add("template", "body must open with a paragraph beginning **Claim.**");
  if (!/as of \d{4}-\d{2}-\d{2}/.test(claim)) add("template", "the claim must carry an `as of YYYY-MM-DD` marker");
  for (const h of ["Details", "Evidence", "Related"]) if (!new RegExp(`^## ${h}\\s*$`, "m").test(note.body)) add("template", `missing section ## ${h}`);
  return f;
}

export function budgetFindings(notes: Note[]): Finding[] {
  const f: Finding[] = [];
  for (const name of ["Home", "MEMORY"]) {
    const n = notes.find((x) => x.rel === `${name}.md`);
    if (!n) continue;
    const lines = n.text.replace(/\n+$/, "").split("\n").length;
    if (lines > LINE_BUDGET) f.push({ note: name, rule: "budget", detail: `${name}.md is ${lines} lines; the budget is ${LINE_BUDGET}` });
  }
  return f;
}

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
}

export function lintVault(notes: Note[]): { refuse: Finding[]; warn: Finding[] } {
  const refuse: Finding[] = [];
  const warn: Finding[] = [];
  const wiki = wikiNotes(notes);
  for (const n of wiki) refuse.push(...validateNote(n, notes));
  refuse.push(...budgetFindings(notes));
  const targets = linkTargets(notes);
  for (const n of notes.filter((x) => !x.wiki && !x.archived && x.rel !== "VAULT.md")) for (const t of links(n.body)) if (!targets.has(t.toLowerCase())) refuse.push({ note: n.title, rule: "dangling", detail: `[[${t}]] resolves to nothing` });

  const home = notes.find((x) => x.rel === "Home.md");
  const fromHome = new Set(links(home?.body ?? "").map((t) => targets.get(t.toLowerCase())?.path));
  for (const n of wiki) if (!fromHome.has(n.path)) warn.push({ note: n.title, rule: "orphan", detail: "not linked from Home.md" });

  const cutoff = Date.now() - STALE_DAYS * 86400_000;
  for (const n of wiki) {
    if (n.fm.confidence === "measured" && Date.parse(String(n.fm.updated)) < cutoff) warn.push({ note: n.title, rule: "stale", detail: `measured, updated ${n.fm.updated}, older than ${STALE_DAYS} days` });
  }

  for (let i = 0; i < wiki.length; i++) for (let j = i + 1; j < wiki.length; j++) {
    const a = wiki[i], b = wiki[j];
    if (a.fm.scope !== b.fm.scope) continue;
    const sup = (x: Note, y: Note) => list(x.fm, "supersedes").some((t) => t.toLowerCase() === y.title.toLowerCase());
    if (sup(a, b) || sup(b, a)) continue;
    const wa = words([a.title, ...list(a.fm, "aliases")].join(" "));
    const wb = words([b.title, ...list(b.fm, "aliases")].join(" "));
    const shared = [...wa].filter((w) => wb.has(w));
    if (shared.length >= 2) warn.push({ note: a.title, rule: "overlap", detail: `shares "${shared.join('", "')}" with ${b.title} in scope ${a.fm.scope}; neither supersedes the other` });
  }
  return { refuse, warn };
}

export interface Health { notes: number; dangling: number; orphans: number; date: string }

export function health(notes: Note[]): Health {
  const { refuse, warn } = lintVault(notes);
  return { notes: wikiNotes(notes).length, dangling: refuse.filter((f) => f.rule === "dangling").length, orphans: warn.filter((f) => f.rule === "orphan").length, date: today() };
}

export function healthLine(h: Health): string {
  return `Health: ${h.notes} notes, ${h.dangling} dangling, ${h.orphans} orphans, lint ${h.date}`;
}

/** Home.md with its last line set to the health line. */
export function withHealth(homeText: string, line: string): string {
  const lines = homeText.replace(/\n+$/, "").split("\n");
  if (lines.at(-1)?.startsWith("Health:")) lines[lines.length - 1] = line;
  else lines.push("", line);
  return lines.join("\n") + "\n";
}

export function citedTraces(notes: Note[]): string[] {
  const ids = new Set<string>();
  for (const n of notes) for (const s of list(n.fm, "sources")) if (s.startsWith("trace:")) ids.add(s.slice(6));
  return [...ids].sort();
}
