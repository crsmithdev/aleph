// The feed rows and the findings list that more than one view draws: the Status page's Herald, the Monitor findings and the Design page.
import { clock, when } from "./format.js";
import { esc, fold, idLink, tag, tone } from "./html.js";

/** A finding as HTML: **text** and each number or percentage in bold; all other text escaped. */
export function findingHtml(text) {
  return esc(text).split(/\*\*(.+?)\*\*/).map((part, i) => i % 2 ? `<b>${part}</b>`
    : part.replace(/(&#?\w+;)|(\$?\d+(?:[.,]\d+)*%?)/g, (m, entity) => (entity ? m : `<b>${m}</b>`))).join("");
}

/**
 * The findings of a Monitor report as a numbered list, each through findingHtml().
 * @design findings-list
 */
export const findingsList = (findings) => `<ol class="findings">${findings.map((f) => `<li>${findingHtml(f)}</li>`).join("")}</ol>`;

/**
 * A feed row in two columns: the time (the clock, or the day), then the body's HTML. `cls` is added to the row's class, `bodyCls` to the body's, `by` is the actor, `attrs` more attributes.
 * @design feed-row
 */
export function feedRow({ tone, at, body, by, cls = "", bodyCls = "", attrs = "" }) {
  return `<div class="event-row ${tone}${cls}"${by === undefined ? "" : ` data-by="${esc(by)}"`}${attrs}>` +
    `<span class="event-time">${esc(at ? (clock(at) || when(at)) : "")}</span>` +
    `<span class="event-body${bodyCls}">${body}</span></div>`;
}

/** A row's or line's pieces (ui/herald.ts) as HTML: text escaped, an ID linked to its page, a run's mark in its span. */
const piecesHtml = (ps) => ps.map((p) => (typeof p === "string" ? esc(p) : p.mark ? `<span class="brief-mark">${esc(p.mark)}</span>` : idLink(p.id, p.to))).join("");
/** The pieces as text. */
const piecesText = (ps) => ps.map((p) => (typeof p === "string" ? p : p.mark ?? p.id)).join("");

/** A chip's tone: filing starts work and an ended routine changes no issue, so neither is a success. */
const CHIP_TONES = { filed: "quiet", ended: "quiet", closed: "done", started: "run" };
const chipTone = (word) => CHIP_TONES[word] ?? tone(word);
/** The state whose tone a status row's chip takes, by the tone of its verdict (lib/status-words.ts). */
const STATUS_STATES = { alert: "failed", warning: "waiting", ask: "waiting", fine: "done" };

/** A Herald row on one line: the time, the chip, the ID (one grid cell, with a routine run's kind, empty for a status row), then the text; `+N` is the count of lines in its fold, which holds the facts of its runs. */
export function eventRow(r) {
  const t = chipTone(STATUS_STATES[r.tone] ?? r.word);
  const line = r.sys ? `<span class="event-say">${piecesHtml(r.text)}</span>`
    : `<span class="event-line">${tag(r.word, t)}${r.id.length === 1 ? piecesHtml(r.id) : `<span>${piecesHtml(r.id)}</span>`}${r.text.length ? `<span class="event-title" title="${esc(piecesText(r.text))}">${piecesHtml(r.text)}</span>` : "<span></span>"}${r.more ? `<span class="event-more">+${r.more}</span>` : ""}</span>`;
  return feedRow({ tone: t, at: r.at, by: r.by, cls: r.sys ? " sys" : "", body: line });
}

/** An older line: the time, the label and the text, in the action's tone. */
const briefRow = (l) => `<div class="event-brief ${tone(l.action)}"><span class="event-time">${esc(clock(l.at) || when(l.at))}</span>` +
  `<span class="brief-label" title="${esc(l.label)}">${esc(l.label)}</span><span class="brief-text" title="${esc(piecesText(l.text))}">${piecesHtml(l.text)}</span></div>`;

/**
 * A Herald row of the server (ui/herald.ts), with its older lines in a fold named by the row's `fold`.
 * @design feed-row
 */
export const heraldRow = (r) => (r.lines.length ? fold(eventRow(r), `<div class="herald-older">${r.lines.map(briefRow).join("")}</div>`, { cls: "herald-group", id: r.fold }) : eventRow(r));
