// The Herald's event rows, built on the server from event rows and the maps they need: /api/factory sends them, the `ev` stream sends them
// again when an event is added, and the terminal panel (herdr/status.ts) reads them. The page only draws them.
// An issue's rows are one per attempt (`attempts`: the first job of a job's `prev` chain), its older events in the fold;
// a routine's run is one row that says "N changes", each change a line in its fold. Every event is in a row or a fold line.
import { EDITS, factsOf, issueHref, jobHref, parseId, parseKey, runWord, sayRest, shownId, targetOf, whoOf, wordOf, type EventRow } from "../lib/naming.ts";
// @ts-ignore plain JS, shared with the page
import { dur } from "./views/lib/format.js";
import { money } from "../lib/money.ts";

/** A piece of a line: text, an ID with the address of its page, or the mark of a run's result. */
type Piece = string | { id: string; to: string } | { mark: string };
/** One line of a row's fold: its time, the action (which sets its tone), its label and its text. */
export interface Line { at: string; action: string; label: string; text: Piece[] }
/** A row of the Herald: the newest event of its group with the older ones in `lines`. `key` names the row for a redraw; `fold` names its fold. */
export interface Row {
  key: string; fold?: string; at: string; by: string;
  /** A routing choice: a system row of its text only. */
  sys?: true;
  /** What happened, never who: the chip's word. */
  word: string;
  /** A status row: the verdict's tone, which the chip takes. */
  tone?: string;
  /** The ID that leads the row: its issue, else its job. */
  id: Piece[];
  text: Piece[];
  /** The count of lines in the fold. */
  more: number;
  lines: Line[];
}
/** What the rows name besides the events: each issue's title by its target, each run's kind by its job, each job's attempt, each housekeeper run's reviewed count. */
export interface Context { titles: Record<string, string>; runs: Record<string, string>; attempts: Record<string, string>; reviewed: Record<string, number> }

const MARK: Record<string, string> = { passed: "✓", landed: "✓", done: "✓", failed: "✗", returned: "✗", dropped: "✗" };

const isJobId = (id: string) => parseKey(id)?.kind === "job";
const isIssue = (t: string) => Boolean(parseId(t) || parseKey(t)?.kind === "issue");
const jobOf = (e: EventRow) => (isJobId(e.object) ? e.object : undefined);
/** A line's pieces as text. */
export const plain = (ps: Piece[]) => ps.map((p) => (typeof p === "string" ? p : "id" in p ? p.id : p.mark)).join("");
/** A short hash of a text, to key a row by its text. */
const hash = (t: string) => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0).toString(36);

/** What happened, never who. A done closes an issue, or ends a routine's run; a start or a running run is "started". */
const stateWord = (e: EventRow) => (e.action === "done" ? (isIssue(targetOf(e)) ? "closed" : "ended") : e.action === "started" || e.action === "running" ? "started" : e.action);

const issuePiece = (issue: string, project?: string | null): Piece => ({ id: shownId(issue, project), to: issueHref(issue, project) });

/** What a routing event chose, "medium · sonnet · $0.50", from its job's fields, then the classifier that chose it: "small · classifier jev-1.13". */
const routeText = (e: EventRow) => [e.size, e.model, e.cost != null && money(e.cost), wordOf(e) === "classifier" && `classifier ${factsOf(e)}`].filter(Boolean).join(" · ");

/** Whether an event is a routing choice: it names a size, or is a start whose detail is `model: <model>`, "default" when routing picked no size. */
const isRouting = (e: EventRow) => Boolean(e.size) || (e.action === "started" && wordOf(e) === "model");

/** An event's sentence in two parts: its leading ID, and what follows the verb ("the factory is paused", "past its time box"). */
function parts(e: EventRow): { lead: Piece[]; rest: Piece[] } {
  const bit = (p: string | { id: string }): Piece => {
    if (typeof p === "string") return p;
    const repo = p.id === e.object ? e.project : undefined;
    return { id: shownId(p.id, repo), to: isJobId(p.id) ? jobHref(shownId(p.id)) : issueHref(p.id, repo) };
  };
  // Adjacent text pieces as one, so a reason's colon and its words ("main is red", ": ", "x") read as one.
  const said = sayRest(e).reduce<(string | { id: string })[]>((out, p) => (typeof p === "string" && typeof out.at(-1) === "string" ? [...out.slice(0, -1), out.at(-1) + p] : [...out, p]), []);
  const lead = [bit({ id: e.object })];
  const rest = said.map(bit).filter((p) => p !== "");
  if (typeof rest[0] === "string") rest[0] = rest[0].trimStart();
  if (typeof rest.at(-1) === "string") rest[rest.length - 1] = (rest.at(-1) as string).trimEnd();
  return { lead, rest: rest.filter((p) => p !== "") };
}

