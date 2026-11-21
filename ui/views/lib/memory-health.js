// The Health tab and the Needs-you strip of the Memory page. `m` is /api/memory with `processes` (/api/memory/processes)
// and `rows` (/api/memory/log). Offered: the recall hook or `aleph memory recall` returned the note to an agent.
// Offer dates start when the recall log does, so a note written before the first one may be unused or unrecorded.
import { noteHref } from "../../../lib/naming.ts";
import { quantile } from "../../../lib/windows.ts";
import { count, day, localMs, pct, plural, when } from "./format.js";
import { barList, barRow, card, dataTable, empty, esc, facts, heads, list, note, statCard, subHead, tag, tiles } from "./html.js";

const DAY = 86_400_000;
export const link = (title) => `<a href="${noteHref(title)}">${esc(title)}</a>`;
export const shortDay = (s) => (s ? day(localMs(String(s).slice(0, 10))) : "");
const age = (s, now = Date.now()) => Math.floor((now - localMs(String(s).slice(0, 10))) / DAY);
const tab = (t) => `#/memory?tab=${t}`;
/** Whether recall offered note `n` in the 7 days before `now`. */
export const offered = (n, now = Date.now()) => !!n.read && now - localMs(n.read) <= 7 * DAY;
/** The local day of a log row: a recall's `at` is a day, a write's an ISO time. */
export const dayOf = (at) => (at.length === 10 ? at : new Date(at).toLocaleDateString("en-CA"));
/** The local day `n` days before today. */
export const daysBack = (n, now = Date.now()) => new Date(now - n * DAY).toLocaleDateString("en-CA");
/** True for a log row that wrote an episode page, not a note. */
export const isEpisode = (r) => r.kind === "write" && r.why.startsWith("episode of");

/** Note writes in the 7 days to today, and the median and range of the three 7-day sums before them. */
export function writeWeeks(rows, now = Date.now()) {
  const days = rows.filter((r) => r.kind === "write" && !isEpisode(r)).map((r) => dayOf(r.at));
  const sum = (w) => days.filter((d) => d > daysBack(7 * w + 7, now) && d <= daysBack(7 * w, now)).length;
  const [week, ...before] = [0, 1, 2, 3].map(sum), sorted = [...before].sort((a, b) => a - b);
  return { week, median: sorted[1], lo: sorted[0], hi: sorted[2] };
}

/** The links to the cut core lines, the refusals, the unoffered reads and the notes far past their re-check, each only over its act-threshold. */
export function needItems(m) {
  const cut = Object.values(m.start ?? {}).reduce((n, s) => n + s.cut, 0), refused = m.lint?.refuse.length ?? 0;
  const unoffered = m.misses?.unoffered_reads ?? 0, late = (m.processes?.decay.stale ?? []).filter((s) => s.over > 30).length;
  // prettier-ignore
  const items = [
    [cut > 0, "start", "need", `${plural(cut, "core line")} cut`, tab("health"), "Shows when a core line is cut from a start context."],
    [refused > 0, "refused", "error", `${plural(refused, "note")} refused`, tab("health"), "Shows when lint refuses a note."],
    [unoffered > 10, "reads", "need", `${count(unoffered)} reads nobody offered`, tab("health"), "Shows when more than 10 wiki reads in 7 days had no offer in their turn."],
    [late > 0, "re-check", "need", `${plural(late, "note")} over 30 d late`, tab("health"), "Shows when a note is more than 30 days past its re-check date."],
  ].filter(([on]) => on);
  return items.map(([, k, t, text, href, tip]) => `<a href="${href}" title="${esc(tip)}">${tag(k, t)} ${esc(text)}</a>`);
}

/** The Needs-you strip of `needItems(m)`; nothing when none is over its threshold. */
export function needs(m, now = Date.now()) {
  const items = needItems(m);
  return items.length ? `<div class="mstrip" role="status"><b>Needs you</b>${items.join("")}</div>` : "";
}


