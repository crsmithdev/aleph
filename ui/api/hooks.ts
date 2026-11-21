/**
 * `GET /api/hooks`, `GET /api/hooks/:event/:name`: the Hooks page's data. The Stop-hook holds and the hook errors of the
 * request's window and project come from the hook entries of the Claude Code transcripts under `~/.claude/projects`; the hooks come from
 * `hooks/hooks.json`, each with its files and its newest commit of the window. A hold's outcome is a keyword pass over its reply: a guide, not a measurement.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { git } from "../../lib/git.ts";
import { readJsonOr } from "../../lib/json.ts";
import { jsonLines, type Entry } from "../../lib/jsonl.ts";
import { touch } from "../../lib/sources.ts";
import { list } from "../../lib/transcripts.ts";
import type { Routes } from "../server.ts";
import { scopeOf, traceProject, type Scope } from "./scope.ts";

const WHY = 220; // chars of a hold's reason
const ROOT = join(import.meta.dir, "..", "..");
// A hook skips a factory worker when one of its files exits early on `isAgent()` or `jobId()` (hooks/lib/gate.ts:32).
const SKIPS = /(?<!!)\b(isAgent|jobId)\(\)[^&\n]*\)\s*(process\.exit\(0\)|return( null)?;)/;

interface Hold { t: string; sid: string; project: string; hook: string; event: string; kind: string; who: string; out: string; why: string }
interface Fail { t: string; sid: string; project: string; hook: string; event: string; cause: string; fix: string }

// An error's cause and its fix, by the first pattern its stderr matches.
// prettier-ignore
const CAUSES: [RegExp, string, string][] = [
  [/Module not found/,                                                 "Moved hook file",        "Stub or stable entry"],
  [/Plugin directory does not exist/,                                  "Worktree gone (worker)", "Keep until worker ends"],
  [/Executable not found in \$PATH|could not be started \(ENOENT\)/,   "No bun on PATH",         "Probe session"],
  [/No stderr output|posix_spawn/,                                     "Worktree gone (cwd)",    "Fixed d90a0602 (one way)"],
];
// A hold's outcome by the first pattern its reply matches. False comes before caught: "the gate was wrong" fixes nothing.
// prettier-ignore
const OUTS: [RegExp, string][] = [
  [/aleph:handoff/,                                                                                   "handoff"],
  [/pre-?existing|not (from |part of )?(this|my) (session|change)|not mine|false positive|gate (is|was) wrong/i, "false"],
  [/\bcorrect(ion|ed| (one|the|my|that|this))\b|i was wrong|imprecise|overstated|\bfixed\b/i,      "caught"],
];

/** The hook's name: a command's `.ts` file without its folder and suffix, else the command (a `statusMessage`). */
const nameOf = (cmd: string) => /([\w-]+)\.ts\b/.exec(cmd)?.[1] ?? cmd;
/** A session's kind: a terminal session, a factory worker in its job worktree, or another headless run. */
const whoOf = (e: Entry) => (e.entrypoint === "cli" ? "interactive" : /\/\.worktrees\/job-/.test(e.cwd ?? "") ? "worker" : "headless");
/** A hold's kind, from the words of its reason. */
const kindOf = (text: string) =>
  [/which boundary/.test(text) && "boundary", /a copy the base did not have/.test(text) && "new-copy"].filter(Boolean).join("+") ||
  (/cites commit/.test(text) ? "unbacked hash" : /says a doc matches/.test(text) ? "doc-claim" : /has compacted/.test(text) ? "compacted, handoff" : "judged");

/** The agent's reply to the hold at entry `i`, up to the next prompt or hold: its text and the skills it called. */
function reply(es: Entry[], i: number): string {
  const end = es.findIndex((e, j) => j > i && ((e.type === "user" && !e.isMeta && typeof e.message?.content === "string") || e.attachment?.type === "hook_blocking_error"));
  return es.slice(i + 1, end < 0 ? undefined : end).filter((e) => e.type === "assistant")
    .flatMap((e) => [e.message?.content].flat()).map((b) => b?.text ?? b?.input?.skill ?? "").join("\n").trim();
}

