/**
 * The turns of the user's sessions in one repo: what they typed or answered, and the reply that ended each turn.
 * Headless (`claude -p`) and factory sessions are left out. Prints one block per session, oldest first.
 *
 *   bun turns.ts [--since <ISO time>] [--repo <path>] [--root ~/.claude/projects]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { jsonLines } from "../../lib/jsonl.ts";
import { claudeProjects } from "../../lib/paths.ts";
import { said as text } from "../automate/scan.ts";

const WEEK = 7 * 864e5;
const SAID = 600; // chars of a prompt or an answer
const HEAD = 600, TAIL = 1200; // chars of a long reply: its outcome comes first and its open ends last

export interface Turn { at: string; who: "chris" | "reply" | "asks"; text: string }

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)} …` : s);
const clip = (s: string) => (s.length > HEAD + TAIL ? `${s.slice(0, HEAD)}\n…\n${s.slice(-TAIL)}` : s);

/** What the user typed, with hook and harness text removed; "" for a message they did not type. */
export const typed = (raw: string): string => {
  const cmd = raw.match(/<command-name>([^<]*)<\/command-name>/);
  if (cmd) return `${cmd[1]} ${raw.match(/<command-args>([^<]*)<\/command-args>/)?.[1] ?? ""}`.trim();
  const s = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  return /^(<|\[Request interrupted|Stop hook feedback|Base directory for this skill|This session is being continued|Caveat:)/.test(s) ? "" : s;
};

/** The turns after `since` of one transcript, or null when the user did not drive it. */
export const turns = (jsonl: string, since: string): Turn[] | null => {
  const out: Turn[] = [];
  const asks = new Set<string>();
  let reply: Turn | null = null;
  const flush = () => { if (reply) out.push({ ...reply, text: clip(reply.text) }); reply = null; };
  for (const r of jsonLines(jsonl)) {
    if (r?.entrypoint && r.entrypoint !== "cli") return null;
    if (r?.isSidechain || r?.isMeta || !r?.timestamp || r.timestamp <= since) continue;
    const c = r.message?.content;
    if (r.type === "assistant" && Array.isArray(c))
      for (const b of c) {
        if (b?.type === "text" && b.text.trim()) reply = { at: r.timestamp, who: "reply", text: b.text.trim() };
        if (b?.type === "tool_use" && b.name === "AskUserQuestion") {
          asks.add(b.id);
          flush();
          out.push({ at: r.timestamp, who: "asks", text: (b.input?.questions ?? []).map((q: any) => q.question).join(" | ") });
        }
      }
    if (r.type !== "user") continue;
    const answer = Array.isArray(c) && c.find((b) => b?.type === "tool_result" && asks.has(b.tool_use_id));
    const said = answer ? text(answer.content) : typed(text(c));
    if (!said) continue;
    flush();
    out.push({ at: r.timestamp, who: "chris", text: cut(said, SAID) });
  }
  flush();
  return out;
};

/** The project directories Claude Code keeps for a repo and its worktrees. */
export const dirs = (root: string, repo: string): string[] => {
  const key = repo.replace(/[^a-zA-Z0-9]/g, "-");
  return existsSync(root) ? readdirSync(root).filter((d) => d === key || d.startsWith(`${key}--`)).map((d) => join(root, d)) : [];
};

if (import.meta.main) {
  const { values: v } = parseArgs({
    options: {
      since: { type: "string", default: new Date(Date.now() - WEEK).toISOString() },
      repo: { type: "string", default: process.cwd() },
      root: { type: "string", default: claudeProjects() },
    },
  });
  const since = new Date(v.since!).toISOString();
  const files = dirs(v.root!, v.repo!)
    .flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".jsonl")).map((f) => join(d, f)))
    .filter((f) => statSync(f).mtime.toISOString() > since);
  const found = files
    .map((f) => ({ id: f.split("/").at(-1)!.slice(0, -6), ts: turns(readFileSync(f, "utf8"), since) }))
    .filter((s) => s.ts?.some((t) => t.who === "chris"))
    .toSorted((a, b) => a.ts![0].at.localeCompare(b.ts![0].at));
  for (const { id, ts } of found) {
    console.log(`## ${id} ${ts![0].at.slice(0, 16)} to ${ts!.at(-1)!.at.slice(0, 16)}\n`);
    for (const t of ts!) console.log(`${t.who === "chris" ? "Chris" : t.who === "asks" ? "Asks" : "Reply"}: ${t.text}\n`);
  }
}
