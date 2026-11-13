/**
 * The maintainer's compile: one read-only `claude -p` run per day reads the compile digest of yesterday and replies
 * typed notes. Code renders each note and writes it with the vault `write` op in-process, so each write is a pushed,
 * revertible vault commit and each refusal is the op's own. The model never writes a file and never sets `core:`
 * (core lines change only through an Ask). A dry compile runs the model, reports the notes and writes nothing.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeFrontmatter } from "../../../lib/frontmatter.ts";
import { compileDigest } from "../../../vault/lib/compile.ts";
import { sub } from "../../../vault/lib/maintain.ts";
import { markRetry, recordCompiled, recordRun, today } from "../../../vault/lib/vault.ts";
import { addDays } from "../learning/monitor-table.ts";
import { lock } from "../infra/locks.ts";
import { readModels } from "../routing/models.ts";
import { endLost, openRun } from "./agent-run.ts";

/** The run's time box, in seconds. */
const SECONDS = 900;
const MODEL = () => readModels().maintainer?.model ?? "sonnet";
/** Read-only: the vault's recall and Read. */
const ALLOWED = ["Bash(aleph memory recall:*)", "Read"];
const KINDS = ["decision", "project", "concept", "entity", "gotcha"];
const TEXT = { type: "string" } as const;
const LIST = { type: "array", items: TEXT } as const;

/** The JSON schema of the reply: the notes to write, possibly none. */
export const MAINTAINER_SCHEMA = {
  type: "object",
  properties: {
    notes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: TEXT, kind: { enum: KINDS }, scope: TEXT, confidence: { enum: ["measured", "reported", "inferred"] },
          sources: LIST, aliases: LIST, tags: LIST, claim: TEXT, details: TEXT, evidence: TEXT, related: LIST,
        },
        required: ["title", "kind", "scope", "confidence", "sources", "claim", "details", "evidence", "related"],
      },
    },
  },
  required: ["notes"],
};

type Note = Record<string, any>;
/** One note's outcome: written (with its commit), or refused with the rule, or only drafted by a dry compile. */
export interface Written { title: string; kind: string; commit?: string | null; rule?: string; refused?: string }
export interface CompileReport { day: string; dry: boolean; run?: string; notes: Written[]; skipped?: string; error?: string }

/** The `## write` section of the vault skill: where the vault's write rules live. */
const writeRules = (): string => /^## write\n[\s\S]*?(?=^## |(?![\s\S]))/m.exec(readFileSync(join(import.meta.dir, "../../../skills/vault/SKILL.md"), "utf8"))?.[0] ?? "";

export function prompt(day: string, digest: string): string {
  return [
    `You are the memory maintainer. Below is the compile digest of ${day}: the day's turns, handoffs and daily note.`,
    "Write only what the day decided or learned that no existing note holds. Check with `aleph memory recall <query>` before you propose a note.",
    "Prefer decisions and projects over gotchas. Cite each note's evidence as `trace:<id>` in its sources.",
    'Skip every trace id listed under "Already cited". Zero notes is a valid answer: reply `{"notes": []}`.',
    "Do not set `core`. Reply only with the JSON the schema asks for. Code writes each note from your fields; the vault refuses a note that breaks its rules.",
    "Each note gives `claim` as one or two sentences ending in `as of YYYY-MM-DD`, then `details`, `evidence` and `related` (titles of notes that exist; `Home` is always valid).",
    "",
    writeRules(),
    "",
    digest,
  ].join("\n");
}

