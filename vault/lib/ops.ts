/**
 * The ops of `aleph memory`: jobs/commands.ts passes its argv to `run`. Each op prints JSON on stdout and findings
 * on stderr, and ends with `Exit` for a refusal, which the CLI turns into its exit code.
 */
import { readJsonOr } from "../../lib/json.ts";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { judgeChoice, nouls, type Noul } from "../../lib/jev.ts";
import { langfuse } from "../../lib/langfuse.ts";
import type { Observation } from "../../lib/otlp.ts";
import { serializeFrontmatter } from "../../lib/frontmatter.ts";
import { addedDate, commitPaths, git, pushOrigin, tracked, trackedFiles } from "./git.ts";
import { compileDigest } from "./compile.ts";
import { GITIGNORE, MEMORY_MD, OBSIDIAN, VAULT_MD } from "./templates.ts";
import { claimLine, openIndex, rankNotes } from "./index.ts";
import { maintain } from "./maintain.ts";
import { recallQuery } from "./recall-query.ts";
import { appendDaily as writeDaily, appendRecallLog, backlinks, budgetFindings, coreNotes, fixFrontmatter, folderFor, health, healthLine, homeText, lintVault, loadVault, readNote, recordCompiled, recordRun, relativeDates, renameScope, screenCandidates, stampProvenance, START_BUDGET, startContext, today, validateNote, vaultDir, wikiNotes, type Finding, type Note } from "./vault.ts";
import { layout, logEvent } from "../../lib/layout.ts";
import { logUse } from "../../lib/episode-use.ts";

/** An op's end with an exit code: 1 for a refusal, 2 for a usage error. */
export class Exit extends Error { constructor(readonly code: number) { super(`exit ${code}`); } }
function exit(code: number): never { throw new Exit(code); }

let cmd: string | undefined, rest: string[] = [];
const rootOf = () => resolve(vaultDir());
let root = "";


function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}
function has(name: string): boolean { return rest.includes(`--${name}`); }
let positional: string[] = [];

function out(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }

/**
 * Commit, then push. Every vault op that writes goes through here, so the
 * second copy is never one someone forgot to make.
 */
function commitAndPush(subject: string, paths: string[]): string | null {
  const commit = commitPaths(root, subject, paths);
  if (!commit) return null;
  const p = pushOrigin(root);
  if (p.detail !== "no origin") recordRun(root, "vault push", p.pushed ? "ok" : "failed", p.detail);
  if (!p.pushed && p.detail !== "no origin") console.error(`warn push ${subject}: ${p.detail}; the commit stands, push it when you can`);
  return commit;
}
function refuse(findings: Finding[], hint?: string): never {
  for (const f of findings) console.error(`refuse ${f.rule} ${f.note}: ${f.detail}`);
  if (hint) console.error(hint);
  out({ findings });
  exit(1);
}

function warn(findings: Finding[]): void {
  for (const f of findings) console.error(`warn ${f.rule} ${f.note}: ${f.detail}`);
}
function requireVault(): void {
  if (!existsSync(join(root, "Home.md"))) { console.error(`no vault at ${root}; run: aleph memory init`); exit(1); }
}

function appendDaily(line: string): void { writeDaily(root, line); }

/**
 * Undo exactly the paths one write touched, and nothing else.
 *
 * `git checkout -- .` and `git clean -fdq` used to stand here. They reverted
 * every uncommitted change in the vault and deleted every untracked file in it,
 * whoever had made them: on 2026-09-24 a refused write destroyed two notes an
 * earlier session had left uncommitted and six lines of Home.md. A rollback may
 * only undo its own write.
 *
 * A path git knows goes back to its committed state; a path git has never seen
 * was created by this write, so it is removed.
 */
function rollback(paths: string[]): void {
  for (const p of [...new Set(paths)]) {
    const rel = relative(root, p);
    if (git(root, "ls-files", "--error-unmatch", "--", rel).ok) git(root, "checkout", "--", rel);
    else if (existsSync(p)) unlinkSync(p);
  }
}

