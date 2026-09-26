#!/usr/bin/env bun
/**
 * vault <init|write|adopt|recall [--scope]|lint [--fix]|consolidate|archive|compile> — the
 * mechanical half of /aleph:vault.
 * Vault path: $ALEPH_VAULT or ~/.aleph/vault. JSON on stdout, findings on
 * stderr, exit 1 on refusal. See docs/specs/2026-09-04-memory-vault.md.
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { langfuseConfig } from "../hooks/lib/env.ts";
import { serializeFrontmatter } from "./lib/frontmatter.ts";
import { addedDate, commitPaths, git, tracked, trackedFiles } from "./lib/git.ts";
import { handoffsFor, traceDigest } from "./lib/compile.ts";
import { GITIGNORE, HOME_MD, MEMORY_MD, OBSIDIAN, VAULT_MD } from "./lib/templates.ts";
import { budgetFindings, citedTraces, clock, fixFrontmatter, folderFor, health, healthLine, HOME_KINDS, homeCandidates, LINE_BUDGET, links, lintVault, loadVault, planHome, readNote, relativeDates, staleness, today, validateNote, vaultDir, wikiNotes, withHealth, type Finding, type Note } from "./lib/vault.ts";

const [cmd, ...rest] = process.argv.slice(2);
/**
 * The vault root with every symlink resolved.
 *
 * `~/.aleph/vault` is a symlink to `/mnt/c/Users/crsmi/vault`, so one note has
 * two absolute paths. Both the root and a write's source resolve here, so the
 * `srcPath !== dest` guard below compares one spelling against itself.
 *
 * Without that, a write given a note's `/mnt/c/...` path copied the file onto
 * itself through the `~/.aleph` spelling, and `copyFileSync` truncated it to 0
 * bytes. It also read as outside the vault, so `relative()` put
 * `../../../../mnt/c/...` in the messages.
 */
const root = (() => { const r = resolve(vaultDir()); try { return realpathSync(r); } catch { return r; } })();


function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}
function has(name: string): boolean { return rest.includes(`--${name}`); }
const positional = rest.filter((a, i) => !a.startsWith("--") && rest[i - 1]?.startsWith("--") !== true);

function out(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
function refuse(findings: Finding[], hint?: string): never {
  for (const f of findings) console.error(`refuse ${f.rule} ${f.note}: ${f.detail}`);
  if (hint) console.error(hint);
  process.exit(1);
}

/** The lines a budget refusal should offer, so the caller is not left guessing. */
function budgetHint(notes: Note[]): string {
  const candidates = homeCandidates(notes);
  if (!candidates.length) return "";
  return ["", "Home.md lines ranked for removal, worst first. The notes stay on disk and recall still finds them:",
    ...candidates.map((c) => `  ${c.line}: ${c.text.trim()}\n      — ${c.why}`)].join("\n");
}
function warn(findings: Finding[]): void {
  for (const f of findings) console.error(`warn ${f.rule} ${f.note}: ${f.detail}`);
}
function requireVault(): void {
  if (!existsSync(join(root, "Home.md"))) { console.error(`no vault at ${root}; run: vault init`); process.exit(1); }
}

function appendDaily(line: string): void {
  const dir = join(root, "daily");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${today()}.md`);
  if (!existsSync(file)) writeFileSync(file, `# ${today()}\n\n`);
  appendFileSync(file, `- ${clock()} ${line}\n`);
}

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
  try { return JSON.parse(readFileSync(READ_LOG(), "utf8")); } catch { return {}; }
}
function noteRead(titles: string[]): void {
  if (!titles.length) return;
  try {
    const log = readLog();
    for (const t of titles) log[t] = today();
    writeFileSync(READ_LOG(), JSON.stringify(log, null, 0));
  } catch { /* a read must never fail on its own bookkeeping */ }
}

function setHealth(): void {
  const home = join(root, "Home.md");
  writeFileSync(home, withHealth(readFileSync(home, "utf8"), healthLine(health(loadVault(root), readLog()))));
}

