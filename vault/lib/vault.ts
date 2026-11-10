/**
 * The vault on disk: notes, links, validation, lint, health. Pure functions
 * over a directory; the CLI decides what to write and commit.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { today } from "../../lib/day.ts";
import { vaultDir } from "../../lib/paths.ts";
import { parseFrontmatter, splitFrontmatter, type Frontmatter } from "../../lib/frontmatter.ts";

export const KINDS = ["decision", "concept", "entity", "project", "gotcha"] as const;
export type Kind = (typeof KINDS)[number];
export const FOLDERS: Record<Kind, string> = { decision: "decisions", concept: "concepts", entity: "entities", project: "projects", gotcha: "gotchas" };
export const CONFIDENCE = ["measured", "reported", "inferred"] as const;
export const REQUIRED = ["kind", "scope", "confidence", "updated", "supersedes", "sources"] as const;
export const LISTS = ["aliases", "supersedes", "consistent_with", "sources", "tags"] as const;
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

export { vaultDir };

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

export { today };

export function clock(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function readNote(path: string, root: string): Note {
  return parseNote(path, root, readFileSync(path, "utf8"));
}

function parseNote(path: string, root: string, text: string): Note {
  const { frontmatter, body } = splitFrontmatter(text);
  const rel = relative(root, path);
  return { path, rel, title: basename(path, ".md"), fm: frontmatter === null ? {} : parseFrontmatter(frontmatter), hasFrontmatter: frontmatter !== null, body, text, wiki: rel.startsWith("wiki/"), archived: rel.startsWith("archive/") };
}

export function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    // A symlink is followed, as statSync did.
    const isDir = e.isSymbolicLink() ? statSync(p).isDirectory() : e.isDirectory();
    if (isDir) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** Parsed notes by root and path, valid while a file's mtime and size are unchanged. */
const cache = new Map<string, { mtimeMs: number; size: number; note: Note }>();

/** Every markdown file outside .obsidian/, archive included: archived notes are link targets. */
export async function loadVault(root: string): Promise<Note[]> {
  const seen = new Set<string>();
  const notes = await Promise.all(
    walk(root).map(async (p) => {
      const key = `${root}\0${p}`;
      seen.add(key);
      const st = await stat(p);
      const hit = cache.get(key);
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return { ...hit.note };
      const note = parseNote(p, root, await readFile(p, "utf8"));
      cache.set(key, { mtimeMs: st.mtimeMs, size: st.size, note });
      return { ...note };
    }),
  );
  for (const key of cache.keys()) if (key.startsWith(`${root}\0`) && !seen.has(key)) cache.delete(key);
  return notes;
}

/**
 * The notes under wiki/, read in parallel. Each read on a /mnt/c vault costs
 * about 4 ms over 9P, so a serial loadVault of 700 notes takes 3-5 s.
 */