/** A job's facts after its mark: for a build, the size it was routed to and the model it ran on, both from its start's event, then a land's commit, its time and its cost. `all` is the group's events, newest first. */
function jobFacts(e: EventRow, job: string, run: string, all: EventRow[]): string {
  // The job's first start: the gate logs it again as the run moves on after its result.
  const start = all.findLast((x) => x.action === "running" && jobOf(x) === job && x.time <= e.time);
  const picked = start && run === "build" ? all.find((x) => x.time <= start.time && x.action === "started" && wordOf(x) === "model") : undefined;
  const took = start && e !== start ? dur((Date.parse(e.time) - Date.parse(start.time)) / 1000) : "";
  return [picked?.size, picked && factsOf(picked), e.commit_sha && e.commit_sha.slice(0, 7), took, e.cost != null && money(e.cost)].filter(Boolean).join(" · ");
}

/** An older event as a line: a run's kind, then its linked job ID, its mark and its facts; or the chip word and what the sentence adds. `all` is the group's events, newest first. */
function brief(e: EventRow, runs: Record<string, string>, all: EventRow[]): Line {
  const job = jobOf(e), kind = job && runs[job], tgt = targetOf(e), line = (label: string, text: Piece[]): Line => ({ at: e.time, action: e.action, label, text });
  if (e.action === "routed") return line("routed", [routeText(e)]);
  if (e.action === "stalled") return line("", [`stalled ${shownId(tgt, e.project)}${kind ? ` · ${runWord(kind)}` : ""}`]);
  const { lead, rest } = parts(e), more = e.size ? [` → ${routeText(e)}`] : [];
  if (job && kind) {
    const fx = jobFacts(e, job, kind, all);
    return line(runWord(kind), [{ id: shownId(job), to: jobHref(job) }, " ", MARK[e.action] ? { mark: MARK[e.action] } : e.action, ...(rest.length ? [" ", ...rest] : []), ...(fx ? [` ${fx}`] : []), ...more]);
  }
  // The group already names its issue, so a line whose sentence adds only the actor says who did it.
  const by = whoOf(e.subject, e.subject_role);
  // An Ask's answer: its reason and answer, then who answered; with no answer, only the reason.
  if (e.action === "answered" && e.detail && isIssue(tgt)) return line("answered", [factsOf(e) ? `${e.detail} · by ${e.subject === "rule" ? "an Always rule" : by}` : e.detail]);
  return line(stateWord(e), [...(isIssue(tgt) && (!rest.length || plain(rest) === by) ? [`by ${by}`] : rest.length ? rest : lead), ...more]);
}

/** The lines of a group's fold, newest first: its events but a head with no run and no detail, which its row says; no start of a job with another event, nor of a run kind with a newer one, and no routing or start of an issue that a later job start draws as that job's facts. */
function briefs(all: EventRow[], runs: Record<string, string>): Line[] {
  const drawn = (e: EventRow) => (e.action === "routed" || e.action === "started") && all.some((x) => x.action === "running" && jobOf(x) && x.time >= e.time);
  // The gate can log a job's start after its result, so any other event of the job hides the start.
  const ended = new Set(all.filter((e) => e.action !== "running").map(jobOf));
  const seen = new Set<string | undefined>(), out: Line[] = [];
  for (const e of all) {
    const job = jobOf(e), kind = job && runs[job];
    if (e === all[0] && !isRouting(e) && !kind && (!e.detail || e.action === "routed")) continue;
    if (e.action === "running" && job && (ended.has(job) || (kind && seen.has(kind)))) continue;
    if (drawn(e)) continue;
    seen.add(kind);
    out.push(brief(e, runs, all));
  }
  return out;
}

