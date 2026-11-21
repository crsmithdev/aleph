/**
 * The maintainer's compile: one read-only `claude -p` run per day reads the compile digest of yesterday and replies
 * typed notes. Code builds each note and writes it with the vault `put` op in-process, so each write is a pushed,
 * revertible vault commit and each refusal is the op's own. The model never writes a file and never sets `core:`
 * (core lines change only through an Ask). A dry compile runs the model, reports the notes and writes nothing.
 */
import { compileDigest } from "../../../vault/lib/compile.ts";
import { outcome, put, type Draft } from "../../../vault/lib/ops.ts";
import { markRetry, recordCompiled, recordRun } from "../../../vault/lib/vault.ts";
import { lock } from "../../../lib/locks.ts";
import { readModels } from "../routing/models.ts";
import { endLost, openRun } from "./agent-run.ts";
import { skillPart } from "./role-skill.ts";
import { errText } from "../../../lib/errtext.ts";

/** The run's time box, in seconds. */
const SECONDS = 900;
const MODEL = () => readModels().maintainer.model;
/** Read-only: the vault's recall and Read. */
const ALLOWED = ["Bash(aleph memory recall:*)", "Read"];
const KINDS = ["decision", "project", "concept", "entity", "gotcha"];
export const TEXT = { type: "string" } as const;
const LIST = { type: "array", items: TEXT } as const;

/** The JSON schema of the reply: the notes to write, possibly none. */
const MAINTAINER_SCHEMA = {
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
interface CompileReport { day: string; dry: boolean; run?: string; notes: Written[]; skipped?: string; error?: string }

function prompt(day: string, digest: string): string {
  return [
    `You are the memory maintainer. Below is the compile digest of ${day}: the day's turns, handoffs and daily note.`,
    "Write only what the day decided or learned that no existing note holds. Check with `aleph memory recall <query>` before you propose a note.",
    "Prefer decisions and projects over gotchas. Cite each note's evidence as `trace:<id>` in its sources.",
    'Skip every trace id listed under "Already cited". Zero notes is a valid answer: reply `{"notes": []}`.',
    "Do not set `core`. Reply only with the JSON the schema asks for. Code writes each note from your fields; the vault refuses a note that breaks its rules.",
    "Each note gives `claim` as one or two sentences ending in `as of YYYY-MM-DD`, then `details`, `evidence` and `related` (titles of notes that exist).",
    "",
    skillPart("vault", "write"),
    "",
    digest,
  ].join("\n");
}

/** The text of the note body's Related section, the last section: the heading in any case, with or without a blank line after it (ui/api/memory.ts `withLink` writes none). */
export const related = (text: string): string => {
  const m = /^##\s+related\s*$/im.exec(text);
  return m ? text.slice(m.index + m[0].length).trim() : "";
};

/** The note's body from its fields; `related` is the Related section's text. */
export function body(n: Note, day: string, related: string): string {
  // The write op refuses a claim with no date marker, so code adds it.
  const claim = /as of \d{4}-\d\d-\d\d/.test(n.claim) ? n.claim : n.claim.replace(/\.?\s*$/, `, as of ${day}.`);
  return `\n**Claim.** ${claim}\n\n## Details\n\n${n.details}\n\n## Evidence\n\n${n.evidence}\n\n## Related\n\n${related}\n`;
}

/** The note's draft: frontmatter from its fields, then the body. */
export function draft(n: Note, day: string): Draft {
  const fm = { aliases: n.aliases ?? [], kind: n.kind, scope: n.scope, confidence: n.confidence, updated: day, supersedes: [], sources: n.sources ?? [], tags: n.tags ?? [] };
  return { title: n.title, fm, body: body(n, day, (n.related ?? []).map((t: string) => `- [[${t}]]`).join("\n")) };
}

/** The `--why` of a vault op: who, which pass, which day, then the reason when there is one. */
export const reason = (verb: string, day: string, why?: string): string => `maintainer ${verb} ${day}${why === undefined ? "" : `: ${why.replace(/\s+/g, " ")}`}`;

/** What a maintainer pass gives the harness. */
export interface Pass {
  /** The pass's name: the run's name and command. */
  label: string;
  /** The vault and the name of the vault run record `pass` writes. */
  root: string;
  record: string;
  day: string;
  dry: boolean;
  schema: object;
  /** The `--allowedTools` list: the tools the run gets are the names in it. */
  allowed: string[];
  /** The reply's list: its key. */
  key: "notes" | "verdicts";
  prompt: string;
  /** Put the reply's list into the report; a throw fails the run. */
  act: (list: any[]) => Promise<void>;
  /** The run's end text when `act` succeeded. */
  done: () => string;
  /** Called after the run ends and its record is written: the error text, or undefined when it succeeded. */
  settle?: (error?: string) => void;
}

/** Run one maintainer pass under the maintainer lock. The report gets `run`, `error` or `skipped`. */
export async function pass(report: { run?: string; error?: string; skipped?: string }, p: Pass): Promise<void> {
  await endLost("maintainer", () => "maintainer", "a reply");
  const release = await lock("maintainer", 0);
  if (!release) { report.skipped = "another maintainer holds the lock"; return; }
  try {
    const tools = [...new Set(p.allowed.map((a) => a.replace(/\(.*/, "")))].join(",");
    const run = openRun({ role: "maintainer", who: "the maintainer", model: MODEL(), seconds: SECONDS, flags: ["--tools", tools, "--allowedTools", p.allowed.join(",")], schema: p.schema, env: p.dry ? { ALEPH_RECALL_UNLOGGED: "1" } : undefined, name: `${p.label}-${p.day}`, command: `${p.label} ${p.day}${p.dry ? " --dry" : ""}`, shown: false });
    report.run = run.folder;
    try {
      const list = ((await run.askData(p.prompt)) as Record<string, unknown> | undefined)?.[p.key];
      if (!Array.isArray(list)) throw new Error(`malformed reply: no ${p.key} list`);
      await p.act(list);
    } catch (e) {
      report.error = errText(e);
      run.end(`failed: ${report.error}`, { cause: "unanswered" });
      recordRun(p.root, p.record, "failed", report.error);
      p.settle?.(report.error);
      return;
    }
    const text = `${p.dry ? "dry: " : ""}${p.done()}`;
    run.end(text);
    recordRun(p.root, p.record, "ok", text);
    p.settle?.();
  } finally {
    release();
  }
}

/** Write each note through the vault `put` op; a refusal is kept with its rule and the rest go on. */
async function place(root: string, notes: Note[], day: string): Promise<Written[]> {
  const out: Written[] = [];
  for (const n of notes) out.push({ title: String(n.title), kind: String(n.kind), ...outcome(await put(root, draft(n, day), reason("compile", day))) });
  return out;
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
  await pass(report, {
    label: "maintainer", root, record: "compile", day, dry, schema: MAINTAINER_SCHEMA, allowed: ALLOWED, key: "notes", prompt: prompt(day, digest.text),
    act: async (list) => { report.notes = dry ? list.map((n) => ({ title: String(n.title), kind: String(n.kind) })) : await place(root, list, day); },
    done: () => {
      const wrote = report.notes.filter((n) => !n.refused).length;
      return `${wrote} notes${report.notes.length > wrote ? `, ${report.notes.length - wrote} refused` : ""}`;
    },
    settle: (error) => {
      if (!error && !dry) recordCompiled(root, day);
      markRetry(root, day, !!error);
    },
  });
  return report;
}
