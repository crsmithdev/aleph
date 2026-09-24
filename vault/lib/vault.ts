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

/**
 * The kinds Home indexes. A gotcha is what you search for when you hit it, not
 * what you need in context every session, and gotchas were 91 of Home's 132
 * index lines. The index pattern is reported to hold to 100-200 pages; at 138
 * notes and about seven a day, Home had weeks left as an inventory of
 * everything. It routes to the standing kinds; `recall` finds the rest.
 */
export const HOME_KINDS: readonly string[] = ["decision", "project", "concept", "entity"];

/**
 * Days before a note's claim wants a re-check, by kind. An architecture
 * decision decays slowly and a transient gotcha decays fast; a project note
 * describes current state, so it decays fastest of all.
 */
export const DECAY_DAYS: Record<Kind, number> = { project: 30, gotcha: 60, decision: 180, concept: 365, entity: 365 };

/**
 * Freshness and authority are different axes. A six-month-old claim someone
 * measured outlives a fresh one they guessed, so confidence widens or narrows
 * the window rather than gating it, as the old `measured`-only rule did.
 */
export const CONFIDENCE_FACTOR: Record<string, number> = { measured: 1.5, reported: 1, inferred: 0.5 };

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

/**
 * How stale a note's claim is, or null when it is inside its window.
 *
 * The window is the kind's decay budget, widened or narrowed by confidence,
 * and it runs from the later of `updated` and the last time `recall` returned
 * the note. A retention curve resets on reinforcement: a note read every week
 * is in use, whatever its `updated` line says, and the old rule could not tell
 * that from one nobody had opened.
 */
export function staleness(note: Note, read: Record<string, string> = {}, now = new Date()): string | null {
  const kind = String(note.fm.kind ?? "");
  if (!(KINDS as readonly string[]).includes(kind)) return null;
  const updated = String(note.fm.updated ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updated)) return null;
  const window = Math.round(DECAY_DAYS[kind as Kind] * (CONFIDENCE_FACTOR[String(note.fm.confidence)] ?? 1));
  const last = [updated, read[note.title] ?? ""].sort().at(-1)!;
  const days = Math.floor((now.getTime() - Date.parse(last)) / 86400_000);
  if (days <= window) return null;
  const since = last === updated ? `updated ${updated}` : `last read ${last}`;
  return `${kind}/${note.fm.confidence} wants a re-check every ${window} days; ${since}, ${days} days ago`;
}

export interface LintOptions { read?: Record<string, string>; overlap?: boolean; now?: Date; tracked?: string[]; templates?: boolean }

