/**
 * The `usage` and `openrouter` tables of aleph.db: the SQL of both lives here (lib/db.ts holds their schema).
 * ui/usage.ts polls the sources and writes; jobs/ reads and prunes, as it cannot import ui/.
 */
import { conn } from "./db.ts";

/** One poll of the plan: the 7-day percent and when it resets. */
export interface Snapshot { at: string; seven_day: number; seven_day_resets_at: string | null }
/** One poll of the OpenRouter key: its lifetime USD, and the rate over list price when the poll could fit one. */
interface KeyRow { at: string; usage: number; factor: number | null }

export const addSnapshot = (s: Snapshot): void => { conn().query("INSERT INTO usage (time, seven_day, seven_day_resets_at) VALUES (?, ?, ?)").run(s.at, s.seven_day, s.seven_day_resets_at); };

/** Every snapshot in the order written. */
export const snapshots = (): Snapshot[] => conn().query("SELECT time AS at, seven_day, seven_day_resets_at FROM usage ORDER BY seq").all() as Snapshot[];

/** Delete the snapshots older than `cut` (ISO time); how many. */
export const pruneSnapshots = (cut: string): number => conn().query("DELETE FROM usage WHERE time < ?").run(cut).changes;

export const addKeyRow = (r: { at: string; usage: number; factor?: number }): void => { conn().query("INSERT INTO openrouter (time, usage, factor) VALUES (?, ?, ?)").run(r.at, r.usage, r.factor ?? null); };

/** Every key row in the order written. */
export const keyRows = (): KeyRow[] => conn().query("SELECT time AS at, usage, factor FROM openrouter ORDER BY seq").all() as KeyRow[];

/** The factor of the last key row that has one, or null. */
export const lastFactor = (): number | null => (conn().query("SELECT factor FROM openrouter WHERE factor > 0 ORDER BY seq DESC LIMIT 1").get() as { factor: number } | null)?.factor ?? null;
