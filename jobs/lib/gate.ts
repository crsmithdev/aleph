/**
 * The factory's gate: what a worker's transcript says, and whether a diff
 * needs Chris. See "Held paths" in docs/specs/2026-10-26-seed-factory.md.
 */
import { git } from "./git.ts";

export interface Outcome { ok: boolean; line: string; result: string; cost?: number }

const lifecycle = (line: string): boolean => {
  try { return JSON.parse(line)?.type === "command_lifecycle"; } catch { return false; }
};

/**
 * The last line of the worker's stdout decides: it must be a `stream-json`
 * `result` event with `is_error` false. Anything else, whatever the exit
 * code, is a run that did not finish. The `command_lifecycle` lines the
 * command adds after the worker's output are not the worker's, so they are skipped.
 */
export function outcome(stdout: string): Outcome {
  const line = stdout.trimEnd().split("\n").findLast((l) => !lifecycle(l)) ?? "";
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

/**
 * The worker's claim that the goal is already met, as its last `Goal: Already met`
 * line: the reason given after it, or "no reason given". Null when there is no claim.
 */
export function alreadyMet(result: string): string | null {
  const m = result.split("\n").map((l) => /^Goal:\s*already met\b[\s:.\-—]*(.*)$/i.exec(l.trim())).filter(Boolean).at(-1);
  return m ? (m[1].trim() || "no reason given") : null;
}

/**
 * The reviewer's verdict: its last `VERDICT:` line. `pass`, or `hold` with
 * a reason; null when there is no such line or it says neither.
 */
export function verdict(result: string): { pass: true } | { pass: false; reason: string } | null {
  const v = tagged(result, "VERDICT").at(-1);
  if (v === undefined) return null;
  if (v === "pass") return { pass: true };
  if (v === "hold" || v.startsWith("hold ")) return { pass: false, reason: v.slice(4).trim() || "no reason given" };
  return null;
}

const TEST = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const MARK = /\b(test|it|describe)\.(skip|only|todo)\b/;
const CASE = /\b(test|it|describe|expect)\s*(\.\w+\s*)?\(/;

/**
 * The held rule the diff from `base` to `tip` breaks, or null: a path in the
 * `held` list that is not a test. The globs come from the registry, which the
 * branch cannot change. Test changes are `testFindings`, for the reviewer.
 */
export function heldRule(cwd: string, held: string[], base: string, tip: string): string | null {
  const isHeld = (p: string) => held.some((g) => new Bun.Glob(g).match(p));
  const rows = git(cwd, "diff", "--name-status", "-M", base, tip).out.split("\n").filter(Boolean).map((l) => l.split("\t"));
  for (const [, ...paths] of rows) for (const p of paths) if (isHeld(p) && !TEST.test(p)) return `held path ${p}`;
  return null;
}

/**
 * What the diff does to tests, one finding each: an existing test deleted or
 * renamed, a removed or changed `test`, `it`, `describe` or `expect` line, or
 * a `.skip`, `.only` or `.todo` added. A run that only adds tests gives none.
 * The reviewer judges them against the goal; they do not hold the run.
 */
export function testFindings(cwd: string, base: string, tip: string): string[] {
  const rows = git(cwd, "diff", "--name-status", "-M", base, tip).out.split("\n").filter(Boolean).map((l) => l.split("\t"));
  const lines = (f: string, sign: "+" | "-") => git(cwd, "diff", base, tip, "--", f).out.split("\n").filter((l) => l.startsWith(sign) && !l.startsWith(sign.repeat(3)));
  const found: string[] = [];
  for (const [status, from, to] of rows) {
    if (!TEST.test(from)) continue;
    if (status === "D") found.push(`deletes the test ${from}`);
    else if (status.startsWith("R")) found.push(`renames the test ${from} to ${to}`);
    else if (status === "M" && lines(from, "-").some((l) => CASE.test(l))) found.push(`changes the test ${from}`);
    else if (lines(from, "+").some((l) => MARK.test(l))) found.push(`adds .skip, .only or .todo in ${from}`);
  }
  return found;
}