// ---------------------------------------------------------------- init
function init(): void {
  if (existsSync(join(root, "Home.md"))) { console.error(`vault already at ${root}`); process.exit(1); }
  const made: string[] = [];
  const lay = (rel: string, text: string) => { writeFileSync(join(root, rel), text); made.push(join(root, rel)); };
  for (const d of ["wiki/decisions", "wiki/concepts", "wiki/entities", "wiki/projects", "wiki/gotchas", "daily", "archive", "attachments", ".obsidian"]) mkdirSync(join(root, d), { recursive: true });
  for (const d of ["daily", "archive", "attachments"]) lay(join(d, ".gitkeep"), "");
  for (const d of ["decisions", "concepts", "entities", "projects", "gotchas"]) lay(join("wiki", d, ".gitkeep"), "");
  lay("VAULT.md", VAULT_MD);
  lay("Home.md", HOME_MD);
  lay("MEMORY.md", MEMORY_MD);
  lay(".gitignore", GITIGNORE);
  for (const [name, value] of Object.entries(OBSIDIAN)) lay(join(".obsidian", name), JSON.stringify(value, null, 2) + "\n");
  if (!existsSync(join(root, ".git"))) {
    const r = git(root, "init", "-q", "-b", "main");
    if (!r.ok) { console.error(r.out); process.exit(1); }
  }
  setHealth();
  const commit = commitPaths(root, "init vault", made);
  out({ op: "init", path: root, commit });
}

// ---------------------------------------------------------------- write
function write(): void {
  requireVault();
  const src = positional[0];
  const why = flag("why");
  if (!src || !why) { console.error('usage: vault write <file.md> --why "<one line>"'); process.exit(1); }
  const srcPath = (() => { const r = resolve(src); try { return realpathSync(r); } catch { return r; } })();
  if (!existsSync(srcPath)) { console.error(`no such file: ${srcPath}`); process.exit(1); }
  const inside = !relative(root, srcPath).startsWith("..");
  const rel = inside ? relative(root, srcPath) : null;

  if (rel === "VAULT.md") refuse([{ note: "VAULT", rule: "owner", detail: "VAULT.md is human-owned; propose a change in wiki/decisions/ and ask" }]);
  if (rel === "Home.md" || rel === "MEMORY.md") {
    const name = basename(rel, ".md");
    if (name === "Home") setHealth();
    const notes = loadVault(root);
    const budget = budgetFindings(notes).filter((f) => f.note === name);
    if (budget.length) refuse(budget, budgetHint(notes));
    const { refuse: r, warn: w } = lintVault(notes);
    const dangling = r.filter((f) => f.note === name);
    if (dangling.length) refuse(dangling);
    warn(w);
    appendDaily(`write [[${name}]] — ${why}`);
    if (name === "MEMORY") setHealth();
    const commit = commitPaths(root, `write: ${name}`, [join(root, `${name}.md`), join(root, "Home.md"), join(root, "daily", `${today()}.md`)]);
    out({ op: "write", title: name, path: `${name}.md`, warnings: w, commit });
    return;
  }

  const draft = readNote(srcPath, inside ? root : dirname(srcPath));
  const folder = folderFor(String(draft.fm.kind ?? ""));
  const dest = folder ? join(root, folder, `${draft.title}.md`) : srcPath;
  const notes = loadVault(root).filter((n) => n.path !== srcPath && n.path !== dest);
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
  // A draft that already sits at its destination and that no write has ever
  // accepted is invisible to git but not to lint or to [[links]]. Name it; do
  // not delete it. It may be Chris's own note, typed in Obsidian, and b089def
  // is what undoing another writer's work costs.
  if (findings.length) refuse(findings, existsSync(dest) && !tracked(root, dest)
    ? `${relative(root, dest)} is in the vault but no write has accepted it. Fix it and rerun, or remove it.`
    : undefined);
  // Home and MEMORY are budgeted, and a note write cannot shrink either. Asking
  // before the disk is touched means an over-budget Home refuses a write that
  // has changed nothing, instead of one that has to be undone.
  const before = loadVault(root);
  const overBudget = budgetFindings(before);
  if (overBudget.length) refuse(overBudget, "prune the over-budget file first: this write changed nothing" + budgetHint(before));

  // Everything validated; now touch the disk.
  const touched: string[] = [join(root, "Home.md"), join(root, "daily", `${today()}.md`), dest];
  mkdirSync(dirname(dest), { recursive: true });
  if (srcPath !== dest) copyFileSync(srcPath, dest);
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
  setHealth();
  const after = loadVault(root);
  const budget = budgetFindings(after);
  if (budget.length) { rollback(touched); refuse(budget, budgetHint(after)); }
  warn(lintVault(after).warn.filter((f) => f.note === draft.title || f.detail.includes(draft.title)));
  const subject = archived.length ? `supersede: ${archived.join(", ")} → ${draft.title}` : `write: ${draft.title}`;
  const commit = commitPaths(root, subject, touched);
  out({ op: archived.length ? "supersede" : "write", title: draft.title, path: relative(root, dest), archived, commit });
}