/**
 * When `recall` last returned each note, by title. A retention curve resets on
 * use, so staleness reads this beside `updated`.
 *
 * It lives outside git: a read is not a change to memory, and committing one
 * on every recall would bury the writes that matter. Losing the file only
 * costs the reset, so every access here is best-effort.
 */
const READ_LOG = () => join(root, ".recall.json");
function readLog(): Record<string, string> {
  return readJsonOr(READ_LOG(), {});
}
function noteRead(titles: string[], query: string): void {
  // `--unlogged`: a person browsing is not a read by an agent, and the Memory page shows the log as use.
  // `ALEPH_RECALL_UNLOGGED`: a dry compile's model recalls without a flag it could leave out.
  if (!titles.length || rest.includes("--unlogged") || process.env.ALEPH_RECALL_UNLOGGED) return;
  try {
    const log = readLog();
    for (const t of titles) log[t] = today();
    writeFileSync(READ_LOG(), JSON.stringify(log, null, 0));
    appendRecallLog(root, titles, query, process.env.CLAUDE_CODE_SESSION_ID || null, "cli");
  } catch { /* a read must never fail on its own bookkeeping */ }
}

/** Write Home.md, generated from the notes, with the health line last. */
async function writeHome(): Promise<void> {
  const notes = await loadVault(root);
  writeFileSync(join(root, "Home.md"), homeText(notes, healthLine(health(notes, readLog()))));
}

/**
 * The refusal for a core line the start context cannot hold. A global core
 * line is on in every scope, so it is checked against each scope that has
 * core lines.
 */
function coreFindings(notes: Note[], draft: Note): { findings: Finding[]; hint: string } {
  const scope = String(draft.fm.scope);
  const scopes = scope === "global" ? [...new Set(["global", ...wikiNotes(notes).filter((n) => typeof n.fm.core === "string").map((n) => String(n.fm.scope))])] : [scope];
  for (const s of scopes) {
    if (!startContext(root, notes, s).cut) continue;
    const ranked = coreNotes(notes, s).reverse();
    return {
      findings: [{ note: draft.title, rule: "core", detail: `the start context of scope ${s} is over ${START_BUDGET} bytes with this core line` }],
      hint: ["", `Core lines of ${s} and global ranked for demotion, oldest first. Remove the core: field of one; the note stays and recall still finds it:`,
        ...ranked.map((n) => `  ${n.title} (updated ${n.fm.updated ?? "never"}, ${n.fm.scope}): ${n.fm.core}`)].join("\n"),
    };
  }
  return { findings: [], hint: "" };
}

async function init(): Promise<void> {
  if (existsSync(join(root, "Home.md"))) { console.error(`vault already at ${root}`); exit(1); }
  const made: string[] = [];
  const lay = (rel: string, text: string) => { writeFileSync(join(root, rel), text); made.push(join(root, rel)); };
  for (const d of ["wiki/decisions", "wiki/concepts", "wiki/entities", "wiki/projects", "wiki/gotchas", "daily", "archive", "attachments", ".obsidian"]) mkdirSync(join(root, d), { recursive: true });
  for (const d of ["daily", "archive", "attachments"]) lay(join(d, ".gitkeep"), "");
  for (const d of ["decisions", "concepts", "entities", "projects", "gotchas"]) lay(join("wiki", d, ".gitkeep"), "");
  lay("VAULT.md", VAULT_MD);
  lay("Home.md", homeText([], "Health: 0 notes, 0 dangling, 0 stale, lint never"));
  lay("MEMORY.md", MEMORY_MD);
  lay(".gitignore", GITIGNORE);
  for (const [name, value] of Object.entries(OBSIDIAN)) lay(join(".obsidian", name), JSON.stringify(value, null, 2) + "\n");
  if (!existsSync(join(root, ".git"))) {
    const r = git(root, "init", "-q", "-b", "main");
    if (!r.ok) { console.error(r.out); exit(1); }
  }
  await writeHome();
  const commit = commitAndPush("init vault", made);
  out({ op: "init", path: root, commit });
}

