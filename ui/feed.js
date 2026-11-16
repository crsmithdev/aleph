// The feed rows and the findings list that more than one view draws: the Status page's Herald, the Monitor findings and the Kit.
import { clock, esc, idLink, shortModel, tag, tone, when } from "./lib.js";
import { jobHref, shownId, issueHref, parseId, parseKey, say as sayParts } from "../lib/naming.ts";

/** A finding as HTML: **text** and each number or percentage in bold; all other text escaped. */
export function findingHtml(text) {
  return esc(text).split(/\*\*(.+?)\*\*/).map((part, i) => i % 2 ? `<b>${part}</b>`
    : part.replace(/(&#?\w+;)|(\$?\d+(?:[.,]\d+)*%?)/g, (m, entity) => (entity ? m : `<b>${m}</b>`))).join("");
}

/** The findings of a Monitor report as a numbered list, each through findingHtml(). */
export const findingsList = (findings) => `<ol class="findings">${findings.map((f) => `<li>${findingHtml(f)}</li>`).join("")}</ol>`;

/** A feed row in two columns: the time (the clock, or the day), then the body's HTML. `cls` is added to the row's class, `bodyCls` to the body's, `by` is the actor, `attrs` more attributes. */
export function feedRow({ tone, at, body, by, cls = "", bodyCls = "", attrs = "" }) {
  return `<div class="event-row ${tone}${cls}"${by === undefined ? "" : ` data-by="${esc(by)}"`}${attrs}>` +
    `<span class="event-time">${esc(at ? (clock(at) || when(at)) : "")}</span>` +
    `<span class="event-body${bodyCls}">${body}</span></div>`;
}

/** A piece of `say`: text escaped, a job ID linked to its job page, an issue ID to its issue page, any other ID as text. */
const saidHtml = (p, row) => {
  if (typeof p === "string") return esc(p);
  const repo = p.id === row.object ? row.project : undefined;
  const to = isJobId(p.id) ? jobHref(shownId(p.id)) : issueHref(p.id, repo);
  return idLink(shownId(p.id, repo), to);
};

/** An issue's subject (`aleph-2118`, `issue.2118`), not a routine's (`housekeeper`). */
export const isIssue = (subject) => Boolean(parseId(subject) || parseKey(subject)?.kind === "issue");
/** The leading verb of a sentence after its ID, with the words that only join it to the rest. */
const VERB = /^ ?(?:(?:is|has|asks|proposes|hit) |\S+(?: up| its checks)?(?: by| for| to)?(?::|$| ))\s*/;

/** What a routing event chose, "medium · sonnet · $0.00003", from its job's fields. An event with no such job has a note, "cost … model M tier T p P", read as "T · M · p P"; any other note as it is. */
export const routeText = (ev) => {
  if (ev.size) return [ev.size, ev.model, ev.cost !== undefined && `$${Number(ev.cost.toFixed(5))}`].filter(Boolean).join(" · ");
  const note = ev.note ?? "";
  const m = Object.fromEntries([...note.matchAll(/(\w+) (\S+)/g)].map(([, k, v]) => [k, v]));
  return m.tier ? `${m.tier} · ${shortModel(m.model)} · p ${m.p}` : note;
};

/** Whether an event is a routing choice: it names a size, or is a start whose note is the model, "model default" when routing picked no size. */
export const isRouting = (ev) => ev.size || (ev.action === "started" && /^model /.test(ev.note ?? ""));

/** What an event's own fields add to its row, as HTML: a routing event's choice. */
export const detail = (ev) => (ev.size ? `→ ${esc(routeText(ev))}` : "");

/** An event's sentence in two parts of HTML: its leading ID, and what follows the verb ("the factory is paused", "past its time box"). */
export function parts(ev) {
  // Adjacent text pieces as one, so the verb's colon and the reason after it ("failed", ": past its time box") read as one.
  const said = sayParts(ev.row).reduce((out, p) => (typeof p === "string" && typeof out.at(-1) === "string" ? [...out.slice(0, -1), out.at(-1) + p] : [...out, p]), []);
  const lead = typeof said[0] === "string" ? "" : saidHtml(said.shift(), ev.row);
  if (typeof said[0] === "string") said[0] = said[0].replace(VERB, "");
  return { lead, rest: said.map((p) => saidHtml(p, ev.row)).join("").trim() };
}

/** Whether `id` names a job: `a1878#2`, or the key `job.1878`. */
const isJobId = (id) => id.includes("#") || /^job\.\d+$/.test(id);

/** The job of an event, `a1878#2`, if it names one. */
export const jobOf = (ev) => ev.on?.find(isJobId);

/** The chip of an event: what happened, never who. A done closes an issue, or ends a routine's run; a start or a running run is "started". */
export function stateWord(ev) {
  if (ev.action === "done") return isIssue(ev.subject) ? "closed" : "ended";
  return ev.action === "started" || ev.action === "running" ? "started" : ev.action;
}
/** A chip's tone: filing starts work and an ended routine changes no issue, so neither is a success. */
const CHIP_TONES = { filed: "quiet", ended: "quiet", closed: "done", started: "run" };
const chipTone = (word) => CHIP_TONES[word] ?? tone(word);

/** An event's row on one line: the time, the chip, the ID (the issue, else the run's job), then the title, or `said` for a routine run, or what the sentence adds; `+N` is the count of rows in its fold. The facts of its runs are in the fold. */
export function eventRow(ev, titles = {}, more = 0, said = "") {
  const route = ev.action === "routed" && !ev.size;
  const { lead, rest } = route ? { lead: "", rest: "" } : parts(ev);
  const word = stateWord(ev), title = route ? "" : titles[ev.subject] ?? "", job = jobOf(ev);
  const id = isIssue(ev.subject) ? idLink(shownId(ev.subject, ev.project), issueHref(ev.subject, ev.project)) : job ? idLink(shownId(job), jobHref(job)) : lead;
  const text = said || title || (!isRouting(ev) && rest !== ev.action && rest);
  const line = route ? `<span class="event-say">${esc(routeText(ev))}</span>`
    : `<span class="event-line">${tag(word, chipTone(word))}${id}${text ? `<span class="event-title" title="${esc(title || text.replace(/<[^>]*>/g, ""))}">${title ? esc(title) : text}</span>` : "<span></span>"}${more ? `<span class="event-more">+${more}</span>` : ""}</span>`;
  return feedRow({ tone: chipTone(word), at: ev.at, by: ev.by, cls: route ? " sys" : "", body: line });
}