export function lintVault(notes: Note[], { read = {}, overlap = false, now = new Date(), tracked = [], templates = false }: LintOptions = {}): { refuse: Finding[]; warn: Finding[] } {
  const refuse: Finding[] = [];
  const warn: Finding[] = [];
  const wiki = wikiNotes(notes);
  // `write` is the gate and refuses on the template; `lint` reports a vault
  // that already exists. A note on disk cannot be un-written, and the template
  // rules are claims about prose that no repair can make true, so they warn
  // here — one line per note, not one per missing heading.
  const template: Finding[] = [];
  for (const n of wiki) {
    const found = validateNote(n, notes);
    refuse.push(...found.filter((f) => f.rule !== "template"));
    const broken = found.filter((f) => f.rule === "template");
    if (broken.length) template.push({ note: n.title, rule: "template", detail: broken.map((f) => f.detail).join("; ") });
  }
  // 69 correct warnings are a wall, and the seventieth is the one that matters.
  // The count goes in the list; the notes go behind `lint --template`.
  if (templates || template.length <= 1) warn.push(...template);
  else warn.push({ note: `${template.length} notes`, rule: "template", detail: `want an \`as of\` marker, a **Claim.** opening or a ## Details/Evidence/Related section; name them with: lint --template` });
  refuse.push(...budgetFindings(notes));
  const targets = linkTargets(notes);
  for (const n of notes.filter((x) => !x.wiki && !x.archived && x.rel !== "VAULT.md")) for (const t of links(n.body)) if (!targets.has(t.toLowerCase())) refuse.push({ note: n.title, rule: "dangling", detail: `[[${t}]] resolves to nothing` });

  // A note deleted by hand is gone from the filesystem, so nothing else here
  // can see it, and no op commits the deletion any more. Say so and name the
  // door: `archive` retires a note without destroying it.
  const onDisk = new Set(notes.map((n) => n.rel));
  for (const rel of tracked) {
    // `loadVault` walks markdown only, so every other tracked file — a
    // `.gitkeep`, an attachment — would look deleted.
    if (!rel.endsWith(".md") || onDisk.has(rel)) continue;
    warn.push({ note: basename(rel, ".md"), rule: "deleted", detail: `${rel} is tracked but gone from disk; retire it with: vault archive "${basename(rel, ".md")}" --why "<one line>"` });
  }

  const home = notes.find((x) => x.rel === "Home.md");
  const fromHome = new Set(links(home?.body ?? "").map((t) => targets.get(t.toLowerCase())?.path));
  for (const n of wiki) {
    if (!HOME_KINDS.includes(String(n.fm.kind))) continue;
    if (!fromHome.has(n.path)) warn.push({ note: n.title, rule: "orphan", detail: "not linked from Home.md" });
  }

  for (const n of wiki) {
    const s = staleness(n, read, now);
    if (s) warn.push({ note: n.title, rule: "stale", detail: s });
  }

  // The overlap check is off. It pairs notes on words their titles and aliases
  // share inside one scope, and the scope already encodes the project name, so
  // it fired 147 times across 62 of 138 notes and named no duplicate worth
  // acting on. Dated series (`... Review 2026-09-19/-20/-23`) pair with each
  // other by design. Word overlap also cannot see the thing that matters, a
  // later note that quietly invalidates an earlier one; the published work on
  // that uses embeddings plus fuzzy matching and still needs a labelled corpus
  // to set the threshold. The code stays until a rule exists that finds
  // something: turn it on with `lint --overlap`.
  if (overlap) for (let i = 0; i < wiki.length; i++) for (let j = i + 1; j < wiki.length; j++) {
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

export interface Health { notes: number; dangling: number; orphans: number; stale: number; date: string }

/**
 * The counts that go in Home's last line, which SessionStart injects.
 *
 * `stale` is here because nothing else shows it. A decay window that nobody
 * reads is a window that closes quietly, and no hook runs `consolidate`.
 */
export function health(notes: Note[], read: Record<string, string> = {}): Health {
  const { refuse, warn } = lintVault(notes, { read });
  const count = (rule: string) => warn.filter((f) => f.rule === rule).length;
  return { notes: wikiNotes(notes).length, dangling: refuse.filter((f) => f.rule === "dangling").length, orphans: count("orphan"), stale: count("stale"), date: today() };
}

export function healthLine(h: Health): string {
  return `Health: ${h.notes} notes, ${h.dangling} dangling, ${h.orphans} orphans, ${h.stale} stale, lint ${h.date}`;
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

/**
 * The repairs that need no judgement. `--fix` edits frontmatter and never the
 * body: frontmatter is structural and each defect below has one right answer,
 * where a missing `## Evidence` or `as of` marker is a claim about the world.
 * Appending those headings would turn "this claim is unbacked" into a passing
 * check and lose the only way to find an unbacked claim later.
 *
 * Edits are line-level, so a note keeps its own formatting and the diff stays
 * readable. Returns null when there is nothing to repair.
 */
export function fixFrontmatter(note: Note, added: string | null): { text: string; repairs: string[] } | null {
  if (!note.hasFrontmatter) return null;
  const { frontmatter, body } = splitFrontmatter(note.text);
  const lines = frontmatter!.split(/\r?\n/);
  const repairs: string[] = [];

  for (const key of LISTS) {
    const v = note.fm[key];
    if (v === undefined || Array.isArray(v)) continue;
    const i = lines.findIndex((l) => new RegExp(`^${key}:\\s`).test(l));
    // Rebuild the line from its own text, not from the parsed value, and only
    // when the text is a plain scalar. A line the parser read as a string
    // because it could not read it at all is a defect to report, not to wrap.
    const raw = i < 0 ? "" : lines[i].slice(key.length + 1).trim();
    if (i < 0 || !raw || /["'\[\]#]/.test(raw)) continue;
    lines[i] = `${key}: [${raw}]`;
    repairs.push(`${key} wrapped in a list`);
  }
  if (note.fm.supersedes === undefined) { lines.push("supersedes: []"); repairs.push("added supersedes: []"); }
  if (note.fm.updated === undefined && added) { lines.push(`updated: ${added}`); repairs.push(`added updated: ${added}, the date the note entered git`); }

  if (!repairs.length) return null;
  return { text: `---\n${lines.join("\n")}\n---\n${body}`, repairs };
}

export interface Candidate { line: number; text: string; why: string }

/**
 * Home.md index lines ranked for removal, worst first, and only as many as the
 * budget needs. Every reason is a fact about the target note, never a guess
 * about what Chris still wants to see. Removing a line drops nothing: the note
 * stays on disk and `recall` still finds it.
 */
export function homeCandidates(notes: Note[]): Candidate[] {
  const home = notes.find((n) => n.rel === "Home.md");
  if (!home) return [];
  const lines = home.text.replace(/\n+$/, "").split("\n");
  const over = lines.length - LINE_BUDGET;
  if (over <= 0) return [];
  const targets = linkTargets(notes);

  const scored: (Candidate & { rank: number; updated: string })[] = [];
  for (const [i, text] of lines.entries()) {
    const m = /^\s*-\s*\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/.exec(text);
    if (!m) continue;
    const hit = targets.get(m[1].trim().toLowerCase());
    const updated = String(hit?.fm.updated ?? "");
    if (!hit) scored.push({ line: i + 1, text, why: `[[${m[1].trim()}]] resolves to nothing`, rank: 0, updated });
    else if (hit.archived) scored.push({ line: i + 1, text, why: `${hit.title} is archived`, rank: 1, updated });
    else scored.push({ line: i + 1, text, why: `${hit.title} last updated ${updated || "never"}`, rank: 2, updated });
  }
  scored.sort((a, b) => a.rank - b.rank || a.updated.localeCompare(b.updated) || a.line - b.line);
  return scored.slice(0, over).map(({ line, text, why }) => ({ line, text, why }));
}

export interface HomePlan {
  text: string;
  dropped: { line: number; text: string; why: string }[];
  missing: { title: string; kind: string; rel: string }[];
  lines: number;
}

/**
 * Home rebuilt as a router: an index line for every live note of a
 * `HOME_KINDS` kind, and nothing else.
 *
 * It drops lines and never writes one. A hook is prose about what a note is
 * for, so a missing line is reported for a human or an agent to write; an
 * invented hook would be a claim nobody made. Headings stay even when they
 * empty out, because their order is Chris's.
 */
export function planHome(notes: Note[]): HomePlan {
  const home = notes.find((n) => n.rel === "Home.md");
  if (!home) return { text: "", dropped: [], missing: [], lines: 0 };
  const targets = linkTargets(notes);
  const kept: string[] = [];
  const dropped: HomePlan["dropped"] = [];
  const indexed = new Set<string>();

  for (const [i, text] of home.text.replace(/\n+$/, "").split("\n").entries()) {
    const m = /^\s*-\s*\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/.exec(text);
    if (!m) { kept.push(text); continue; }
    const hit = targets.get(m[1].trim().toLowerCase());
    if (!hit) dropped.push({ line: i + 1, text, why: `[[${m[1].trim()}]] resolves to nothing` });
    else if (hit.archived) dropped.push({ line: i + 1, text, why: `${hit.title} is archived` });
    else if (!HOME_KINDS.includes(String(hit.fm.kind))) dropped.push({ line: i + 1, text, why: hit.fm.kind === undefined ? `${hit.title} has no kind; fix it, then it can be indexed` : `${hit.fm.kind}s are not indexed; recall finds them` });
    else { kept.push(text); indexed.add(hit.path); }
  }

  const missing = wikiNotes(notes)
    .filter((n) => HOME_KINDS.includes(String(n.fm.kind)) && !indexed.has(n.path))
    .map((n) => ({ title: n.title, kind: String(n.fm.kind), rel: n.rel }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));

  // Two blank lines in a row are what a removed run leaves behind.
  const text = kept.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "") + "\n";
  return { text, dropped, missing, lines: text.replace(/\n+$/, "").split("\n").length };
}

/** Body text that names a date the reader cannot resolve. Reported, never rewritten. */
export function relativeDates(notes: Note[]): Finding[] {
  const words = /\b(yesterday|today|tomorrow|last (?:night|week|month|year)|this (?:morning|week|month)|next week|a few days ago|recently|just now)\b/gi;
  const out: Finding[] = [];
  for (const n of wikiNotes(notes)) {
    const prose = n.body.replace(/```[\s\S]*?```/g, "");
    const hits = [...new Set([...prose.matchAll(words)].map((m) => m[0].toLowerCase()))];
    if (hits.length) out.push({ note: n.title, rule: "relative-date", detail: `says ${hits.map((h) => `"${h}"`).join(", ")}; give the date` });
  }
  return out;
}