// ---------------------------------------------------------------- recall
function recall(): void {
  requireVault();
  const q = positional.join(" ").trim().toLowerCase();
  const scope = flag("scope");
  if (!q && !scope) { console.error('usage: vault recall <query> [--scope <name>]  |  vault recall --scope <name>'); process.exit(1); }
  // `--scope` alone lists a project's notes: at 165 notes "what do we know
  // about cloudchamber" is a real question, and ranking every note by one word
  // could not answer it.
  const scoped = (n: Note) => scope === undefined || String(n.fm.scope) === scope;
  const rank = (n: Note): number => {
    const aliases = (Array.isArray(n.fm.aliases) ? n.fm.aliases : []).map((a) => a.toLowerCase());
    const title = n.title.toLowerCase();
    if (title === q) return 0;
    if (aliases.includes(q)) return 1;
    if (title.includes(q) || aliases.some((a) => a.includes(q))) return 2;
    if (n.body.toLowerCase().includes(q)) return 3;
    return -1;
  };
  const notes = wikiNotes(loadVault(root));
  const hits = notes.filter(scoped).map((n) => ({ n, r: q ? rank(n) : 4 })).filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.n.title.localeCompare(b.n.title));
  noteRead(hits.map(({ n }) => n.title));
  // A scope nobody uses is almost always a misspelling of one that exists, and
  // the vault has five names for one project. Say so rather than return [].
  if (scope !== undefined && !hits.length) {
    const known = [...new Set(notes.map((n) => String(n.fm.scope)))].sort();
    console.error(`no note has scope ${scope}; the vault uses: ${known.join(", ")}`);
  }
  out(hits.map(({ n, r }) => ({ title: n.title, path: n.rel, rank: r, scope: String(n.fm.scope), frontmatter: n.fm })));
}

// ---------------------------------------------------------------- lint
function lint(): void {
  requireVault();
  const fixed: { note: string; path: string; repairs: string[] }[] = [];
  if (has("fix")) {
    for (const n of wikiNotes(loadVault(root))) {
      const r = fixFrontmatter(n, addedDate(root, n.path));
      if (!r) continue;
      writeFileSync(n.path, r.text);
      fixed.push({ note: n.title, path: n.rel, repairs: r.repairs });
    }
  }
  setHealth();
  const result = lintVault(loadVault(root), { read: readLog(), overlap: has("overlap"), templates: has("template"), tracked: trackedFiles(root, "wiki") });
  const touched = [join(root, "Home.md"), ...fixed.map((f) => join(root, f.path))];
  const commit = commitPaths(root, fixed.length ? `lint --fix: ${fixed.length} notes` : `lint: ${today()}`, touched);
  out({ fixed, ...result, commit });
  process.exit(result.refuse.length ? 1 : 0);
}

