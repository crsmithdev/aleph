/**
 * The maintainer's decay re-check: one read-only `claude -p` run per pass checks the most recalled stale notes against
 * the code and the repos' git history, and replies one verdict per note. Code applies each through the vault ops
 * in-process, so each change is a pushed, revertible vault commit and each refusal is the op's own. The model never
 * writes a file. On a note with a `core:` line only `refresh` is applied: `correct` and `archive` are held in the factory
 * dir and put to Chris as a core-change Ask on a parked issue, and the note is not re-checked while its held verdict
 * waits. His Approve applies the verdict through the same ops; his Decline keeps the claim and bumps `updated`.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeFrontmatter } from "../../../lib/frontmatter.ts";
import { getJson, putJson } from "../../../lib/db.ts";
import { vaultDir } from "../../../lib/paths.ts";
import { fileIssue, writeList } from "../../../issues/lib/store.ts";
import { find, note, parseIssueRef, setStatus } from "../../../issues/lib/todo.ts";
import { clearAsk, setAsk } from "../asks/ask.ts";
import { decayQueue, sub } from "../../../vault/lib/maintain.ts";
import { lintVault, loadWiki, recordRun, type Note } from "../../../vault/lib/vault.ts";
import { today } from "../../../lib/day.ts";
import { loadRegistry } from "../records/ledger.ts";
import { body, pass, reason, scratch, TEXT } from "./maintainer.ts";
import { cutTitle } from "./title.ts";
import { issueKey } from "../../../lib/naming.ts";

/** Notes re-checked per run, most recalled first. */
export const BUDGET = 5;
/** Read-only: the files, git history and the vault's recall. */
const ALLOWED = ["Read", "Grep", "Glob", "Bash(git log:*)", "Bash(aleph memory recall:*)"];
/** The verdicts held for Chris, by note title: outside the vault, so no vault op or commit touches them. */

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

type Held = Verdict & { day: string; issue: string };

/** An op's result as the fields of a verdict's outcome: its commit, or its refusal with the rule. */
export function outcome(r: { code: number; json: Record<string, any> | null; err: string }) {
  const f = r.json?.findings?.[0];
  return r.code === 0 ? { commit: r.json?.commit ?? null } : { rule: f?.rule, refused: f ? `refuse ${f.rule} ${f.note}: ${f.detail}` : r.err.trim() || `exit ${r.code}` };
}

/** Hold the verdict of core note `n` for Chris: a parked aleph issue, with the core-change Ask on it. */
function hold(n: Note, v: Verdict, day: string): void {
  const repo = loadRegistry().aleph;
  if (!repo) throw new Error("no aleph repo in the registry to file the held change in");
  const claim = v.verdict === "correct" && v.claim ? `New claim: ${v.claim}` : "";
  const request = [`The memory re-check of the core note ${n.title} gives the verdict ${v.verdict}.`, `Why: ${v.why}`, claim].filter(Boolean).join("\n\n");
  const issue = fileIssue(repo, { title: cutTitle(`Apply the ${v.verdict} of core note ${n.title}`), kind: "task", source: "memory", parked: true, request }, "rule", { after: () => {} });
  const ref = `${repo.key}-${issue.id}`;
  setAsk(issueKey(issue.id), { reason: "core-change", question: `Apply the ${v.verdict} verdict to the core note ${n.title}?`, options: [], why: [v.why, claim].filter(Boolean) });
  putJson("state", "recheck-held", { ...getJson<Record<string, Held>>("state", "recheck-held", {}), [n.title]: { ...v, day, issue: ref } });
}

