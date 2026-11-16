/**
 * Where aleph's files live: under ~/.aleph unless an environment variable names the place. Home is
 * HOME, else the OS's home folder, and a leading ~ in a variable is home; this module alone reads them.
 * Each function reads at each call, and a path that a UI build reads touches its source (sources.ts).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { touch } from "./sources.ts";

/** HOME, else the OS's home folder. */
export const home = (): string => process.env.HOME || homedir();

/** `p` with a leading `~` as home. */
export const expand = (p: string): string => (p === "~" || p.startsWith("~/") ? join(home(), p.slice(1)) : p);

/**
 * Chris's live store, from the passwd entry of this uid, so a test that sets HOME cannot move it. Bun 1.4.2's
 * `os.userInfo().homedir` follows HOME (Node's does not), so the file is read. Null when no entry is found.
 */
function passwdHome(): string | null {
  const uid = String(process.getuid?.());
  try {
    const row = readFileSync("/etc/passwd", "utf8").split("\n").map((l) => l.split(":")).find((f) => f[2] === uid);
    return row?.[5] || null;
  } catch { return null; }
}
const owner = passwdHome();
const live = owner === null ? null : join(owner, ".aleph");

/**
 * The variable `name`, expanded, else `rel` under ~/.aleph. Under `bun test` (NODE_ENV=test) a path in the live store
 * throws: a test that reaches it, by a missing preload or an env restored to unset, wrote fixture events to the live log.
 */
export function alephPath(name: string, rel: string): string {
  const p = expand(process.env[name] ?? join(home(), ".aleph", rel));
  if (process.env.NODE_ENV === "test" && live !== null && (p === live || p.startsWith(`${live}/`))) throw new Error(`a test reached the live store: ${name} unset, ${p}`);
  return p;
}

/** The folder of Claude Code's transcripts, `<project>/<session>.jsonl`. */
export const claudeProjects = (): string => expand(process.env.ALEPH_CLAUDE_PROJECTS ?? join(home(), ".claude", "projects"));
/** The vault folder. */
export const vaultDir = (): string => { touch("vault"); return alephPath("ALEPH_VAULT", "vault"); };
/** The handoffs folder: beside the vault (the link, not its target) unless the environment names it. */
export const handoffsDir = (): string => { touch("handoffs"); return expand(process.env.ALEPH_HANDOFFS_DIR ?? join(dirname(resolve(vaultDir())), "handoffs")); };
/** The notes pinned on UI pages, and the answers to them (lib/annotations.ts). */
export const annotationsFile = (): string => { touch("annotations"); return alephPath("ALEPH_ANNOTATIONS", "annotations.json"); };