function offerCard(ms, rows) {
  if (!ms) return card("Offer Quality", empty());
  const sizes = rows.filter((r) => r.kind === "recall").map((r) => r.titles.length).sort((a, b) => a - b);
  return card("Offer Quality", `<p><strong>${count(ms.unoffered_reads)}</strong> reads of a note nobody offered</p>` + facts([
    ["Recalls", count(ms.recalls)],
    ["Empty", `${count(ms.empty)} of ${count(ms.recalls)} (${pct(ms.empty_share * 100)})`],
    ["Reformulated", `${count(ms.reformulated)} turns`],
    ["Hook runs", `${count(ms.hook.runs)}: ${count(ms.hook.zero_candidates)} with no candidate, ${count(ms.hook.capped)} over 100`],
    ["Notes per offer", sizes.length ? `p50 ${count(quantile(sizes, 0.5))}, p95 ${count(quantile(sizes, 0.95))}, n=${count(sizes.length)}` : ""],
  ]), { aside: `${count(ms.days)} days` });
}

const emptyCard = (ms) => card("Empty Recalls", ms?.missed.length
  ? dataTable(heads(["Query", "When"]), ms.missed.map((x) => `<tr><td class="wide" title="${esc(x.query)}">${esc(x.query)}</td><td class="time">${esc(when(x.at))}</td></tr>`).join(""))
  : empty());

/** The notes by when recall last offered them, and the never-offered ones, oldest written first. */
function notOffered(notes, now = Date.now()) {
  if (!notes.length) return card("Not Offered in 7 Days", empty());
  const week = notes.filter((n) => offered(n, now)).length, never = notes.filter((n) => !n.read);
  const first = notes.map((n) => n.read).filter(Boolean).sort()[0] ?? "";
  const bars = barList([["Offered, 7 days", week], ["Earlier", notes.length - week - never.length], ["Never", never.length]].map(([k, v]) => barRow(esc(k), (v / notes.length) * 100, count(v))).join(""));
  const oldest = [...never].sort((a, b) => a.updated.localeCompare(b.updated)), top = oldest.slice(0, 8);
  const rows = top.map((n) => `<tr><td class="wide" title="${esc(n.title)}">${link(n.title)}</td><td>${esc(n.kind)}</td><td class="num">${n.updated ? `${count(age(n.updated, now))} d` : "–"}</td><td>${n.updated < first ? "review" : ""}</td></tr>`).join("");
  const more = oldest.length > top.length ? `<p class="hint"><a href="#/memory?fresh=never">${count(oldest.length - top.length)} more in Notes</a></p>` : "";
  return card("Not Offered in 7 Days", bars + (top.length ? dataTable(heads(["Note", "Kind", "Written", "Check"], ["Written"]), rows) + more : ""), { count: count(notes.length - week) });
}

/** What the start context of `scope` holds by part, the core lines it cut, and the kept ones to trim first. */
function startCard(m, scope = "aleph") {
  const all = Object.entries(m.start ?? {}), s = m.start?.[scope];
  if (!s) return card("Start Context", empty());
  const B = (n) => `${count(n)} B`, share = (n) => pct((n / s.bytes) * 100);
  const bars = barList(all.map(([k, x]) => barRow(esc(k), (x.bytes / x.budget) * 100, `${B(x.bytes)} / ${B(x.budget)}`)).join(""));
  const kept = s.core.filter((c) => c.kept), sum = (cs) => cs.reduce((n, c) => n + c.bytes, 0);
  const globals = kept.filter((c) => c.scope === "global"), own = kept.filter((c) => c.scope !== "global");
  const parts = [["MEMORY.md", s.memory], [`Global core lines · ${globals.length}`, sum(globals)], [`${scope[0].toUpperCase()}${scope.slice(1)} core lines · ${own.length}`, sum(own)], ["Tags and pointer", s.bytes - s.memory - sum(kept)]];
  const sent = dataTable(heads(["Part", "Bytes", "Share"], ["Bytes", "Share"]), parts.map(([k, n]) => `<tr><td>${esc(k)}</td><td class="num">${B(n)}</td><td class="num">${share(n)}</td></tr>`).join("") +
    `<tr><td><strong>Total sent</strong></td><td class="num"><strong>${B(s.bytes)}</strong></td><td class="num">${B(s.budget - s.bytes)} left</td></tr>`);
  const byTitle = new Map((m.notes ?? []).map((n) => [n.title, n]));
  const cut = s.core.filter((c) => !c.kept), offers = (c) => (byTitle.get(c.title)?.history ?? []).slice(-8).reduce((a, b) => a + b, 0);
  const cutRows = cut.map((c) => `<tr><td class="wide" title="${esc(c.title)}">${link(c.title)}</td><td class="num">${B(c.bytes)}</td><td class="time">${esc(byTitle.get(c.title)?.updated ?? "")}</td></tr>`).join("");
  const trim = [...kept].sort((a, b) => offers(a) - offers(b) || String(byTitle.get(a.title)?.updated).localeCompare(String(byTitle.get(b.title)?.updated))).slice(0, 5);
  const trimRows = trim.map((c) => `<tr><td class="wide" title="${esc(c.title)}">${link(c.title)}</td><td class="num">${count(offers(c))}</td><td class="time">${esc(shortDay(byTitle.get(c.title)?.read) || "never")}</td><td class="time">${esc(byTitle.get(c.title)?.updated ?? "")}</td><td class="num">${B(c.bytes)}</td></tr>`).join("");
  return card("Start Context", bars + subHead(`What the ${scope} agent receives`) + sent +
    (cut.length ? subHead(`Cut lines, ${cut.length}`) + dataTable(heads(["Core line", "Bytes", "Updated"], ["Bytes"]), cutRows) : "") +
    (trim.length ? subHead("Trim first: fewest offers, then oldest") + dataTable(heads(["Core line", "Offers, 8 days", "Last offered", "Updated", "Bytes"], ["Offers, 8 days", "Bytes"]), trimRows) : ""), { aside: esc(scope) });
}