async function write(): Promise<void> {
  requireVault();
  const src = positional[0];
  const why = flag("why");
  if (!src || !why) { console.error('usage: aleph memory write <file.md> --why "<one line>"'); exit(1); }
  const srcPath = resolve(src);
  if (!existsSync(srcPath)) { console.error(`no such file: ${srcPath}`); exit(1); }
  const inside = !relative(root, srcPath).startsWith("..");
  const rel = inside ? relative(root, srcPath) : null;

  if (rel === "VAULT.md") refuse([{ note: "VAULT", rule: "owner", detail: "VAULT.md is human-owned; propose a change in wiki/decisions/ and ask" }]);
  if (rel === "Home.md") refuse([{ note: "Home", rule: "generated", detail: "Home.md is generated from the notes on each write; write the note instead" }]);
  if (rel === "MEMORY.md") {
    const name = "MEMORY";
    const notes = await loadVault(root);
    const budget = budgetFindings(notes).filter((f) => f.note === name);
    if (budget.length) refuse(budget);
    const { refuse: r, warn: w } = lintVault(notes);
    const dangling = r.filter((f) => f.note === name);
    if (dangling.length) refuse(dangling);
    warn(w);
    appendDaily(`write [[${name}]] — ${why}`);
    await writeHome();
    const commit = commitAndPush(`write: ${name}`, [join(root, `${name}.md`), join(root, "Home.md"), join(root, "daily", `${today()}.md`)]);
    out({ op: "write", title: name, path: `${name}.md`, warnings: w, commit });
    return;
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
  for (const title of supersedes) {
    const hit = wikiNotes(notes).find((n) => n.title.toLowerCase() === title.toLowerCase());
    if (!hit) findings.push({ note: draft.title, rule: "supersedes", detail: `supersedes [${title}] but no live wiki note has that title` });
    else old.push(hit);
  }
  for (const title of Array.isArray(draft.fm.consistent_with) ? draft.fm.consistent_with : []) {
    if (!wikiNotes(notes).some((n) => n.title.toLowerCase() === String(title).toLowerCase())) findings.push({ note: draft.title, rule: "consistent_with", detail: `consistent_with [${title}] but no live wiki note has that title` });
  }
  // A draft that already sits at its destination and that no write has ever
  // accepted is invisible to git but not to lint or to [[links]]. Name it; do
  // not delete it. It may be Chris's own note, typed in Obsidian, and b089def
  // is what undoing another writer's work costs.
  if (findings.length) refuse(findings, existsSync(dest) && !tracked(root, dest)
    ? `${relative(root, dest)} is in the vault but no write has accepted it. Fix it and rerun, or remove it.`
    : undefined);
  // Home and MEMORY are budgeted. A note write may not make either longer
  // while it is over, but an over-budget Home does not block a note that
  // leaves it as it was: the factory's facts gate writes unattended, and from
  // 1 to 3 Nov it lost 28 kept facts to a Home one line over (lint still warns).
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
          // A log that cannot be written must not turn the refusal into a write.
          try { logEvent({ by: "gate", subject: draft.title, action: "refused", sub: "contradiction", on: hits.map((n) => n.title) }); }
          catch (e) { console.error(`warn contradiction ${draft.title}: event not logged, ${(e as Error).message}`); }
          refuse(hits.map((n) => ({ note: n.title, rule: "contradiction", detail: `the draft [${draft.title}] may contradict [${n.title}]` })), "add it to supersedes or fix the draft: this write changed nothing; name it in consistent_with if the two agree");
        }
      } catch (e) {
        if (e instanceof Exit) throw e; // the refusal above
        console.error(`warn contradiction ${draft.title}: screen skipped, ${(e as Error).message}`);
      }
    }
  }

  const touched: string[] = [join(root, "Home.md"), join(root, "daily", `${today()}.md`), dest];
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
    appendDaily(`supersede [[${o.title}]] → [[${draft.title}]]`);
  }
  appendDaily(`write [[${draft.title}]] — ${why}`);
  await writeHome();
  const after = await loadVault(root);
  const budget = budgetFindings(after).filter((f) => !overBudget.some((b) => b.detail === f.detail));
  if (budget.length) { rollback(touched); refuse(budget); }
  if (typeof draft.fm.core === "string") {
    const core = coreFindings(after, placed);
    if (core.findings.length) { rollback(touched); refuse(core.findings, core.hint); }
  }
  warn(lintVault(after).warn.filter((f) => f.note === draft.title || f.detail.includes(draft.title)));
  const subject = archived.length ? `supersede: ${archived.join(", ")} → ${draft.title}` : `write: ${draft.title}`;
  const commit = commitAndPush(subject, touched);
  out({ op: archived.length ? "supersede" : "write", title: draft.title, path: relative(root, dest), archived, commit });
}

