// The layout of a job folder, `<jobs>/<n>/`: the name of every file a job keeps, the sections of `log.txt`, and the job's
// spec in its work's first folder. A leaf module: every module that reads or writes a job folder can import it without a cycle.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { layout } from "../../../lib/layout.ts";
import { parseKey } from "../../../lib/naming.ts";

/**
 * The files and folders a job folder holds. `pid`/`exit` belong to process.ts; they are listed so that the names stay in one place.
 * `prompt.md` is the agent's prompt, `transcript.jsonl` its stream, `result.md` its answer (a reviewer's verdict text in its own job's folder).
 */
export type RunFile =
  | "pid" | "exit"
  | "prompt.md" | "transcript.jsonl" | "result.md" | "log.txt"
  | "spec.md" | "result.html" | "review.json" | "batch.json" | "paused-next"
  | "gh" | "notes";

/** The parts of `log.txt`: the command that started the job, then what each step wrote. */
export type Section = "command" | "setup" | "stderr" | "dispatch" | "checks" | "land";
const SECTIONS: readonly Section[] = ["command", "setup", "stderr", "dispatch", "checks", "land"];
/** Whether `name` is a section of `log.txt`, not a file. */
export const isSection = (name: string): name is Section => (SECTIONS as readonly string[]).includes(name);

/** The folder of the job with key `id`: `<jobs>/<n>`. */
export function jobFolder(id: string): string {
  const k = parseKey(id);
  if (k?.kind !== "job") throw new Error(`run-files: "${id}" is not a job key`);
  return join(layout().jobs, String(k.n));
}

/** The key of the job whose folder is `folder`: `job.<n>`. */
export const jobOfFolder = (folder: string): string => `job.${basename(folder)}`;

/** The path of `file` in the job folder `folder`. */
export const runFile = (folder: string, file: RunFile): string => join(folder, file);

const header = (section: Section) => `=== ${section} ===`;
const HEADER = new RegExp(`^=== (${SECTIONS.join("|")}) ===$`);

/** Start a block of `section` in `log.txt` and return its path, for a process that appends its output to it. */
export function logStream(folder: string, section: Section): string {
  const file = runFile(folder, "log.txt");
  const had = existsSync(file) ? readFileSync(file, "utf8") : "";
  appendFileSync(file, `${had && !had.endsWith("\n") ? "\n" : ""}${header(section)}\n`);
  return file;
}

/** Append `text` to `log.txt` as a block of `section`. */
export function logTo(folder: string, section: Section, text: string): void {
  appendFileSync(logStream(folder, section), text.endsWith("\n") ? text : `${text}\n`);
}

/** The text of every block of `section` in `log.txt`, in order; undefined when the file or the section is not there. */
export function readSection(folder: string, section: Section): string | undefined {
  const file = runFile(folder, "log.txt");
  if (!existsSync(file)) return undefined;
  let at: string | undefined, found = false;
  const out: string[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const h = HEADER.exec(line);
    if (h) { at = h[1]; found ||= at === section; continue; }
    if (at === section) out.push(line);
  }
  if (!found) return undefined;
  const text = out.join("\n").replace(/\n+$/, "");
  return text ? `${text}\n` : "";
}

/** The path of the job's spec: `spec.md` in the folder of the work's first job, a sibling of the folders of its jobs. */
export const jobSpecFile = (run: { job: string }): string => join(jobFolder(run.job), "spec.md");

/** The job's spec, trimmed. Throws when the first job has none: only a build's work has one. */
export const jobSpec = (run: { job: string }): string => readFileSync(jobSpecFile(run), "utf8").trim();
