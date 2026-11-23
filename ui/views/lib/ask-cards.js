// The parts of a card, and the Ask card that Status, Automation and an issue page show. Pure string functions, no DOM.
import { actMessages, openDiffs, reasonOf } from "./decisions.js";
import { clock, dur, span, when } from "./format.js";
import { actButton, fold, codeText, diffHtml, esc, idLink, inputBox, meta, note, priorityBadge, repoIdLink, subHead, tag } from "./html.js";
import { shortText, shortId, jobHref, parseId } from "../../../lib/naming.ts";

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

/** The meta row, line 1 of every card: id, status chip, priority chip, "n/m", date, duration. `chips` is HTML. */
export function metaRow({ id, chips, part, at, since, now, end }) {
  return `<div class="ih">${id}${chips}${partLink(part)}<span class="num date">${esc(when(at))}</span><span class="num dur">${esc(span(since, end ?? now))}</span></div>`;
}

/** The Ask card structure: the article with `cls` and `attrs`, then the box with `meta`, the fold of `label`, `title` and `tag` over `desc`, and `rest`. */
export const askShell = (cls, attrs, key, meta, label, title, tag, desc, rest) =>
  `<article class="job-card small issue-row ${cls}" ${attrs}>` +
  `<div class="ask-box">${meta}${fold(`<span class="ask-dot" aria-hidden="true"></span><span class="t"><b class="ask-kind">${esc(label)}:</b> <span class="ask-title">${esc(title)}</span></span>${tag ? `<span class="ask-tag">${esc(tag)}</span>` : ""}`, desc, { cls: "ask-fold", keep: `ask:${key}`, head: "ask-head" })}${rest}</div></article>`;

/** The options, recommended mark and context of a decision with fields; `mark` is false when a choice already carries the mark. */
function decisionBody(d, mark, repo) {
  const say = (t) => codeText(shortText(t, repo));
  return `<p class="dq">${say(d.question)}</p>` +
    `<ul class="opts">${d.options.map((o) => `<li${mark && o.label === d.recommended ? ' class="rec"' : ""}><b>${say(o.label)}</b>${mark && o.label === d.recommended ? ` ${tag("Recommended", "run")}` : ""} <span class="line">${say(o.line)}</span></li>`).join("")}</ul>` +
    (d.why?.length ? `<ul class="why">${d.why.map((w) => `<li>${say(w)}</li>`).join("")}</ul>` : "");
}

const isUrl = (u) => /^https?:\/\//.test(u);

/** One button of an ask row: the request it posts as data attributes; `name` keys the row's message, `kind` sizes it. */
function actionButton(a, name, kind) {
  return actButton(a.label, { act: a.act, path: a.path, body: JSON.stringify(a.body ?? {}), ...(a.confirm ? { confirm: "1" } : {}), ...(name ? { name } : {}), label: a.label }, { primary: a.primary, kind });
}

/** The Technical details of an ask card: what the limits moved out, the raw note, the options, the signals, the stat and the review note. Closed until opened. */
function askDetails(i) {
  const d = i.details ?? {};
  const isRun = i.key?.startsWith("run:");
  const sig = (d.signals ?? []).map((g) => `<li>${esc(when(g.at))} ${esc(g.source)}: ${esc(g.quote)}${isUrl(g.link) ? ` <a href="${esc(g.link)}">link</a>` : ""}</li>`).join("");
  const body = (i.more ?? []).map((t) => note(shortText(t, i.repo))).join("") +
    (d.note ? note(shortText(d.note, i.repo)) : "") +
    (d.ask ? decisionBody(d.ask, !(i.actions ?? []).some((a) => a.recommended), i.repo) : "") +
    (sig ? `<ul>${sig}</ul>` : "") +
    (d.review ? note(`Reviewer: ${d.review.call}${d.review.reason ? `: ${d.review.reason}` : ""}`) : "") +
    (d.stat ? `<div class="ev one"><div>${subHead("Diff")}<pre class="stat">${statLines(d.stat)}</pre></div></div>` : "") +
    (isRun ? `<div class="actions">${actButton("Diff", { act: "diff", name: i.id, label: "Diff" })}</div><div class="diff-panel" data-diff-for="${esc(i.id)}"${openDiffs.has(i.id) ? `>${diffHtml(openDiffs.get(i.id))}` : " hidden>"}</div>` : "");
  return body ? fold("Technical details", `<div class="body">${body}</div>`, { cls: "more", keep: `more:${i.key ?? i.id}` }) : "";
}


/** What the no-answer timeout does, as the card's verb. */
const DUE_VERB = { approve: "Approves", resolve: "Decides", continue: "Reruns", disapprove: "Drops", dismiss: "Drops", discontinue: "Drops" };

/** One choice of an Ask card: the button, then what it does and the recommended mark, shown when the card is open. */
const askChoice = (a, input, name) =>
  `<div class="choice${a.recommended ? " rec" : ""}">${actionButton(a, name)}<div class="choice-text"><span class="effect">${codeText(a.hint)}</span>${a.recommended ? '<span class="rec-note">Recommended</span>' : ""}${input}</div></div>`;

/**
 * An Ask card from a server `asks` entry. Compact: the meta row, the title (the kind, then the headline, and the tag
 * that names the stop) and the buttons. A click on the title opens it: the description, what each button does with
 * the recommended one marked, and Technical details, closed until opened. Choices in order: positive, positive [auto-yes], negative.
 * @design ask-card
 */
