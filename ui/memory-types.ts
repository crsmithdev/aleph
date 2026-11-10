/** The per-type blocks of `GET /api/memory`: where aleph keeps each of the seven memory types, read as it is. A source that is absent gives an empty list, never an error. */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { clip } from "../lib/naming.ts";
import { claudeSettings } from "../hooks/lib/context.ts";
import { readStore } from "../jobs/lib/learning/corrections.ts";
import { episodesDir, KEEP_DAYS } from "../jobs/lib/learning/episode.ts";
import { loadRegistry } from "../jobs/lib/records/ledger.ts";
import { afterOf, priorityOf, readLists } from "../issues/lib/store.ts";
import * as todos from "../issues/lib/todo.ts";
import { coreNotes, START_BUDGET, startContext, type Note } from "../vault/lib/vault.ts";
import { activity } from "./activity.ts";
import { skillsDir } from "./api/skills.ts";
import { langfuse } from "../lib/langfuse.ts";
import { list } from "./langfuse.ts";
import { traceProject } from "./api/scope.ts";
import { later } from "../lib/sources.ts";
import { handoffsDir as handoffsSetting } from "../lib/paths.ts";

const mtime = (p: string): string => { try { return statSync(p).mtime.toISOString(); } catch { return ""; } };
const newest = (xs: (string | undefined | null)[]): string => xs.filter(Boolean).sort().at(-1) ?? "";
const files = (dir: string, re: RegExp): string[] => { try { return readdirSync(dir).filter((f) => re.test(f)); } catch { return []; } };

export const handoffsDir = handoffsSetting;

/** The first non-blank line under a handoff's `## Intent`, else its first line. */
export function intent(text: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^##\s+intent\s*$/i.test(l));
  const from = at < 0 ? lines : lines.slice(at + 1);
  return clip(from.find((l) => l.trim() && !/^#/.test(l)) ?? "", 160);
}

function working() {
  const dir = handoffsDir();
  const read = (f: string) => ({ name: f.replace(/\.md$/, ""), intent: intent(readFileSync(join(dir, f), "utf8")), at: mtime(join(dir, f)) });
  const current = existsSync(join(dir, "current.md")) ? read("current.md") : null;
  const archived = files(dir, /^\d{4}-\d{2}-\d{2}-.*\.md$/).sort().reverse();
  const latest = archived.slice(0, 10).map((f) => ({ ...read(f), date: f.slice(0, 10) }));
  const projects = files(join(dir, "projects"), /\.md$/).sort().map((f) => {
    const text = readFileSync(join(dir, "projects", f), "utf8");
    return { name: f.replace(/\.md$/, ""), text: text.match(/^summary:[ \t]*(.+)/)?.[1].trim() || intent(text), at: mtime(join(dir, "projects", f)) };
  });
  return { current, archived: latest, projects, total: archived.length + (current ? 1 : 0) + projects.length, last: newest([current?.at, latest[0]?.at, ...projects.map((x) => x.at)]) };
}

function semantic(root: string, wiki: Note[], all: Note[]) {
  const file = join(root, "MEMORY.md");
  const text = existsSync(file) ? readFileSync(file, "utf8") : null;
  const kinds = ["decision", "concept", "entity", "project", "gotcha"];
  const notes = wiki.filter((n) => kinds.includes(String(n.fm.kind)))
    .map((n) => ({ title: n.title, kind: String(n.fm.kind), scope: String(n.fm.scope ?? ""), updated: String(n.fm.updated ?? "") }))
    .sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title));
  const start = Object.fromEntries(["aleph", "global"].map((scope) => {
    const { text, cut } = startContext(root, all, scope);
    return [scope, { core: coreNotes(all, scope).map((n) => ({ title: n.title, core: String(n.fm.core).trim() })), bytes: Buffer.byteLength(text), budget: START_BUDGET, cut }];
  }));
  return {
    start,
    memory: text === null ? null : { lines: text.split("\n").length, first: clip(text.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "", 160), at: mtime(file) },
    notes, last: newest([text === null ? "" : mtime(file), ...notes.map((n) => n.updated)]),
  };
}

/** The last 7 days' sessions from Langfuse, newest first; null when Langfuse is off or fails. One read serves every build
 * until the 10 min usage poll: Memory's Langfuse reads are slow, so they do not run on the 30 s Langfuse poll. */
