/**
 * `aleph` in the test's own process, for the tests that need a command's effects and not a process of its own: each
 * call runs jobs/commands.ts `run` under the environment and working directory that `aleph` gets from cli.helpers,
 * and gives the result in the shape of `aleph()`: the exit code, stdout, stderr and the printed JSON.
 */
import { base, env } from "./cli.helpers";
import { run as aleph } from "./commands.ts";
import { Refusal } from "../lib/refusal.ts";
import { findJob, view } from "./lib/records/job.ts";
import type { Fate } from "./lib/records/outcome.ts";
import type * as verbs from "../issues/lib/issues.ts";

export interface Result { code: number; stdout: string; stderr: string; json: any }

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

/** `aleph <args>` in this process, with `stdin` as its standard input. */
export async function cli(args: string[], extra: Record<string, string> = {}, stdin = ""): Promise<Result> {
  let stderr = "";
  const r = await asCli(extra, () => aleph(args, { stderr: (s) => { stderr += s; }, stdin: async () => stdin }));
  let json: any = null;
  try { json = JSON.parse(r.out); } catch {}
  return { code: r.code, stdout: r.out, stderr, json };
}

/** The value of a library call, as `aleph` would print it, with exit 0; a refusal is exit 1 with its message on stderr. */
export async function call(f: () => unknown, extra: Record<string, string> = {}): Promise<Result> {
  try {
    const v = await asCli(extra, f);
    return { code: 0, stdout: "", stderr: "", json: v === undefined ? null : JSON.parse(JSON.stringify(v)) };
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    return { code: 1, stdout: "", stderr: e.message, json: null };
  }
}

/** The flags of `aleph issue add|edit` that set `fields`: a list joins with commas, and each media file is a flag of its own. */
const flags = (fields: verbs.Fields): string[] => Object.entries(fields).flatMap(([k, v]) =>
  v === undefined ? [] : k === "media" ? (v as string[]).flatMap((m) => ["--media", m]) : [`--${k}`, Array.isArray(v) ? v.join(",") : v]);

/** `aleph job <repo> <name> --spec -` with the spec's text. */
export const job = (repo: string, name: string, spec: string, o: { on?: string; land?: boolean } = {}, extra: Record<string, string> = {}) =>
  cli(["job", repo, name, "--spec", "-", ...(o.on ? ["--on", o.on] : []), ...(o.land ? ["--land"] : [])], extra, spec);
/** `aleph job demo <name>` with the one-action spec of cli.helpers `job`. */
export const actionJob = (name: string, action: string, extra: Record<string, string> = {}, repo = "demo") =>
  job(repo, name, `Goal: ${name}\nACTION: ${action}\n`, {}, extra);
/** `aleph land <name> [--checked]`. */
export const land = (name: string, o: { checked?: boolean } = {}, extra: Record<string, string> = {}) =>
  cli(["land", name, ...(o.checked ? ["--checked"] : [])], extra);
/** `aleph recheck <name>`. */
export const recheck = (name: string, extra: Record<string, string> = {}) => cli(["recheck", name], extra);
/** `aleph drop <name> [<reason>] [--quiet]`. */
export const drop = (name: string, reason = "", quiet = false, extra: Record<string, string> = {}) =>
  cli(["drop", ...(quiet ? ["--quiet"] : []), "--", name, ...(reason ? [reason] : [])], extra);
/** `aleph drop <name> [<reason>] [--quiet] [--fate <fate>]`. */
export const dropAs = (name: string, a: { reason?: string; quiet?: boolean; fate?: Fate }) =>
  cli(["drop", ...(a.quiet ? ["--quiet"] : []), ...(a.fate ? ["--fate", a.fate] : []), "--", name, ...(a.reason ? [a.reason] : [])]);
/** `aleph checked <name>`. */
export const checked = (name: string) => cli(["checked", name]);
/** The job's view, from which `aleph jobs [<name>]` prints its condition and check. */
export const jobView = (name: string) => call(() => { const j = findJob(name); return j && view(j); });
/** `aleph dispatch`. */
export const dispatch = (extra: Record<string, string> = {}) => cli(["dispatch"], extra);
/** `aleph run <name> -- <argv>`, from base: the started run, then the unit's exit code. */
export const run = (name: string, argv: string[]) => cli(["run", name, "--", ...argv]);
/** `aleph tick`: the JSON it prints. */
export const tick = async (extra: Record<string, string> = {}): Promise<any> => (await cli(["tick"], extra)).json;
/** `aleph report`: the text it prints. */
export const reportText = async (): Promise<string> => (await cli(["report"])).stdout.slice(0, -1);

/** `aleph issue add <repo> <title>` with its fields. */
export const issueAdd = (key: string, title: string, fields: verbs.Fields = {}, extra: Record<string, string> = {}) =>
  cli(["issue", "add", key, ...flags(fields), "--", title], extra);
/** `aleph issue list <repo> [--status <s>] [--label <l>] [--kind <k>] --json`. */
export const issueList = (key: string, o: { status?: string; label?: string; kind?: string } = {}) =>
  cli(["issue", "list", key, "--json", ...flags(o)]);
/** `aleph issue show <repo> <ref> --json`. */
export const issueShow = (key: string, ref: number | string) => cli(["issue", "show", key, String(ref), "--json"]);
/** `aleph issue note <repo> <ref> <text>`. */
export const issueNote = (key: string, ref: number | string, text: string) => cli(["issue", "note", "--", key, String(ref), text]);
/** `aleph issue edit <repo> <ref> [<reason>]` with its fields. */
export const issueEdit = (key: string, ref: number | string, fields: verbs.Fields, reason = "") =>
  cli(["issue", "edit", key, ...flags(fields), "--", String(ref), ...(reason ? [reason] : [])]);
/** `aleph issue done|drop <repo> <ref> [<text>]`. */
export const issueClose = (key: string, ref: number | string, how: "done" | "drop", text = "") =>
  cli(["issue", how, "--", key, String(ref), ...(text ? [text] : [])]);
/** The notes that `aleph issue show <repo> <id>` prints. */
export const issueNotes = async (key: string, id: number | string): Promise<string> => (await issueShow(key, id)).json.notes.join("\n");

/** `aleph status <repo>-<n>[.<k>] --json`. */
export const status = (ref: string) => cli(["status", ref, "--json"]);
