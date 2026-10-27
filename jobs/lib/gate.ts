/**
 * The factory's gate: what a worker's transcript says, and whether a diff
 * needs Chris. See "Held paths" in docs/specs/2026-10-26-seed-factory.md.
 */
import { git } from "./git.ts";

export interface Outcome { ok: boolean; line: string; result: string; cost?: number }

/**
 * The last line of the worker's stdout decides: it must be a `stream-json`
 * `result` event with `is_error` false. Anything else, whatever the exit
 * code, is a run that did not finish.
 */
export function outcome(stdout: string): Outcome {
  const line = stdout.trimEnd().split("\n").at(-1) ?? "";
  let ev: any;
  try { ev = JSON.parse(line); } catch { return { ok: false, line: line.slice(0, 300) || "no output", result: "" }; }
  const result = typeof ev?.result === "string" ? ev.result : "";
  const cost = typeof ev?.total_cost_usd === "number" ? ev.total_cost_usd : undefined;
  const ok = ev?.type === "result" && ev.is_error === false;
  return { ok, line: ok ? "" : (result || line).slice(0, 300), result, cost };
}

/** The text after `<tag>:` on each line of the result that starts with it. */
export const tagged = (result: string, tag: string): string[] =>
  result.split("\n").map((l) => l.trim()).filter((l) => l.startsWith(`${tag}:`)).map((l) => l.slice(tag.length + 1).trim()).filter(Boolean);

const TEST = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const MARK = /\b(test|it|describe)\.(skip|only|todo)\b/;

/**
 * The first rule the diff from `base` to `tip` breaks, or null: a held path,
 * an existing test deleted, renamed or changed, or a `.skip`, `.only` or
 * `.todo` added to a test. The globs come from the registry, which the
 * branch cannot change.
 */
export function heldRule(cwd: string, held: string[], base: string, tip: string): string | null {
  const isHeld = (p: string) => held.some((g) => new Bun.Glob(g).match(p));
  const rows = git(cwd, "diff", "--name-status", "-M", base, tip).out.split("\n").filter(Boolean).map((l) => l.split("\t"));
  for (const [, ...paths] of rows) for (const p of paths) if (isHeld(p)) return `held path ${p}`;
  for (const [status, from, to] of rows) {
    if (!TEST.test(from)) continue;
    if (status === "D") return `deletes the test ${from}`;
    if (status.startsWith("R")) return `renames the test ${from} to ${to}`;
    if (status === "M") return `changes the test ${from}`;
    if (status === "A") {
      const added = git(cwd, "diff", base, tip, "--", from).out.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
      if (added.some((l) => MARK.test(l))) return `adds .skip, .only or .todo in ${from}`;
    }
  }
  return null;
}