export async function loadWiki(root: string): Promise<Note[]> {
  return Promise.all(walk(join(root, "wiki")).map(async (p) => parseNote(p, root, await readFile(p, "utf8"))));
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

/** The notes, other than `hit`, whose links resolve to `hit` by its title or an alias. */
export function backlinks(notes: Note[], hit: Note): Note[] {
  const targets = linkTargets(notes);
  return notes.filter((n) => n !== hit && links(n.body).some((t) => targets.get(t.toLowerCase()) === hit));
}

/** Every note a name resolves to, in note order: `linkTargets` keeps only the last of them. */
function nameIndex(notes: Note[]): Map<string, Note[]> {
  const m = new Map<string, Note[]>();
  for (const n of notes) for (const name of [n.title, ...list(n.fm, "aliases")]) {
    const k = name.toLowerCase();
    m.set(k, [...(m.get(k) ?? []), n]);
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
export function validateNote(note: Note, others: Note[], index: Map<string, Note[]> = nameIndex(others)): Finding[] {
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
  if (note.fm.core !== undefined && (typeof note.fm.core !== "string" || !note.fm.core.trim() || note.fm.core.length > CORE_MAX)) add("schema", `core must be one line of 1 to ${CORE_MAX} characters`);
  const folder = folderFor(kind);
  if (folder && dirname(note.rel) !== folder) add("folder", `kind ${kind} belongs in ${folder}/, note is in ${dirname(note.rel)}/`);

  const mine = [note.title, ...list(note.fm, "aliases")].map((s) => s.toLowerCase());
  for (const name of mine) {
    const hit = index.get(name)?.filter((o) => o.path !== note.path).at(-1);
    if (hit) add("duplicate", `"${name}" is already the title or an alias of ${hit.rel}`);
  }
  for (const target of links(note.body)) if (!index.has(target.toLowerCase()) && !mine.includes(target.toLowerCase())) add("dangling", `[[${target}]] resolves to nothing`);

  const body = note.body.replace(/^\s*#[^\n]*\n/, "").trimStart();
  const claim = body.split(/\n\s*\n/)[0] ?? "";
  if (!claim.startsWith("**Claim.**")) add("template", "body must open with a paragraph beginning **Claim.**");
  if (!/as of \d{4}-\d{2}-\d{2}/.test(claim)) add("template", "the claim must carry an `as of YYYY-MM-DD` marker");
  for (const h of ["Details", "Evidence", "Related"]) if (!new RegExp(`^## ${h}\\s*$`, "m").test(note.body)) add("template", `missing section ## ${h}`);
  return f;
}

export function budgetFindings(notes: Note[]): Finding[] {
  const f: Finding[] = [];
  for (const name of ["MEMORY"]) {
    const n = notes.find((x) => x.rel === `${name}.md`);
    if (!n) continue;
    const lines = n.text.replace(/\n+$/, "").split("\n").length;
    if (lines > LINE_BUDGET) f.push({ note: name, rule: "budget", detail: `${name}.md is ${lines} lines; the budget is ${LINE_BUDGET}` });
  }
  return f;
}

const STOP = new Set("about after also been before being could does doing from have here into just like make more most much must only other over really should some such than that their them then there these they this those very want were what when where which while will with would your".split(" "));
export const screenWords = (s: string) => (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w));

/** Live wiki notes in the draft's scope that share a title or alias word with it, minus those it supersedes or says it is consistent with, at most `max`. */
export function screenCandidates(draft: Note, notes: Note[], max = 20): Note[] {
  const want = new Set(screenWords([draft.title, ...list(draft.fm, "aliases")].join(" ")));
  const sup = new Set([...list(draft.fm, "supersedes"), ...list(draft.fm, "consistent_with")].map((t) => t.toLowerCase()));
  return wikiNotes(notes)
    .filter((n) => n.fm.scope === draft.fm.scope && !sup.has(n.title.toLowerCase()))
    .filter((n) => screenWords([n.title, ...list(n.fm, "aliases")].join(" ")).some((w) => want.has(w)))
    .slice(0, max);
}

/** The draft's text with `written_by` and `session` added to its frontmatter where it has none. */
export function stampProvenance(draft: Note, sessionId: string | undefined): string {
  const add: string[] = [];
  if (draft.fm.written_by === undefined) add.push(`written_by: ${sessionId ? "claude" : "chris"}`);
  if (sessionId && draft.fm.session === undefined) add.push(`session: ${sessionId}`);
  if (!add.length) return draft.text;
  return draft.text.replace(/^(---\r?\n[\s\S]*?\r?\n)(---)/, (_, head, close) => `${head}${add.join("\n")}\n${close}`);
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
  const index = nameIndex(notes);
  for (const n of wiki) {
    const found = validateNote(n, notes, index);
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

  // The other half: a note on disk that git has never seen. No op commits a
  // path it did not touch, so an unwritten draft sits in `wiki/` for ever,
  // visible to lint and to [[links]] but absent from history. On 2026-09-26
  // seven notes another session had drafted were waiting in the live vault and
  // nothing had said so.
  if (tracked.length) {
    const known = new Set(tracked);
    for (const n of wiki) {
      if (known.has(n.rel)) continue;
      warn.push({ note: n.title, rule: "untracked", detail: `${n.rel} is on disk but git has never seen it; put it through: vault write "${n.rel}" --why "<one line>"` });
    }
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
    const agree = (x: Note, y: Note) => list(x.fm, "consistent_with").some((t) => t.toLowerCase() === y.title.toLowerCase());
    if (sup(a, b) || sup(b, a) || agree(a, b) || agree(b, a)) continue;
    const wa = words([a.title, ...list(a.fm, "aliases")].join(" "));
    const wb = words([b.title, ...list(b.fm, "aliases")].join(" "));
    const shared = [...wa].filter((w) => wb.has(w));
    if (shared.length >= 2) warn.push({ note: a.title, rule: "overlap", detail: `shares "${shared.join('", "')}" with ${b.title} in scope ${a.fm.scope}; neither supersedes the other` });
  }
  return { refuse, warn };
}

export interface Health { notes: number; dangling: number; stale: number; date: string }

/**
 * The counts that go in Home's last line, which SessionStart injects.
 *
 * `stale` is here because nothing else shows it. A decay window that nobody
 * reads is a window that closes quietly, and no hook runs `consolidate`.
 */
export function health(notes: Note[], read: Record<string, string> = {}): Health {
  const { refuse, warn } = lintVault(notes, { read });
  const count = (rule: string) => warn.filter((f) => f.rule === rule).length;
  return { notes: wikiNotes(notes).length, dangling: refuse.filter((f) => f.rule === "dangling").length, stale: count("stale"), date: today() };
}

export function healthLine(h: Health): string {
  return `Health: ${h.notes} notes, ${h.dangling} dangling, ${h.stale} stale, lint ${h.date}`;
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

/** Body text that names a date the reader cannot resolve. Reported, never rewritten. */
export function relativeDates(notes: Note[]): Finding[] {
  const words = /\b(yesterday|today|tomorrow|last (?:night|week|month|year)|this (?:morning|week|month)|next week|a few days ago|recently|just now)\b/gi;
  const out: Finding[] = [];
  for (const n of wikiNotes(notes)) {
    // Code names a word, it does not date anything: `today()` is a function.
    const prose = n.body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]+`/g, "");
    const hits = [...new Set([...prose.matchAll(words)].map((m) => m[0].toLowerCase()))];
    if (hits.length) out.push({ note: n.title, rule: "relative-date", detail: `says ${hits.map((h) => `"${h}"`).join(", ")}; give the date` });
  }
  return out;
}

/**
 * Rewrite the `scope:` line of every note in one scope.
 *
 * Line-level, like `fixFrontmatter`, so a note keeps its own formatting. The
 * vault carried five scope names for two projects, because a rename moved the
 * repo and left every note behind: `voice-bridge` and `voice-bridge-mcp` are
 * both Sidetone, and `caller` is Voiceover. Nothing catches that, because
 * `scope` is free text.
 *
 * Returns the notes it would change, each with its new text. It touches no
 * other line and invents no scope.
 */
export function renameScope(notes: Note[], from: string, to: string): { note: Note; text: string }[] {
  const out: { note: Note; text: string }[] = [];
  for (const n of wikiNotes(notes)) {
    if (String(n.fm.scope) !== from) continue;
    const { frontmatter, body } = splitFrontmatter(n.text);
    if (frontmatter === null) continue;
    const lines = frontmatter.split(/\r?\n/);
    const i = lines.findIndex((l) => /^scope:\s/.test(l));
    if (i < 0) continue;
    lines[i] = `scope: ${to}`;
    out.push({ note: n, text: `---\n${lines.join("\n")}\n---\n${body}` });
  }
  return out.sort((a, b) => a.note.rel.localeCompare(b.note.rel));
}

/** The scope of a session in `cwd`: the main checkout's folder name, so a worktree at `<repo>/.worktrees/<name>` takes the scope of `<repo>`. */
export function repoScope(cwd: string): string {
  const git = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], { stdout: "pipe", stderr: "ignore" });
  return git.exitCode === 0 ? basename(dirname(git.stdout.toString().trim())) : basename(cwd);
}

/** The longest `core:` line, in characters. */
export const CORE_MAX = 160;
/** The bytes the SessionStart context may take: Claude Code shows a 2 KB preview in place of hook output over about 10,000 characters. */
export const START_BUDGET = 6000;

const byNewest = (a: Note, b: Note) => String(b.fm.updated ?? "").localeCompare(String(a.fm.updated ?? "")) || a.title.localeCompare(b.title);

/** The live notes whose `core:` line is always on in `scope`: those of `scope` and of `global`, newest first. */
export function coreNotes(notes: Note[], scope: string): Note[] {
  return wikiNotes(notes).filter((n) => !n.archived && typeof n.fm.core === "string" && [scope, "global"].includes(String(n.fm.scope))).sort(byNewest);
}

/**
 * The SessionStart context for `scope`: MEMORY.md whole, then the core lines,
 * cut at whole lines to START_BUDGET bytes. `cut` counts the core lines left
 * out; the last line then points to the rest.
 */
export function startContext(root: string, notes: Note[], scope: string, head?: string): { text: string; cut: number } {
  const memory = (head ?? notes.find((n) => n.rel === "MEMORY.md")?.text)?.trim();
  const lines = coreNotes(notes, scope).map((n) => `- ${String(n.fm.core).trim()} [[${n.title}]]`);
  const render = (kept: string[]) => {
    const cut = lines.length - kept.length;
    return [`<vault path="${root}">`, ...(memory ? [memory, ""] : []), ...kept, ...(cut ? [`${cut} more core lines: vault recall --scope ${scope}`] : []), "</vault>"].join("\n");
  };
  let kept = lines;
  while (kept.length && Buffer.byteLength(render(kept)) > START_BUDGET) kept = kept.slice(0, -1);
  return { text: render(kept), cut: lines.length - kept.length };
}

const KIND_HEADINGS: Record<string, string> = { decision: "Decisions", project: "Projects", concept: "Concepts", entity: "Entities" };

/**
 * Home.md, generated: every live decision, project, concept and entity note
 * under its scope (global first), then its kind, newest first, with its core
 * line when it has one. The health line is last. Nothing here is hand-written,
 * so two writes in either order give the same Home.
 */
export function homeText(notes: Note[], healthLine: string): string {
  const shown = wikiNotes(notes).filter((n) => !n.archived && HOME_KINDS.includes(String(n.fm.kind)));
  const scopes = [...new Set(shown.map((n) => String(n.fm.scope ?? "")))].sort((a, b) => Number(b === "global") - Number(a === "global") || a.localeCompare(b));
  const out = ["# Home", "", "Generated by `vault write` from the notes; do not edit it. Each line is a note, with its core line when it has one.", ""];
  for (const scope of scopes) {
    out.push(`## ${scope || "(no scope)"}`, "");
    for (const kind of HOME_KINDS) {
      const ns = shown.filter((n) => String(n.fm.scope ?? "") === scope && n.fm.kind === kind).sort(byNewest);
      if (!ns.length) continue;
      out.push(`### ${KIND_HEADINGS[kind]}`, ...ns.map((n) => `- [[${n.title}]]${typeof n.fm.core === "string" ? ` — ${n.fm.core.trim()}` : ""}`), "");
    }
  }
  return [...out, healthLine, ""].join("\n");
}