// A query returns the best few: an agent reads the top of the list, and a full match list ran to 10,323 lines.
const TOP = 10;

async function recall(): Promise<void> {
  requireVault();
  // `--episodes` takes no value, so the word after it stays in the query.
  const args = rest.filter((a) => a !== "--episodes");
  const q = args.filter((a, i) => !a.startsWith("--") && args[i - 1]?.startsWith("--") !== true).join(" ").trim().toLowerCase();
  const scope = flag("scope");
  if (!q && !scope) { console.error('usage: aleph memory recall [--episodes] <query> [--scope <name>]  |  aleph memory recall [--episodes] --scope <name>'); exit(1); }
  // The episode pages are the factory's, not the vault's: they get a throwaway index and no read log.
  // They are searched alone, because a vault match list runs to thousands of lines and hides them.
  if (has("episodes")) {
    const dir = join(layout().factory, "episodes");
    const pages = (await loadVault(dir)).filter((n) => scope === undefined || String(n.fm.scope) === scope);
    const tmp = mkdtempSync(join(tmpdir(), "aleph-episodes-"));
    try {
      const db = openIndex(tmp, pages);
      const ranked = q ? rankNotes(db, pages, q, scope).map(({ note, rank }) => ({ n: note, r: rank })) : pages.map((n) => ({ n, r: 4 })).sort((a, b) => a.n.title.localeCompare(b.n.title));
      db.close();
      const shown = q ? ranked.slice(0, TOP) : ranked;
      if (q) logUse("shown", shown.map(({ n }) => n.title), process.env.CLAUDE_CODE_SESSION_ID || null, q);
      return out(shown.map(({ n, r }) => ({ title: n.title, path: join(dir, n.rel), rank: r, scope: String(n.fm.scope), frontmatter: n.fm })));
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  // `--scope` alone lists a project's notes: at 165 notes "what do we know
  // about cloudchamber" is a real question, and ranking every note by one word
  // could not answer it.
  const notes = wikiNotes(await loadVault(root));
  const scoped = notes.filter((n) => scope === undefined || String(n.fm.scope) === scope);
  const hits = q
    ? rankNotes(openIndex(root, notes), scoped, q, scope).slice(0, TOP).map(({ note, rank }) => ({ n: note, r: rank }))
    : scoped.map((n) => ({ n, r: 4 })).sort((a, b) => a.n.title.localeCompare(b.n.title));
  noteRead(hits.map(({ n }) => n.title), q);
  // A scope nobody uses is almost always a misspelling of one that exists, and
  // the vault has five names for one project. Say so rather than return [].
  if (scope !== undefined && !hits.length) {
    const known = [...new Set(notes.map((n) => String(n.fm.scope)))].sort();
    console.error(`no note has scope ${scope}; the vault uses: ${known.join(", ")}`);
  }
  const found = hits.map(({ n, r }) => ({ title: n.title, path: n.rel, rank: r, scope: String(n.fm.scope), frontmatter: n.fm }));
  out(found);
}

const asValue = (v: unknown): any => { if (typeof v === "string") { try { return JSON.parse(v); } catch { return v; } } return v; };
/** A tool's output as text: a bare string, or the stdout of a result object. */
function outText(v: unknown): string {
  const x = asValue(v);
  if (typeof x === "string") return x.trim();
  if (x && typeof x === "object" && typeof (x as any).stdout === "string") return (x as any).stdout.trim();
  return x === undefined || x === null ? "" : JSON.stringify(x);
}
const queryWords = (q: string) => new Set(q.toLowerCase().match(/[^\s"']+/g) ?? []);
const noteName = (p: string) => basename(p).replace(/\.md$/, "");

async function misses(): Promise<void> {
  const raw = flag("days");
  const days = raw === undefined ? 7 : Number(raw);
  if (!(days > 0)) { console.error("usage: aleph memory misses [--days N]"); exit(1); }
  const lf = langfuse();
  if (!lf) { console.error("no Langfuse keys"); exit(1); }
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  let obs: Observation[];
  try { obs = (await lf.observations({ from, to: new Date(to.getTime() + 60_000) })).rows; }
  catch (e) { console.error(`Langfuse failed: ${e instanceof Error ? e.message : e}`); exit(1); }
  obs = obs.filter((o) => !o.startTime || new Date(o.startTime) >= from).sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));

  const cmdOf = (o: Observation): string => { const i = asValue(o.input); return String(typeof i === "string" ? i : i?.command ?? "").trim(); };
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
    const path = String(i?.file_path ?? i?.path ?? "");
    if (!/(^|\/)wiki\/.+\.md$/.test(path)) return false;
    const seen = offeredIn.get(o.traceId ?? "") ?? [];
    return !seen.some((t) => t.includes(path) || t.includes(noteName(path)));
  }).length;

  const num = (v: unknown) => Number(v) || 0;
  const meta = spans.map((o) => o.metadata ?? {});
  out({
    days, recalls: recalls.length, empty: empty.length, empty_share: recalls.length ? empty.length / recalls.length : 0,
    reformulated, unoffered_reads: unoffered,
    missed: empty.slice(-10).reverse().map((o) => ({ query: queryOf(o), at: o.startTime ?? "" })),
    hook: {
      runs: spans.length,
      zero_candidates: meta.filter((m) => num(m.candidates) === 0).length,
      capped: meta.filter((m) => m.capped === true || m.capped === "true").length,
      mean_kept: spans.length ? meta.reduce((a, m) => a + num(m.kept), 0) / spans.length : 0,
    },
  });
}

async function lint(): Promise<void> {
  requireVault();
  const fixed: { note: string; path: string; repairs: string[] }[] = [];
  if (has("fix")) {
    for (const n of wikiNotes(await loadVault(root))) {
      const r = fixFrontmatter(n, addedDate(root, n.path));
      if (!r) continue;
      writeFileSync(n.path, r.text);
      fixed.push({ note: n.title, path: n.rel, repairs: r.repairs });
    }
  }
  await writeHome();
  const notes = await loadVault(root);
  const result = lintVault(notes, { read: readLog(), overlap: has("overlap"), templates: has("template"), tracked: trackedFiles(root, "wiki") });
  result.warn.push(...relativeDates(notes));
  const touched = [join(root, "Home.md"), ...fixed.map((f) => join(root, f.path))];
  const commit = commitAndPush(fixed.length ? `lint --fix: ${fixed.length} notes` : `lint: ${today()}`, touched);
  out({ fixed, ...result, commit });
  exit(result.refuse.length ? 1 : 0);
}

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
async function adopt(): Promise<void> {
  requireVault();
  const src = positional[0];
  const why = flag("why");
  if (!src || !why) { console.error('usage: aleph memory adopt <path-inside-the-vault> --why "<one line>"'); exit(1); }
  const path = resolve(src);
  if (!existsSync(path)) { console.error(`no such file: ${path}`); exit(1); }
  const rel = relative(root, path);
  if (rel.startsWith("..")) { console.error(`${src} is outside the vault; adopt is for a note already in it — use: aleph memory write`); exit(1); }
  if (!rel.startsWith("wiki/")) { console.error(`${rel} is not a wiki note; adopt only takes one`); exit(1); }
  if (tracked(root, path)) { console.error(`${rel} is already tracked; rewrite it with: aleph memory write`); exit(1); }

  const note = readNote(path, root);
  const folder = folderFor(String(note.fm.kind ?? ""));
  if (folder && dirname(rel) !== folder) refuse([{ note: note.title, rule: "folder", detail: `kind ${note.fm.kind} belongs in ${folder}/, note is in ${dirname(rel)}/` }]);
  const findings = validateNote(note, (await loadVault(root)).filter((n) => n.path !== path));
  const template = findings.filter((f) => f.rule === "template");
  const hard = findings.filter((f) => f.rule !== "template");
  if (hard.length) refuse(hard, "adopt forgives the template, not the schema");

  appendDaily(`adopt [[${note.title}]] — ${why}`);
  await writeHome();
  const commit = commitAndPush(`adopt: ${note.title}`, [path, join(root, "Home.md"), join(root, "daily", `${today()}.md`)]);
  warn(template);
  out({ op: "adopt", title: note.title, path: rel, template, commit });
}

/**
 * Move every note in one scope to another. Read-only unless `--apply`.
 *
 * A rename moves the repo and leaves the notes behind, so the vault ends up
 * with several names for one project and no way to see it: `scope` is free
 * text, and the only rule that read it is off. On 2026-09-26 five names covered
 * two projects across 49 notes.
 */
async function renameScopeOp(): Promise<void> {
  requireVault();
  const [from, to] = positional;
  const apply = has("apply");
  if (!from || !to) { console.error("usage: aleph memory rename-scope <old> <new> [--apply]"); exit(1); }
  const notes = await loadVault(root);
  const scopes = [...new Set(wikiNotes(notes).map((n) => String(n.fm.scope)))].sort();
  if (!scopes.includes(from)) refuse([{ note: from, rule: "scope", detail: `no note has scope ${from}; the vault uses: ${scopes.join(", ")}` }]);
  const changes = renameScope(notes, from, to);

  let commit: string | null = null;
  if (apply && changes.length) {
    for (const c of changes) writeFileSync(c.note.path, c.text);
    appendDaily(`rename-scope ${from} → ${to} — ${changes.length} notes`);
    await writeHome();
    commit = commitAndPush(`rename-scope: ${from} → ${to}, ${changes.length} notes`,
      [...changes.map((c) => c.note.path), join(root, "Home.md"), join(root, "daily", `${today()}.md`)]);
  }
  out({ op: "rename-scope", from, to, applied: apply, notes: changes.map((c) => c.note.rel), count: changes.length, commit });
  if (!apply && changes.length) console.error(`rename-scope changed nothing; rerun with --apply to move ${changes.length} notes from ${from} to ${to}`);
}

/**
 * Retire a note without writing its replacement.
 *
 * `supersedes` was the only exit, and it needs a newer note that covers the
 * same ground. A subject that is simply over has no such note, so nothing ever
 * left: 2 notes archived in the vault's first 20 days. Archive is not
 * deletion; the file moves to `archive/` and stays a link target.
 */
async function archive(): Promise<void> {
  requireVault();
  const title = positional.join(" ").trim();
  const why = flag("why");
  if (!title || !why) { console.error('usage: aleph memory archive "<title>" --why "<one line>"'); exit(1); }
  const notes = await loadVault(root);
  const hit = wikiNotes(notes).find((n) => n.title.toLowerCase() === title.toLowerCase());
  if (!hit) refuse([{ note: title, rule: "archive", detail: "no live wiki note has that title" }]);

  // Wiki notes only. Home's line goes with the plan below, and a daily note is
  // a record of what happened on a day; neither is a caller to warn about.
  const inbound = backlinks(notes, hit).filter((n) => n.wiki);
  const dest = join(root, "archive", `${hit.title}.md`);
  const fm = { ...hit.fm, archived: today(), archived_reason: why };
  writeFileSync(dest, serializeFrontmatter(fm) + hit.body);
  unlinkSync(hit.path);
  const home = join(root, "Home.md");
  appendDaily(`archive [[${hit.title}]] — ${why}`);
  await writeHome();
  const commit = commitAndPush(`archive: ${hit.title}`, [dest, hit.path, home, join(root, "daily", `${today()}.md`)]);
  // An archived note stays a link target, so nothing dangles; the callers are
  // named because each one now points at a retired claim.
  warn(inbound.map((n) => ({ note: n.title, rule: "inbound", detail: `links [[${hit.title}]], which is now archived` })));
  out({ op: "archive", title: hit.title, path: relative(root, dest), why, inbound: inbound.map((n) => n.title), commit });
}

/**
 * Remove a note for good: a claim that was wrong, not one that is over. Git keeps the old file. A note that a live
 * note links to is refused, since its callers would dangle; unlink them or archive it instead.
 */
async function del(): Promise<void> {
  requireVault();
  const title = positional.join(" ").trim();
  const why = flag("why");
  if (!title || !why) { console.error('usage: aleph memory delete "<title>" --why "<one line>"'); exit(1); }
  const notes = await loadVault(root);
  const hit = wikiNotes(notes).find((n) => n.title.toLowerCase() === title.toLowerCase());
  if (!hit) refuse([{ note: title, rule: "delete", detail: "no live wiki note has that title" }]);
  const inbound = backlinks(notes, hit).filter((n) => n.wiki);
  if (inbound.length) refuse(inbound.map((n) => ({ note: n.title, rule: "inbound", detail: `links [[${hit.title}]]; unlink it or archive [${hit.title}] instead` })));
  unlinkSync(hit.path);
  appendDaily(`delete ${hit.title} — ${why}`);
  await writeHome();
  const commit = commitAndPush(`delete: ${hit.title}`, [hit.path, join(root, "Home.md"), join(root, "daily", `${today()}.md`)]);
  out({ op: "delete", title: hit.title, why, commit });
}

async function compile(): Promise<void> {
  requireVault();
  const date = positional[0] ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error("usage: aleph memory compile [YYYY-MM-DD]"); exit(1); }
  const { text } = await compileDigest(root, date);
  recordCompiled(root, date);
  console.log(text);
}

/** `vault <argv>`: one op, under the vault that $ALEPH_VAULT names now. */
export async function run(argv: string[]): Promise<void> {
  [cmd, ...rest] = argv;
  root = rootOf();
  positional = rest.filter((a, i) => !a.startsWith("--") && rest[i - 1]?.startsWith("--") !== true);
  switch (cmd) {
    case "init": await init(); break;
    case "write": await write(); break;
    case "recall": await recall(); break;
    case "lint": await lint(); break;
    case "adopt": await adopt(); break;
    case "rename-scope": await renameScopeOp(); break;
    case "archive": await archive(); break;
    case "delete": await del(); break;
    case "compile": await compile(); break;
    case "misses": await misses(); break;
    case "maintain": { requireVault(); const r = await maintain(root, has("dry"), commitAndPush); out(r); if (!r.ok) exit(1); break; }
    default:
      console.error("usage: aleph memory <init|write <file> --why <text>|recall [--episodes] <query> [--scope <name>]|lint [--fix] [--overlap] [--template]|adopt <path> --why <text>|rename-scope <old> <new> [--apply]|archive <title> --why <text>|delete <title> --why <text>|compile [date]|misses [--days N]|maintain [--dry]>");
      exit(2);
  }
}
