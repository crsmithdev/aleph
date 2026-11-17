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

/** The text of a JSONL transcript, or "" when the file cannot be read. */
export function readText(transcriptPath: string): string {
  try { return readFileSync(transcriptPath, "utf8"); } catch { return ""; }
}

/** The entries of JSONL `text` from the last back. Only a line that matches `grep` is parsed, so a search for a rare entry does not pay a parse of the whole text. */
export function* entriesBackward(text: string, grep: RegExp): Generator<Entry> {
  for (let end = text.length; end > 0;) {
    const start = text.lastIndexOf("\n", end - 1) + 1;
    const line = text.slice(start, end);
    end = start - 1;
    if (!grep.test(line)) continue;
    try { yield JSON.parse(line); } catch { /* partial last line */ }
  }
}