function hold(es: Entry[], i: number): Hold {
  const e = es[i], b = e.attachment.blockingError, who = whoOf(e), said = reply(es, i);
  const out = who !== "interactive" ? "no effect" : !said ? "no reply" : OUTS.find(([re]) => re.test(said))?.[1] ?? "held up";
  const why = b.blockingError.replace(/^[\w ]+: /, "").replace(/\s+/g, " ").slice(0, WHY);
  return { t: e.timestamp, sid: e.sessionId, project: traceProject(e.cwd, undefined), hook: b.command, event: e.attachment.hookEvent, kind: kindOf(b.blockingError), who, out, why };
}

function fail(e: Entry): Fail {
  const a = e.attachment, [, cause, fix] = a.type === "hook_cancelled" ? [, "Cancelled", "Interrupt"] : CAUSES.find(([re]) => re.test(a.stderr ?? "")) ?? [, "Other", ""];
  return { t: e.timestamp, sid: e.sessionId, project: traceProject(e.cwd, undefined), hook: nameOf(a.command), event: a.hookEvent, cause, fix };
}

/** A transcript's Stop-hook holds and hook errors. */
function parse(f: string): { holds: Hold[]; fails: Fail[] } {
  const text = readFileSync(f, "utf8");
  if (!/"hook_(blocking_error|non_blocking_error|cancelled)"/.test(text)) return { holds: [], fails: [] };
  const es = jsonLines(text), types = es.map((e) => e.attachment?.type);
  return {
    holds: es.flatMap((e, i) => (types[i] === "hook_blocking_error" && e.attachment.hookEvent === "Stop" ? [hold(es, i)] : [])),
    fails: es.filter((_, i) => types[i] === "hook_non_blocking_error" || types[i] === "hook_cancelled").map(fail),
  };
}

/** Each transcript's parse, by path, while its mtime holds: a scan reads only the files written since the one before. */
let parsed = new Map<string, { at: number; holds: Hold[]; fails: Fail[] }>();

/** The Stop-hook holds, newest first, and the hook errors of the scope's window and project. */
function scan({ ms, project }: Scope): { holds: Hold[]; fails: Fail[] } {
  touch("transcripts");
  const since = Date.now() - ms;
  const files = list().map((t) => ({ f: t.path, at: t.at })).filter((x) => x.at >= since);
  parsed = new Map(files.map(({ f, at }) => [f, parsed.get(f)?.at === at ? parsed.get(f)! : { at, ...parse(f) }]));
  const recent = (x: { t: string; project: string }) => Date.parse(x.t) >= since && (!project || x.project === project), all = [...parsed.values()];
  return { holds: all.flatMap((p) => p.holds).filter(recent).sort((a, b) => b.t.localeCompare(a.t)), fails: all.flatMap((p) => p.fails).filter(recent) };
}

const uniq = (xs: string[]) => [...new Set(xs)].sort();
const tally = (xs: Hold[]) => Object.fromEntries([...Map.groupBy(xs, (h) => h.out)].map(([out, hs]) => [out, hs.length]));

/** Holds by hook and kind, most first, with the Interactive and Workers counts and the count of each outcome. */
const byKind = (holds: Hold[]) => [...Map.groupBy(holds, (h) => `${h.hook}\0${h.kind}`).values()].sort((a, b) => b.length - a.length).map((xs) => {
  const interactive = xs.filter((h) => h.who === "interactive").length;
  return { hook: xs[0].hook, event: xs[0].event, kind: xs[0].kind, holds: xs.length, interactive, workers: xs.length - interactive, outcomes: tally(xs) };
});

