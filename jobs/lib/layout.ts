/**
 * Where the store, the ledger and the sandbox folders live. One answer for every
 * reader (docs/specs/2026-10-30-work-model.md, "Migration rules"): the new layout
 * (issues, runs, sandbox) under ~/.aleph. The environment wins, variable by variable.
 * The old roots (items, jobs) belong to jobs/lib/migrate.ts alone.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export interface Layout { store: string; ledger: string; sandbox: string }

const expand = (p: string): string => (p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p);

/** Read at each call, so a changed environment is seen at once. */
export function layout(): Layout {
  const home = join(process.env.HOME || homedir(), ".aleph");
  const e = process.env;
  return {
    store: expand(e.ALEPH_ISSUES ?? join(home, "issues")),
    ledger: expand(e.ALEPH_JOBS_DIR ?? join(home, "runs")),
    sandbox: expand(e.ALEPH_SANDBOX_DIR ?? join(home, "sandbox")),
  };
}
