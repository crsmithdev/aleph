// The Hooks page: List (one row per hook, the 3 that hold first, each with its outcomes; the inspector shows one hook),
// Holds (the holds log by hook, the verify gate's denials among them) and Errors (the hook errors by cause). README, Pages.
import { barList, barRow, cell, chip, chips, codeText, dataTable, esc, heads, idLink, legendHtml, meter, row, statusRow, subHead, tag } from "../../../../ui/views/lib/html.js";
import { count, day, dur, plural, when } from "../../../../ui/views/lib/format.js";
import { factsLine, inspector, list, LIVE, now, type Data, type Group, type Page, type Row } from "../kit.ts";

// A hold's outcome, the useful first, as the live page has them (ui/views/hooks.js, OUTS): key, meter class, badge tone.
// prettier-ignore
const OUTS = [
  ["caught",    "o-caught",  "done"],
  ["handoff",   "o-handoff", "done"],
  ["held up",   "o-held",    "quiet"],
  ["false",     "o-false",   "error"],
  ["no reply",  "o-none",    "need"],
  ["no effect", "o-dead",    "parked"],
];
/** A hold's kind as the live page names it (ui/views/hooks.js, KIND). */
const KIND: Record<string, string> = { "unbacked hash": "hash", "doc-claim": "doc claim", "new-copy": "new copy", "boundary+new-copy": "both", "compacted, handoff": "compacted" };
const kindName = (k: string) => KIND[k] ?? k;
const outTag = (out: string) => tag(out, OUTS.find((o) => o[0] === out)![2]);
const hookHref = (h: any) => `${LIVE}#/hooks/${encodeURIComponent(h.event)}/${encodeURIComponent(h.name)}`;
/** A name in title case, for a group head: "verify gate" is "Verify Gate". */
const titled = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const at = (d: Data) => new Date(now(d));

/** The outcomes of a hook's holds, summed over its kinds. */
const outcomes = (d: Data, name: string) => {
  const by: Record<string, number> = {};
  for (const g of d.hooks.byHook.filter((g: any) => g.hook === name)) for (const [k, n] of Object.entries<number>(g.outcomes)) by[k] = (by[k] ?? 0) + n;
  return by;
};
/** The outcome strip of a row: one meter of the outcomes, its numbers in the tooltip, not beside it (README, Decision 5). */
const strip = (by: Record<string, number>, holds: number) =>
  `<span class="rt-hooks-out">${meter(OUTS.map(([k, cls]) => ({ pct: (100 * (by[k] ?? 0)) / holds, cls })), OUTS.filter(([k]) => by[k]).map(([k]) => `${k} ${by[k]}`).join(", "))}</span>`;
/** The error causes that name this hook on its event. A cause counts its errors, not each hook's, so a hook gets the cause, not a number. */
const causesOf = (d: Data, h: any) => d.hooks.errors.filter((e: any) => e.hooks.includes(h.name) && e.events.includes(h.event));

/** The inspector of one hook: its facts, its outcomes and kinds, its newest holds and its error causes. */
function inspectHook(h: any, d: Data) {
  const by = outcomes(d, h.name), kinds = d.hooks.byHook.filter((g: any) => g.hook === h.name), causes = causesOf(d, h);
  const latest = d.hooks.log.filter((x: any) => x.hook === h.name).slice(0, 2);
  const kv: [string, string][] = [
    ["Matcher", h.matcher ? codeText(`\`${h.matcher}\``) : `<span class="quiet">all</span>`], ["File", codeText(`\`${h.file}\``)], ["Mode", esc(h.mode)],
    ["Timeout", esc(dur(h.timeout))], ["Workers", esc(h.workers)], ["Holds", h.holds ? esc(count(h.holds)) : ""],
    ["Changed", h.changed ? `${esc(day(h.changed.t, at(d)))} <span class="idp" title="${esc(h.changed.subject)}">${esc(h.changed.hash)}</span>` : ""],
  ];
  const outs = h.holds ? `${subHead("Outcomes")}${barList(OUTS.filter(([k]) => by[k]).map(([k, cls]) => barRow(esc(k), 0, count(by[k]), { bar: meter([{ pct: (100 * by[k]) / h.holds, cls }], "") })).join(""))}` : "";
  const kindTable = kinds.length > 1 ? `${subHead("Kinds")}<div class="rt-hooks-kinds">${dataTable(heads(["Kind", "Holds", "Interactive", "Workers"], ["Holds", "Interactive", "Workers"]),
    kinds.map((g: any) => row([cell(kindName(g.kind)), cell(count(g.holds), { num: true }), cell(count(g.interactive), { num: true }), cell(count(g.workers), { num: true })])).join(""))}</div>` : "";
  const newest = latest.length ? `${subHead("Newest Holds")}<ul>${latest.map((x: any) => `<li>${outTag(x.out)} <span class="idp">${esc(when(x.t, at(d)))}</span><p class="rt-clip">${esc(x.why)}</p></li>`).join("")}</ul>` : "";
  const errs = causes.length ? `${subHead("Errors")}<ul>${causes.map((e: any) => `<li>${esc(e.cause)} <span class="quiet">${esc(count(e.n))} · ${esc(e.fix || "no fix")}</span></li>`).join("")}</ul>` : "";
  return inspector({ id: h.event, title: h.name, rows: kv, body: outs + kindTable + newest + errs, href: hookHref(h) });
}

