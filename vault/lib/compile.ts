/**
 * The compile digest: one day's Langfuse turns, handoffs and daily note,
 * plus the trace ids already cited, so the agent proposes writes from it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { langfuse, type Langfuse } from "../../lib/langfuse.ts";
import { handoffsDir } from "../../lib/paths.ts";
import { citedTraces, loadVault } from "./vault.ts";

const TRACE_CAP = 12 * 1024;

interface Obs { id: string; type: string; name?: string; parentObservationId?: string; input?: unknown; output?: unknown; metadata?: Record<string, any>; startTime?: string }

function dayRange(date: string): { from: Date; to: Date } {
  const from = new Date(`${date}T00:00:00`);
  return { from, to: new Date(from.getTime() + 86400_000) };
}

function str(v: unknown, max: number): string {
  const s = typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v);
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

function inputOf(o: Obs): any {
  if (typeof o.input === "string") { try { return JSON.parse(o.input); } catch { return o.input; } }
  return o.input;
}

/** One block per turn: cwd, final message, guardrail verdict, commands run. */
function digestTrace(trace: { id: string; name?: string; metadata?: any; observations?: Obs[] }): string {
  const obs = trace.observations ?? [];
  const cwd = trace.metadata?.cwd ?? trace.name ?? "";
  const turns = obs.filter((o) => o.name === "turn").sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  const children = (id: string) => obs.filter((o) => o.parentObservationId === id);
  const out: string[] = [`### trace ${trace.id} (${cwd})`];
  for (const t of turns) {
    const kids = children(t.id);
    const guard = kids.find((o) => o.type === "GUARDRAIL" || o.name === "verify-gate");
    const bash = kids.filter((o) => o.name === "Bash").map((o) => str(inputOf(o)?.command ?? inputOf(o), 160));
    out.push(`- prompt: ${str(t.input, 200)}`);
    if (bash.length) out.push(`  ran: ${bash.slice(0, 8).join(" ; ")}`);
    if (guard) out.push(`  verify: ${str(guard.metadata?.verdict ?? guard.output, 40)} ${str(guard.metadata?.reason ?? "", 200)}`);
    out.push(`  final: ${str(t.output, 600)}`);
  }
  if (!turns.length) out.push("- no turns");
  return out.join("\n");
}

export async function traceDigest(lf: Langfuse, date: string): Promise<{ text: string; error?: string }> {
  const { from, to } = dayRange(date);
  const parts: string[] = [];
  let size = 0;
  try {
    const { rows } = await lf.traces({ from, to });
    for (const t of rows) {
      const block = digestTrace((await lf.trace(t.id)) ?? t);
      if (size + block.length > TRACE_CAP) { parts.push(`… ${rows.length} traces on the day; digest capped at ${TRACE_CAP} bytes`); return { text: parts.join("\n\n") }; }
      parts.push(block);
      size += block.length;
    }
  } catch (e) {
    return { text: parts.join("\n\n"), error: String(e instanceof Error ? e.message : e) };
  }
  return { text: parts.length ? parts.join("\n\n") : "no traces on this date" };
}

export function handoffsFor(dir: string, date: string): string {
  if (!existsSync(dir)) return "";
  return readdirSync(dir).filter((f) => f.startsWith(date) && f.endsWith(".md")).sort()
    .map((f) => `### ${f}\n${readFileSync(join(dir, f), "utf8").slice(0, 6000)}`).join("\n\n");
}

/** The digest of `date` under the vault at `root`, as `aleph memory compile` prints it. `empty` is true when the day has no traces (and no Langfuse error), no handoff and no daily note. */
export async function compileDigest(root: string, date: string): Promise<{ text: string; empty: boolean }> {
  const lf = langfuse();
  const traces = lf ? await traceDigest(lf, date) : { text: "", error: "no Langfuse keys" };
  const handoffs = handoffsFor(handoffsDir(), date);
  const dailyPath = join(root, "daily", `${date}.md`);
  const daily = existsSync(dailyPath) ? readFileSync(dailyPath, "utf8") : "";
  const cited = citedTraces(await loadVault(root));
  const sections = [
    `# compile ${date}`,
    `## Traces${traces.error ? ` (Langfuse failed: ${traces.error})` : ""}\n\n${traces.text || "none"}`,
    `## Handoffs\n\n${handoffs || "none"}`,
    `## Daily note\n\n${daily || "none"}`,
    `## Already cited\n\n${cited.length ? cited.map((id) => `- trace:${id}`).join("\n") : "none"}`,
  ];
  return { text: sections.join("\n\n"), empty: !traces.error && traces.text === "no traces on this date" && !handoffs && !daily };
}