// ---------------------------------------------------------------- adopt
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
function adopt(): void {
  requireVault();
  const src = positional[0];
  const why = flag("why");
  if (!src || !why) { console.error('usage: vault adopt <path-inside-the-vault> --why "<one line>"'); process.exit(1); }
  const path = (() => { const r = resolve(src); try { return realpathSync(r); } catch { return r; } })();
  if (!existsSync(path)) { console.error(`no such file: ${path}`); process.exit(1); }
  const rel = relative(root, path);
  if (rel.startsWith("..")) { console.error(`${src} is outside the vault; adopt is for a note already in it — use: vault write`); process.exit(1); }
  if (!rel.startsWith("wiki/")) { console.error(`${rel} is not a wiki note; adopt only takes one`); process.exit(1); }
  if (tracked(root, path)) { console.error(`${rel} is already tracked; rewrite it with: vault write`); process.exit(1); }

  const note = readNote(path, root);
  const folder = folderFor(String(note.fm.kind ?? ""));
  if (folder && dirname(rel) !== folder) refuse([{ note: note.title, rule: "folder", detail: `kind ${note.fm.kind} belongs in ${folder}/, note is in ${dirname(rel)}/` }]);
  const findings = validateNote(note, loadVault(root).filter((n) => n.path !== path));
  const template = findings.filter((f) => f.rule === "template");
  const hard = findings.filter((f) => f.rule !== "template");
  if (hard.length) refuse(hard, "adopt forgives the template, not the schema");

  appendDaily(`adopt [[${note.title}]] — ${why}`);
  setHealth();
  const commit = commitPaths(root, `adopt: ${note.title}`, [path, join(root, "Home.md"), join(root, "daily", `${today()}.md`)]);
  warn(template);
  const home = HOME_KINDS.includes(String(note.fm.kind)) ? "wants a line in Home.md" : null;
  if (home) warn([{ note: note.title, rule: "orphan", detail: home }]);
  out({ op: "adopt", title: note.title, path: rel, template, commit });
}

// ---------------------------------------------------------------- consolidate
/**
 * The pass that acts on what `compile` gathers: it rebuilds Home as a router,
 * drops index lines that point at nothing, and reports every claim whose
 * window has run out.
 *
 * Read-only unless `--apply`. The consolidation passes that ship elsewhere run
 * unattended with no dry run and no approval; this vault has already lost
 * notes to an op that reached past its own paths, so the default prints and
 * writes nothing.
 *
 * It removes only Home lines. Every note stays on disk and `recall` still
 * finds it, so VAULT.md's rule that a note is never deleted holds unchanged.
 */
function consolidate(): void {
  requireVault();
  const apply = has("apply");
  const notes = loadVault(root);
  const plan = planHome(notes);
  const read = readLog();
  const stale = wikiNotes(notes)
    .map((n) => ({ note: n.title, path: n.rel, detail: staleness(n, read) }))
    .filter((x): x is { note: string; path: string; detail: string } => x.detail !== null)
    .sort((a, b) => a.note.localeCompare(b.note));
  const dates = relativeDates(notes);

  let commit: string | null = null;
  if (apply && plan.dropped.length) {
    writeFileSync(join(root, "Home.md"), plan.text);
    setHealth();
    appendDaily(`consolidate — dropped ${plan.dropped.length} Home lines`);
    commit = commitPaths(root, `consolidate: Home ${plan.lines} lines`, [join(root, "Home.md"), join(root, "daily", `${today()}.md`)]);
  }
  out({
    op: "consolidate", applied: apply,
    home: { lines: plan.lines, was: notes.find((n) => n.rel === "Home.md")?.text.replace(/\n+$/, "").split("\n").length ?? 0, budget: LINE_BUDGET },
    dropped: plan.dropped, missing: plan.missing, stale, relativeDates: dates, commit,
  });
  if (!apply && plan.dropped.length) console.error(`consolidate changed nothing; rerun with --apply to drop ${plan.dropped.length} Home lines`);
}

