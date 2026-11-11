/**
 * Where the store, the ledger, and the factory folder live. One answer for every
 * reader (docs/data-model.md): the layout
 * (issues, runs, factory) under ~/.aleph. The environment wins, variable by variable.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { event, type Event } from "./naming.ts";
import { alephPath } from "./paths.ts";
import { touch } from "./sources.ts";

export interface Layout { store: string; ledger: string; factory: string }

const factory = () => alephPath("ALEPH_FACTORY_DIR", "factory");

/** Read at each call, so a changed environment is seen at once. Each path touches its source when read (sources.ts). */
export function layout(): Layout {
  return {
    get store() { touch("store"); return alephPath("ALEPH_ISSUES", "issues"); },
    get ledger() { touch("runs"); return alephPath("ALEPH_JOBS_DIR", "runs"); },
    get factory() { touch("factory"); return factory(); },
  };
}

/** The folder of the job records: `ALEPH_RECORDS_DIR`, else beside a ledger the environment names, else ~/.aleph/jobs. */
export function recordsDir(): string {
  touch("records");
  const e = process.env;
  if (!e.ALEPH_RECORDS_DIR && e.ALEPH_JOBS_DIR) return join(e.ALEPH_JOBS_DIR, ".records");
  return alephPath("ALEPH_RECORDS_DIR", "jobs");
}

/** The event log: one file per UTC day, `<day>.jsonl`, one event as JSON per line. A day before today never changes. */
export const eventsDir = (): string => { touch("events"); return join(factory(), "events"); };

/** One event in the event log, in the file of its day. `event()` checks its words first, so a bad word throws. */
export function logEvent(e: Parameters<typeof event>[0]): Event {
  const ev = event(e);
  mkdirSync(eventsDir(), { recursive: true });
  appendFileSync(join(eventsDir(), `${ev.at.slice(0, 10)}.jsonl`), `${JSON.stringify(ev)}\n`);
  return ev;
}

/** The parsed lines of each day file, by path, with the size they were read at: a file is read again only when it grows. */
const days = new Map<string, { size: number; events: Event[] }>();

/** The events of a day file's text; a line cut off by a write in progress is left for the next read. */
export const eventsOf = (text: string): Event[] => text.split("\n").flatMap((l) => { try { return l ? [JSON.parse(l)] : []; } catch { return []; } });

/** The events at or after `since` (ms), oldest first. Only the files of the days from `since` on are read. */
export function readEvents(since = 0): Event[] {
  const dir = eventsDir();
  if (!existsSync(dir)) return [];
  const from = new Date(since).toISOString(), first = `${from.slice(0, 10)}.jsonl`;
  const out: Event[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl") && f >= first).sort()) {
    const path = join(dir, f), size = statSync(path).size;
    let d = days.get(path);
    if (d?.size !== size) days.set(path, (d = { size, events: eventsOf(readFileSync(path, "utf8")) }));
    out.push(...d.events.filter((e) => e.at >= from));
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

