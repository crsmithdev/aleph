/**
 * The maintainer's overlap queue: one read-only `claude -p` run per pass looks at the most similar note pairs and
 * replies one verdict per pair. Code applies each through the vault ops in-process, so each change is a pushed,
 * revertible vault commit and each refusal is the op's own. The model never writes a file, and a pair with a note
 * that has a `core:` line is never touched.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeFrontmatter } from "../../../lib/frontmatter.ts";
import { sub } from "../../../vault/lib/maintain.ts";
import { lintVault, loadVault, recordRun, today, wikiNotes, type Note } from "../../../vault/lib/vault.ts";
import { lock } from "../infra/locks.ts";
import { endLost, openRun } from "./agent-run.ts";
import { body } from "./maintainer.ts";
import { MODEL, outcome, SECONDS, TEXT } from "./recheck.ts";

/** Pairs worked per run, most similar first. */
export const PAIRS = 5;
/** Read-only: the files and the vault's recall. */
const ALLOWED = ["Read", "Grep", "Glob", "Bash(aleph memory recall:*)"];

export const DEDUPE_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: { a: TEXT, b: TEXT, verdict: { enum: ["merge", "archive", "distinct"] }, why: TEXT, keep: TEXT, drop: TEXT, claim: TEXT, details: TEXT, evidence: TEXT },
        required: ["a", "b", "verdict", "why"],
      },
    },
  },
  required: ["verdicts"],
};

type Verdict = { a: string; b: string; verdict: string; why: string; keep?: string; drop?: string; claim?: string; details?: string; evidence?: string };
type Pair = [Note, Note];
/** One verdict's outcome: its commit, or the op's refusal with its rule; a dry run has neither. */
export interface Resolved { a: string; b: string; verdict: string; why: string; commit?: string | null; rule?: string; refused?: string }
export interface DedupeReport { day: string; dry: boolean; run?: string; pairs: Resolved[]; skipped?: string; error?: string }

export function prompt(pairs: Pair[], day: string): string {
  return [
    `You are the memory maintainer. Today is ${day}. Each pair of notes below shares words in its titles and may say the same thing.`,
    "Read both notes of a pair, and check the claims against the code when they differ. Reply one verdict per pair, with `a` and `b` as the titles given and a one-line `why`:",
    "- `merge`: the two say the same thing. Give `keep` (one of the two titles) and `claim` (one or two sentences, true today), `details` and `evidence` for the merged note. The other note is archived.",
    "- `archive`: one note adds nothing the other lacks. Give `drop` (that note's title).",
    "- `distinct`: the two are different facts and both stay.",
    "Do not set `core`. Code applies each verdict; the vault refuses a change that breaks its rules.",
    "",
    ...pairs.flatMap(([a, b], i) => [`# Pair ${i + 1}`, "", `## Note A: ${a.title}`, "", a.text, "", `## Note B: ${b.title}`, "", b.text, ""]),
  ].join("\n");
}

const list = (n: Note, key: string): string[] => (Array.isArray(n.fm[key]) ? n.fm[key] : []);

/** The note title and file text to write, or the `archive` op's target, for a verdict, or a reason it is malformed. */
function change(a: Note, b: Note, v: Verdict, day: string): { title: string; text: string } | { drop: string } | { bad: string } {
  const pair = [a.title, b.title];
  if (v.verdict === "distinct") return { title: a.title, text: serializeFrontmatter({ ...a.fm, distinct: [...list(a, "distinct"), b.title] }) + a.body };
  if (v.verdict === "archive") return v.drop && pair.includes(v.drop) ? { drop: v.drop } : { bad: "archive verdict names no drop of the pair" };
  if (v.verdict !== "merge") return { bad: `unknown verdict ${v.verdict}` };
  if (!v.keep || !pair.includes(v.keep) || !v.claim || !v.details || !v.evidence) return { bad: "merge verdict has no keep of the pair, claim, details and evidence" };
  const [k, o] = v.keep === a.title ? [a, b] : [b, a];
  const related = /^## Related\n\n([\s\S]*)$/m.exec(k.body)?.[1].trim() || "- [[Home]]";
  return { title: k.title, text: serializeFrontmatter({ ...k.fm, updated: day, supersedes: [...list(k, "supersedes"), o.title] }) + body(v as any, day, related) };
}

