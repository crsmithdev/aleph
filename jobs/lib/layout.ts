/**
 * Where the store, the ledger and the sandbox folders live. One answer for every
 * reader (docs/specs/2026-10-30-work-model.md, "Migration rules"): the new layout
 * (issues, runs, sandbox) once ~/.aleph/issues exists, the old one (items, jobs,
 * runs) before. The environment still wins, variable by variable.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Layout { store: string; ledger: string; sandbox: string }

const expand = (p: string): string => (p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p);

/** Read at each call, so a migration while a process runs is seen at once. */
export function layout(): Layout {
  const home = join(process.env.HOME || homedir(), ".aleph");
  const e = process.env;
  const migrated = existsSync(join(home, "issues"));
  const [store, ledger, sandbox] = migrated
    ? [join(home, "issues"), join(home, "runs"), join(home, "sandbox")]
    : [join(home, "items"), join(home, "jobs"), join(home, "runs")];
  return {
    store: expand(e.ALEPH_ISSUES ?? e.ALEPH_ITEMS ?? store),
    ledger: expand(e.ALEPH_JOBS_DIR ?? ledger),
    sandbox: expand(e.ALEPH_SANDBOX_DIR ?? e.ALEPH_RUNS_DIR ?? sandbox),
  };
}

/** The store before the migration: ALEPH_ITEMS or ~/.aleph/items, never ALEPH_ISSUES. */
export function oldStore(): string {
  return expand(process.env.ALEPH_ITEMS ?? join(process.env.HOME || homedir(), ".aleph", "items"));
}