/** How to clear each lint rule; another rule shows its first finding's detail. */
const FIX = {
  stale: "re-check the note, then update its date", "relative-date": "replace “today” with the date",
  template: "add a claim, an as-of marker or a section", dangling: "fix or remove the link", untracked: "put it through aleph memory write",
};

/** Lint by rule, largest first, with how to fix each; then the notes past their re-check window, most overdue first. */
function lintCard(lint, stale) {
  const by = Map.groupBy([...lint.refuse.map((f) => ({ ...f, refused: true })), ...lint.warn], (f) => f.rule);
  const rules = [...by].sort((a, b) => b[1].length - a[1].length);
  const total = lint.refuse.length + lint.warn.length;
  const rows = rules.map(([rule, fs]) => `<tr><td><code>${esc(rule)}</code>${fs.some((f) => f.refused) ? " (refused)" : ""}</td><td class="num">${count(fs.length)}</td><td class="wide" title="${esc(FIX[rule] ?? fs[0].detail)}">${esc(FIX[rule] ?? fs[0].detail)}</td></tr>`).join("");
  const top = stale.slice(0, 6), most = Math.max(1, ...top.map((s) => s.over));
  const late = top.length ? subHead("Stale notes, most overdue first") + barList(top.map((s) => barRow(link(s.note), (s.over / most) * 100, `+${count(s.over)} d of ${count(s.window)}`)).join("")) +
    (stale.length > top.length ? note(`${stale.length - top.length} more`) : "") : "";
  return card("Lint", (total ? dataTable(heads(["Rule", "Findings", "Fix"], ["Findings"]), rows + `<tr><td><strong>Total</strong></td><td class="num"><strong>${count(total)}</strong></td><td></td></tr>`) : empty()) + late, { count: count(total) });
}

/** The Health tab's body: tiles, then offers, then the start context and lint. */
export function renderHealth(m, now = Date.now()) {
  const notes = m.notes ?? [], ms = m.misses, rows = m.rows ?? [], lint = m.lint ?? { refuse: [], warn: [] };
  const used = notes.filter((n) => offered(n, now)).length, never = notes.filter((n) => !n.read).length;
  const s = m.start?.aleph, w = writeWeeks(rows, now);
  const tileRow = tiles("Health", [
    statCard({ k: "Offered, 7 days", v: count(used), v2: count(notes.length), q: ["offered", "notes"] }),
    statCard({ k: "Never offered", v: count(never) }),
    statCard({ k: "Unoffered reads", v: count(ms?.unoffered_reads), note: "7 days" }),
    statCard({ k: "Start context", v: count(s?.cut), v2: count(s?.core.length), q: ["cut", "core lines"] }),
    statCard({ k: "Lint findings", v: count(lint.refuse.length + lint.warn.length), note: `${count(lint.refuse.length)} refused` }),
    statCard({ k: "Writes, 7 days", v: count(w.week), note: `median week ${count(w.median)}` }),
  ].join(""));
  return list(tileRow + `<div class="pair">${offerCard(ms, rows)}${emptyCard(ms)}</div>` +
    `<div class="pair">${notOffered(notes, now)}${lintCard(lint, m.processes?.decay.stale ?? [])}</div>${startCard(m)}`);
}
