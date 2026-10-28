/** The per-type blocks of `GET /api/memory`: where aleph keeps each of the seven memory types, read as it is. A source that is absent gives an empty list, never an error. */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { langfuseConfig } from "../../hooks/lib/env.ts";
import { readStore } from "../../jobs/lib/corrections.ts";
import { loadRegistry } from "../../jobs/lib/ledger.ts";
import { readLists } from "../../todo/lib/store.ts";
import * as todos from "../../todo/lib/todo.ts";
import type { Note } from "../../vault/lib/vault.ts";
import { activity } from "./activity.ts";
import { skillsDir } from "./skills.ts";
import { config, traces } from "../langfuse.ts";

const mtime = (p: string): string => { try { return statSync(p).mtime.toISOString(); } catch { return ""; } };
const newest = (xs: (string | undefined | null)[]): string => xs.filter(Boolean).sort().at(-1) ?? "";
const oneLine = (s: string, max = 160) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > max ? t.slice(0, max) + "…" : t; };
const files = (dir: string, re: RegExp): string[] => { try { return readdirSync(dir).filter((f) => re.test(f)); } catch { return []; } };

export const handoffsDir = () => process.env.ALEPH_HANDOFFS_DIR ?? join(homedir(), ".aleph", "handoffs");

/** The first non-blank line under a handoff's `## Intent`, else its first line. */
export function intent(text: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^##\s+intent\s*$/i.test(l));
  const from = at < 0 ? lines : lines.slice(at + 1);
  return oneLine(from.find((l) => l.trim() && !/^#/.test(l)) ?? "");
}

function working() {
  const dir = handoffsDir();
  const read = (f: string) => ({ name: f.replace(/\.md$/, ""), intent: intent(readFileSync(join(dir, f), "utf8")), at: mtime(join(dir, f)) });
  const current = existsSync(join(dir, "current.md")) ? read("current.md") : null;
  const archived = files(dir, /^\d{4}-\d{2}-\d{2}-.*\.md$/).sort().reverse();
  const latest = archived.slice(0, 10).map((f) => ({ ...read(f), date: f.slice(0, 10) }));
  return { current, archived: latest, total: archived.length + (current ? 1 : 0), last: newest([current?.at, latest[0]?.at]) };
}

function semantic(root: string, wiki: Note[]) {
  const file = join(root, "MEMORY.md");
  const text = existsSync(file) ? readFileSync(file, "utf8") : null;
  const kinds = ["decision", "concept", "entity", "project", "gotcha"];
  const notes = wiki.filter((n) => kinds.includes(String(n.fm.kind)))
    .map((n) => ({ title: n.title, kind: String(n.fm.kind), scope: String(n.fm.scope ?? ""), updated: String(n.fm.updated ?? "") }))
    .sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title));
  return {
    memory: text === null ? null : { lines: text.split("\n").length, first: oneLine(text.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? ""), at: mtime(file) },
    notes, last: newest([text === null ? "" : mtime(file), ...notes.map((n) => n.updated)]),
  };
}

/** The last 7 days' sessions from Langfuse, newest first; null when Langfuse is off or fails. */
async function sessions(): Promise<{ id: string; project: string; firstPrompt: string; turns: number; last: string }[] | null> {
  if (!langfuseConfig()) return null;
  try {
    const from = new Date(Math.floor((Date.now() - 7 * 86400_000) / 3600_000) * 3600_000).toISOString();
    const groups = new Map<string, any[]>();
    for (const t of await traces(config(), { fromTimestamp: from })) if (t.sessionId) groups.set(t.sessionId, [...(groups.get(t.sessionId) ?? []), t]);
    const ms = (t: any) => Date.parse(t.timestamp ?? "") || 0;
    return [...groups].map(([id, ts]) => {
      ts.sort((a, b) => ms(a) - ms(b));
      const input = ts[0].input;
      return { id, project: ts[0].name || (ts[0].metadata?.cwd ? basename(String(ts[0].metadata.cwd)) : ""), firstPrompt: oneLine(typeof input === "string" ? input : JSON.stringify(input ?? ""), 120), turns: ts.length, last: ts.at(-1).timestamp as string };
    }).sort((a, b) => b.last.localeCompare(a.last)).slice(0, 10);
  } catch { return null; }
}

function episodic(root: string, wiki: Note[], live: Awaited<ReturnType<typeof sessions>>) {
  const episodes = wiki.filter((n) => n.fm.kind === "episode")
    .map((n) => ({ title: n.title, scope: String(n.fm.scope ?? ""), updated: String(n.fm.updated ?? "") }))
    .sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title));
  const daily = files(join(root, "daily"), /^\d{4}-\d{2}-\d{2}\.md$/).sort().reverse().map((f) => f.slice(0, 10));
  return { episodes, daily: { total: daily.length, latest: daily.slice(0, 10) }, sessions: live, last: newest([episodes[0]?.updated, daily[0], live?.[0]?.last]) };
}

const HOOK_NAMES: Record<string, string> = { "verify-gate": "verify-gate", "vault-context": "vault-context", "vault-recall": "vault-recall" };

/** Hooks in `~/.claude/settings.json`: event, matcher and command, with 7-day call counts where Langfuse has them. */
async function hooks() {
  const file = join(homedir(), ".claude", "settings.json");
  let cfg: any = {};
  try { cfg = JSON.parse(readFileSync(file, "utf8")); } catch {}
  const calls = new Map<string, number>();
  let counted = false;
  try {
    const a = await activity(7, null);
    counted = a.langfuse === "ok";
    for (const h of a.hooks) calls.set(h.name, h.calls);
  } catch {}
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
  const claude = join(import.meta.dir, "..", "..", "identity", "CLAUDE.md");
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

/** Open issues with a due date or a waiting_on, soonest due first. */
function prospective() {
  const registry = Object.values(loadRegistry());
  let docs: (todos.Doc | null)[] = [];
  try { docs = readLists(registry); } catch {}
  const open: { repo: string; id: number; title: string; due: string | null; waiting_on: string | null }[] = [];
  registry.forEach((r, n) => {
    for (const i of docs[n]?.items ?? []) {
      if (todos.status(i) !== "open") continue;
      const due = i.fm.due ? String(i.fm.due) : null, waiting = i.fm.waiting_on ? String(i.fm.waiting_on) : null;
      if (due || waiting) open.push({ repo: r.key, id: i.id, title: i.title, due, waiting_on: waiting });
    }
  });
  open.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.repo.localeCompare(b.repo) || a.id - b.id);
  return { issues: open, triggers: [] as unknown[], last: "" };
}

/** The factory's memory gates: corrections and proposals from the store; kept and rejected facts once aleph-352 writes them. */
function gates() {
  const s = readStore();
  const by = (state: string) => s.lessons.filter((l) => l.state === state);
  return {
    facts: { kept: [] as unknown[], rejected: [] as unknown[] },
    corrections: s.lessons.filter((l) => l.state === "open").map((l) => ({ id: l.id, sentence: l.sentence, count: l.count })),
    proposals: by("proposed").map((l) => ({ id: l.id, sentence: l.sentence, count: l.count, kind: l.kind ?? "" })),
    minedAt: s.minedAt,
  };
}

export async function memoryTypes(root: string, wiki: Note[], misses: unknown) {
  const [live, proc] = await Promise.all([sessions(), procedural()]);
  return {
    working: working(), semantic: semantic(root, wiki), episodic: episodic(root, wiki, live), procedural: proc,
    retrieval: retrieval(misses), prospective: prospective(), gates: gates(),
  };
}