/** The note's file text: frontmatter from its fields, then the body. */
export function render(n: Note, day: string): string {
  const fm = { aliases: n.aliases ?? [], kind: n.kind, scope: n.scope, confidence: n.confidence, updated: day, supersedes: [], sources: n.sources ?? [], tags: n.tags ?? [] };
  const related = (n.related?.length ? n.related : ["Home"]).map((t: string) => `- [[${t}]]`).join("\n");
  // The write op refuses a claim with no date marker, so code adds it.
  const claim = /as of \d{4}-\d\d-\d\d/.test(n.claim) ? n.claim : n.claim.replace(/\.?\s*$/, `, as of ${day}.`);
  return `${serializeFrontmatter(fm)}\n**Claim.** ${claim}\n\n## Details\n\n${n.details}\n\n## Evidence\n\n${n.evidence}\n\n## Related\n\n${related}\n`;
}

/** Write each note through the vault `write` op; a refusal is kept with its rule and the rest go on. */
async function put(notes: Note[], day: string): Promise<Written[]> {
  const dir = mkdtempSync(join(tmpdir(), "maintainer-"));
  try {
    const out: Written[] = [];
    for (const n of notes) {
      const w: Written = { title: String(n.title), kind: String(n.kind) };
      if (!n.title || /[\/\\:*?"<>|]/.test(n.title)) { out.push({ ...w, rule: "title", refused: "the title is empty or has a character a file name cannot" }); continue; }
      const file = join(dir, `${n.title}.md`);
      writeFileSync(file, render(n, day));
      const r = await sub(["write", file, "--why", `maintainer compile ${day}`]);
      const f = r.json?.findings?.[0];
      out.push(r.code === 0 ? { ...w, commit: r.json?.commit ?? null } : { ...w, rule: f?.rule, refused: f ? `refuse ${f.rule} ${f.note}: ${f.detail}` : r.err.trim() || `exit ${r.code}` });
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Compile `day` under the vault at `root`. A real compile writes the notes and records the day; a dry one does neither.
 * A day with nothing in it makes no model call. A failed run is in `error`, leaves the day uncompiled and marks it for retry; a run that succeeds, dry or not, clears the mark.
 */
export async function compileDay(root: string, day: string, dry: boolean): Promise<CompileReport> {
  const report: CompileReport = { day, dry, notes: [] };
  const digest = await compileDigest(root, day);
  if (digest.empty) {
    if (!dry) recordCompiled(root, day);
    return { ...report, skipped: "nothing on the day" };
  }
  await endLost("maintainer", () => "maintainer", "a reply");
  const release = await lock("maintainer", 0);
  if (!release) return { ...report, skipped: "another maintainer holds the lock" };
  try {
    const run = openRun({ role: "maintainer", who: "the maintainer", model: MODEL(), seconds: SECONDS, flags: ["--tools", "Bash,Read", "--allowedTools", ALLOWED.join(",")], schema: MAINTAINER_SCHEMA, name: `maintainer-${day}`, command: `maintainer ${day}${dry ? " --dry" : ""}`, shown: false });
    report.run = run.folder;
    try {
      const reply = (await run.askData(prompt(day, digest.text))) as { notes?: Note[] } | undefined;
      if (!Array.isArray(reply?.notes)) throw new Error("malformed reply: no notes list");
      report.notes = dry ? reply.notes.map((n) => ({ title: String(n.title), kind: String(n.kind) })) : await put(reply.notes, day);
    } catch (e: any) {
      report.error = String(e?.message ?? e);
      run.end(`failed: ${report.error}`, { cause: "unanswered" });
      recordRun(root, "compile", "failed", `${day}: ${report.error}`);
      markRetry(root, day, true);
      return report;
    }
    const wrote = report.notes.filter((n) => !n.refused).length;
    run.end(`${dry ? "dry: " : ""}${wrote} notes${report.notes.length > wrote ? `, ${report.notes.length - wrote} refused` : ""}`);
    if (!dry) recordCompiled(root, day);
    markRetry(root, day, false);
    recordRun(root, "compile", "ok", `${dry ? "dry: " : ""}${day}: ${wrote} notes`);
    return report;
  } finally {
    release();
  }
}

/** The vault's date (local) before `now`. */
export const yesterday = (now: number): string => addDays(today(new Date(now)), -1);