/** One hook as a row: its name and only what differs from the defaults (no `sync`, no `runs`), its outcomes, holds and error causes. */
function hookRow(h: any, d: Data, event: boolean): Row {
  const causes = causesOf(d, h);
  const main = `<span class="t">${esc(h.name)}</span>${event ? chip(h.event) : ""}${h.matcher ? codeText(`\`${h.matcher}\``) : ""}${h.mode ? chip(h.mode) : ""}${h.workers === "skips" ? chip("skips workers") : ""}`;
  const errs = causes.length ? `<span class="quiet" title="${esc(causes.map((e: any) => e.cause).join(", "))}">${esc(plural(causes.length, "cause"))}</span>` : "";
  return {
    key: `${h.event}/${h.name}`, lead: "", main, inspect: inspectHook(h, d), data: { workers: h.workers },
    cells: [h.holds ? strip(outcomes(d, h.name), h.holds) : "", h.holds ? esc(count(h.holds)) : "", errs], text: `${h.event} ${h.name} ${h.file} ${h.matcher}`,
  };
}

const STYLE = `<style>.rt-hooks-out { display: inline-flex; width: 140px; vertical-align: middle; }
.rt-hooks-out .meter { flex: 1; }
/* The inspector is a flex column, and a table's scroll box would shrink to nothing in it. */
.rt-hooks-kinds { flex: none; }
/* A group's last line is a subgrid row: one span over every column keeps the lead column narrow. */
.rt-hooks-more { grid-column: 1 / -1; flex: 1 1 100%; }
.rt-hooks-key { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--sp-6) var(--sp-14); }</style>`;

function listView(d: Data) {
  const H = d.hooks, inv = H.inventory, o = H.outcomes;
  const holding = inv.filter((h: any) => h.holds).sort((a: any, b: any) => b.holds - a.holds), rest = inv.filter((h: any) => !h.holds);
  // 13 events hold one hook each: a group per event made the list 1931 px tall at 1440 px.
  const events = [...Map.groupBy(rest, (h: any) => h.event)], shared = events.filter(([, hs]) => hs.length > 1), lone = events.filter(([, hs]) => hs.length === 1).map(([, hs]) => hs[0]);
  const groups: Group[] = [
    { title: "Hold", count: count(holding.length), heads: ["Outcomes", "Holds", "Errors"], rows: holding.map((h: any) => hookRow(h, d, true)) },
    ...shared.map(([e, hs]): Group => ({ title: e, count: count(hs.length), heads: ["", "", ""], rows: hs.map((h: any) => hookRow(h, d, false)) })),
    { title: "Other", count: count(lone.length), heads: ["", "", ""], rows: lone.map((h: any) => hookRow(h, d, true)) },
  ];
  const key = legendHtml(OUTS.map(([k, cls]) => [k, cls]));
  return STYLE + `<div class="rt-hooks-key">${factsLine([[count(H.holds), "holds"], [count(o.caught), "caught"], [count(o.false), "false"], [count(o["no effect"]), "no effect"]])}${key}</div>` +
    list({ label: "Hooks", search: "Search hooks", filters: [{ label: "Workers", name: "workers", options: ["runs", "skips"] }], groups });
}

/** The inspector of one hold: its outcome, its session and the hook's reply. */
const inspectHold = (x: any, d: Data) => inspector({
  id: x.sid, title: `${x.hook} · ${kindName(x.kind)}`, status: statusRow(outTag(x.out), x.who === "interactive" ? "" : chip(x.who), ""),
  rows: [["When", esc(when(x.t, at(d)))], ["Session", idLink(x.sid, `${LIVE}#/sessions/${x.sid}`)], ["Who", esc(x.who)]],
  body: `${subHead("Reason")}<p>${esc(x.why)}</p>`, href: `${LIVE}#/sessions/${x.sid}`,
});

