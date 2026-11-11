// The parts of a card, and the Ask card that Status, Automation and an issue page show. Pure string functions, no DOM.
import { actButton, actMessages, fold, clock, codeText, denyReasons, diffHtml, dur, esc, inputBox, meta, note, openDiffs, priorityBadge, repoIdLink, span, subHead, tag, when } from "../lib.js";
import { shortText, shortId, jobHref, parseId } from "../../lib/naming.ts";

/** A job's id, linking to its page. */
export const itemId = (j) => repoIdLink(j.name, j.href || jobHref(j.id));
export const actMsg = (name) => (actMessages.has(name) ? `<span class="act-msg" role="alert">${esc(actMessages.get(name))}</span>` : "");
/** The checks of a run as fact rows: `Tests 71s ✓`. */
export const checkFacts = (j) =>
  (j.checks || []).map((c) => [c.name.charAt(0).toUpperCase() + c.name.slice(1), `${esc(dur(c.seconds))} ${c.ok ? "✓" : "✗"}`]);
/** "10/28 04:28" from a job folder id like 20261028-042822-aleph-aleph-240-agent: the id's own local time, as `when` shows it. */
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
  j.trailers?.length ? meta(j.trailers.map((t) => trailer(t, j, now))) : "";

const STAT_FILES = 12;

/** The first STAT_FILES file lines of a diff stat, then "+N more files" and the summary line. */
export function statLines(stat) {
  const all = stat.replace(/\n+$/, "").split("\n");
  const files = all.filter((l) => l.includes(" | "));
  if (files.length <= STAT_FILES) return esc(stat);
  const shown = new Set(files.slice(0, STAT_FILES));
  const kept = all.filter((l) => !l.includes(" | ") || shown.has(l));
  const summary = kept.filter((l) => !l.includes(" | "));
  return esc(kept.filter((l) => l.includes(" | ")).join("\n")) + `\n<b>+${files.length - STAT_FILES} more files</b>` + (summary.length ? "\n" + esc(summary.join("\n")) : "");
}

/** The "3/4" link of a part to its parent; "" for a card that is no part. */
const partLink = (p) => (p ? `<a class="part" href="${esc(p.href)}" title="Sub-issue ${p.n} of ${p.m} of ${esc(p.parent)}">${p.n}/${p.m}</a>` : "");

/** The meta row, line 1 of every card: id, status chip, priority chip, "n/m", date, duration, the hold. `chips` is HTML. */
export function metaRow({ id, chips, part, at, since, now, end, hold }) {
  return `<div class="ih">${id}${chips}${partLink(part)}<span class="num date">${esc(when(at))}</span><span class="num dur">${esc(span(since, end ?? now))}</span>${hold ? `<span class="blocked" title="${esc(hold)}">${esc(hold)}</span>` : ""}</div>`;
}

/** The Ask card structure: the article with `cls` and `attrs`, then the box with `meta`, the fold of `label`, `title` and `tag` over `desc`, and `rest`. */
export const askShell = (cls, attrs, key, meta, label, title, tag, desc, rest) =>
  `<article class="job-card small issue-row ${cls}" ${attrs}>` +
  `<div class="ask-box">${meta}${fold(`<span class="ask-dot" aria-hidden="true"></span><span class="t"><b class="ask-kind">${esc(label)}:</b> <span class="ask-title">${esc(title)}</span></span>${tag ? `<span class="ask-tag">${esc(tag)}</span>` : ""}`, desc, { cls: "ask-fold", keep: `ask:${key}`, head: "ask-head" })}${rest}</div></article>`;

/** The options, recommended mark and context of a decision with fields; `mark` is false when a choice already carries the mark. */
function decisionBody(d, mark) {
  return `<p class="dq">${codeText(d.question)}</p>` +
    `<ul class="opts">${d.options.map((o) => `<li${mark && o.label === d.recommended ? ' class="rec"' : ""}><b>${codeText(o.label)}</b>${mark && o.label === d.recommended ? ` ${tag("Recommended", "run")}` : ""} <span class="line">${codeText(o.line)}</span></li>`).join("")}</ul>` +
    (d.why?.length ? `<ul class="why">${d.why.map((w) => `<li>${codeText(w)}</li>`).join("")}</ul>` : "");
}

const isUrl = (u) => /^https?:\/\//.test(u);

/** One button of an ask row: the request it posts as data attributes; `name` keys the row's message. */
function actionButton(a, name) {
  return actButton(a.label, { act: a.act, path: a.path, body: JSON.stringify(a.body ?? {}), ...(a.confirm ? { confirm: "1" } : {}), ...(name ? { name } : {}), label: a.label }, { primary: a.primary });
}

