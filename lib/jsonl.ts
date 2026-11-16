// The one reader of a JSONL transcript. A line that does not parse is skipped: the last line of a live session can be cut off.
import { readFileSync, statSync } from "node:fs";

export type Entry = Record<string, any>;

/** The entries of JSONL `text`, one per line that parses. */
export function jsonLines(text: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try { entries.push(JSON.parse(line)); } catch { /* partial last line */ }
  }
  return entries;
}

let parsed: { path: string; size: number; entries: Entry[] } | null = null;

/** Every entry of a JSONL transcript, or none when the file cannot be read. A hook process parses a path once while its size holds: a parse of a 25 MB transcript takes about 110 ms. */
export function readLines(transcriptPath: string): Entry[] {
  let size: number;
  try { size = statSync(transcriptPath).size; } catch { return []; }
  if (parsed?.path === transcriptPath && parsed.size === size) return parsed.entries;
  let raw: string;
  try { raw = readFileSync(transcriptPath, "utf8"); } catch { return []; }
  const entries = jsonLines(raw);
  parsed = { path: transcriptPath, size, entries };
  return entries;
}
