/**
 * Every memory as one row, for the Memory page's search: its type, where it lives, what it says, how it reaches
 * the agent, and when it was last written and read. A source that is absent gives no rows, never an error.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { clip, issueHref } from "../lib/naming.ts";
import { parseFrontmatter, splitFrontmatter } from "../lib/frontmatter.ts";
import { readStore } from "../jobs/lib/learning/corrections.ts";
import { episodesDir, KEEP_DAYS } from "../jobs/lib/learning/episode.ts";
import { claimLine, openIndex, rankNotes } from "../vault/lib/index.ts";
import type { Note } from "../vault/lib/vault.ts";
import { skillsDir } from "./api/skills.ts";
import { claudeSettings } from "../hooks/lib/context.ts";
import { loadRegistry } from "../jobs/lib/records/ledger.ts";
import { afterOf, priorityOf, readLists } from "../issues/lib/store.ts";
import * as todos from "../issues/lib/todo.ts";
import { activity } from "./activity.ts";
import { langfuse } from "../lib/langfuse.ts";
import { sessionRows, windowTraces } from "./api/sessions.ts";
import { later } from "../lib/sources.ts";
import { handoffsDir } from "../lib/paths.ts";
import { memoryIn } from "./api/scope.ts";

export const TYPES = ["semantic", "procedural", "episodic", "working", "prospective", "retrieval"] as const;
export type Type = (typeof TYPES)[number];

/** One memory. `body` is the text a search matches; the page gets `text`, a line of it. */
export type Item = {
  type: Type; source: string; key: string; title: string; text: string; scope: string;
  at: string; read: string | null; effect: string; href?: string; core?: string; kind?: string; priority?: string; body: string;
};

const mtime = (p: string): string => { try { return statSync(p).mtime.toISOString(); } catch { return ""; } };
const read = (p: string): string => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const files = (dir: string, re: RegExp): string[] => { try { return readdirSync(dir).filter((f) => re.test(f)).sort(); } catch { return []; } };
const IDENTITY = join(import.meta.dir, "..", "identity");

