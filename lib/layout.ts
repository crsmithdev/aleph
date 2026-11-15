/**
 * Where the items repo, the job folders, and the factory folder live. One answer for every
 * reader (docs/data-model.md): the layout
 * (items, jobs, factory) under ~/.aleph. The environment wins, variable by variable.
 */
import { conn } from "./db.ts";
import { event, type Event, type EventRow } from "./naming.ts";
import { alephPath } from "./paths.ts";
import { touch } from "./sources.ts";

export interface Layout { items: string; jobs: string; factory: string }

const factory = () => alephPath("ALEPH_FACTORY_DIR", "factory");

/** Read at each call, so a changed environment is seen at once. Each path touches its source when read (sources.ts). */
export function layout(): Layout {
  return {
    get items() { touch("store"); return alephPath("ALEPH_ITEMS", "items"); },
    get jobs() { touch("runs"); return alephPath("ALEPH_JOBS_DIR", "jobs"); },
    get factory() { touch("factory"); return factory(); },
  };
}

/** One event in the event table; `event()` checks its words first, so a bad word throws. */
export function logEvent(e: Parameters<typeof event>[0]): Event {
  const ev = event(e);
  conn().query("INSERT INTO events (time, subject, action, object, detail, size) VALUES (?, ?, ?, ?, ?, ?)").run(ev.time, ev.subject, ev.action, ev.object, ev.detail ?? null, ev.size ?? null);
  return ev;
}

/** A change of a setting (pause, Always, a model setting, the judge) as an event, so the Herald shows it. */
export const logSetting = (detail: string): Event => logEvent({ subject: "human", action: "changed", object: "settings", detail });

/** The events at or after `since` (ms), oldest first, with the job fields of `event_rows`. */
export function readEvents(since = 0): EventRow[] {
  touch("events");
  return conn().query("SELECT * FROM event_rows WHERE time >= ? ORDER BY seq").all(new Date(since).toISOString()) as EventRow[];
}

/** The events after `seq`, oldest first. */
export const eventsAfter = (seq: number): EventRow[] => conn().query("SELECT * FROM event_rows WHERE seq > ? ORDER BY seq").all(seq) as EventRow[];
/** The `seq` of the last event; 0 when there is none. */
export const lastSeq = (): number => (conn().query("SELECT coalesce(max(seq), 0) AS n FROM events").get() as { n: number }).n;

/** The events whose object is `object`, oldest first; with `actions`, only those actions. */
export const eventsOf = (object: string, ...actions: string[]): Event[] =>
  conn().query(`SELECT seq, time, subject, action, object, detail FROM events WHERE object = ?${actions.length ? ` AND action IN (${actions.map(() => "?").join(", ")})` : ""} ORDER BY seq`).all(object, ...actions) as Event[];
