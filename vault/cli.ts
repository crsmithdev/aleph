#!/usr/bin/env bun
/**
 * vault <init|write|recall|lint|compile> — the mechanical half of /aleph:vault.
 * Vault path: $ALEPH_VAULT or ~/.aleph/vault. JSON on stdout, findings on
 * stderr, exit 1 on refusal. See docs/specs/2026-09-04-memory-vault.md.
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { langfuseConfig } from "../hooks/lib/env.ts";
import { serializeFrontmatter } from "./lib/frontmatter.ts";
import { commitAll, git } from "./lib/git.ts";
import { handoffsFor, traceDigest } from "./lib/compile.ts";
import { GITIGNORE, HOME_MD, MEMORY_MD, OBSIDIAN, VAULT_MD } from "./lib/templates.ts";
import { budgetFindings, citedTraces, clock, folderFor, health, healthLine, links, lintVault, loadVault, readNote, today, validateNote, vaultDir, wikiNotes, withHealth, type Finding, type Note } from "./lib/vault.ts";

const [cmd, ...rest] = process.argv.slice(2);
const root = resolve(vaultDir());

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}
const positional = rest.filter((a, i) => !a.startsWith("--") && rest[i - 1]?.startsWith("--") !== true);

function out(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
function refuse(findings: Finding[], hint?: string): never {
  for (const f of findings) console.error(`refuse ${f.rule} ${f.note}: ${f.detail}`);
  if (hint) console.error(hint);
  process.exit(1);
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

function setHealth(): void {
  const home = join(root, "Home.md");
  writeFileSync(home, withHealth(readFileSync(home, "utf8"), healthLine(health(loadVault(root)))));
}

// ---------------------------------------------------------------- init
function init(): void {
  if (existsSync(join(root, "Home.md"))) { console.error(`vault already at ${root}`); process.exit(1); }
  for (const d of ["wiki/decisions", "wiki/concepts", "wiki/entities", "wiki/projects", "wiki/gotchas", "daily", "archive", "attachments", ".obsidian"]) mkdirSync(join(root, d), { recursive: true });
  for (const d of ["daily", "archive", "attachments"]) writeFileSync(join(root, d, ".gitkeep"), "");
  for (const d of ["decisions", "concepts", "entities", "projects", "gotchas"]) writeFileSync(join(root, "wiki", d, ".gitkeep"), "");
  writeFileSync(join(root, "VAULT.md"), VAULT_MD);
  writeFileSync(join(root, "Home.md"), HOME_MD);
  writeFileSync(join(root, "MEMORY.md"), MEMORY_MD);
  writeFileSync(join(root, ".gitignore"), GITIGNORE);
  for (const [name, value] of Object.entries(OBSIDIAN)) writeFileSync(join(root, ".obsidian", name), JSON.stringify(value, null, 2) + "\n");
  if (!existsSync(join(root, ".git"))) {
    const r = git(root, "init", "-q", "-b", "main");
    if (!r.ok) { console.error(r.out); process.exit(1); }
  }
  setHealth();
  const commit = commitAll(root, "init vault");
  out({ op: "init", path: root, commit });
}

// ---------------------------------------------------------------- write
function write(): void {
  requireVault();
  const src = positional[0];
  const why = flag("why");
  if (!src || !why) { console.error('usage: vault write <file.md> --why "<one line>"'); process.exit(1); }
  const srcPath = resolve(src);
  if (!existsSync(srcPath)) { console.error(`no such file: ${srcPath}`); process.exit(1); }
  const inside = !relative(root, srcPath).startsWith("..");
  const rel = inside ? relative(root, srcPath) : null;

  if (rel === "VAULT.md") refuse([{ note: "VAULT", rule: "owner", detail: "VAULT.md is human-owned; propose a change in wiki/decisions/ and ask" }]);
  if (rel === "Home.md" || rel === "MEMORY.md") {
    const name = basename(rel, ".md");
    if (name === "Home") setHealth();
    const notes = loadVault(root);
    const budget = budgetFindings(notes).filter((f) => f.note === name);
    if (budget.length) refuse(budget);
    const { refuse: r, warn: w } = lintVault(notes);
    const dangling = r.filter((f) => f.note === name);
    if (dangling.length) refuse(dangling);
    warn(w);
    appendDaily(`write [[${name}]] — ${why}`);
    if (name === "MEMORY") setHealth();
    const commit = commitAll(root, `write: ${name}`);
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
  if (findings.length) refuse(findings);

  // Everything validated; now touch the disk.
  mkdirSync(dirname(dest), { recursive: true });
  if (srcPath !== dest) copyFileSync(srcPath, dest);
  const archived: string[] = [];
  for (const o of old) {
    const target = join(root, "archive", `${o.title}.md`);
    const fm = { ...o.fm, archived: today(), archived_reason: `superseded by [[${draft.title}]]` };
    writeFileSync(target, serializeFrontmatter(fm) + o.body);
    unlinkSync(o.path);
    archived.push(o.title);
    appendDaily(`supersede [[${o.title}]] → [[${draft.title}]]`);
  }
  appendDaily(`write [[${draft.title}]] — ${why}`);
  setHealth();
  const after = loadVault(root);
  const budget = budgetFindings(after);
  if (budget.length) { git(root, "checkout", "--", "."); git(root, "clean", "-fdq"); refuse(budget); }
  warn(lintVault(after).warn.filter((f) => f.note === draft.title || f.detail.includes(draft.title)));
  const subject = archived.length ? `supersede: ${archived.join(", ")} → ${draft.title}` : `write: ${draft.title}`;
  const commit = commitAll(root, subject);
  out({ op: archived.length ? "supersede" : "write", title: draft.title, path: relative(root, dest), archived, commit });
}

// ---------------------------------------------------------------- recall
function recall(): void {
  requireVault();
  const q = positional.join(" ").trim().toLowerCase();
  if (!q) { console.error("usage: vault recall <query>"); process.exit(1); }
  const rank = (n: Note): number => {
    const aliases = (Array.isArray(n.fm.aliases) ? n.fm.aliases : []).map((a) => a.toLowerCase());
    const title = n.title.toLowerCase();
    if (title === q) return 0;
    if (aliases.includes(q)) return 1;
    if (title.includes(q) || aliases.some((a) => a.includes(q))) return 2;
    if (n.body.toLowerCase().includes(q)) return 3;
    return -1;
  };
  const hits = wikiNotes(loadVault(root)).map((n) => ({ n, r: rank(n) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r || a.n.title.localeCompare(b.n.title));
  out(hits.map(({ n, r }) => ({ title: n.title, path: n.rel, rank: r, frontmatter: n.fm })));
}

// ---------------------------------------------------------------- lint
function lint(): void {
  requireVault();
  setHealth();
  const result = lintVault(loadVault(root));
  const commit = commitAll(root, `lint: ${today()}`);
  out({ ...result, commit });
  process.exit(result.refuse.length ? 1 : 0);
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
  case "compile": await compile(); break;
  default:
    console.error("usage: vault <init|write <file> --why <text>|recall <query>|lint|compile [date]>");
    process.exit(2);
}