function holdsView(d: Data) {
  const H = d.hooks, inv = H.inventory.filter((h: any) => h.holds).sort((a: any, b: any) => b.holds - a.holds);
  const groups: Group[] = inv.map((h: any) => {
    const xs = H.log.filter((x: any) => x.hook === h.name);
    // The kind most of the hook's holds have is its default, so a row names only another kind (README, Decision 6).
    const usual = [...Map.groupBy(xs, (x: any) => x.kind)].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
    return {
      title: titled(h.name), count: count(h.holds), heads: ["", "Outcome"], more: `${count(xs.length)} of ${count(h.holds)}`,
      rows: xs.map((x: any): Row => ({
        key: `${x.t}/${x.hook}`, lead: `<span class="idp">${esc(when(x.t, at(d)))}</span>`, inspect: inspectHold(x, d), data: { out: x.out, who: x.who },
        main: `<span class="t" title="${esc(x.why)}">${esc(x.why)}</span>${x.kind !== usual ? chip(kindName(x.kind)) : ""}`,
        cells: [x.who === "interactive" ? "" : chip(x.who), outTag(x.out)], text: `${x.sid} ${x.hook} ${x.kind} ${x.why}`,
      })),
    };
  });
  return factsLine([[count(H.holds), "holds"], [count(H.who.interactive), "interactive"], [count(H.who.workers), "workers"]]) +
    list({ label: "Holds", search: "Search holds", filters: [{ label: "Outcome", name: "out", options: OUTS.map(([k]) => k) }, { label: "Who", name: "who", options: [...new Set<string>(H.log.map((x: any) => x.who))] }], groups });
}

function errorsView(d: Data) {
  const H = d.hooks, n = H.errors.reduce((s: number, e: any) => s + e.n, 0);
  const groups: Group[] = H.errors.map((e: any) => ({
    title: e.cause, count: count(e.n), heads: ["Events"],
    more: `<span class="rt-hooks-more">${e.fix ? `Fix: ${esc(e.fix)}` : "No fix"} · ${esc(plural(e.sessions, "session"))} · last ${esc(when(e.last, at(d)))}</span>`,
    rows: e.hooks.map((name: string): Row => {
      // A hook the cause names but hooks.json does not hold is gone: its file moved or the hook was cut.
      const own = H.inventory.filter((h: any) => h.name === name && e.events.includes(h.event)), gone = !H.inventory.some((h: any) => h.name === name);
      const events = gone ? e.events : own.map((h: any) => h.event);
      return {
        key: `${e.cause}/${name}`, lead: "", text: `${e.cause} ${name} ${events.join(" ")}`,
        main: `<span class="t">${esc(name)}</span>${gone ? tag("not in hooks.json", "need") : ""}`, cells: [esc(events.join(", "))],
        inspect: inspector({
          id: e.cause, title: name, href: own[0] ? hookHref(own[0]) : `${LIVE}#/hooks`,
          rows: [["Errors", esc(count(e.n))], ["Sessions", esc(count(e.sessions))], ["Last", esc(when(e.last, at(d)))], ["Fix", e.fix ? esc(e.fix) : `<span class="quiet">none</span>`], ["Events", esc(events.join(", "))]],
          body: `${subHead("Same Cause")}${chips(e.hooks.filter((x: string) => x !== name))}`,
        }),
      };
    }),
  }));
  return factsLine([[count(n), "errors"], [count(H.errors.length), "causes"], [count(H.errors.filter((e: any) => e.fix).length), "with a fix"]]) +
    list({ label: "Errors", search: "Search errors", groups });
}

export const page: Page = {
  id: "hooks", title: "Hooks", group: "Claude", order: 7, icon: "plug", route: "hooks",
  views: [{ id: "list", label: "List", draw: listView }, { id: "holds", label: "Holds", draw: holdsView }, { id: "errors", label: "Errors", draw: errorsView }],
  attention: (d) => {
    const errs = d.hooks.errors, n = errs.reduce((s: number, e: any) => s + e.n, 0);
    const top = [...errs].sort((a: any, b: any) => b.n - a.n)[0];
    return n ? [{ tone: "error" as const, text: `${count(n)} hook errors, ${count(top.n)} from a ${top.cause.toLowerCase()}`, act: { label: "Errors", href: "hooks.html#errors" } }] : [];
  },
};
