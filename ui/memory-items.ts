/**
 * Every memory as one row, for the Memory page's search: its type, where it lives, what it says, how it reaches
 * the agent, and when it was last written and read. A source that is absent gives no rows, never an error.
 */
import { readJsonOr } from "../lib/json.ts";
import { logOnce } from "./state.ts";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { clip, issueHref, issueId, MEMORY_TYPES, noteHref, sessionHref } from "../lib/naming.ts";
import { parseFrontmatter, splitFrontmatter } from "../lib/frontmatter.ts";
import { claimLine, recall } from "../vault/lib/index.ts";
import { dailyNotes, readMemoryMd, scopeOf, type Note } from "../vault/lib/vault.ts";
import { skillsDir } from "../jobs/lib/infra/settings.ts";
import { claudeSettings } from "../lib/session-context.ts";
import { loadRegistry } from "../jobs/lib/records/ledger.ts";
import { readLists } from "../lib/store.ts";
import { afterOf, priorityOf } from "../lib/issue-file.ts";
import * as todos from "../lib/issue-file.ts";
import { activity } from "./activity.ts";
import { langfuse } from "../lib/langfuse.ts";
import { sessionRows, windowTraces } from "./api/session-list.ts";
import { later } from "../lib/sources.ts";
import { handoffs, intent, type Handoff } from "../lib/handoffs.ts";
import { memoryIn } from "./api/scope.ts";
import { errText } from "../lib/errtext.ts";

const TYPES = MEMORY_TYPES.map((t) => t.id);
type Type = (typeof MEMORY_TYPES)[number]["id"];

/** One memory. `body` is the text a search matches; the page gets `text`, a line of it. */
export type Item = {
  type: Type; source: string; key: string; title: string; text: string; scope: string;
  at: string; read: string | null; effect: string; href?: string; core?: string; kind?: string; priority?: string; body: string;
};

const mtime = (p: string): string => statSync(p).mtime.toISOString();
const read = (p: string): string => readFileSync(p, "utf8");
const files = (dir: string, re: RegExp): string[] => { try { return readdirSync(dir).filter((f) => re.test(f)).sort(); } catch { return []; } };
const IDENTITY = join(import.meta.dir, "..", "identity");

/** The last 7 days' sessions from Langfuse, newest first; null when Langfuse is off or fails. One read serves every build
 * until the 10 min usage poll: Memory's Langfuse reads are slow, so they do not run on the 30 s Langfuse poll. */
type Sessions = Awaited<ReturnType<typeof sessionRows>>["sessions"];
const sessions = (): Promise<Sessions | null> => later("memory:sessions", ["usage"], loadSessions, null);
async function loadSessions(): Promise<Sessions | null> {
  if (!langfuse()) return null;
  try { return (await sessionRows((await windowTraces(7, null)).rows, 10)).sessions; } catch (e) { console.error(`ui/memory-items: no sessions: ${errText(e)}`); return null; }
}

const HOOK_NAMES: Record<string, string> = { "verify-gate": "verify-gate", "vault-context": "vault-context", "vault-recall": "vault-recall" };

/** Hooks in Claude Code's settings file (`claudeSettings()`): event, matcher and command, with 7-day call counts where Langfuse has them. */
async function hooks() {
  const file = claudeSettings();
  const cfg = readJsonOr<{ hooks?: Record<string, { matcher?: string; hooks?: { command?: string; type?: string }[] }[]> }>(file, {});
  // activity() reads Langfuse for about 100 s cold: a build answers without the counts until the read ends.
  const counts = await later("memory:calls", ["usage"], async () => {
    try {
      const a = await activity(7, null);
      return a.langfuse === "ok" ? new Map(a.hooks.map((h) => [h.name, h.calls] as const)) : null;
    } catch (e) { console.error(`ui/memory-items: no hook calls: ${errText(e)}`); return null; }
  }, null);
  const counted = counts !== null, calls = counts ?? new Map<string, number>();
  const out: { event: string; matcher: string; command: string; calls: number | null }[] = [];
  for (const [event, groups] of Object.entries(cfg.hooks ?? {}))
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
  try { docs = readLists(registry); } catch (e) { logOnce("memory-items", e); }
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
    const scope = scopeOf(n), core = typeof n.fm.core === "string" ? n.fm.core : undefined;
    return {
      type: "semantic", source: "note", key: n.title, title: n.title, text: clip(claimLine(n).replace(/^\*\*Claim\.\*\*\s*/, ""), 240), scope,
      at: String(n.fm.updated ?? ""), read: log[n.title] ?? null, core, kind: String(n.fm.kind ?? ""), body: n.body, href: noteHref(n.title),
      effect: core ? `Its core line is in the start context of every ${scope} session.` : "Reaches a session when vault recall or the vault-recall hook returns it.",
    };
  });
  const memory = readMemoryMd(root);
  if (memory) {
    const body = memory.text;
    out.push({ type: "semantic", source: "memory-md", key: "MEMORY.md", title: "MEMORY.md", text: `${body.split("\n").length} lines of standing context`, scope: "global",
      at: memory.mtime, read: null, body, effect: "In the start context of every session." });
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
  return out;
}