/** A handoff's `summary:` line, else the first non-blank line under its `## Intent`, else its first line. */
function intent(text: string): string {
  const summary = text.match(/^summary:[ \t]*(.+)/m)?.[1].trim();
  if (summary) return clip(summary, 160);
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^##\s+intent\s*$/i.test(l));
  const from = at < 0 ? lines : lines.slice(at + 1);
  return clip(from.find((l) => l.trim() && !/^#/.test(l)) ?? "", 160);
}

/** The last 7 days' sessions from Langfuse, newest first; null when Langfuse is off or fails. One read serves every build
 * until the 10 min usage poll: Memory's Langfuse reads are slow, so they do not run on the 30 s Langfuse poll. */
type Sessions = Awaited<ReturnType<typeof sessionRows>>;
const sessions = (): Promise<Sessions | null> => later("memory:sessions", ["usage"], loadSessions, null);
async function loadSessions(): Promise<Sessions | null> {
  if (!langfuse()) return null;
  try { return (await sessionRows((await windowTraces(7, null)).rows)).slice(0, 10); } catch { return null; }
}

const HOOK_NAMES: Record<string, string> = { "verify-gate": "verify-gate", "vault-context": "vault-context", "vault-recall": "vault-recall" };

/** Hooks in Claude Code's settings file (`claudeSettings()`): event, matcher and command, with 7-day call counts where Langfuse has them. */
async function hooks() {
  const file = claudeSettings();
  let cfg: any = {};
  try { cfg = JSON.parse(readFileSync(file, "utf8")); } catch {}
  // activity() reads Langfuse for about 100 s cold: a build answers without the counts until the read ends.
  const counts = await later("memory:calls", ["usage"], async () => {
    try {
      const a = await activity(7, null);
      return a.langfuse === "ok" ? new Map(a.hooks.map((h) => [h.name, h.calls] as const)) : null;
    } catch { return null; }
  }, null);
  const counted = counts !== null, calls = counts ?? new Map<string, number>();
  const out: { event: string; matcher: string; command: string; calls: number | null }[] = [];
  for (const [event, groups] of Object.entries<any>(cfg.hooks ?? {}))
    for (const g of Array.isArray(groups) ? groups : [])
      for (const h of g.hooks ?? []) {
        const command = String(h.command ?? h.type ?? "");
        const stem = Object.keys(HOOK_NAMES).find((k) => command.includes(k));
        out.push({ event, matcher: String(g.matcher ?? ""), command, calls: counted ? (stem ? calls.get(stem) ?? 0 : null) : null });
      }
  return out;
}

/** Open issues with an after. */
function prospectiveIssues() {
  const registry = Object.values(loadRegistry());
  let docs: (todos.Doc | null)[] = [];
  try { docs = readLists(registry); } catch {}
  const open: { repo: string; id: number; title: string; after: string[]; priority: string }[] = [];
  registry.forEach((r, n) => {
    for (const i of docs[n]?.items ?? []) {
      if (todos.status(i) !== "open") continue;
      const after = afterOf(i);
      if (after.length) open.push({ repo: r.key, id: i.id, title: i.title, after, priority: priorityOf(i) });
    }
  });
  return open.sort((a, b) => a.repo.localeCompare(b.repo) || a.id - b.id);
}


function semantic(root: string, wiki: Note[], log: Record<string, string>): Item[] {
  const out: Item[] = wiki.map((n) => {
    const scope = String(n.fm.scope ?? ""), core = typeof n.fm.core === "string" ? n.fm.core : undefined;
    return {
      type: "semantic", source: "note", key: n.title, title: n.title, text: clip(claimLine(n).replace(/^\*\*Claim\.\*\*\s*/, ""), 240), scope,
      at: String(n.fm.updated ?? ""), read: log[n.title] ?? null, core, kind: String(n.fm.kind ?? ""), body: n.body, href: `#/memory/${encodeURIComponent(n.title)}`,
      effect: core ? `Its core line is in the start context of every ${scope} session.` : "Reaches a session when vault recall or the vault-recall hook returns it.",
    };
  });
  const file = join(root, "MEMORY.md");
  if (existsSync(file)) {
    const body = read(file);
    out.push({ type: "semantic", source: "memory-md", key: "MEMORY.md", title: "MEMORY.md", text: `${body.split("\n").length} lines of standing context`, scope: "global",
      at: mtime(file), read: null, body, effect: "In the start context of every session." });
  }
  return out;
}

/** Each `## ` section of a rules file, as its own row. */
function rules(file: string, name: string, effect: string): Item[] {
  const text = read(file), at = mtime(file);
  return text.split(/^(?=## )/m).filter((s) => s.startsWith("## ")).map((s) => {
    const head = s.split("\n")[0].slice(3).trim();
    return { type: "procedural", source: "rules", key: `${name}#${head}`, title: `${name} § ${head}`, text: clip(s.split("\n").slice(1).find((l) => l.trim()) ?? "", 240),
      scope: "global", at, read: null, body: s, effect };
  });
}

async function procedural(): Promise<Item[]> {
  const out = [
    ...rules(join(IDENTITY, "CLAUDE.md"), "identity/CLAUDE.md", "In every Claude Code session, as ~/.claude/CLAUDE.md."),
    ...rules(join(IDENTITY, "AGENT.md"), "identity/AGENT.md", "In every factory agent run, in place of CLAUDE.md."),
  ];
  const dir = skillsDir();
  for (const s of files(dir, /^[^.]/)) {
    const file = join(dir, s, "SKILL.md");
    if (!existsSync(file)) continue;
    const { frontmatter, body } = splitFrontmatter(read(file));
    const fm = frontmatter ? parseFrontmatter(frontmatter) : {};
    out.push({ type: "procedural", source: "skill", key: s, title: `skill ${s}`, text: clip(String(fm.description ?? ""), 240), scope: "global", at: mtime(file), read: null,
      body: `${s}\n${fm.description ?? ""}\n${body}`, href: `#/skills/${encodeURIComponent(s)}`, effect: `Loaded when /aleph:${s} runs or its description matches the task.` });
  }
  for (const h of await hooks()) {
    out.push({ type: "procedural", source: "hook", key: `${h.event} ${h.command}`, title: `hook ${h.event}${h.matcher ? ` ${h.matcher}` : ""}`, text: h.command, scope: "global", at: "", read: null,
      body: h.command, effect: `Runs on ${h.event}${h.matcher ? ` for ${h.matcher}` : ""}${h.calls === null ? "" : `; ${h.calls} calls in 7 days`}.` });
  }
  const s = readStore();
  for (const l of s.lessons.filter((l) => l.state === "open" || l.state === "proposed")) {
    const proposed = l.state === "proposed";
    out.push({ type: "procedural", source: proposed ? "proposal" : "correction", key: l.id, title: proposed ? "proposal" : "correction", text: l.sentence, scope: "global",
      at: s.minedAt, read: null, body: l.sentence,
      effect: proposed ? `Seen ${l.count} times. Approve it to reopen it as a rule change.` : `Seen ${l.count} times. A third sighting makes it a proposal.` });
  }
  return out;
}

function working(): Item[] {
  const dir = handoffsDir();
  const one = (rel: string, title: string, scope: string, effect: string): Item => {
    const body = read(join(dir, rel));
    return { type: "working", source: "handoff", key: rel, title, text: intent(body), scope, at: mtime(join(dir, rel)), read: null, body, effect };
  };
  return [
    ...(existsSync(join(dir, "current.md")) ? [one("current.md", "current handoff", "", "Read by /aleph:pickup at the next session start.")] : []),
    ...files(join(dir, "projects"), /\.md$/).map((f) => one(`projects/${f}`, `${f.slice(0, -3)} handoff`, f.slice(0, -3), `Read by /aleph:pickup in ${f.slice(0, -3)}.`)),
    ...files(dir, /^\d{4}-\d{2}-\d{2}-.*\.md$/).reverse().map((f) => one(f, `handoff ${f.slice(0, -3)}`, "", "History: vault compile reads it for its day.")),
  ];
}

async function episodic(root: string): Promise<Item[]> {
  const out: Item[] = files(episodesDir(), /\.md$/).map((f) => {
    const body = read(join(episodesDir(), f)), fm = parseFrontmatter(splitFrontmatter(body).frontmatter ?? "");
    return { type: "episodic", source: "episode", key: f, title: f.slice(0, -3), text: intent(splitFrontmatter(body).body), scope: String(fm.scope ?? ""), at: String(fm.updated ?? ""),
      read: null, body, effect: `The factory report lists it once; it is deleted after ${KEEP_DAYS} days.` };
  });
  for (const f of files(join(root, "daily"), /^\d{4}-\d{2}-\d{2}\.md$/).reverse()) {
    const body = read(join(root, "daily", f)), n = body.split("\n").filter((l) => l.startsWith("- ")).length;
    out.push({ type: "episodic", source: "daily", key: f, title: `daily ${f.slice(0, 10)}`, text: `${n} vault writes`, scope: "", at: f.slice(0, 10), read: null, body,
      href: `#/memory/${f.slice(0, 10)}`, effect: "The vault's log of the day; vault compile reads it." });
  }
  for (const s of (await sessions()) ?? []) {
    out.push({ type: "episodic", source: "session", key: s.id, title: `session ${s.id.slice(0, 8)}`, text: s.firstPrompt, scope: s.project, at: s.last, read: null, body: s.firstPrompt,
      href: `#/sessions/${encodeURIComponent(s.id)}`, effect: `A Langfuse trace of ${s.turns} turns; retro reads it.` });
  }
  return out;
}

function prospective(): Item[] {
  return prospectiveIssues().map((i) => ({
    type: "prospective", source: "issue", key: `${i.repo}/${i.id}`, title: `${i.repo}-${i.id}`, text: i.title, scope: i.repo, at: "", read: null, body: i.title, priority: i.priority,
    href: issueHref(`${i.repo}-${i.id}`), effect: `The factory starts it when ${i.after.join(", ")} is done.`,
  }));
}

function retrieval(misses: any): Item[] {
  return (Array.isArray(misses?.missed) ? misses.missed : []).map((m: { query: string; at: string }) => ({
    type: "retrieval", source: "miss", key: `${m.at} ${m.query}`, title: m.query, text: "vault recall returned nothing", scope: "", at: m.at, read: null, body: m.query,
    effect: "A recall that found nothing. An alias on the note it wanted fixes the next one.",
  }));
}

/** Every memory in the order the page groups them. */
export async function items(root: string, wiki: Note[], log: Record<string, string>, misses: unknown): Promise<Item[]> {
  const [proc, epi] = await Promise.all([procedural(), episodic(root)]);
  return [...semantic(root, wiki, log), ...proc, ...epi, ...working(), ...prospective(), ...retrieval(misses)];
}

/** The first line of `body` that holds `q`, else `text`. */
const snippet = (it: Item, q: string): string => {
  if (!q) return it.text;
  const line = it.body.split("\n").find((l) => l.toLowerCase().includes(q));
  return line ? clip(line.replace(/\*\*Claim\.\*\*\s*/, "").replace(/^[-#*\s]+/, "").trim(), 240) : it.text;
};

/**
 * The items that match `q` (all when it is empty) under `project`, without their bodies. A note matches as vault
 * recall ranks it, and comes in that order; any other item matches when its title or body holds the text. A
 * global item is in every project.
 */
export function search(all: Item[], q: string, project: string | null, root: string, wiki: Note[]): (Omit<Item, "body"> & { rank?: number })[] {
  const text = q.trim().toLowerCase();
  const rank = new Map<string, number>();
  if (text) rankNotes(openIndex(root, wiki), wiki, text, project ?? undefined).forEach((r, i) => rank.set(r.note.title, i));
  const keep = (it: Item) => memoryIn(it.scope, project)
    && (!text || (it.source === "note" ? rank.has(it.key) || it.title.toLowerCase().includes(text) : it.body.toLowerCase().includes(text) || it.title.toLowerCase().includes(text)));
  return all.filter(keep).map(({ body: _, ...it }) => ({ ...it, text: snippet({ ...it, body: _ }, text), ...(rank.has(it.key) && it.source === "note" ? { rank: rank.get(it.key) } : {}) }))
    .sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || (a.rank ?? 1e9) - (b.rank ?? 1e9));
}