// ---------------------------------------------------------------- archive
/**
 * Retire a note without writing its replacement.
 *
 * `supersedes` was the only exit, and it needs a newer note that covers the
 * same ground. A subject that is simply over has no such note, so nothing ever
 * left: 2 notes archived in the vault's first 20 days. Archive is not
 * deletion; the file moves to `archive/` and stays a link target.
 */
function archive(): void {
  requireVault();
  const title = positional.join(" ").trim();
  const why = flag("why");
  if (!title || !why) { console.error('usage: vault archive "<title>" --why "<one line>"'); process.exit(1); }
  const notes = loadVault(root);
  const hit = wikiNotes(notes).find((n) => n.title.toLowerCase() === title.toLowerCase());
  if (!hit) refuse([{ note: title, rule: "archive", detail: "no live wiki note has that title" }]);

  // Wiki notes only. Home's line goes with the plan below, and a daily note is
  // a record of what happened on a day; neither is a caller to warn about.
  const inbound = wikiNotes(notes).filter((n) => n.path !== hit.path && links(n.body).some((t) => t.toLowerCase() === hit.title.toLowerCase()));
  const dest = join(root, "archive", `${hit.title}.md`);
  const fm = { ...hit.fm, archived: today(), archived_reason: why };
  writeFileSync(dest, serializeFrontmatter(fm) + hit.body);
  unlinkSync(hit.path);
  const home = join(root, "Home.md");
  const plan = planHome(loadVault(root));
  if (plan.dropped.length) writeFileSync(home, plan.text);
  appendDaily(`archive [[${hit.title}]] — ${why}`);
  setHealth();
  const commit = commitPaths(root, `archive: ${hit.title}`, [dest, hit.path, home, join(root, "daily", `${today()}.md`)]);
  // An archived note stays a link target, so nothing dangles; the callers are
  // named because each one now points at a retired claim.
  warn(inbound.map((n) => ({ note: n.title, rule: "inbound", detail: `links [[${hit.title}]], which is now archived` })));
  out({ op: "archive", title: hit.title, path: relative(root, dest), why, inbound: inbound.map((n) => n.title), commit });
}

// ---------------------------------------------------------------- compile
async function compile(): Promise<void> {
  requireVault();
  const date = positional[0] ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error("usage: vault compile [YYYY-MM-DD]"); process.exit(1); }
  const cfg = langfuseConfig();
  const traces = cfg ? await traceDigest(cfg, date) : { text: "", error: "no Langfuse keys" };
  const handoffs = handoffsFor(process.env.ALEPH_HANDOFFS ?? join(dirname(root), "handoffs"), date);
  const dailyPath = join(root, "daily", `${date}.md`);
  const daily = existsSync(dailyPath) ? readFileSync(dailyPath, "utf8") : "";
  const cited = citedTraces(loadVault(root));
  const sections = [
    `# compile ${date}`,
    `## Traces${traces.error ? ` (Langfuse failed: ${traces.error})` : ""}\n\n${traces.text || "none"}`,
    `## Handoffs\n\n${handoffs || "none"}`,
    `## Daily note\n\n${daily || "none"}`,
    `## Already cited\n\n${cited.length ? cited.map((id) => `- trace:${id}`).join("\n") : "none"}`,
  ];
  console.log(sections.join("\n\n"));
}

switch (cmd) {
  case "init": init(); break;
  case "write": write(); break;
  case "recall": recall(); break;
  case "lint": lint(); break;
  case "adopt": adopt(); break;
  case "consolidate": consolidate(); break;
  case "archive": archive(); break;
  case "compile": await compile(); break;
  default:
    console.error("usage: vault <init|write <file> --why <text>|recall <query> [--scope <name>]|lint [--fix] [--overlap] [--template]|adopt <path> --why <text>|consolidate [--apply]|archive <title> --why <text>|compile [date]>");
    process.exit(2);
}