/** Apply each verdict through the vault ops; a refusal is kept with its rule and the rest go on. */
async function apply(root: string, pairs: Pair[], verdicts: Verdict[], day: string): Promise<Resolved[]> {
  const dir = mkdtempSync(join(tmpdir(), "dedupe-"));
  try {
    const out: Resolved[] = [];
    const gone = new Set<string>();
    for (const [x, y] of pairs) {
      const v = verdicts.find((z) => (z.a === x.title && z.b === y.title) || (z.a === y.title && z.b === x.title));
      if (!v) continue;
      const w: Resolved = { a: x.title, b: y.title, verdict: v.verdict, why: v.why };
      if (gone.has(x.title) || gone.has(y.title)) { out.push({ ...w, rule: "gone", refused: "a note of this pair was archived by an earlier verdict" }); continue; }
      // An earlier verdict may have rewritten a note of this pair, so read both again.
      const live = new Map(wikiNotes(await loadVault(root)).map((n) => [n.title, n]));
      const [a, b] = [live.get(x.title)!, live.get(y.title)!];
      const c = change(a, b, v, day);
      if ("bad" in c) { out.push({ ...w, rule: "reply", refused: c.bad }); continue; }
      const why = `maintainer dedupe ${day}: ${v.why.replace(/\s+/g, " ")}`;
      const file = "text" in c ? join(dir, `${c.title}.md`) : "";
      if ("text" in c) writeFileSync(file, c.text);
      const r = await sub("drop" in c ? ["archive", c.drop, "--why", why] : ["write", file, "--why", why]);
      if (r.code === 0 && v.verdict !== "distinct") gone.add(v.verdict === "archive" ? v.drop! : v.keep === x.title ? y.title : x.title);
      out.push({ ...w, ...outcome(r) });
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Work the PAIRS most similar overlapping pairs of the vault at `root`. A dry run asks the model and reports its verdicts;
 * a real one applies them. No pair makes no model call. A failed run is in `error`.
 */
export async function dedupe(root: string, dry: boolean): Promise<DedupeReport> {
  const day = today(), report: DedupeReport = { day, dry, pairs: [] };
  const all = wikiNotes(await loadVault(root));
  const byTitle = new Map(all.map((n) => [n.title, n]));
  const queue = lintVault(all, { overlap: true }).warn.filter((f) => f.rule === "overlap")
    .map((f): Pair => [byTitle.get(f.note)!, byTitle.get(f.other!)!]).filter(([a, b]) => !a.fm.core && !b.fm.core).slice(0, PAIRS);
  if (!queue.length) return { ...report, skipped: "no overlapping pairs" };
  await endLost("maintainer", () => "maintainer", "a reply");
  const release = await lock("maintainer", 0);
  if (!release) return { ...report, skipped: "another maintainer holds the lock" };
  try {
    const run = openRun({ role: "maintainer", who: "the maintainer", model: MODEL(), seconds: SECONDS, flags: ["--tools", "Read,Grep,Glob,Bash", "--allowedTools", ALLOWED.join(",")], schema: DEDUPE_SCHEMA, env: dry ? { ALEPH_RECALL_UNLOGGED: "1" } : undefined, name: `dedupe-${day}`, command: `dedupe ${day}${dry ? " --dry" : ""}`, shown: false });
    report.run = run.folder;
    try {
      const reply = (await run.askData(prompt(queue, day))) as { verdicts?: Verdict[] } | undefined;
      if (!Array.isArray(reply?.verdicts)) throw new Error("malformed reply: no verdicts list");
      const asked = (v: Verdict) => queue.some(([a, b]) => (v.a === a.title && v.b === b.title) || (v.a === b.title && v.b === a.title));
      report.pairs = dry ? reply.verdicts.filter(asked).map(({ a, b, verdict, why }) => ({ a, b, verdict, why })) : await apply(root, queue, reply.verdicts, day);
    } catch (e: any) {
      report.error = String(e?.message ?? e);
      run.end(`failed: ${report.error}`, { cause: "unanswered" });
      recordRun(root, "dedupe", "failed", report.error);
      return report;
    }
    const done = report.pairs.filter((p) => !p.refused).length;
    run.end(`${dry ? "dry: " : ""}${done} resolved${report.pairs.length > done ? `, ${report.pairs.length - done} refused` : ""}`);
    recordRun(root, "dedupe", "ok", `${dry ? "dry: " : ""}${done} resolved`);
    return report;
  } finally {
    release();
  }
}
