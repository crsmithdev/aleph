// The parts of a Status page card. Pure string functions, no DOM.
import { actMessages, esc, repoIdLink, when } from "../lib.js";

/** A job's id, linking to its page. */
export const itemId = (j) => repoIdLink(j.name, j.href || `#/jobs/${encodeURIComponent(j.name)}`, j.repo ?? "");
export const title = (j) => `<h3>${esc(j.item?.title || j.name)}</h3>`;
export const actMsg = (name) => (actMessages.has(name) ? `<span class="act-msg" role="alert">${esc(actMessages.get(name))}</span>` : "");
export const act = (verb, name, label, primary = false) =>
  `<button class="act${primary ? " primary" : ""}" type="button" data-act="${verb}" data-name="${esc(name)}" data-label="${esc(label)}">${esc(label)}</button>`;
export const fact = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
/** The checks of a run as facts: `Tests 71 s ✓`. */
export const checkFacts = (j) =>
  (j.checks || []).map((c) => fact(c.name.charAt(0).toUpperCase() + c.name.slice(1), `${esc(String(c.seconds))} s ${c.ok ? "✓" : "✗"}`)).join("");
/** "Oct 28 04:28" from a job folder id like 20261028-042822-aleph-aleph-240-agent: the id's own local time, as `when` shows it. */
const idStart = (m, now) => when(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])), new Date(now));
const KINDS = { agent: "agent run", land: "land", triage: "triage", plan: "planner", firefighter: "firefighter" };
/** One trailer as text: Item shows its value alone; a Job folder id is parsed into its run kind and start and links to the job page (raw id in the title). */
const trailer = (t, j, now) => {
  if (t.key === "Item") return esc(t.value);
  const m = t.key === "Job" && /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)\d\d-.+-([a-z]+)$/.exec(t.value);
  if (!m) return `${esc(t.key)} ${esc(t.value)}`;
  return `<a href="#/jobs/${encodeURIComponent(j.name)}" title="${esc(t.value)}">${esc(KINDS[m[6]] ?? m[6])}, ${esc(idStart(m, now))}</a>`;
};
/** The trailers of a job as one small line; empty when it has none. */
export const trailerLine = (j, now) =>
  j.trailers?.length ? `<p class="trailers-line">${j.trailers.map((t) => trailer(t, j, now)).join(" · ")}</p>` : "";
/** One card shell. */
export const shell = (size, cls, inner, tag = "article") => `<${tag} class="job-card ${size} ${cls}">${inner}</${tag}>`;