/** Errors by cause, most first, each with its fix. */
const byCause = (fails: Fail[]) => [...Map.groupBy(fails, (f) => f.cause).entries()].map(([cause, xs]) => ({
  cause, fix: xs[0].fix, n: xs.length, sessions: new Set(xs.map((x) => x.sid)).size,
  hooks: uniq(xs.map((x) => x.hook)), events: uniq(xs.map((x) => x.event)), last: xs.map((x) => x.t).sort().at(-1)!,
})).sort((a, b) => b.n - a.n);

type Cmd = { command: string; args: string[]; statusMessage?: string; timeout: number; async?: boolean };
/** A hook's entry file and the local files it imports, one level down, with their text; none for a `cli/` hook, the whole CLI. */
function sourceOf(file: string) {
  if (file.startsWith("cli/")) return [];
  const text = readFileSync(join(ROOT, file), "utf8");
  const deps = [...new Set([...text.matchAll(/from "(\.{1,2}\/[^"]+\.ts)"/g)].map((m) => join(dirname(file), m[1])))];
  return [{ file, text }, ...deps.map((f) => ({ file: f, text: readFileSync(join(ROOT, f), "utf8") }))];
}

/** The hooks of `hooks/hooks.json`, in its order, each with its source and whether a factory worker runs it. */
function inventory() {
  const cfg = readJsonOr<{ hooks: Record<string, { matcher?: string; hooks: Cmd[] }[]> }>(join(ROOT, "hooks", "hooks.json"), { hooks: {} }).hooks;
  return Object.entries(cfg).flatMap(([event, groups]) => groups.flatMap((g) => g.hooks.map((h) => {
    const words = [h.command, ...h.args].map((a) => a.replace("${CLAUDE_PLUGIN_ROOT}/", "")), file = words.find((a) => a.endsWith(".ts"))!, source = sourceOf(file);
    return {
      event, name: h.statusMessage ?? nameOf(file), matcher: g.matcher ?? "", file, command: words.map((a) => (/\s/.test(a) ? `'${a}'` : a)).join(" "),
      mode: h.async ? "async" : "", timeout: h.timeout, workers: source.some((s) => SKIPS.test(s.text)) ? "skips" : "runs", source,
    };
  })));
}

/** The commits of the scope's window that touched `files`, newest first: hash, time, subject and the files each touched. */
function commits({ ms }: Scope, files: string[]) {
  const log = git(ROOT, "log", `--since=${new Date(Date.now() - ms).toISOString()}`, `--until=${new Date().toISOString()}`, "--format=%x00%H%x09%cI%x09%s", "--name-only", "--", ...files).out;
  return log.split("\0").slice(1).map((c) => {
    const [head, ...touched] = c.trim().split("\n"), [hash, t, subject] = head.split("\t");
    return { hash, t, subject, files: touched };
  });
}

export const routes: Routes = {
  "GET /api/hooks": (_req, _params, url) => {
    const sc = scopeOf(url);
    if (sc instanceof Response) return sc;
    const { holds, fails } = scan(sc), all = inventory(), log = commits(sc, uniq(all.map((h) => h.file)));
    const hooks = all.map(({ source, ...h }) => {
      const c = log.find((x) => x.files.includes(h.file));
      return { ...h, holds: holds.filter((x) => x.event === h.event && x.hook === h.name).length, changed: c ? { hash: c.hash, t: c.t, subject: c.subject } : null };
    });
    return Response.json({ days: sc.days, holds, byHook: byKind(holds), errors: byCause(fails), hooks });
  },
  "GET /api/hooks/:event/:name": (_req, { event, name }, url) => {
    const sc = scopeOf(url);
    if (sc instanceof Response) return sc;
    const hook = inventory().find((h) => h.event === event && h.name === name);
    if (!hook) return Response.json({ error: `no hook ${event}/${name}` }, { status: 404 });
    const { holds, fails } = scan(sc), mine = holds.filter((x) => x.event === event && x.hook === name);
    return Response.json({ ...hook, holds: mine, byKind: byKind(mine), errors: byCause(fails.filter((f) => f.event === event && f.hook === name)) });
  },
};
