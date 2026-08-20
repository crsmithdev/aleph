/**
 * Vault bootstrap: the v1.0 §4.1 layout, seeded contract files, git initialised
 * BEFORE the first agent write so there is never an uncommitted pre-history.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { initRepo, isRepo, commit, git } from "./git.ts";

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "templates");

export const DIRECTORIES = [
  "wiki/entities", "wiki/concepts", "wiki/projects", "wiki/decisions", "wiki/reviews",
  "log", "inbox", "research", "human", "attachments", "archive",
];

const GITIGNORE = `attachments/*
!attachments/.gitkeep
.obsidian/
.sync-conflict-*
.trash/
`;

// Syncthing scope (design v1.0 §4.5 / red-team F12): the phone gets wiki, MEMORY,
// research and briefs — not attachments, log, or .git.
const STIGNORE = `.git
attachments
log
inbox
.obsidian
`;

export interface BootstrapResult {
  root: string;
  created: string[];
  commit: string | null;
  alreadyExisted: boolean;
}

export function bootstrapVault(root: string, opts: { now?: string; git?: boolean } = {}): BootstrapResult {
  const now = opts.now ?? new Date().toISOString();
  const created: string[] = [];
  const alreadyExisted = existsSync(join(root, "VAULT.md"));

  mkdirSync(root, { recursive: true });
  for (const dir of DIRECTORIES) {
    const abs = join(root, dir);
    if (!existsSync(abs)) { mkdirSync(abs, { recursive: true }); created.push(dir + "/"); }
    const keep = join(abs, ".gitkeep");
    if (!existsSync(keep)) writeFileSync(keep, "");
  }

  const seed = (name: string, body: string) => {
    const abs = join(root, name);
    if (existsSync(abs)) return;
    writeFileSync(abs, body);
    created.push(name);
  };

  const template = (name: string) => readFileSync(join(TEMPLATES, name), "utf8").replaceAll("{{UPDATED}}", now);

  seed("VAULT.md", template("VAULT.md"));
  seed("index.md", template("index.md"));
  seed("MEMORY.md", template("MEMORY.md"));
  seed(".gitignore", GITIGNORE);
  seed(".stignore", STIGNORE);

  let sha: string | null = null;
  if (opts.git !== false) {
    if (!isRepo(root)) initRepo(root);
    sha = commit(root, ["."], "vault: bootstrap", {});
    if (!sha) sha = git(root, ["rev-parse", "HEAD"]).stdout || null;
  }

  return { root, created, commit: sha, alreadyExisted };
}

export function briefTemplate(): string {
  return readFileSync(join(TEMPLATES, "session-brief.md"), "utf8");
}
