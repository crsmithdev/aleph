/**
 * In-process calls of the library functions that jobs/cli.ts calls, for the tests that keep the CLI only for a
 * command's wiring. Each call runs under the environment and working directory that `aleph` gets from
 * cli.helpers, and gives the result in the shape of `aleph()`: the printed JSON, the exit code and the refusal.
 */
import { base, env } from "./cli.helpers";
import { loadRegistry } from "./lib/records/ledger.ts";
import { parseIssueRef } from "../issues/lib/todo.ts";
import { Refusal } from "../lib/refusal.ts";
import { checked as checkedJob, drop as dropJob, jobCommand, land as landJob, recheck as recheckJob, startJob, type Start } from "./lib/transitions/transitions.ts";
import { runDispatch } from "./lib/transitions/factory.ts";
import { repoStages } from "./lib/records/status.ts";
import { findJob, view } from "./lib/records/job.ts";
import * as verbs from "../issues/lib/issues.ts";

export interface Result { code: number; json: any; stderr: string }

/**
 * The machine's time zone. `bun test` runs the test process in UTC, but `aleph` and the units it starts run in this
 * zone: a run folder's name is a local time stamp, so an in-process start must stamp in the zone of the units.
 */
let zone = "";
const localZone = () => zone ||= Bun.spawnSync(["bun", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], { env: { PATH: process.env.PATH } }).stdout.toString().trim();

let depth = 0, saved: Record<string, string | undefined> = {}, savedCwd = "";
/**
 * Run `f` under the CLI's environment (cli.helpers `env(extra)`) and in `base`, as `aleph` runs; then put both back.
 * Calls that overlap share one environment: the first sets it and the last puts it back, so they take the same `extra`.
 */
export async function asCli<T>(extra: Record<string, string>, f: () => T | Promise<T>): Promise<T> {
  if (depth++ === 0) {
    saved = { ...process.env };
    savedCwd = process.cwd();
    const e = { TZ: localZone(), ...env(extra) };
    for (const k of Object.keys(process.env)) if (!(k in e)) delete process.env[k];
    Object.assign(process.env, e);
    process.chdir(base);
  }
  try {
    return await f();
  } finally {
    if (--depth === 0) {
      // Bun reads a new TZ when it is set, not when it is deleted: set UTC back first.
      process.env.TZ = "UTC";
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      process.chdir(savedCwd);
    }
  }
}

/** The value as `aleph` prints it, with exit 0; a refusal is exit 1 with its message on stderr. */
export async function call(f: () => unknown, extra: Record<string, string> = {}): Promise<Result> {
  try {
    const v = await asCli(extra, f);
    return { code: 0, json: v === undefined ? null : JSON.parse(JSON.stringify(v)), stderr: "" };
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    return { code: 1, json: null, stderr: e.message };
  }
}

/** A start as `aleph` runs it: the started run is printed, then the exit code is the foreground unit's. */
async function start(f: () => Promise<Start>, extra: Record<string, string>): Promise<Result> {
  let code = 0;
  const r = await call(async () => { const s = await f(); code = (await s.child?.exited) ?? 0; return s.started; }, extra);
  return r.code ? r : { ...r, code };
}

/** `aleph job <repo> <name> --spec <file>` with the spec's text. */
export const job = (repo: string, name: string, spec: string, o: { on?: string; land?: boolean } = {}, extra: Record<string, string> = {}) => {
  const a = { repo, name, spec, on: o.on, land: o.land };
  return start(() => startJob(a, { command: jobCommand(a), output: "ignore" }), extra);
};
/** `aleph job demo <name>` with the one-action spec of cli.helpers `job`. */
export const actionJob = (name: string, action: string, extra: Record<string, string> = {}, repo = "demo") =>
  job(repo, name, `Goal: ${name}\nACTION: ${action}\n`, {}, extra);
/** `aleph land <name> [--checked]`. */
export const land = (name: string, o: { checked?: boolean } = {}, extra: Record<string, string> = {}) =>
  start(() => landJob(name, { checked: o.checked }, { command: ["land", name], output: "ignore" }), extra);
/** `aleph recheck <name>`. */
export const recheck = (name: string, extra: Record<string, string> = {}) => start(() => recheckJob(name, { command: ["recheck", name], output: "ignore" }), extra);
/** `aleph drop <name> [<reason>] [--quiet]`: the CLI's fate is manual unless quiet. */
export const drop = (name: string, reason = "", quiet = false, extra: Record<string, string> = {}) =>
  call(() => dropJob(name, { reason, quiet, fate: quiet ? undefined : "manual" }), extra);
/** `aleph checked <name>`. */
export const checked = (name: string) => call(() => checkedJob(name));
/** The job's view, from which `aleph jobs [<name>]` prints its condition and check. */
export const jobView = (name: string) => call(() => { const j = findJob(name); return j && view(j); });
/** `aleph dispatch`. */
export const dispatch = (extra: Record<string, string> = {}) => call(() => runDispatch(), extra);

const idOf = (ref: number | string) => (/^\d+\.\d+$/.test(String(ref)) ? String(ref) : Number(ref));

/** `aleph issue add <repo> <title>` with its fields. */
export const issueAdd = (key: string, title: string, fields: verbs.Fields = {}, extra: Record<string, string> = {}) =>
  call(async () => { const repo = loadRegistry()[key]!; verbs.checkFields(fields); return (await verbs.add(repo, title, fields)).result; }, extra);
/** `aleph issue list <repo> [--status <s>] [--label <l>] --json`. */
export const issueList = (key: string, o: { status?: string; label?: string; kind?: string } = {}) => call(() => verbs.list(loadRegistry()[key]!, o).map(verbs.brief(key)));
/** `aleph issue show <repo> <ref> --json`. */
export const issueShow = (key: string, ref: number | string) => call(() => {
  const i = verbs.show(loadRegistry()[key]!, idOf(ref));
  return { ...verbs.brief(key)(i), request: i.request, spec: i.spec, notes: i.notes };
});
/** `aleph issue note <repo> <ref> <text>`, as Chris's note when no worker writes it. */
export const issueNote = (key: string, ref: number | string, text: string) =>
  call(() => verbs.note(loadRegistry()[key]!, idOf(ref), text, verbs.isAnswer(text, undefined)).result);
/** `aleph issue edit <repo> <ref> [<reason>]` with its fields. */
export const issueEdit = (key: string, ref: number | string, fields: verbs.Fields, reason = "") =>
  call(() => { verbs.checkFields(fields); return verbs.edit(loadRegistry()[key]!, idOf(ref), fields, reason).result; });
/** `aleph issue done|drop <repo> <ref> [<text>]`. */
export const issueClose = (key: string, ref: number | string, how: "done" | "drop", text = "") =>
  call(() => verbs.close(loadRegistry()[key]!, idOf(ref), how, text).result);

/** `aleph status <repo>-<n>[.<k>] --json`. */
export const status = (ref: string) => call(() => {
  const reg = loadRegistry(), p = parseIssueRef(ref)!;
  return repoStages(reg[p.repo]!, { fetch: true, items: [p.id] })[0];
});
