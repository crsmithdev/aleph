/**
 * The maintainer's misses queue: one read-only `claude -p` run per pass looks at the queries that missed a note a turn
 * then read, and replies one verdict per miss: an alias for the note, or skip. Code adds each alias through the vault's
 * `write` op in-process, so each change is a pushed, revertible vault commit and each refusal is the op's own. The model
 * never writes a file, and a note with a `core:` line is never touched: its line is in the start context already.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeFrontmatter } from "../../../lib/frontmatter.ts";
import { langfuse } from "../../../lib/langfuse.ts";
import { openIndex, rankNotes } from "../../../vault/lib/index.ts";
import { sub } from "../../../vault/lib/maintain.ts";
import { recallQuery } from "../../../vault/lib/recall-query.ts";
import { loadVault, recordRun, today, wikiNotes, type Note } from "../../../vault/lib/vault.ts";
import { lock } from "../infra/locks.ts";
import { endLost, openRun } from "./agent-run.ts";
import { MODEL, outcome, SECONDS, TEXT } from "./recheck.ts";

/** Misses worked per run, oldest first. */
export const MISSES = 8;
/** How far back a run looks: the maintainer runs once a day. */
const WINDOW_MS = 86400_000;
/** How deep a query still finds a note: the hook asks Jev about 100 candidates, and recall prints 10. */
const DEPTH = { hook: 100, recall: 10 } as const;
/** Read-only: the files and the vault's recall. */
const ALLOWED = ["Read", "Grep", "Glob", "Bash(aleph memory recall:*)"];

export const ALIAS_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: { miss: { type: "integer" }, note: TEXT, verdict: { enum: ["alias", "skip"] }, aliases: { type: "array", items: TEXT }, why: TEXT },
        required: ["miss", "note", "verdict", "why"],
      },
    },
  },
  required: ["verdicts"],
};

/** A query that did not surface `note`, which the same turn then read. `source` is the hook (the user's prompt) or an agent's recall. */
export interface Miss { query: string; note: Note; source: keyof typeof DEPTH; at: string }
type Verdict = { miss: number; note: string; verdict: string; why: string; aliases?: string[] };
/** One verdict's outcome: its commit, or the op's refusal with its rule; a dry run has neither. */
export interface Aliased { query: string; note: string; verdict: string; why: string; aliases?: string[]; commit?: string | null; rule?: string; refused?: string }
export interface AliasReport { day: string; dry: boolean; run?: string; misses: Aliased[]; skipped?: string; error?: string }

const asValue = (v: unknown): any => { if (typeof v === "string") { try { return JSON.parse(v); } catch { return v; } } return v; };
const outText = (v: unknown): string => { const x = asValue(v); return typeof x === "string" ? x : typeof x?.stdout === "string" ? x.stdout : JSON.stringify(x ?? ""); };
const lines = (v: unknown): string[] => String(v ?? "").split("\n").filter(Boolean);

/**
 * The misses of the window before `now` that today's ranking of `notes` still misses, oldest first, one per query and
 * note. A miss is a query of a turn that did not surface a wiki note the turn later read: the hook's prompt when the
 * note was not among the notes it asked about (or offered, on a span from before it logged them), or an agent recall
 * whose output does not name the note. A note the hook offered earlier in the session, or a core note, is no miss.
 */