export function askCard(i, now = new Date().toISOString()) {
  const acts = i.actions ?? [];
  const inputFor = (a) => {
    if (a.input?.name === "reason") {
      const p = parseId(i.id);
      const n = p ? `${p.n}${p.sub === undefined ? "" : `.${p.sub}`}` : "";
      return inputBox("reason", reasonOf(i.id), { attrs: ` class="reason" maxlength="200" placeholder="Reason (optional)" hidden aria-label="Reason to ${esc(a.act)} ${esc(i.id)}" data-repo="${esc(p?.repo ?? "")}" data-id="${esc(n)}" data-lead="${esc(a.input.lead ?? "")}"` });
    }
    return a.input ? inputBox(a.input.name, "", { attrs: ` class="reason" maxlength="500" placeholder="Answer" hidden aria-label="Answer for ${esc(i.id)}"` }) : "";
  };
  const name = i.key?.startsWith("run:") ? i.id : undefined;
  const choices = acts.map((a) => askChoice(a, inputFor(a), name));
  if (i.always) {
    const { reason: own, scope, risk } = i.always, kinds = own ? "" : [["project", i.repo], ["all", "All"]].filter(([, t]) => t);
    const pick = kinds ? `<select class="scope" aria-label="Scope of Always">${kinds.map(([k, t]) => `<option value="${esc(k === "project" ? `${i.reason}:${i.repo}` : i.reason)}"${k === scope ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>` : "";
    choices.splice(acts.length ? 1 : 0, 0, `<div class="choice"><span class="always-pick">${actButton(i.always.label, { act: "always", reason: own ?? i.reason, action: i.always.action, first: acts[0]?.act ?? "", label: i.always.label }, { kind: "always" })}${pick}</span><div class="choice-text"><span class="effect">${codeText(i.always.hint)}</span>${risk ? ` <span class="effect risk">${esc(risk)}</span>` : ""}</div></div>`);
  }
  const key = i.key ?? i.id, msg = i.key?.startsWith("run:") ? actMsg(i.id) : "";
  const idHtml = i.href ? repoIdLink(i.id, i.href, i.repo) : `<span class="id">${esc(i.id)}</span>`;
  const meta = metaRow({ id: idHtml, chips: i.priority ? priorityBadge(i.priority) : "", part: i.part, at: i.at, since: i.since, now });
  const desc = `<p class="situation">${esc(shortText(i.situation ?? i.problem, i.repo))}${i.escalated === false ? ' <span class="muted">With the director: it decides this Ask or sends it to the user with its case text.</span>' : ""}${i.due ? ` <span class="muted">${esc(DUE_VERB[i.dueAction?.split(":")[0]] ?? "Acts")} at ${esc(clock(i.due))} with no answer.</span>` : ""}</p>`;
  return askShell(esc(i.reason), `data-ask="${esc(i.id)}" data-annotate="${esc(shortId(i.id))}" data-card="${esc(i.card)}" data-reason="${esc(i.reason)}"`, key, meta, i.label, shortText(i.headline || i.title, i.repo), i.tag, desc,
    (choices.length || msg ? `<div class="actions choices">${choices.join("")}${msg}</div>` : "") + askDetails(i));
}

/**
 * A compact alert: the head of an Ask card on one line (its dot, kind, title, muted detail, tag and `side`, a wait or a
 * value), then `acts`, its small buttons. `card` colours it: approve, decide, unstick or need. `title` is HTML. `ask` is
 * the ID of the Ask it shows, which the router records once it is answered.
 * @design ask-card
 */
export const alertCard = ({ card, kind, title, detail = "", tag = "", side = "", acts = "", ask = "" }) =>
  `<article class="alert" data-card="${esc(card)}"${ask ? ` data-ask="${esc(ask)}"` : ""}><div class="ask-box"><div class="ask-head"><span class="ask-dot" aria-hidden="true"></span>` +
  `<span class="t" title="${esc(kind)}: ${title.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()}${detail ? ` ${esc(detail)}` : ""}"><b class="ask-kind">${esc(kind)}:</b> <span class="ask-title">${title}</span>${detail ? ` <span class="pdetail">${esc(detail)}</span>` : ""}</span>` +
  `${tag ? `<span class="ask-tag">${esc(tag)}</span>` : ""}${side ? `<span class="num">${esc(side)}</span>` : ""}</div>${acts ? `<div class="actions pacts">${acts}</div>` : ""}</div></article>`;

/** An Ask as a compact alert: its id and headline, how long it has waited, and its buttons but those that need a typed answer (a reason is optional), Always second. Its issue page has the full card. */
export function askAlert(i, now) {
  const acts = (i.actions ?? []).filter((a) => !a.input || a.input.name === "reason").map((a) => actionButton(a, i.key?.startsWith("run:") ? i.id : undefined, "small"));
  if (i.always) {
    const { reason: own, scope, action, label } = i.always;
    acts.splice(acts.length ? 1 : 0, 0, actButton(label, { act: "always", reason: own ?? (scope === "project" && i.repo ? `${i.reason}:${i.repo}` : i.reason), action, first: i.actions?.[0]?.act ?? "", label }, { kind: "small always" }));
  }
  const id = i.href ? idLink(shortText(i.id, i.repo), i.href) : `<span class="id">${esc(shortText(i.id, i.repo))}</span>`;
  return alertCard({ ask: i.id, card: i.card, kind: i.label, title: `${id} ${esc(shortText(i.headline || i.title, i.repo))}`, detail: shortText(i.situation ?? i.problem ?? "", i.repo), tag: i.tag, side: i.at ? dur((Date.parse(now) - Date.parse(i.at)) / 1000) : "", acts: acts.join("") + (i.key?.startsWith("run:") ? actMsg(i.id) : "") });
}
