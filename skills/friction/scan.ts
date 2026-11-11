/**
 * Friction in Claude Code transcripts: errors that repeat across sessions,
 * and work done by hand in many sessions. Prints JSON; code counts, the model judges.
 *
 *   bun scan.ts [--days 14] [--root ~/.claude/projects] [--top 25]
 *
 * Throughout: a signal is one event, a finding is the signals that share a key.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { git } from "../../lib/git.ts";

export type Kind = "hook" | "tool" | "gate" | "loop" | "reload" | "dupe" | "command" | "prompt";
export interface Signal { kind: Kind; key: string; session: string; at: string; cli: boolean; cwd: string; text: string }
export interface Finding {
  kind: Kind; key: string; count: number; sessions: number; days: number; cli: number;
  first: string; last: string; sample: string; cwd: string; ids: string[]; changed?: string; open: boolean;
}

/** Errors count from two sessions; work done by hand counts from three. */
const MIN: Record<Kind, number> = { hook: 2, tool: 2, gate: 2, loop: 2, reload: 2, dupe: 2, command: 3, prompt: 3 };
const LOOP = 3; // gate denials in a row, with no prompt from Chris between them
const HOME = homedir();
const PATH = /\/(?:[\w.@+-]+\/)+[\w.@+-]+\.\w+/g;
const READS = /^(sed -n|cat|head|tail|ls|grep|rg|find|wc|jq|echo|git (diff|log|status|show))\b/; // reading is work, not friction
const CAUSE = /[a-z]{3}/i; // a key with no word in it names no cause

/** The text with the parts that differ between occurrences replaced, so one cause gives one key. */
export const norm = (s: string): string =>
  (s.split("\n").find((l) => l.trim() && !/^Exit code \d+$/.test(l)) ?? "")
    .replaceAll(HOME, "~")
    .replace(/\([^()]*\)/g, "(…)")
    .replace(/\/tmp\/claude-\d+\/\S+/g, "<tmp>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/\b[0-9a-f]{7,}\b/g, "<sha>")
    .replace(/\d+/g, "N")
    .trim()
    .slice(0, 120);

/** A shell command without its leading cd, as a key. */
const shape = (cmd: string) => norm(cmd.replace(/^cd\s+\S+\s*(&&|;)\s*/, ""));

const said = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b?.type === "text" ? b.text : "")).join("") : "";