/** The Technical details of an ask card: what the limits moved out, the raw note, the options, the signals, the stat and the review note. Closed until opened. */
function askDetails(i) {
  const d = i.details ?? {};
  const isRun = i.key?.startsWith("run:");
  const sig = (d.signals ?? []).map((g) => `<li>${esc(when(g.at))} ${esc(g.source)}: ${esc(g.quote)}${isUrl(g.link) ? ` <a href="${esc(g.link)}">link</a>` : ""}</li>`).join("");
  const body = (i.more ?? []).map((t) => note(shortText(t))).join("") +
    (d.note ? note(d.note) : "") +
    (d.ask ? decisionBody(d.ask, !(i.actions ?? []).some((a) => a.recommended)) : "") +
    (sig ? `<ul>${sig}</ul>` : "") +
    (d.review ? note(`Reviewer: ${d.review.call}${d.review.reason ? `: ${d.review.reason}` : ""}`) : "") +
    (d.stat ? `<div class="ev one"><div>${subHead("Diff")}<pre class="stat">${statLines(d.stat)}</pre></div></div>` : "") +
    (isRun ? `<div class="actions">${actButton("Diff", { act: "diff", name: i.id, label: "Diff" })}</div><div class="diff-panel" data-diff-for="${esc(i.id)}"${openDiffs.has(i.id) ? `>${diffHtml(openDiffs.get(i.id))}` : " hidden>"}</div>` : "");
  return body ? fold("Technical details", `<div class="body">${body}</div>`, { cls: "more", keep: `more:${i.key ?? i.id}` }) : "";
}


/** One choice of an Ask card: the button, then what it does and the recommended mark, shown when the card is open. */
const askChoice = (a, input, name) =>
  `<div class="choice${a.recommended ? " rec" : ""}">${actionButton(a, name)}<div class="choice-text"><span class="effect">${codeText(a.hint)}</span>${a.recommended ? '<span class="rec-note">Recommended</span>' : ""}${input}</div></div>`;

/**
 * An Ask card from a server `asks` entry. Compact: the meta row, the title (the kind, then the headline, and the tag
 * that names the stop) and the buttons. A click on the title opens it: the description, what each button does with
 * the recommended one marked, and Technical details, closed until opened. Choices in order: positive, positive [auto-yes], negative.
 */
export function askCard(i, now = new Date().toISOString()) {
  const acts = i.actions ?? [];
  const inputFor = (a) => {
    if (a.input?.name === "reason") {
      const p = parseId(i.id);
      const n = p ? `${p.n}${p.sub === undefined ? "" : `.${p.sub}`}` : "";
      return inputBox("reason", denyReasons.get(i.id), { attrs: ` class="reason" maxlength="200" placeholder="Reason (optional)" hidden aria-label="Reason to deny ${esc(i.id)}" data-repo="${esc(p?.repo ?? "")}" data-id="${esc(n)}" data-lead="${esc(a.input.lead ?? "")}"` });
    }
    return a.input ? inputBox(a.input.name, "", { attrs: ` class="reason" maxlength="500" placeholder="Answer" hidden aria-label="Answer for ${esc(i.id)}"` }) : "";
  };
  const name = i.key?.startsWith("run:") ? i.id : undefined;
  const choices = acts.map((a) => askChoice(a, inputFor(a), name));
  if (i.always) choices.splice(acts.length ? 1 : 0, 0, `<div class="choice">${actButton(i.always.label, { act: "always", reason: i.always.reason ?? i.reason, action: i.always.action, first: acts[0]?.act ?? "", label: i.always.label }, { kind: "always" })}<div class="choice-text"><span class="effect">${codeText(i.always.hint)}</span></div></div>`);
  const key = i.key ?? i.id, msg = i.key?.startsWith("run:") ? actMsg(i.id) : "";
  const idHtml = i.href ? repoIdLink(i.id, i.href, i.repo) : `<span class="id">${esc(i.id)}</span>`;
  const meta = metaRow({ id: idHtml, chips: i.priority ? priorityBadge(i.priority) : "", part: i.part, at: i.at, since: i.since, now });
  const desc = `<p class="situation">${esc(shortText(i.situation ?? i.problem))}${i.escalated === false ? ' <span class="muted">With the director: it decides this Ask or sends it to the user with its case text.</span>' : ""}${i.due ? ` <span class="muted">Lands at ${esc(clock(i.due))} with no answer.</span>` : ""}</p>`;
  return askShell(esc(i.reason), `data-annotate="${esc(shortId(i.id))}" data-kind="${esc(i.kind)}" data-card="${esc(i.card)}" data-reason="${esc(i.reason)}"`, key, meta, i.label, shortText(i.headline || i.title), i.tag, desc,
    (choices.length || msg ? `<div class="actions choices">${choices.join("")}${msg}</div>` : "") + askDetails(i));
}
