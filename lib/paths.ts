/**
 * Where aleph's files live: under ~/.aleph unless an environment variable names the place. Home is
 * HOME, else the OS's home folder, and a leading ~ in a variable is home; this module alone reads them.
 * Each function reads at each call, and a path that a UI build reads touches its source (sources.ts).
 */
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { touch } from "./sources.ts";

/** HOME, else the OS's home folder. */
export const home = (): string => process.env.HOME || homedir();

/** `p` with a leading `~` as home. */
export const expand = (p: string): string => (p === "~" || p.startsWith("~/") ? join(home(), p.slice(1)) : p);

/** The variable `name`, expanded, else `rel` under ~/.aleph. */
export const alephPath = (name: string, rel: string): string => expand(process.env[name] ?? join(home(), ".aleph", rel));

/** The vault folder. */
export const vaultDir = (): string => { touch("vault"); return alephPath("ALEPH_VAULT", "vault"); };
/** The handoffs folder: beside the vault (the link, not its target) unless the environment names it. */
export const handoffsDir = (): string => { touch("handoffs"); return expand(process.env.ALEPH_HANDOFFS_DIR ?? join(dirname(resolve(vaultDir())), "handoffs")); };
/** The notes pinned on UI pages, and the answers to them (lib/annotations.ts). */
export const annotationsFile = (): string => { touch("annotations"); return alephPath("ALEPH_ANNOTATIONS", "annotations.json"); };