/** Apply each verdict through the vault ops; a refusal is kept with its rule and the rest go on. `approved` applies a held core verdict. */
async function apply(notes: Note[], verdicts: Verdict[], day: string, approved = false): Promise<Rechecked[]> {
  return scratch("recheck", async (dir) => {
    const out: Rechecked[] = [];
    for (const n of notes) {
      const v = verdicts.find((x) => x.title === n.title);
      if (!v) continue;
      const w: Rechecked = { title: n.title, verdict: v.verdict, why: v.why };
      if (n.fm.core && v.verdict !== "refresh" && !approved) {
        hold(n, v, day);
        out.push({ ...w, rule: "core", refused: "held for Chris" });
        continue;
      }
      const why = reason("recheck", day, v.why);
      const file = join(dir, `${n.title}.md`);
      const t = v.verdict === "archive" ? "" : text(n, v, day);
      if (t === null) { out.push({ ...w, rule: "reply", refused: `${v.verdict} verdict has no claim, details and evidence` }); continue; }
      writeFileSync(file, t);
      const r = await sub(v.verdict === "archive" ? ["archive", n.title, "--why", why] : ["write", file, "--why", why]);
      out.push({ ...w, ...outcome(r) });
    }
    return out;
  });
}

/**
 * Re-check the BUDGET most recalled stale notes of the vault at `root`. A dry run asks the model and reports its verdicts;
 * a real one applies them. No stale note makes no model call. A failed run is in `error`.
 */
export async function recheck(root: string, dry: boolean): Promise<RecheckReport> {
  const day = today(), report: RecheckReport = { day, dry, notes: [] };
  const all = await loadWiki(root);
  const byTitle = new Map(all.map((n) => [n.title, n]));
  const stale = decayQueue(root, lintVault(all).warn.filter((f) => f.rule === "stale"));
  const held = getJson<Record<string, unknown>>("state", "recheck-held", {});
  const queue = stale.map((f) => byTitle.get(f.note)!).filter((n) => !held[n.title]).slice(0, BUDGET);
  if (!queue.length) return { ...report, skipped: "nothing to re-check" };
  await pass(report, {
    label: "recheck", day, dry, schema: RECHECK_SCHEMA, allowed: ALLOWED, key: "verdicts", prompt: prompt(queue, day),
    act: async (list) => {
      report.notes = dry ? queue.flatMap((n) => list.filter((v) => v.title === n.title).map(({ title, verdict, why }) => ({ title, verdict, why }))) : await apply(queue, list, day);
    },
    done: () => {
      const done = report.notes.filter((n) => !n.refused).length;
      return `${done} rechecked${report.notes.length > done ? `, ${report.notes.length - done} refused` : ""}`;
    },
    settle: (error) => recordRun(root, "recheck", error ? "failed" : "ok", error ?? `${dry ? "dry: " : ""}${report.notes.filter((n) => !n.refused).length} rechecked`),
  });
  return report;
}

/**
 * Chris's answer to the held verdict of the issue `ref`. Approve applies it through the vault op; decline keeps the claim and
 * sets the note's `updated` to today. Either clears the held verdict and the Ask. A done issue (approve) or a dropped one
 * (decline) is the result; a refusal of the op is a note on the issue, which stays parked. Why it could not answer, or null.
 */
export async function answerHeld(ref: string, approved: boolean): Promise<string | null> {
  const held = getJson<Record<string, Held>>("state", "recheck-held", {});
  const title = Object.keys(held).find((t) => held[t].issue === ref);
  if (!title) return `no held verdict for ${ref}`;
  const n = (await loadWiki(vaultDir())).find((x) => x.title === title);
  if (!n) return `no note ${title} in the vault`;
  const [r] = await apply([n], [approved ? held[title] : { title, verdict: "refresh", why: "Chris kept the claim" }], today(), true);
  const at = parseIssueRef(ref)!;
  writeList({ key: at.repo }, `recheck: ${approved ? "approved" : "declined"} ${ref}`, (doc) => {
    const item = find(doc, at.id);
    if (!item) return null;
    note(item, r.refused ? `the vault refused: ${r.refused}` : approved ? `Chris approved: the ${held[title].verdict} is applied` : "Chris declined: the claim stays");
    if (!r.refused) setStatus(item, approved ? "done" : "dropped");
    return true;
  });
  // Read again: a recheck may have held another verdict while the op ran.
  const { [title]: _, ...rest } = getJson<Record<string, Held>>("state", "recheck-held", {});
  putJson("state", "recheck-held", rest);
  clearAsk(issueKey(at.id));
  return r.refused ?? null;
}
