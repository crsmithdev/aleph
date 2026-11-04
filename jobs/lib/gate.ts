/**
 * The factory's gate: what a worker's transcript says, and whether a diff
 * needs Chris. See "Held paths" in docs/specs/2026-10-26-seed-factory.md.
 */
import { git } from "./git.ts";
import { tagged } from "./ledger.ts";
import { NO_OUTPUT } from "./structured.ts";

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

/**
 * The reply text and the cost of a read-only run. A stdout with no `result`
 * event, as a test's fake prints, is the text itself.
 */
export function replyOf(stdout: string): { text: string; cost?: number } {
  const o = outcome(stdout);
  return o.result || o.cost !== undefined ? { text: o.result, cost: o.cost } : { text: stdout };
}

/** The marker a worker's claim that the goal is already met starts with; the FACTORY prompt asks for it. */
export const ALREADY_MET = "Goal: Already met";

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

/** The JSON schema of the reviewer's reply. */
export const REVIEW_SCHEMA = {
  type: "object", additionalProperties: false, required: ["verdict", "summary", "failures"],
  properties: {
    verdict: { enum: ["pass", "hold"] },
    summary: { type: "string", minLength: 1, description: "The verdict in one sentence and the count of passes, in at most 80 words." },
    failures: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["clause", "observed"],
        properties: { clause: { type: "string", minLength: 1, description: "The failed clause, named by a few words." }, observed: { type: "string", minLength: 1 } },
      },
    },
    set_aside: { type: "array", items: { type: "string", minLength: 1 }, description: "Each sealed scenario set aside, and why." },
  },
};

export interface Review { pass: boolean; reason: string; asides: string[]; text: string }

const line = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/**
 * The reviewer's structured output, or why it does not do. `reason` names the failed clauses; `text` is review.md:
 * the summary, a `CHECK: fail` line for each failure, a `SET-ASIDE:` line for each scenario set aside, and the `VERDICT:` line `verdict` reads.
 */
export function parseReview(raw: any): Review | string {
  if (raw === undefined) return NO_OUTPUT;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "not an object";
  if (raw.verdict !== "pass" && raw.verdict !== "hold") return `unknown verdict ${JSON.stringify(raw.verdict)}`;
  const pass = raw.verdict === "pass";
  const failures = (Array.isArray(raw.failures) ? raw.failures : []).map((f: any) => ({ clause: line(f?.clause), observed: line(f?.observed) })).filter((f: { clause: string }) => f.clause);
  const asides = (Array.isArray(raw.set_aside) ? raw.set_aside : []).map(line).filter(Boolean);
  const reason = pass ? "" : failures.map((f: { clause: string }) => f.clause).join("; ") || "no reason given";
  const text = [
    typeof raw.summary === "string" ? raw.summary.trim() : "", "",
    ...failures.map((f: { clause: string; observed: string }) => `CHECK: fail ${f.clause}: ${f.observed}`),
    ...asides.map((a: string) => `SET-ASIDE: ${a}`),
    `VERDICT: ${pass ? "pass" : `hold ${reason}`}`,
  ].join("\n");
  return { pass, reason, asides, text: `${text.trim()}\n` };
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
 * What runs the sandbox, and the review and safety checks. A diff that changes one waits for Chris
 * after the reviewer passes it, as a held path does; any other run that passes the reviewer lands by itself.
 */
export const SECURITY_PATHS = ["hooks/", "jobs/lib/sandbox.ts", "jobs/lib/netns.ts", "jobs/lib/probe.ts", "jobs/lib/shot.ts", "jobs/lib/gate.ts", "jobs/lib/review-browser.ts", "package.json", "tsconfig.json", "bunfig.toml", "identity/CLAUDE.md"];

/** A security path the diff from `base` to `tip` changes that is not a test, or null. A rename counts both of its paths. */
export function securityChange(cwd: string, base: string, tip: string): string | null {
  const rows = git(cwd, "diff", "--name-status", "-M", base, tip).out.split("\n").filter(Boolean).map((l) => l.split("\t"));
  for (const [, ...paths] of rows) for (const p of paths) if (!TEST.test(p) && SECURITY_PATHS.some((s) => (s.endsWith("/") ? p.startsWith(s) : p === s))) return p;
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
