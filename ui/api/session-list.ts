/** The sessions list of `GET /api/sessions` and the Memory page: a window's traces grouped into session rows, from Langfuse. */
import { clip } from "../../lib/naming.ts";
import { need, type Langfuse, type Trace } from "../../lib/langfuse.ts";
import { list } from "../langfuse.ts";
import { loadRegistry } from "../../jobs/lib/records/ledger.ts";
import { traceIn, type Scope } from "./scope.ts";
import { currentFit, share } from "../usage.ts";
import { byTime, jobs, ms, projectOf, taskTypes, text } from "./sessions.ts";
// @ts-ignore plain JS, shared with the page
import { systemParts } from "../system-parts.js";

/** The first prompt the user typed, read trace by trace in time order until one has it: system text (a `<task-notification>`, a `<system-reminder>`) skipped. */
async function firstTyped(lf: Langfuse, ts: Trace[]) {
  let first: unknown;
  for (const [i, t] of ts.entries()) {
    const input = (await lf.trace(t.id))?.input;
    if (i === 0) first = input;
    const typed = systemParts(text(input)).text;
    if (typed) return typed;
  }
  return text(first);
}

/** A trace that has a session. */
type Session = Trace & { sessionId: string };

/** The traces with a session over the last `days` days, at most 90 (the widest window the page offers), and whether Langfuse held more pages than the read. */
export async function windowTraces(days: number, project: string | null): Promise<{ rows: Session[]; partial: boolean }> {
  const hour = 3600_000; // whole hours, so the cache key holds
  const from = new Date(Math.floor((Date.now() - Math.min(days > 0 ? days : 7, 90) * 86400_000) / hour) * hour);
  const { rows, partial } = await list(need(), "traces", { from, core: true });
  return { rows: rows.filter((t): t is Session => !!t.sessionId && traceIn(t, project)), partial };
}

const LIMIT = 100, MAX = 2000;

/**
 * The first `limit` sessions of `traces` that ended before `before`, newest last turn first: a factory worker's session has its job's name, and its ledger cost when Langfuse prices it at 0.
 * The window's traces hold no input, so only these sessions have their `firstPrompt` read.
 */
export async function sessionRows(traces: Session[], limit: number, before: string | null = null) {
  const groups = new Map<string, Session[]>();
  for (const t of traces) {
    const g = groups.get(t.sessionId);
    if (g) g.push(t); else groups.set(t.sessionId, [t]);
  }
  const ledger = jobs();
  const fit = await currentFit();
  const rows = [...groups].map(([id, ts]) => {
    ts.sort(byTime);
    const job = ledger.get(id);
    const langfuse = ts.reduce((n, t) => n + (t.totalCost ?? 0), 0);
    const wk = share(fit, langfuse || job?.cost || 0, job?.model);
    return {
      ts,
      row: {
        ...(wk ? { wk } : {}),
        id,
        ...(job ? { label: job.name } : {}),
        project: projectOf(ts[0]),
        turns: ts.length,
        start: ts[0].timestamp as string,
        last: ts[ts.length - 1].timestamp as string,
        cost: langfuse || job?.cost || 0,
        taskTypes: taskTypes(ts),
      },
    };
  }).filter((x) => before === null || ms(x.row.last) < Date.parse(before))
    .sort((a, b) => ms(b.row.last) - ms(a.row.last)).slice(0, limit);
  const lf = need();
  return Promise.all(rows.map(async ({ ts, row }) => ({ ...row, firstPrompt: clip(text(await firstTyped(lf, ts)), 160) })));
}

/** The sessions of a scope for the Agents view: newest last turn first, `limit` of them before the `before` time, and `next`, the `before` of the next page. A bad page or a Langfuse failure throws its message. */
export async function listSessions({ days, project }: Pick<Scope, "days" | "project">, { limit = LIMIT, before = null }: { limit?: number; before?: string | null } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX) throw new Error(`limit must be 1 to ${MAX}`);
  if (before !== null && Number.isNaN(Date.parse(before))) throw new Error("before must be an ISO time");
  const lf = need();
  const { rows: all, partial } = await windowTraces(days, project);
  const sessions = await sessionRows(all, limit + 1, before); // one more than the page says whether there is a next
  const page = sessions.slice(0, limit), next = sessions.length > limit ? page.at(-1)!.last : null;
  return { base: lf.base, projects: Object.keys(loadRegistry()).sort(), sessions: page, next, partial };
}
