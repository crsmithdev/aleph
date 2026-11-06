/**
 * Where the store, the ledger, and the factory folder live. One answer for every
 * reader (docs/data-model.md): the layout
 * (issues, runs, factory) under ~/.aleph. The environment wins, variable by variable.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { event, type Event } from "../../../lib/naming.ts";

export interface Layout { store: string; ledger: string; factory: string }

const expand = (p: string): string => (p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p);

/** Read at each call, so a changed environment is seen at once. */
export function layout(): Layout {
  const home = join(process.env.HOME || homedir(), ".aleph");
  const e = process.env;
  return {
    store: expand(e.ALEPH_ISSUES ?? join(home, "issues")),
    ledger: expand(e.ALEPH_JOBS_DIR ?? join(home, "runs")),
    factory: expand(e.ALEPH_FACTORY_DIR ?? join(home, "factory")),
  };
}

/** One line in the factory's tick.log. */
export function factoryLog(line: string): void {
  const dir = layout().factory;
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "tick.log"), `${new Date().toISOString()} ${line}\n`);
}

/** One event in tick.log: the time, a space, and the event as JSON. `event()` checks its words first, so a bad word throws. */
export function logEvent(e: Parameters<typeof event>[0]): Event {
  const ev = event(e);
  const dir = layout().factory;
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "tick.log"), `${ev.at} ${JSON.stringify(ev)}\n`);
  return ev;
}

/** The event in the rest of a tick.log line (after the time), or null for a text line. */
export function eventOf(rest: string): Event | null {
  if (!rest.startsWith("{")) return null;
  try { return JSON.parse(rest); } catch { return null; }
}

/** The whole tick.log, or "" when there is none. */
export function readFactoryLog(): string {
  try { return readFileSync(join(layout().factory, "tick.log"), "utf8"); } catch { return ""; }
}