export async function findMisses(root: string, notes: Note[], now: number): Promise<Miss[]> {
  const lf = langfuse();
  if (!lf) throw new Error("no Langfuse keys");
  const span = { from: new Date(now - WINDOW_MS), to: new Date(now) };
  const [traces, obs] = await Promise.all([lf.traces(span), lf.observations(span)]);
  const prompt = new Map(traces.rows.map((t) => [t.id, typeof t.input === "string" ? t.input : ""]));
  const session = new Map(traces.rows.map((t) => [t.id, t.sessionId ?? ""]));
  const byRel = new Map(notes.filter((n) => !n.fm.core).map((n) => [n.rel, n]));
  const offered = new Map<string, Set<string>>();
  for (const o of obs.rows) if (o.name === "vault-recall") {
    const s = session.get(o.traceId) ?? "";
    offered.set(s, new Set([...(offered.get(s) ?? []), ...lines(o.metadata?.offered)]));
  }
  const byTrace = new Map<string, any[]>();
  for (const o of [...obs.rows].sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""))) byTrace.set(o.traceId, [...(byTrace.get(o.traceId) ?? []), o]);

  const found: Miss[] = [];
  for (const [id, list] of byTrace) {
    // What each query of the turn surfaced, in order: a note surfaces when its path, or for a recall its title, is there.
    const asked: { query: string; source: Miss["source"]; has: (n: Note) => boolean }[] = [];
    for (const o of list) {
      const input = asValue(o.input);
      if (o.name === "vault-recall" && prompt.get(id)) {
        const paths = new Set(lines(o.metadata?.askedPaths ?? o.metadata?.offered));
        asked.push({ query: prompt.get(id)!, source: "hook", has: (n) => paths.has(n.rel) });
      }
      const q = o.name === "Bash" ? recallQuery(String(typeof input === "string" ? input : input?.command ?? "").trim()) : null;
      if (q) { const out = outText(o.output); asked.push({ query: q, source: "recall", has: (n) => out.includes(n.title) }); }
      const rel = o.name === "Read" ? /(?:^|\/)(wiki\/.+\.md)$/.exec(String(input?.file_path ?? ""))?.[1] : undefined;
      const n = rel ? byRel.get(rel) : undefined;
      if (!n || offered.get(session.get(id) ?? "")?.has(n.rel)) continue;
      for (const a of asked) if (!a.has(n)) found.push({ query: a.query, note: n, source: a.source, at: o.startTime ?? "" });
    }
  }
  const db = openIndex(root, notes);
  try {
    const seen = new Set<string>();
    return found.filter((m) => {
      const key = `${m.query}\n${m.note.rel}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return !rankNotes(db, notes, m.query).slice(0, DEPTH[m.source]).some((r) => r.note.rel === m.note.rel);
    });
  } finally {
    db.close();
  }
}

export function prompt(misses: Miss[], day: string): string {
  return [
    `You are the memory maintainer. Today is ${day}. Each miss below is a query that did not find a note, and the same turn then read that note.`,
    "An alias is a short name a reader would search for: 1 to 6 words, a term or a phrase from the query, not the query itself. The vault matches a query against titles and aliases, so a good alias makes the next such query find the note.",
    "Reply one verdict per miss, with `miss` as its number, `note` as given and a one-line `why`:",
    "- `alias`: the query looked for this note's topic. Give `aliases`, one or two new names. Do not repeat the title or an alias the note has.",
    "- `skip`: the query was about something else, or the read came from a link, a name in the context or a note the turn wrote.",
    "Code adds each alias; the vault refuses an alias that is another note's title or alias.",
    "",
    ...misses.flatMap((m, i) => [`# Miss ${i + 1}`, "", `Query (${m.source === "hook" ? "the user's prompt" : "an agent's recall"}): ${m.query.slice(0, 2000)}`, "", `## Note: ${m.note.title}`, "", m.note.text, ""]),
  ].join("\n");
}

const list = (n: Note, key: string): string[] => (Array.isArray(n.fm[key]) ? n.fm[key] : []);

/** Add each `alias` verdict's aliases through the `write` op; a refusal is kept with its rule and the rest go on. */
async function apply(root: string, misses: Miss[], verdicts: Verdict[], day: string): Promise<Aliased[]> {
  const dir = mkdtempSync(join(tmpdir(), "alias-"));
  try {
    const out: Aliased[] = [];
    for (const [i, m] of misses.entries()) {
      const v = verdicts.find((x) => x.miss === i + 1 && x.note === m.note.title);
      if (!v) continue;
      const w: Aliased = { query: m.query, note: m.note.title, verdict: v.verdict, why: v.why, ...(v.aliases ? { aliases: v.aliases } : {}) };
      if (v.verdict === "skip") { out.push(w); continue; }
      // An earlier verdict may have added aliases to this note, so read it again.
      const n = wikiNotes(await loadVault(root)).find((x) => x.title === m.note.title);
      const have = new Set([n?.title ?? "", ...(n ? list(n, "aliases") : [])].map((a) => a.toLowerCase()));
      const add = [...new Set((v.aliases ?? []).map((a) => a.trim()).filter((a) => a && !have.has(a.toLowerCase())))];
      if (v.verdict !== "alias" || !n || !add.length) { out.push({ ...w, rule: "reply", refused: !n ? "the note is gone" : v.verdict !== "alias" ? `unknown verdict ${v.verdict}` : "alias verdict names no new alias" }); continue; }
      const file = join(dir, `${n.title}.md`);
      writeFileSync(file, serializeFrontmatter({ ...n.fm, aliases: [...list(n, "aliases"), ...add] }) + n.body);
      const r = await sub(["write", file, "--why", `maintainer alias ${day}: ${v.why.replace(/\s+/g, " ")}`]);
      out.push({ ...w, aliases: add, ...outcome(r) });
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Work the MISSES oldest misses of the last day for the vault at `root`. A dry run asks the model and reports its
 * verdicts; a real one applies them. No miss makes no model call. A failed run is in `error`.
 */
export async function alias(root: string, dry: boolean, now = Date.now()): Promise<AliasReport> {
  const day = today(), report: AliasReport = { day, dry, misses: [] };
  const notes = wikiNotes(await loadVault(root));
  const queue = (await findMisses(root, notes, now)).slice(0, MISSES);
  if (!queue.length) return { ...report, skipped: "no misses" };
  await endLost("maintainer", () => "maintainer", "a reply");
  const release = await lock("maintainer", 0);
  if (!release) return { ...report, skipped: "another maintainer holds the lock" };
  try {
    const run = openRun({ role: "maintainer", who: "the maintainer", model: MODEL(), seconds: SECONDS, flags: ["--tools", "Read,Grep,Glob,Bash", "--allowedTools", ALLOWED.join(",")], schema: ALIAS_SCHEMA, env: dry ? { ALEPH_RECALL_UNLOGGED: "1" } : undefined, name: `alias-${day}`, command: `alias ${day}${dry ? " --dry" : ""}`, shown: false });
    report.run = run.folder;
    try {
      const reply = (await run.askData(prompt(queue, day))) as { verdicts?: Verdict[] } | undefined;
      if (!Array.isArray(reply?.verdicts)) throw new Error("malformed reply: no verdicts list");
      const asked = (v: Verdict) => queue[v.miss - 1]?.note.title === v.note;
      report.misses = dry ? reply.verdicts.filter(asked).map(({ miss, note, verdict, why, aliases }) => ({ query: queue[miss - 1].query, note, verdict, why, ...(aliases ? { aliases } : {}) })) : await apply(root, queue, reply.verdicts, day);
    } catch (e: any) {
      report.error = String(e?.message ?? e);
      run.end(`failed: ${report.error}`, { cause: "unanswered" });
      recordRun(root, "alias", "failed", report.error);
      return report;
    }
    const done = report.misses.filter((m) => m.verdict === "alias" && !m.refused).length;
    const refused = report.misses.filter((m) => m.refused).length;
    run.end(`${dry ? "dry: " : ""}${done} aliased${refused ? `, ${refused} refused` : ""}`);
    recordRun(root, "alias", "ok", `${dry ? "dry: " : ""}${done} aliased`);
    return report;
  } finally {
    release();
  }
}
