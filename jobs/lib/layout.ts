/**
 * Where the store, the ledger, the sandbox folders and the factory folder live. One answer for every
 * reader (docs/specs/2026-10-30-work-model.md, "Migration rules"): the new layout
 * (issues, runs, sandbox, factory) under ~/.aleph. The environment wins, variable by variable.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Layout { store: string; ledger: string; sandbox: string; factory: string }

const expand = (p: string): string => (p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p);

/** Read at each call, so a changed environment is seen at once. */
export function layout(): Layout {
  const home = join(process.env.HOME || homedir(), ".aleph");
  const e = process.env;
  return {
    store: expand(e.ALEPH_ISSUES ?? join(home, "issues")),
    ledger: expand(e.ALEPH_JOBS_DIR ?? join(home, "runs")),
    sandbox: expand(e.ALEPH_SANDBOX_DIR ?? join(home, "sandbox")),
    factory: expand(e.ALEPH_FACTORY_DIR ?? join(home, "factory")),
  };
}

/** One line in the factory's tick.log. */
export function factoryLog(line: string): void {
  const dir = layout().factory;
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "tick.log"), `${new Date().toISOString()} ${line}\n`);
}

/** The whole tick.log, or "" when there is none. */
export function readFactoryLog(): string {
  try { return readFileSync(join(layout().factory, "tick.log"), "utf8"); } catch { return ""; }
}