function working(): Item[] {
  const all = handoffs();
  const one = (h: Handoff, title: string, effect: string): Item => {
    const body = read(h.path);
    return { type: "working", source: "handoff", key: h.key, title, text: intent(body), scope: h.scope, at: mtime(h.path), read: null, body, effect };
  };
  return [
    ...all.filter((h) => h.kind !== "dated").map((h) => one(h, `${`${h.scope} ${h.name}`.trim()} handoff`, h.scope ? `Read by /aleph:pickup in ${h.scope}.` : `Read by /aleph:pickup ${h.name}.`)),
    ...all.filter((h) => h.kind === "dated").reverse().map((h) => one(h, `handoff ${h.key.slice(0, -3)}`, "History: vault compile reads it for its day.")),
  ];
}

async function episodic(root: string): Promise<Item[]> {
  const out: Item[] = [];
  for (const { day, text: body } of dailyNotes(root)) {
    const n = body.split("\n").filter((l) => l.startsWith("- ")).length;
    out.push({ type: "episodic", source: "daily", key: `${day}.md`, title: `daily ${day}`, text: `${n} vault writes`, scope: "", at: day, read: null, body,
      href: `#/memory/${day}`, effect: "The vault's log of the day; vault compile reads it." });
  }
  for (const s of (await sessions()) ?? []) {
    out.push({ type: "episodic", source: "session", key: s.id, title: `session ${s.id.slice(0, 8)}`, text: s.firstPrompt, scope: s.project, at: s.last, read: null, body: s.firstPrompt,
      href: sessionHref(s.id), effect: `A Langfuse trace of ${s.turns} turns; retro reads it.` });
  }
  return out;
}

function prospective(): Item[] {
  return prospectiveIssues().map((i) => ({
    type: "prospective", source: "issue", key: `${i.repo}/${i.id}`, title: issueId(i.repo, i.id), text: i.title, scope: i.repo, at: "", read: null, body: i.title, priority: i.priority,
    href: issueHref(issueId(i.repo, i.id)), effect: `The factory starts it when ${i.after.join(", ")} is done.`,
  }));
}

/** Every memory in the order the page groups them. */
export async function items(root: string, wiki: Note[], log: Record<string, string>): Promise<Item[]> {
  const [proc, epi] = await Promise.all([procedural(), episodic(root)]);
  return [...semantic(root, wiki, log), ...proc, ...epi, ...working(), ...prospective()];
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
  if (text) recall(root, wiki, text, project ?? undefined).forEach((r, i) => rank.set(r.note.title, i));
  const keep = (it: Item) => memoryIn(it.scope, project)
    && (!text || (it.source === "note" ? rank.has(it.key) || it.title.toLowerCase().includes(text) : it.body.toLowerCase().includes(text) || it.title.toLowerCase().includes(text)));
  return all.filter(keep).map(({ body: _, ...it }) => ({ ...it, text: snippet({ ...it, body: _ }, text), ...(rank.has(it.key) && it.source === "note" ? { rank: rank.get(it.key) } : {}) }))
    .sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || (a.rank ?? 1e9) - (b.rank ?? 1e9));
}
