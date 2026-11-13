/**
 * The episode use log, `<factory>/episode-use.jsonl`: one line each time
 * `recall --episodes` shows a page or a tool call opens one. Eviction by use
 * reads it: a page shown often and never opened does not help.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { today } from "./day.ts";
import { layout } from "./layout.ts";

export interface Use { date: string; title: string; event: "shown" | "opened"; session: string | null; query?: string }

export const useLog = () => join(layout().factory, "episode-use.jsonl");

/** Append one line per title. Appends only, so the async hook and the CLI never overwrite each other. */
export function logUse(event: Use["event"], titles: string[], session: string | null, query?: string): void {
  if (!titles.length) return;
  try {
    mkdirSync(layout().factory, { recursive: true });
    appendFileSync(useLog(), titles.map((title) => JSON.stringify({ date: today(), title, event, session, ...(query === undefined ? {} : { query }) }) + "\n").join(""));
  } catch { /* a read must never fail on its own bookkeeping */ }
}

/** Drop the lines dated before `cut` (YYYY-MM-DD). */
export function trimUse(cut: string): void {
  const file = useLog();
  if (!existsSync(file)) return;
  const kept = readFileSync(file, "utf8").split("\n").filter((l) => l && JSON.parse(l).date >= cut);
  writeFileSync(file, kept.map((l) => l + "\n").join(""));
}
