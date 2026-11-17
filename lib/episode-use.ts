/**
 * The episode use log, `<factory>/episode-use.jsonl`: one line each time
 * `recall --episodes` shows a page or a tool call opens one. Eviction by use
 * reads it: a page shown often and never opened does not help.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { today } from "./day.ts";
import { jsonLines } from "./jsonl.ts";
import { layout } from "./layout.ts";

export interface Use { date: string; title: string; event: "shown" | "opened" }

const useLog = () => join(layout().factory, "episode-use.jsonl");

/** Append one line per title. Appends only, so the async hook and the CLI never overwrite each other. */
export function logUse(event: Use["event"], titles: string[]): void {
  if (!titles.length) return;
  try {
    mkdirSync(layout().factory, { recursive: true });
    appendFileSync(useLog(), titles.map((title) => JSON.stringify({ date: today(), title, event }) + "\n").join(""));
  } catch { /* a read must never fail on its own bookkeeping */ }
}

/** The lines of the log that parse: a line cut off by a crash is skipped. */
export const readUses = (): Use[] => (existsSync(useLog()) ? (jsonLines(readFileSync(useLog(), "utf8")) as Use[]) : []);

/** Drop the lines dated before `cut` (YYYY-MM-DD), and any line cut off. */
export function trimUse(cut: string): void {
  if (!existsSync(useLog())) return;
  writeFileSync(useLog(), readUses().filter((u) => u.date >= cut).map((u) => JSON.stringify(u) + "\n").join(""));
}
