// The factory's JSON state files. The only module that parses one: a missing file is the caller's fallback, a file
// that does not parse is a bug and throws. The write goes through a rename, so a reader never sees half a file.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The JSON in `file`, or `fallback` when there is no file. A file that does not parse throws. */
export function readJsonOr<T>(file: string, fallback: T): T {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
  return JSON.parse(text);
}

/** Writes `value` to `file` as JSON: to a temp file, then a rename over `file`. `mode` sets the new file's permissions. */
export function writeJson(file: string, value: unknown, mode?: number): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode });
  renameSync(tmp, file);
}
