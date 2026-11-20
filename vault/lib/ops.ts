/**
 * The ops of `aleph memory`, each a function of the vault root with typed arguments. An op returns its value or a
 * refusal as data and prints nothing; vault/lib/cli.ts parses argv and prints.
 */
import { copyFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { judgeChoice, nouls, type Noul } from "../../lib/jev.ts";
import { langfuse } from "../../lib/langfuse.ts";
import { readJsonOr, writeJson } from "../../lib/json.ts";
import { missesStore } from "../../jobs/lib/infra/settings.ts";
import type { Observation } from "../../lib/langfuse.ts";
import { serializeFrontmatter } from "../../lib/frontmatter.ts";
import { addedDate, commitPaths, pushOrigin, tracked, trackedFiles } from "./git.ts";
import { git } from "../../lib/git.ts";
import { compileDigest } from "./compile.ts";
import { GITIGNORE, MEMORY_MD, OBSIDIAN, VAULT_MD } from "./templates.ts";
import { claimLine, recall as recallNotes } from "./index.ts";
import { recallQuery } from "./recall-query.ts";
import { appendDaily as writeDaily, backlinks, budgetFindings, coreNotes, fixFrontmatter, folderFor, isVault, lintVault, linkTargets, loadVault, loadWiki, noteRead, parseNote, readNote, recordCompiled, recordRun, relativeDates, renameScope, scopeOf, screenCandidates, stampProvenance, START_BUDGET, startContext, validateNote, wikiNotes, type Finding, type Note, type Op } from "./vault.ts";
import { today } from "../../lib/day.ts";
import { errText } from "../../lib/errtext.ts";

/** The text of a finding as `aleph memory` prints it, after `refuse` or `warn`. */
const line = (kind: "refuse" | "warn", f: Finding): string => `${kind} ${f.rule} ${f.note}: ${f.detail}`;

/** An op that did not run to its end: findings that refuse it, or an `error` for a fault such as a missing file. */
export interface Refused { ok: false; findings: Finding[]; hint?: string; error?: string; warnings: string[] }
/** An op that ran: its `value`, which `aleph memory` prints as JSON. `warnings` are the stderr lines it raised. */
export interface Done<T> { ok: true; value: T; warnings: string[] }
export type Result<T> = Done<T> | Refused;
export interface Committed { commit: string | null }

/** Thrown inside an op to end it; `op` turns it into a `Refused`. */
class Stop extends Error { constructor(readonly findings: Finding[], readonly hint?: string, readonly error?: string) { super("refused"); } }
export function fail(error: string): never { throw new Stop([], undefined, error); }
function refuse(findings: Finding[], hint?: string): never { throw new Stop(findings, hint); }

/** Run `body` as one op: its value, or the refusal it ended with. `w` collects the warnings, whichever way it ends. */
export async function op<T>(body: (w: string[]) => Promise<T>): Promise<Result<T>> {
  const warnings: string[] = [];
  try { return { ok: true, value: await body(warnings), warnings }; }
  catch (e) {
    if (!(e instanceof Stop)) throw e;
    return { ok: false, findings: e.findings, hint: e.hint, error: e.error, warnings };
  }
}

/** A result as the fields of a verdict's outcome: its commit, or its refusal with the rule. */
export function outcome(r: Result<Committed>): { commit: string | null } | { rule?: string; refused: string } {
  if (r.ok) return { commit: r.value.commit };
  const f = r.findings[0];
  return { rule: f?.rule, refused: f ? line("refuse", f) : r.error ?? "refused" };
}

/**
 * Commit, then push. Every vault op that writes goes through here, so the
 * second copy is never one someone forgot to make.
 */
export function commitAndPush(root: string, w: string[], subject: string, paths: string[]): string | null {
  const commit = commitPaths(root, subject, paths);
  if (!commit) return null;
  const p = pushOrigin(root);
  if (p.detail !== "no origin") recordRun(root, "vault push", p.pushed ? "ok" : "failed", p.detail);
  if (!p.pushed && p.detail !== "no origin") w.push(`warn push ${subject}: ${p.detail}; the commit stands, push it when you can`);
  return commit;
}

const warn = (w: string[], findings: Finding[]): void => { w.push(...findings.map((f) => line("warn", f))); };
export function requireVault(root: string): void {
  if (!isVault(root)) fail(`no vault at ${root}; run: aleph memory init`);
}

/** The live wiki notes by title and alias. */
const live = (notes: Note[]) => linkTargets(wikiNotes(notes));

/**
 * Undo exactly the paths one write touched, and nothing else.
 *
 * `git checkout -- .` and `git clean -fdq` used to stand here. They reverted
 * every uncommitted change in the vault and deleted every untracked file in it,
 * whoever had made them: on 2026-09-24 a refused write destroyed two notes an
 * earlier session had left uncommitted and six lines of an index file. A rollback may
 * only undo its own write.
 *
 * A path git knows goes back to its committed state; a path git has never seen
 * was created by this write, so it is removed.
 */
function rollback(root: string, paths: string[]): void {
  for (const p of [...new Set(paths)]) {
    const rel = relative(root, p);
    if (git(root, "ls-files", "--error-unmatch", "--", rel).ok) git(root, "checkout", "--", rel);
    else if (existsSync(p)) unlinkSync(p);
  }
}

/**
 * The refusal for a core line the start context cannot hold: a write that
 * grows a scope's start context past the budget. A write that keeps an
 * over-budget scope the same size or smaller, such as a shorter core line,
 * passes. A global core line is on in every scope, so it is checked against
 * each scope that has core lines.
 */
function coreFindings(root: string, prior: Note[], notes: Note[], draft: Note): { findings: Finding[]; hint: string } {
  const scope = scopeOf(draft);
  const scopes = scope === "global" ? [...new Set(["global", ...wikiNotes(notes).filter((n) => typeof n.fm.core === "string").map(scopeOf)])] : [scope];
  for (const s of scopes) {
    const { bytes } = startContext(root, notes, s);
    if (bytes <= START_BUDGET || bytes <= startContext(root, prior, s).bytes) continue;
    const ranked = coreNotes(notes, s).reverse();
    return {
      findings: [{ note: draft.title, rule: "core", detail: `the start context of scope ${s} is over ${START_BUDGET} bytes with this core line` }],
      hint: ["", `Core lines of ${s} and global ranked for demotion, oldest first. Remove the core: field of one; the note stays and recall still finds it:`,
        ...ranked.map((n) => `  ${n.title} (updated ${n.fm.updated ?? "never"}, ${n.fm.scope}): ${n.fm.core}`)].join("\n"),
    };
  }
  return { findings: [], hint: "" };
}

export const init = (root: string) => op(async (w) => {
  if (isVault(root)) fail(`vault already at ${root}`);
  const made: string[] = [];
  const lay = (rel: string, text: string) => { writeFileSync(join(root, rel), text); made.push(join(root, rel)); };
  for (const d of ["wiki/decisions", "wiki/concepts", "wiki/entities", "wiki/projects", "wiki/gotchas", "daily", "archive", "attachments", ".obsidian"]) mkdirSync(join(root, d), { recursive: true });
  for (const d of ["daily", "archive", "attachments"]) lay(join(d, ".gitkeep"), "");
  for (const d of ["decisions", "concepts", "entities", "projects", "gotchas"]) lay(join("wiki", d, ".gitkeep"), "");
  lay("VAULT.md", VAULT_MD);
  lay("MEMORY.md", MEMORY_MD);
  lay(".gitignore", GITIGNORE);
  for (const [name, value] of Object.entries(OBSIDIAN)) lay(join(".obsidian", name), JSON.stringify(value, null, 2) + "\n");
  if (!existsSync(join(root, ".git"))) {
    const r = git(root, "init", "-q", "-b", "main");
    if (!r.ok) fail(r.out);
  }
  const commit = commitAndPush(root, w, "init vault", made);
  return { op: "init", path: root, commit };
});

export interface Written extends Committed { op: string; title: string; path: string; archived?: string[]; warnings?: Finding[] }

export const write = (root: string, src: string, why: string) => op<Written>(async (w) => {
  requireVault(root);
  const srcPath = resolve(src);
  if (!existsSync(srcPath)) fail(`no such file: ${srcPath}`);
  const inside = !relative(root, srcPath).startsWith("..");
  const rel = inside ? relative(root, srcPath) : null;

  if (rel === "VAULT.md") refuse([{ note: "VAULT", rule: "owner", detail: "VAULT.md is human-owned; propose a change in wiki/decisions/ and ask" }]);
  if (rel === "MEMORY.md") {
    const name = "MEMORY";
    const notes = await loadVault(root);
    const budget = budgetFindings(notes).filter((f) => f.note === name);
    if (budget.length) refuse(budget);
    const { refuse: r, warn: warns } = lintVault(notes);
    const dangling = r.filter((f) => f.note === name);
    if (dangling.length) refuse(dangling);
    warn(w, warns);
    const daily = writeDaily(root, { op: "write", title: name, why });
    const commit = commitAndPush(root, w, `write: ${name}`, [join(root, `${name}.md`), daily]);
    return { op: "write", title: name, path: `${name}.md`, warnings: warns, commit };
  }

  const draft = readNote(srcPath, inside ? root : dirname(srcPath));
  const folder = folderFor(String(draft.fm.kind ?? ""));
  const dest = folder ? join(root, folder, `${draft.title}.md`) : srcPath;
  const notes = (await loadVault(root)).filter((n) => n.path !== srcPath && n.path !== dest);
  const placed: Note = { ...draft, path: dest, rel: relative(root, dest), wiki: true, archived: false };
  if (inside && folder && dirname(rel!) !== folder) refuse([{ note: draft.title, rule: "folder", detail: `kind ${draft.fm.kind} belongs in ${folder}/, file is in ${dirname(rel!)}/` }]);
  const findings = validateNote(placed, notes);
  const supersedes = Array.isArray(draft.fm.supersedes) ? draft.fm.supersedes : [];
  const old: Note[] = [];
  const names = live(notes);
  for (const title of supersedes) {
    const hit = names.get(title.toLowerCase());
    if (!hit) findings.push({ note: draft.title, rule: "supersedes", detail: `supersedes [${title}] but no live wiki note has that title` });
    else old.push(hit);
  }
  for (const title of Array.isArray(draft.fm.consistent_with) ? draft.fm.consistent_with : []) {
    if (!names.has(String(title).toLowerCase())) findings.push({ note: draft.title, rule: "consistent_with", detail: `consistent_with [${title}] but no live wiki note has that title` });
  }
  for (const title of Array.isArray(draft.fm.distinct) ? draft.fm.distinct : []) {
    if (!names.has(String(title).toLowerCase())) findings.push({ note: draft.title, rule: "distinct", detail: `distinct [${title}] but no live wiki note has that title` });
  }
  // A draft that already sits at its destination and that no write has ever
  // accepted is invisible to git but not to lint or to [[links]]. Name it; do
  // not delete it. It may be Chris's own note, typed in Obsidian, and b089def
  // is what undoing another writer's work costs.
  if (findings.length) refuse(findings, existsSync(dest) && !tracked(root, dest)
    ? `${relative(root, dest)} is in the vault but no write has accepted it. Fix it and rerun, or remove it.`
    : undefined);
  // MEMORY is budgeted. A note write may not make it longer while it is over,
  // but an over-budget MEMORY does not block a note that leaves it as it was:
  // the factory's facts gate writes unattended, and from 1 to 3 Nov it lost 28
  // kept facts to an index file one line over (lint still warns).
  const overBudget = budgetFindings(await loadVault(root));

  // The contradiction screen. A Jev failure never blocks a write.
  if (judgeChoice() !== "haiku") {
    const candidates = screenCandidates(placed, notes);
    if (candidates.length) {
      const questions: Record<string, Noul> = {};
      candidates.forEach((n, i) => {
        questions[`n${i}`] = { type: "noul", instructions: `Does the draft's claim contradict the note's claim? Draft \`${draft.title}\` (its claim line: ${claimLine(draft)}). Note \`${n.title}\` (its claim line: ${claimLine(n)}).` };
      });
      try {
        const { p } = await nouls({ draft: draft.title }, questions);
        const hits = candidates.filter((_, i) => p[`n${i}`] >= 0.7);
        if (hits.length) {
          refuse(hits.map((n) => ({ note: n.title, rule: "contradiction", detail: `the draft [${draft.title}] may contradict [${n.title}]` })), "add it to supersedes or fix the draft: this write changed nothing; name it in consistent_with if the two agree");
        }
      } catch (e) {
        if (e instanceof Stop) throw e; // the refusal above
        w.push(`warn contradiction ${draft.title}: screen skipped, ${(e as Error).message}`);
      }
    }
  }

  const touched: string[] = [dest];
  const log = (o: Op) => { const p = writeDaily(root, o); if (!touched.includes(p)) touched.push(p); };
  mkdirSync(dirname(dest), { recursive: true });
  const stamped = stampProvenance(draft, process.env.CLAUDE_CODE_SESSION_ID || undefined);
  if (srcPath !== dest) copyFileSync(srcPath, dest);
  if (stamped !== draft.text) writeFileSync(dest, stamped);
  const archived: string[] = [];
  for (const o of old) {
    const target = join(root, "archive", `${o.title}.md`);
    const fm = { ...o.fm, archived: today(), archived_reason: `superseded by [[${draft.title}]]` };
    writeFileSync(target, serializeFrontmatter(fm) + o.body);
    touched.push(target, o.path);
    unlinkSync(o.path);
    archived.push(o.title);
    log({ op: "supersede", title: o.title, why: `superseded by [[${draft.title}]]` });
  }
  log({ op: "write", title: draft.title, why });
  const after = await loadVault(root);
  const budget = budgetFindings(after).filter((f) => !overBudget.some((b) => b.detail === f.detail));
  if (budget.length) { rollback(root, touched); refuse(budget); }
  if (typeof draft.fm.core === "string") {
    // A draft written in place is already on disk, so the vault before the write holds the committed note.
    const head = git(root, "show", `HEAD:${relative(root, dest)}`);
    const core = coreFindings(root, head.ok ? [...notes, parseNote(dest, root, head.out)] : notes, after, placed);
    if (core.findings.length) { rollback(root, touched); refuse(core.findings, core.hint); }
  }
  warn(w, lintVault(after).warn.filter((f) => f.note === draft.title || f.detail.includes(draft.title)));
  const subject = archived.length ? `supersede: ${archived.join(", ")} → ${draft.title}` : `write: ${draft.title}`;
  const commit = commitAndPush(root, w, subject, touched);
  return { op: archived.length ? "supersede" : "write", title: draft.title, path: relative(root, dest), archived, commit };
});

// A query returns the best few: an agent reads the top of the list, and a full match list ran to 10,323 lines.
const TOP = 10;

export interface Hit { title: string; path: string; rank: number; scope: string; frontmatter: Note["fm"] }
interface RecallArgs { query: string; scope?: string; unlogged?: boolean }

export const recall = (root: string, { query: q, scope, unlogged = false }: RecallArgs) => op<Hit[]>(async (w) => {
  requireVault(root);
  // `--scope` alone lists a project's notes: at 165 notes "what do we know
  // about cloudchamber" is a real question, and ranking every note by one word
  // could not answer it.
  const notes = await loadWiki(root);
  const scoped = notes.filter((n) => scope === undefined || String(n.fm.scope) === scope);
  const hits = q
    ? recallNotes(root, notes, q, scope, scoped).slice(0, TOP).map(({ note, rank }) => ({ n: note, r: rank }))
    : scoped.map((n) => ({ n, r: 4 })).sort((a, b) => a.n.title.localeCompare(b.n.title));
  noteRead(root, hits.map(({ n }) => n.title), q, unlogged);
  // A scope nobody uses is almost always a misspelling of one that exists, and
  // the vault has five names for one project. Say so rather than return [].
  if (scope !== undefined && !hits.length) {
    const known = [...new Set(notes.map((n) => String(n.fm.scope)))].sort();
    w.push(`no note has scope ${scope}; the vault uses: ${known.join(", ")}`);
  }
  return hits.map(({ n, r }) => ({ title: n.title, path: n.rel, rank: r, scope: String(n.fm.scope), frontmatter: n.fm }));
});

const asValue = (v: unknown): unknown => { if (typeof v === "string") { try { return JSON.parse(v); } catch { return v; } } return v; };
const fieldOf = (v: unknown, k: string): unknown => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined);
/** A tool's output as text: a bare string, or the stdout of a result object. */
function outText(v: unknown): string {
  const x = asValue(v);
  if (typeof x === "string") return x.trim();
  if (x && typeof x === "object" && "stdout" in x && typeof x.stdout === "string") return x.stdout.trim();
  return x === undefined || x === null ? "" : JSON.stringify(x);
}
const queryWords = (q: string) => new Set(q.toLowerCase().match(/[^\s"']+/g) ?? []);
const noteName = (p: string) => basename(p).replace(/\.md$/, "");

export const misses = (days = 7) => op(async () => {
  const lf = langfuse();
  if (!lf) fail("no Langfuse keys");
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  // Only these three names are read below: asking for them alone skips more than half of a week's pages.
  // One name at a time keeps the in-flight pages at allPages' own limit.
  const end = new Date(to.getTime() + 60_000);
  // The rows kept on disk for this base: a run reads only since the last run's end less 2 hours (late writes), and
  // any older part of its window not kept; each day it reads the whole window again.
  const file = missesStore(lf.base);
  const old = readJsonOr<{ rows: Observation[]; from: number; to: number; full: number } | null>(file, null);
  const full = !old || to.getTime() - old.full > 86400_000;
  const ranges = full ? [[from.getTime(), end.getTime()]] : [[old.to - 2 * 3600_000, end.getTime()], ...(from.getTime() < old.from ? [[from.getTime(), old.from]] : [])];
  const kept = new Map<string, Observation>(full ? [] : old.rows.map((o) => [o.id, o]));
  try {
    for (const name of ["Bash", "Read", "vault-recall"]) for (const [a, b] of ranges) for (const o of (await lf.observations({ from: new Date(a), to: new Date(b), name })).rows) kept.set(o.id, o);
  } catch (e) { fail(`Langfuse failed: ${errText(e)}`); }
  let obs = [...kept.values()];
  writeJson(file, { rows: obs, from: full ? from.getTime() : Math.min(old.from, from.getTime()), to: end.getTime(), full: full ? to.getTime() : old.full });
  obs = obs.filter((o) => !o.startTime || new Date(o.startTime) >= from).sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));

  const cmdOf = (o: Observation): string => { const i = asValue(o.input); return String(typeof i === "string" ? i : fieldOf(i, "command") ?? "").trim(); };
  const queryOf = (o: Observation) => recallQuery(cmdOf(o)) ?? "";
  const recalls = obs.filter((o) => o.name === "Bash" && recallQuery(cmdOf(o)) !== null);
  const empty = recalls.filter((o) => outText(o.output) === "[]");
  const byTurn = new Map<string, Observation[]>();
  for (const o of recalls) byTurn.set(o.traceId ?? "", [...(byTurn.get(o.traceId ?? "") ?? []), o]);
  const reformulated = [...byTurn.values()].filter((calls) => {
    if (calls.length < 2) return false;
    if (outText(calls[0].output) === "[]") return true;
    const first = queryWords(queryOf(calls[0]));
    return calls.slice(1).some((c) => { const w = queryWords(queryOf(c)); return w.size !== first.size || [...w].some((x) => !first.has(x)); });
  }).length;

  const spans = obs.filter((o) => o.name === "vault-recall");
  const offeredIn = new Map<string, string[]>();
  for (const o of recalls) offeredIn.set(o.traceId ?? "", [...(offeredIn.get(o.traceId ?? "") ?? []), outText(o.output)]);
  for (const o of spans) offeredIn.set(o.traceId ?? "", [...(offeredIn.get(o.traceId ?? "") ?? []), outText(o.output), String(o.metadata?.offered ?? "")]);
  const unoffered = obs.filter((o) => {
    if (o.name !== "Read") return false;
    const i = asValue(o.input);
    const path = String(fieldOf(i, "file_path") ?? fieldOf(i, "path") ?? "");
    if (!/(^|\/)wiki\/.+\.md$/.test(path)) return false;
    const seen = offeredIn.get(o.traceId ?? "") ?? [];
    return !seen.some((t) => t.includes(path) || t.includes(noteName(path)));
  }).length;

  const num = (v: unknown) => Number(v) || 0;
  const meta = spans.map((o) => o.metadata ?? {});
  return {
    days, recalls: recalls.length, empty: empty.length, empty_share: recalls.length ? empty.length / recalls.length : 0,
    reformulated, unoffered_reads: unoffered,
    missed: empty.slice(-10).reverse().map((o) => ({ query: queryOf(o), at: o.startTime ?? "" })),
    hook: {
      runs: spans.length,
      zero_candidates: meta.filter((m) => num(m.candidates) === 0).length,
      capped: meta.filter((m) => m.capped === true || m.capped === "true").length,
      mean_kept: spans.length ? meta.reduce((a, m) => a + num(m.kept), 0) / spans.length : 0,
    },
  };
});

interface LintOpts { fix?: boolean; overlap?: boolean; template?: boolean }

export const lint = (root: string, o: LintOpts = {}) => op(async (w) => {
  requireVault(root);
  const fixed: { note: string; path: string; repairs: string[] }[] = [];
  if (o.fix) {
    for (const n of await loadWiki(root)) {
      const r = fixFrontmatter(n, addedDate(root, n.path));
      if (!r) continue;
      writeFileSync(n.path, r.text);
      fixed.push({ note: n.title, path: n.rel, repairs: r.repairs });
    }
  }
  const notes = await loadVault(root);
  const result = lintVault(notes, { overlap: o.overlap, templates: o.template, tracked: trackedFiles(root, "wiki") });
  result.warn.push(...relativeDates(notes));
  const touched = [...fixed.map((f) => join(root, f.path))];
  const commit = commitAndPush(root, w, fixed.length ? `lint --fix: ${fixed.length} notes` : `lint: ${today()}`, touched);
  return { fixed, ...result, commit };
});

/**
 * Commit a note that is already in the vault but that git has never seen.
 *
 * `write` gates new prose and refuses on the template; `lint` treats the
 * template as a warning, because a note on disk cannot be un-written. A draft
 * written straight into `wiki/` is both at once, so before this op there was no
 * door: `write` refused it and no other op would commit it. Five such notes
 * were stranded in the live vault on 2026-09-26.
 *
 * Adopt applies every schema, folder, duplicate and dangling refusal — those
 * are structural and fixable. It demotes the template to a warning, and says
 * what is missing, so the gap is recorded rather than papered over. It does not
 * edit the note: adding an `## Evidence` heading nobody wrote would turn "this
 * claim is unbacked" into a passing check.
 */
export const adopt = (root: string, src: string, why: string) => op(async (w) => {
  requireVault(root);
  const path = resolve(src);
  if (!existsSync(path)) fail(`no such file: ${path}`);
  const rel = relative(root, path);
  if (rel.startsWith("..")) fail(`${src} is outside the vault; adopt is for a note already in it — use: aleph memory write`);
  if (!rel.startsWith("wiki/")) fail(`${rel} is not a wiki note; adopt only takes one`);
  if (tracked(root, path)) fail(`${rel} is already tracked; rewrite it with: aleph memory write`);

  const note = readNote(path, root);
  const folder = folderFor(String(note.fm.kind ?? ""));
  if (folder && dirname(rel) !== folder) refuse([{ note: note.title, rule: "folder", detail: `kind ${note.fm.kind} belongs in ${folder}/, note is in ${dirname(rel)}/` }]);
  const findings = validateNote(note, (await loadVault(root)).filter((n) => n.path !== path));
  const template = findings.filter((f) => f.rule === "template");
  const hard = findings.filter((f) => f.rule !== "template");
  if (hard.length) refuse(hard, "adopt forgives the template, not the schema");

  const daily = writeDaily(root, { op: "adopt", title: note.title, why });
  const commit = commitAndPush(root, w, `adopt: ${note.title}`, [path, daily]);
  warn(w, template);
  return { op: "adopt", title: note.title, path: rel, template, commit };
});

/**
 * Move every note in one scope to another. Read-only unless `--apply`.
 *
 * A rename moves the repo and leaves the notes behind, so the vault ends up
 * with several names for one project and no way to see it: `scope` is free
 * text, and the only rule that read it is off. On 2026-09-26 five names covered
 * two projects across 49 notes.
 */
export const renameScopeOp = (root: string, from: string, to: string, apply: boolean) => op(async (w) => {
  requireVault(root);
  const notes = await loadVault(root);
  const scopes = [...new Set(wikiNotes(notes).map((n) => String(n.fm.scope)))].sort();
  if (!scopes.includes(from)) refuse([{ note: from, rule: "scope", detail: `no note has scope ${from}; the vault uses: ${scopes.join(", ")}` }]);
  const changes = renameScope(notes, from, to);

  let commit: string | null = null;
  if (apply && changes.length) {
    for (const c of changes) writeFileSync(c.note.path, c.text);
    const daily = writeDaily(root, { op: "rename-scope", title: `${from} → ${to}`, why: `${changes.length} notes` });
    commit = commitAndPush(root, w, `rename-scope: ${from} → ${to}, ${changes.length} notes`,
      [...changes.map((c) => c.note.path), daily]);
  }
  if (!apply && changes.length) w.push(`rename-scope changed nothing; rerun with --apply to move ${changes.length} notes from ${from} to ${to}`);
  return { op: "rename-scope", from, to, applied: apply, notes: changes.map((c) => c.note.rel), count: changes.length, commit };
});

/**
 * Retire a note without writing its replacement.
 *
 * `supersedes` was the only exit, and it needs a newer note that covers the
 * same ground. A subject that is simply over has no such note, so nothing ever
 * left: 2 notes archived in the vault's first 20 days. Archive is not
 * deletion; the file moves to `archive/` and stays a link target.
 */
export interface Archived extends Committed { op: string; title: string; path: string; why: string; inbound: string[] }

export const archive = (root: string, title: string, why: string) => op<Archived>(async (w) => {
  requireVault(root);
  const notes = await loadVault(root);
  const hit = live(notes).get(title.toLowerCase());
  if (!hit) refuse([{ note: title, rule: "archive", detail: "no live wiki note has that title" }]);

  // Wiki notes only. A daily note is
  // a record of what happened on a day; neither is a caller to warn about.
  const inbound = backlinks(notes, hit).filter((n) => n.wiki);
  const dest = join(root, "archive", `${hit.title}.md`);
  const fm = { ...hit.fm, archived: today(), archived_reason: why };
  writeFileSync(dest, serializeFrontmatter(fm) + hit.body);
  unlinkSync(hit.path);
  const daily = writeDaily(root, { op: "archive", title: hit.title, why });
  const commit = commitAndPush(root, w, `archive: ${hit.title}`, [dest, hit.path, daily]);
  // An archived note stays a link target, so nothing dangles; the callers are
  // named because each one now points at a retired claim.
  warn(w, inbound.map((n) => ({ note: n.title, rule: "inbound", detail: `links [[${hit.title}]], which is now archived` })));
  return { op: "archive", title: hit.title, path: relative(root, dest), why, inbound: inbound.map((n) => n.title), commit };
});

/**
 * Remove a note for good: a claim that was wrong, not one that is over. Git keeps the old file. A note that a live
 * note links to is refused, since its callers would dangle; unlink them or archive it instead.
 */
export const del = (root: string, title: string, why: string) => op(async (w) => {
  requireVault(root);
  const notes = await loadVault(root);
  const hit = live(notes).get(title.toLowerCase());
  if (!hit) refuse([{ note: title, rule: "delete", detail: "no live wiki note has that title" }]);
  const inbound = backlinks(notes, hit).filter((n) => n.wiki);
  if (inbound.length) refuse(inbound.map((n) => ({ note: n.title, rule: "inbound", detail: `links [[${hit.title}]]; unlink it or archive [${hit.title}] instead` })));
  unlinkSync(hit.path);
  const daily = writeDaily(root, { op: "delete", title: hit.title, why });
  const commit = commitAndPush(root, w, `delete: ${hit.title}`, [hit.path, daily]);
  return { op: "delete", title: hit.title, why, commit };
});

/** The digest of `date` as text; it marks the day compiled. */
export const compile = (root: string, date: string) => op(async () => {
  requireVault(root);
  const { text } = await compileDigest(root, date);
  recordCompiled(root, date);
  return text;
});