/** The row of a head event: the chip, the ID (a routine run's kind before its job), then the title, or `said` for a routine run, or what the sentence adds; `more` is the count of lines in its fold. */
function rowOf(head: EventRow, ctx: Context, key: string, lines: Line[], more: number, said = "", fold?: string): Row {
  const route = head.action === "routed" && !head.size, tgt = targetOf(head), job = jobOf(head);
  const { lead, rest } = route ? { lead: [], rest: [] } : parts(head), title = route ? "" : ctx.titles[tgt] ?? "";
  const id = isIssue(tgt) ? [issuePiece(tgt, head.project)] : job ? [...(ctx.runs[job] ? [`${runWord(ctx.runs[job])} `] : []), { id: shownId(job), to: jobHref(job) }] : lead;
  const text: Piece[] = route ? [head.detail ?? ""] : said ? [said] : title ? [title] : !isRouting(head) && plain(rest) !== head.action ? rest : [];
  return { key, ...(fold ? { fold } : {}), at: head.time, by: head.subject, ...(route ? { sys: true as const } : {}), word: stateWord(head), id: route ? [] : id, text, more, lines };
}

/** The Herald's rows for `events` (oldest first), newest first. */
export function heraldRows(events: EventRow[], ctx: Context): Row[] {
  const issues = new Map<string, EventRow[]>(), routine = new Map<string, EventRow[]>(), first = new Map<string, string>(), status: EventRow[] = [];
  const add = (m: Map<string, EventRow[]>, k: string, e: EventRow) => m.set(k, [e, ...(m.get(k) ?? [])]);
  const attemptOf = (e: EventRow) => ctx.attempts[jobOf(e) ?? ""] ?? "";
  for (const e of events) if (isIssue(targetOf(e)) && attemptOf(e) && !first.has(targetOf(e))) first.set(targetOf(e), attemptOf(e));
  const runIds = new Set(events.filter((e) => !isIssue(targetOf(e)) && jobOf(e)).map(jobOf)), now = new Map(first);
  for (const e of events) {
    const tgt = targetOf(e);
    if (e.action === "status") status.push(e);
    else if (e.action === "changed" && runIds.has(e.subject)) add(routine, e.subject, e);
    else if (isIssue(tgt)) { now.set(tgt, attemptOf(e) || now.get(tgt) || ""); add(issues, `${tgt}${now.get(tgt) ? `:${now.get(tgt)}` : ""}`, e); }
    else if (jobOf(e)) add(routine, jobOf(e)!, e);
    else add(issues, tgt, e);
  }
  const runRows = [...routine].map(([job, evs]): Row => {
    const head = evs.find((e) => e.action !== "changed") ?? evs[0], changes = evs.filter((e) => e.action === "changed");
    const edit = (c: EventRow) => (Object.hasOwn(EDITS, wordOf(c)) ? (wordOf(c) as keyof typeof EDITS) : null);
    const lines = [...changes].reverse().map((c): Line => {
      const verb = edit(c), note = verb ? factsOf(c) : c.detail;
      return { at: c.time, action: c.action, label: verb ? EDITS[verb] : stateWord(c), text: [issuePiece(targetOf(c), c.project), ...(note ? [` ${note}`] : [])] };
    });
    const count = (v: string) => changes.filter((c) => edit(c) === v).length;
    const said = !changes.length ? "" : [ctx.reviewed[job] !== undefined && `reviewed ${ctx.reviewed[job]}`,
      ...(changes.every(edit) ? Object.keys(EDITS).filter(count).map((v) => `${EDITS[v as keyof typeof EDITS]} ${count(v)}`) : [`${changes.length} ${changes.length === 1 ? "change" : "changes"}`])].filter(Boolean).join(" · ");
    return rowOf(head, ctx, `event ${hash(`${head.time} ${head.subject} ${targetOf(head)} ${head.action} ${head.object}`)}`, lines, changes.length, said, lines.length ? `issue:${targetOf(head)}:${job}` : undefined);
  });
  const groupRows = [...issues].map(([k, evs]): Row => {
    const head = evs.find((e) => e.action !== "stalled") ?? evs[0];
    const lines = briefs([head, ...evs.filter((e) => e !== head)], ctx.runs);
    return rowOf(head, ctx, `issue:${k}`, lines, lines.length, "", lines.length ? `issue:${k}` : undefined);
  });
  // Each status change is a row of its own: its text is the verdict's sentence.
  const statusRows = status.map((e): Row => ({ key: `status ${hash(`${e.time} ${e.detail}`)}`, at: e.time, by: e.subject, word: e.action, tone: wordOf(e), id: [], text: [factsOf(e)], more: 0, lines: [] }));
  return [...groupRows, ...runRows, ...statusRows].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
