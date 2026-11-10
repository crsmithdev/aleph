// The parts of a Status page card. Pure string functions, no DOM.
import { actButton, actMessages, dur, esc, jobHref, repoIdLink, when } from "../lib.js";

/** A job's id, linking to its page. */
export const itemId = (j) => repoIdLink(j.name, j.href || jobHref(j.id));
export const title = (j) => `<h3>${esc(j.item?.title || j.name)}</h3>`;
export const actMsg = (name) => (actMessages.has(name) ? `<span class="act-msg" role="alert">${esc(actMessages.get(name))}</span>` : "");
export const act = (verb, name, label, primary = false) => actButton(label, { act: verb, name, label }, { primary });
/** The checks of a run as fact rows: `Tests 71s ✓`. */
export const checkFacts = (j) =>
  (j.checks || []).map((c) => [c.name.charAt(0).toUpperCase() + c.name.slice(1), `${esc(dur(c.seconds))} ${c.ok ? "✓" : "✗"}`]);
/** "Oct 28 04:28" from a job folder id like 20261028-042822-aleph-aleph-240-agent: the id's own local time, as `when` shows it. */
const idStart = (m, now) => when(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])), new Date(now));
const KINDS = { land: "land", intake: "intake", director: "director" };
/** One trailer as text: Item shows its value alone; a Job ID (`a1375#6`) shows as it is, and an old Job folder id is parsed into its run kind and start; both link to the job page (raw id in the title). */
const trailer = (t, j, now) => {
  if (t.key === "Item") return esc(t.value);
  if (t.key === "Job" && /#\d+$/.test(t.value)) return `<a href="${esc(jobHref(t.value))}" title="${esc(t.value)}">${esc(t.value)}</a>`;
  const m = t.key === "Job" && /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)\d\d-.+-([a-z]+)$/.exec(t.value);
  if (!m) return `${esc(t.key)} ${esc(t.value)}`;
  return `<a href="${esc(jobHref(j.id))}" title="${esc(t.value)}">${esc(KINDS[m[6]] ?? m[6])}, ${esc(idStart(m, now))}</a>`;
};
/** The trailers of a job as one small line; empty when it has none. */
export const trailerLine = (j, now) =>
  j.trailers?.length ? `<p class="trailers-line">${j.trailers.map((t) => trailer(t, j, now)).join(" · ")}</p>` : "";
/** One card shell. */
export const shell = (size, cls, inner, tag = "article") => `<${tag} class="job-card ${size} ${cls}">${inner}</${tag}>`;