/** Text Chris typed, not a hook, a command wrapper or a relay. */
const typed = (s: string) => s.trim() !== "" && !/^(<|\[|Stop hook feedback|Base directory for this skill|This session is being continued)/.test(s.trimStart());

/** Signals from one transcript. */
export const signals = (text: string): Signal[] => {
  const out: Signal[] = [];
  const tools = new Map<string, string>();
  const loads = new Map<string, number>();
  let denials = 0, listed = false, session = "", at = "", cli = false, cwd = "";
  const add = (kind: Kind, key: string, body = key) => out.push({ kind, key, session, at, cli, cwd, text: body.slice(0, 400) });
  for (const line of text.split("\n")) {
    let r: any;
    try { r = JSON.parse(line); } catch { continue; } // the last line of a live session can be cut off
    if (!r?.sessionId || !r.timestamp) continue;
    session = r.sessionId;
    at = r.timestamp;
    cli = r.entrypoint === "cli";
    cwd = r.cwd ?? cwd;
    const a = r.attachment;
    if (a?.type === "hook_non_blocking_error") add("hook", `${a.hookEvent} hook "${a.command}": ${norm(a.stderr || a.stdout || "")}`, a.stderr);
    if (a?.type === "skill_listing" && !listed) {
      listed = true;
      const by = Map.groupBy(a.names ?? [], (n: string) => n.split(":").at(-1)!);
      for (const ns of by.values()) if (ns.length > 1) add("dupe", `skill listed ${ns.length} times: ${ns.toSorted().join(", ")}`);
    }
    const content = r.message?.content;
    if (r.type === "assistant" && Array.isArray(content))
      for (const b of content.filter((b) => b?.type === "tool_use")) {
        tools.set(b.id, b.name);
        if (b.name === "Bash" && typeof b.input?.command === "string" && !READS.test(shape(b.input.command))) add("command", shape(b.input.command), b.input.command);
        if (b.name === "Skill") loads.set(b.input?.skill, (loads.get(b.input?.skill) ?? 0) + 1);
      }
    if (r.type !== "user") continue;
    if (Array.isArray(content))
      for (const b of content.filter((b) => b?.type === "tool_result" && b.is_error)) {
        const body = said(b.content) || String(b.content ?? "");
        const hook = body.match(/^(\w+):\w+ hook error: /);
        if (hook) add("hook", `${hook[1]} hook: ${norm(body.slice(hook[0].length))}`, body);
        else if (CAUSE.test(norm(body))) add("tool", `${tools.get(b.tool_use_id) ?? "tool"}: ${norm(body)}`, body);
      }
    const s = said(content);
    if (s.startsWith("Stop hook feedback:")) {
      add("gate", `denied by ${norm(s.slice(19)).split(":")[0]}`, s);
      if (++denials === LOOP) add("loop", `${LOOP}+ gate denials in a row`, s);
    } else if (cli && !r.isMeta && typed(s)) {
      denials = 0;
      add("prompt", norm(s).toLowerCase().slice(0, 60), s);
    }
  }
  for (const [skill, n] of loads) if (n > 1) add("reload", `${skill} loaded ${n > 2 ? "3+" : 2} times in one session`);
  return out;
};

/** The newest commit time of a path that exists, or that a repo once had. */
const changed = (path: string): string | undefined => {
  let dir = dirname(path);
  while (!existsSync(dir) && dir !== "/") dir = dirname(dir);
  const real = realpathSync(dir);
  const file = join(real, path.slice(dir.length));
  const r = git(real, "log", "-1", "--format=%cI", "--", file);
  return r.ok ? r.out || undefined : undefined;
};

/** Findings that pass their kind's threshold, most sessions first, at most `top` of each kind. */
export const findings = (all: Signal[], top: number): { findings: Finding[]; cut: Partial<Record<Kind, number>> } => {
  const cut: Partial<Record<Kind, number>> = {};
  const groups = [...Map.groupBy(all, (s) => `${s.kind}\0${s.key}`).values()].map((ss) => {
    const sessions = new Set(ss.map((s) => s.session));
    const ats = ss.map((s) => s.at).toSorted();
    const latest = ss.reduce((a, b) => (b.at > a.at ? b : a));
    return {
      kind: ss[0].kind, key: ss[0].key, count: ss.length, sessions: sessions.size,
      days: new Set(ats.map((t) => t.slice(0, 10))).size,
      cli: new Set(ss.filter((s) => s.cli).map((s) => s.session)).size,
      first: ats[0], last: ats.at(-1)!, sample: latest.text, cwd: latest.cwd, open: true,
      ids: [...new Set(ss.toSorted((a, b) => b.at.localeCompare(a.at)).map((s) => s.session))].slice(0, 3),
    } as Finding;
  });
  const kept = groups.filter((f) => f.sessions >= MIN[f.kind]).toSorted((a, b) => b.sessions - a.sessions || b.count - a.count);
  const out = [...Map.groupBy(kept, (f) => f.kind)].flatMap(([kind, fs]) => {
    if (fs.length > top) cut[kind] = fs.length - top;
    return fs.slice(0, top);
  });
  for (const f of out.filter((f) => f.kind !== "command" && f.kind !== "prompt")) {
    const times = [...new Set(f.sample.match(PATH) ?? [])].map(changed).filter(Boolean) as string[];
    if (!times.length) continue;
    f.changed = times.toSorted().at(-1);
    f.open = Date.parse(f.last) > Date.parse(f.changed!);
  }
  return { findings: out, cut };
};

/** Every .jsonl under root changed in the window. */
const files = (root: string, since: number): string[] =>
  readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(root, f))
    .filter((f) => statSync(f).mtimeMs >= since);

if (import.meta.main) {
  const { values: o } = parseArgs({
    options: { days: { type: "string", default: "14" }, root: { type: "string", default: join(HOME, ".claude/projects") }, top: { type: "string", default: "25" } },
  });
  const t0 = Date.now();
  const since = t0 - Number(o.days) * 86_400_000;
  const fs = files(o.root!, since);
  const all = fs.flatMap((f) => signals(readFileSync(f, "utf8"))).filter((s) => Date.parse(s.at) >= since);
  const { findings: out, cut } = findings(all, Number(o.top));
  console.log(JSON.stringify({ days: Number(o.days), files: fs.length, signals: all.length, ms: Date.now() - t0, cut, findings: out }, null, 1));
}