type Sessions = { id: string; project: string; firstPrompt: string; turns: number; last: string }[];
export const sessions = (): Promise<Sessions | null> => later("memory:sessions", ["usage"], loadSessions, null);
async function loadSessions(): Promise<Sessions | null> {
  const lf = langfuse();
  if (!lf) return null;
  try {
    const from = new Date(Math.floor((Date.now() - 7 * 86400_000) / 3600_000) * 3600_000);
    const groups = new Map<string, any[]>();
    for (const t of (await list(lf, "traces", { from })).rows) if (t.sessionId) groups.set(t.sessionId, [...(groups.get(t.sessionId) ?? []), t]);
    const ms = (t: any) => Date.parse(t.timestamp ?? "") || 0;
    return [...groups].map(([id, ts]) => {
      ts.sort((a, b) => ms(a) - ms(b));
      const input = ts[0].input;
      return { id, project: traceProject(ts[0].metadata?.cwd, ts[0].tags), firstPrompt: clip(typeof input === "string" ? input : JSON.stringify(input ?? ""), 120), turns: ts.length, last: ts.at(-1).timestamp as string };
    }).sort((a, b) => b.last.localeCompare(a.last)).slice(0, 10);
  } catch { return null; }
}

/** `<field>: <value>` from a page's frontmatter, else "". */
const field = (text: string, name: string) => new RegExp(`^${name}:\\s*(.*)$`, "m").exec(text)?.[1]?.trim() ?? "";

function episodic(root: string, live: Awaited<ReturnType<typeof sessions>>) {
  const episodes = files(episodesDir(), /\.md$/).map((f) => {
    let text = "";
    try { text = readFileSync(join(episodesDir(), f), "utf8"); } catch {}
    return { title: f.slice(0, -3), scope: field(text, "scope"), updated: field(text, "updated") };
  }).sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title));
  const daily = files(join(root, "daily"), /^\d{4}-\d{2}-\d{2}\.md$/).sort().reverse().map((f) => f.slice(0, 10));
  return { episodes, keepDays: KEEP_DAYS, daily: { total: daily.length, latest: daily.slice(0, 10) }, sessions: live, last: newest([episodes[0]?.updated, daily[0], live?.[0]?.last]) };
}

const HOOK_NAMES: Record<string, string> = { "verify-gate": "verify-gate", "vault-context": "vault-context", "vault-recall": "vault-recall" };

/** Hooks in Claude Code's settings file (`claudeSettings()`): event, matcher and command, with 7-day call counts where Langfuse has them. */
export async function hooks() {
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

async function procedural() {
  const dir = skillsDir();
  const skills = files(dir, /^[^.]/).filter((f) => existsSync(join(dir, f, "SKILL.md"))).sort();
  const claude = join(import.meta.dir, "..", "identity", "CLAUDE.md");
  const hs = await hooks();
  return {
    skills, claudeMd: existsSync(claude) ? { path: "identity/CLAUDE.md", lines: readFileSync(claude, "utf8").split("\n").length, at: mtime(claude) } : null,
    hooks: hs, last: newest([mtime(claude), ...skills.map((s) => mtime(join(dir, s, "SKILL.md")))]),
  };
}

function retrieval(misses: any) {
  const m = misses && typeof misses === "object" ? misses : null;
  return { stats: m && "recalls" in m ? m : null, missed: Array.isArray(m?.missed) ? m.missed.slice(0, 10) : [], last: newest([m?.missed?.[0]?.at]) };
}

/** Open issues with an after. */
export function prospectiveIssues() {
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

/** The factory's memory gates: corrections and proposals from the store. */
function gates() {
  const s = readStore();
  const by = (state: string) => s.lessons.filter((l) => l.state === state);
  return {
    corrections: s.lessons.filter((l) => l.state === "open").map((l) => ({ id: l.id, sentence: l.sentence, count: l.count })),
    proposals: by("proposed").map((l) => ({ id: l.id, sentence: l.sentence, count: l.count, kind: l.kind ?? "" })),
    minedAt: s.minedAt,
  };
}

export async function memoryTypes(root: string, wiki: Note[], misses: unknown, all: Note[] = wiki) {
  const [live, proc] = await Promise.all([sessions(), procedural()]);
  return {
    working: working(), semantic: semantic(root, wiki, all), episodic: episodic(root, live), procedural: proc,
    retrieval: retrieval(misses), prospective: { issues: prospectiveIssues() }, gates: gates(),
  };
}
