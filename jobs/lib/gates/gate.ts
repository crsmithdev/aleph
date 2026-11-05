/**
 * The factory's gate: what a worker's transcript says, and whether a diff
 * needs Chris. See "Held paths" in docs/specs/2026-10-26-seed-factory.md.
 */
import { git } from "../infra/git.ts";
import { NO_OUTPUT } from "../roles/structured.ts";
import type { Usage } from "../../../hooks/lib/pricing.ts";

/** `usage` is the result event's tokens, in the shape `costDetails` takes. */
export interface Outcome { ok: boolean; line: string; result: string; cost?: number; usage?: Usage }

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
  const u = ev?.usage;
  const usage = typeof u?.input_tokens === "number" && typeof u?.output_tokens === "number"
    ? { input: u.input_tokens, output: u.output_tokens, cache_read_input_tokens: u.cache_read_input_tokens ?? 0, cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0 }
    : undefined;
  return { ok, line: ok ? "" : (result || line).slice(0, 300), result, cost, ...(usage ? { usage } : {}) };
}

/**
 * The reply text and the cost of a read-only run. A stdout with no `result`
 * event, as a test's fake prints, is the text itself.
 */
export function replyOf(stdout: string): { text: string; cost?: number } {
  const o = outcome(stdout);
  return o.result || o.cost !== undefined ? { text: o.result, cost: o.cost } : { text: stdout };
}

const text = { type: "string", minLength: 1 };

/** The JSON schema of the factory worker's reply. */
export const WORKER_SCHEMA = {
  type: "object", additionalProperties: false, required: ["summary", "defaults", "followups", "flakes", "already_met", "question"],
  properties: {
    summary: { ...text, description: "What you did and what you ran, each thing said once: at most 120 words of prose, plus a list only for separate items." },
    defaults: {
      type: "array", description: "Each choice the Oracle does not settle, and the answer you took.",
      items: { type: "object", additionalProperties: false, required: ["choice", "chose"], properties: { choice: text, chose: text } },
    },
    followups: {
      type: "array", description: "Work you found but did not do. Not a flake, and nothing the Oracle names.",
      items: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { ...text, maxLength: 60 } } },
    },
    flakes: {
      type: "array", description: "Tests that are not the goal's own, failed or timed out, and passed alone or on a rerun.",
      items: { type: "object", additionalProperties: false, required: ["file", "name", "what"], properties: { file: text, name: text, what: { ...text, description: "What you saw." } } },
    },
    already_met: {
      description: "Null, unless the goal already holds and you made no commit.",
      anyOf: [
        { type: "null" },
        { type: "object", additionalProperties: false, required: ["evidence"], properties: { evidence: { ...text, description: "The files, lines and commit on main that show the goal holds." } } },
      ],
    },
    question: {
      description: "Null, unless you cannot meet a clause of the Oracle: then the question that names the clause.",
      anyOf: [{ type: "null" }, text],
    },
  },
};

/** The factory worker's reply: result.md's text, the defaults as `<choice> -> <chose>`, follow-up titles, flake notes, the already-met evidence, and the question. */
export interface WorkerReply { summary: string; defaults: string[]; followups: string[]; flakes: string[]; alreadyMet: string | null; question: string | null }

/** The worker's structured output, or why it does not do. */
export function parseWorker(raw: any): WorkerReply | string {
  if (raw === undefined) return NO_OUTPUT;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "not an object";
  if (typeof raw.summary !== "string") return "no summary";
  const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  return {
    summary: raw.summary,
    defaults: list(raw.defaults).map((d) => `${line(d?.choice)} -> ${line(d?.chose)}`),
    followups: list(raw.followups).map((f) => line(f?.title)).filter(Boolean),
    flakes: list(raw.flakes).map((f) => `${line(f?.file)} > ${line(f?.name)}: ${line(f?.what)}`),
    alreadyMet: raw.already_met ? line(raw.already_met.evidence) || "no reason given" : null,
    question: line(raw.question) || null,
  };
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
  },
};

/** What review.json holds: the reviewer's reply, with its failures cleaned. */
export interface ReviewJson { verdict: "pass" | "hold"; summary: string; failures: { clause: string; observed: string }[] }

export interface Review { pass: boolean; reason: string; text: string; json: ReviewJson }

const line = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/**
 * The reviewer's structured output, or why it does not do. `reason` names the failed clauses; `json` is review.json,
 * which code reads; `text` is review.md, for people: the summary, a `CHECK: fail` line for each failure, and a `VERDICT:` line.
 */
export function parseReview(raw: any): Review | string {
  if (raw === undefined) return NO_OUTPUT;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "not an object";
  if (raw.verdict !== "pass" && raw.verdict !== "hold") return `unknown verdict ${JSON.stringify(raw.verdict)}`;
  const pass = raw.verdict === "pass";
  const failures = (Array.isArray(raw.failures) ? raw.failures : []).map((f: any) => ({ clause: line(f?.clause), observed: line(f?.observed) })).filter((f: { clause: string }) => f.clause);
  const reason = pass ? "" : failures.map((f: { clause: string }) => f.clause).join("; ") || "no reason given";
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  const text = [
    summary, "",
    ...failures.map((f: { clause: string; observed: string }) => `CHECK: fail ${f.clause}: ${f.observed}`),
    `VERDICT: ${pass ? "pass" : `hold ${reason}`}`,
  ].join("\n");
  return { pass, reason, text: `${text.trim()}\n`, json: { verdict: raw.verdict, summary, failures } };
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
 * The review and safety checks. A diff that changes one waits for Chris
 * after the reviewer passes it, as a held path does; any other run that passes the reviewer lands by itself.
 */
export const SECURITY_PATHS = ["hooks/", "jobs/lib/gates/gate.ts", "package.json", "tsconfig.json", "bunfig.toml", "identity/CLAUDE.md"];

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
 * The reviewer judges them against the issue; they do not hold the run.
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
