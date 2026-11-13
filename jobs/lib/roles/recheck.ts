/**
 * The maintainer's decay re-check: one read-only `claude -p` run per pass checks the most recalled stale notes against
 * the code and the repos' git history, and replies one verdict per note. Code applies each through the vault ops
 * in-process, so each change is a pushed, revertible vault commit and each refusal is the op's own. The model never
 * writes a file, and a note with a `core:` line is never touched.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeFrontmatter } from "../../../lib/frontmatter.ts";
import { decayQueue, sub } from "../../../vault/lib/maintain.ts";
import { lintVault, loadVault, recordRun, today, wikiNotes, type Note } from "../../../vault/lib/vault.ts";
import { lock } from "../infra/locks.ts";
import { loadRegistry } from "../records/ledger.ts";
import { readModels } from "../routing/models.ts";
import { endLost, openRun } from "./agent-run.ts";
import { body } from "./maintainer.ts";

const SECONDS = 900;
/** Notes re-checked per run, most recalled first. */
export const BUDGET = 5;
const MODEL = () => readModels().maintainer?.model ?? "sonnet";
/** Read-only: the files, git history and the vault's recall. */
const ALLOWED = ["Read", "Grep", "Glob", "Bash(git log:*)", "Bash(aleph memory recall:*)"];
const TEXT = { type: "string" } as const;

export const RECHECK_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: { title: TEXT, verdict: { enum: ["refresh", "correct", "archive"] }, why: TEXT, claim: TEXT, details: TEXT, evidence: TEXT },
        required: ["title", "verdict", "why"],
      },
    },
  },
  required: ["verdicts"],
};

type Verdict = { title: string; verdict: string; why: string; claim?: string; details?: string; evidence?: string };
/** One verdict's outcome: its commit, or the op's refusal with its rule; a dry run has neither. */
export interface Rechecked { title: string; verdict: string; why: string; commit?: string | null; rule?: string; refused?: string }
export interface RecheckReport { day: string; dry: boolean; run?: string; notes: Rechecked[]; skipped?: string; error?: string }

export function prompt(notes: Note[], day: string): string {
  const repos = Object.values(loadRegistry()).map((r) => `- ${r.key}: ${r.path}`).join("\n");
  return [
    `You are the memory maintainer. Today is ${day}. Each note below passed its decay window, so its claim needs a re-check.`,
    "Check each claim against the code in the repos below and their git history (`git log` in the repo's path). Read the files; do not guess.",
    "Reply one verdict per note, with a one-line `why`:",
    "- `refresh`: the claim still holds.",
    "- `correct`: the claim is wrong but the note is worth keeping. Give `claim` (one or two sentences, true today), `details` and `evidence`.",
    "- `archive`: the claim fails and nothing in the note is worth keeping.",
    "Do not set `core`. Code applies each verdict; the vault refuses a change that breaks its rules.",
    "",
    "Repos:",
    repos || "(none registered)",
    "",
    ...notes.flatMap((n) => [`# ${n.title}`, "", n.text, ""]),
  ].join("\n");
}

/** The note's file text for a verdict: `refresh` bumps `updated`, `correct` rewrites the claim and keeps the frontmatter and Related. */
function text(n: Note, v: Verdict, day: string): string | null {
  if (v.verdict === "refresh") return serializeFrontmatter({ ...n.fm, updated: day }) + n.body;
  if (!v.claim || !v.details || !v.evidence) return null;
  const related = /^## Related\n\n([\s\S]*)$/m.exec(n.body)?.[1].trim() || "- [[Home]]";
  return serializeFrontmatter({ ...n.fm, updated: day }) + body(v, day, related);
}

/** Apply each verdict through the vault ops; a refusal is kept with its rule and the rest go on. */
async function apply(notes: Note[], verdicts: Verdict[], day: string): Promise<Rechecked[]> {
  const dir = mkdtempSync(join(tmpdir(), "recheck-"));
  try {
    const out: Rechecked[] = [];
    for (const n of notes) {
      const v = verdicts.find((x) => x.title === n.title);
      if (!v) continue;
      const w: Rechecked = { title: n.title, verdict: v.verdict, why: v.why };
      const why = `maintainer recheck ${day}: ${v.why.replace(/\s+/g, " ")}`;
      const file = join(dir, `${n.title}.md`);
      const t = v.verdict === "archive" ? "" : text(n, v, day);
      if (t === null) { out.push({ ...w, rule: "reply", refused: `${v.verdict} verdict has no claim, details and evidence` }); continue; }
      writeFileSync(file, t);
      const r = await sub(v.verdict === "archive" ? ["archive", n.title, "--why", why] : ["write", file, "--why", why]);
      const f = r.json?.findings?.[0];
      out.push(r.code === 0 ? { ...w, commit: r.json?.commit ?? null } : { ...w, rule: f?.rule, refused: f ? `refuse ${f.rule} ${f.note}: ${f.detail}` : r.err.trim() || `exit ${r.code}` });
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Re-check the BUDGET most recalled stale notes of the vault at `root`. A dry run asks the model and reports its verdicts;
 * a real one applies them. No stale note makes no model call. A failed run is in `error`.
 */
export async function recheck(root: string, dry: boolean): Promise<RecheckReport> {
  const day = today(), report: RecheckReport = { day, dry, notes: [] };
  const all = wikiNotes(await loadVault(root));
  const byTitle = new Map(all.map((n) => [n.title, n]));
  const stale = decayQueue(root, lintVault(all).warn.filter((f) => f.rule === "stale"));
  const queue = stale.map((f) => byTitle.get(f.note)!).filter((n) => !n.fm.core).slice(0, BUDGET);
  if (!queue.length) return { ...report, skipped: "nothing to re-check" };
  await endLost("maintainer", () => "maintainer", "a reply");
  const release = await lock("maintainer", 0);
  if (!release) return { ...report, skipped: "another maintainer holds the lock" };
  try {
    const run = openRun({ role: "maintainer", who: "the maintainer", model: MODEL(), seconds: SECONDS, flags: ["--tools", "Read,Grep,Glob,Bash", "--allowedTools", ALLOWED.join(",")], schema: RECHECK_SCHEMA, env: dry ? { ALEPH_RECALL_UNLOGGED: "1" } : undefined, name: `recheck-${day}`, command: `recheck ${day}${dry ? " --dry" : ""}`, shown: false });
    report.run = run.folder;
    try {
      const reply = (await run.askData(prompt(queue, day))) as { verdicts?: Verdict[] } | undefined;
      if (!Array.isArray(reply?.verdicts)) throw new Error("malformed reply: no verdicts list");
      report.notes = dry ? queue.flatMap((n) => reply.verdicts!.filter((v) => v.title === n.title).map(({ title, verdict, why }) => ({ title, verdict, why }))) : await apply(queue, reply.verdicts, day);
    } catch (e: any) {
      report.error = String(e?.message ?? e);
      run.end(`failed: ${report.error}`, { cause: "unanswered" });
      recordRun(root, "recheck", "failed", report.error);
      return report;
    }
    const done = report.notes.filter((n) => !n.refused).length;
    run.end(`${dry ? "dry: " : ""}${done} rechecked${report.notes.length > done ? `, ${report.notes.length - done} refused` : ""}`);
    recordRun(root, "recheck", "ok", `${dry ? "dry: " : ""}${done} rechecked`);
    return report;
  } finally {
    release();
  }
}
