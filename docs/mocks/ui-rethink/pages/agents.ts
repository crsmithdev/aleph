// The Agents page: Roles (rows in three groups, each with its model, its switch and its success against the
// baseline) and Usage (the usage tile and the 3 charts that left the list, as a figure band and charts 2 across).
// README, Pages and "Agents, Roles".
import { barList, barRow, card, cell, dataTable, esc, heads, meter, row, selectBox, subHead } from "../../../../ui/views/lib/html.js";
import { cardPct, count, day, dur, hours, money, pct, shortModel } from "../../../../ui/views/lib/format.js";
import { MODEL_ORDER } from "../../../../ui/views/factory-agents.js";
import { NAMES } from "../../../../lib/naming.ts";
import { band, charts, columns, factsLine, inspector, legend, lines, list, LIVE, now, type Data, type Group, type Page, type Row, type Series } from "../kit.ts";

const HREF = `${LIVE}#/factory/agents`;
/** The three groups: each model setting's key and the role whose outcomes its row shows (README, "Agents, Roles"). */
const GROUPS: [string, [string, string, string][]][] = [
  ["Workers", [["small", "worker", "Small"], ["medium", "worker", "Medium"], ["large", "worker", "Large"]]],
  ["Review and Intake", [["review", "reviewer", NAMES.reviewer], ["intake", "intake", NAMES.intake], ["judge", "judge", NAMES.judge]]],
  ["Oversight", [["director", "director", NAMES.director], ["monitor", "monitor", NAMES.monitor], ["housekeeper", "housekeeper", NAMES.housekeeper], ["maintainer", "maintainer", NAMES.maintainer], ["investigator", "investigator", NAMES.investigator]]],
];
/** The noun of each role's output, as the live page has it; another role counts its OK runs. */
const NOUNS: Record<string, string> = { worker: "landed", reviewer: "verdicts", intake: "triages", director: "steps", monitor: "readings", housekeeper: "sweeps", judge: "calls" };
/** A row with fewer ended runs shows its counts, not a rate, as on the live page. */
const MIN_ENDED = 20;
/** The chart colours of the live page: a model's place in MODEL_ORDER, the seventh for Other. */
const COLORS = ["series-1", "series-2", "series-3", "series-4", "series-5", "chart-6"];

const STYLE = `<style>
.rt-agents-ctl { display: inline-flex; align-items: center; gap: var(--sp-6); }
.rt-agents-ctl input[type="checkbox"] { margin: 0; }
.rt-agents-rate { display: inline-flex; align-items: center; gap: var(--sp-6); }
.rt-agents-rate .meter { width: 64px; }
.rt-agents-rate .meter > i.below { background: var(--need); }
.rt-agents-chart .k-chart-6 { --c: var(--chart-6); }
.rt-agents-chart .k-chart-7 { --c: var(--chart-7); }
@media (max-width: 720px) {
  .rt-agents-roles .rt-row .lead { flex: 0 0 6.5rem; }
  .rt-agents-roles .rt-row .main { flex: 1 1 60%; min-width: 0; }
  .rt-agents-roles .rt-agents-ctl { display: flex; width: 100%; min-width: 0; }
  .rt-agents-roles .rt-agents-ctl select { flex: 1 1 auto; min-width: 0; }
}
</style>`;

/** What a role's run made: landed builds for a worker, verdicts for the reviewer, OK runs for another role. */
const output = (o: any) => (o.role === "worker" ? o.built : o.role === "reviewer" ? o.pass + o.fail : o.succeeded);

/** The success of an outcome against its baseline: a bar with the baseline as its mark, in the need tone below it; counts under MIN_ENDED runs. */
function rate(o: any) {
  if (o.ended < MIN_ENDED) return `${count(o.succeeded)}/${count(o.ended)}`;
  const below = o.baseline != null && o.rate < o.baseline, title = o.baseline == null ? "no baseline" : `baseline ${cardPct(o.baseline)}`;
  const bar = meter([{ pct: o.rate * 100, cls: below ? "below" : "" }], title, { mark: o.baseline == null ? null : Math.round(Math.min(o.baseline, 1) * 100) });
  return `<span class="rt-agents-rate">${bar}<span>${esc(cardPct(o.rate))}</span></span>`;
}

/** The outcomes of one row: the one of the model it is set to, then the earlier models, newest first. */
function outcomesOf(d: Data, key: string, role: string) {
  const all = d.agents.outcomes.filter((o: any) => o.role === role && o.runs && (role !== "worker" || o.size === key));
  const set = shortModel(d.agents.models.models[key].model), cur = all.find((o: any) => shortModel(o.model) === set);
  return { cur, past: all.filter((o: any) => o !== cur).sort((a: any, b: any) => b.to.localeCompare(a.to)) };
}

/** The inspector of one role: the figures of its model, then each earlier model. */
function roleInspect(d: Data, key: string, role: string, label: string, cur: any, past: any[]) {
  const at = new Date(now(d)), out = cur ? output(cur) : 0;
  const kv: [string, string][] = !cur ? [] : [
    ["Runs", esc(count(cur.runs))], ["Failed", cur.failed ? esc(count(cur.failed)) : ""], ["Error", cur.error ? esc(count(cur.error)) : ""],
    ["Success", esc(cardPct(cur.rate))], ["Baseline", cur.baseline == null ? "" : esc(cardPct(cur.baseline))],
    ["First Pass", cur.built ? esc(cardPct(cur.firstPass / cur.built)) : ""], ["Review Pass", cur.reviewPass == null ? "" : esc(cardPct(cur.reviewPass))],
    ["p50", esc(dur(cur.p50))], ["p95", esc(dur(cur.p95))], ["Cost", cur.cost ? esc(money(cur.cost)) : ""],
    ["Output", out ? esc(`${count(out)} ${NOUNS[role] ?? "runs"}`) : ""], ["Since", esc(day(cur.from, at))],
  ];
  const table = past.length ? subHead("Earlier Models") + dataTable(heads(["Model", "Until", "Runs", "Success", "Cost"], ["Runs", "Success", "Cost"]),
    past.map((o) => row([cell(shortModel(o.model)), cell(day(o.to, at)), cell(count(o.runs), { num: true }), cell(cardPct(o.rate), { num: true }), cell(o.cost ? money(o.cost) : "", { num: true })])).join("")) : "";
  return inspector({ id: key, title: `${label} · ${shortModel(d.agents.models.models[key].model)}`, rows: kv, body: table, href: HREF });
}

/** One role as a row: the switch and the model select, then runs, success, p50, cost and cost per output; a blank for no value. */
function roleRow(d: Data, key: string, role: string, label: string): Row {
  const M = d.agents.models, set = M.models[key], { cur, past } = outcomesOf(d, key, role), out = cur ? output(cur) : 0;
  const pick = selectBox(`${label} model`, key, M.offers[key].map((v: string) => ({ value: v, label: shortModel(v), disabled: M.down.includes(v) })), set.model);
  const ctl = `<span class="rt-agents-ctl"><input type="checkbox" aria-label="${esc(label)} on"${set.enabled ? " checked" : ""}>${pick}</span>`;
  return {
    key, lead: esc(label), main: ctl, text: `${label} ${role} ${set.model}`, inspect: roleInspect(d, key, role, label, cur, past),
    cells: cur ? [esc(count(cur.runs)), rate(cur), esc(dur(cur.p50)), cur.cost ? esc(money(cur.cost)) : "", out && cur.cost ? esc(money(cur.cost / out)) : ""] : ["", "", "", "", ""],
  };
}

const runs = (d: Data) => d.agents.roles.reduce((n: number, r: any) => n + r.runs, 0);
const weekCost = (d: Data) => d.agents.days.reduce((n: number, x: any) => n + Object.values<number>(x.cost).reduce((a, c) => a + c, 0), 0);

function rolesView(d: Data) {
  const A = d.agents;
  const groups: Group[] = GROUPS.map(([title, keys]) => ({ title, count: count(keys.length), heads: ["Runs", "Success", "p50", "Cost", "Per Output"], rows: keys.map(([k, r, l]) => roleRow(d, k, r, l)) }));
  return STYLE + factsLine([[count(A.live), `of ${count(A.cap)} live`], [count(runs(d)), "runs"], [cardPct(A.rates.success), "success"], [money(A.models.spend.week), "OpenRouter"]]) +
    `<div class="rt-agents-roles">${list({ label: "Roles", search: "Search roles", groups })}</div>`;
}

/** Each day's values by model, short names joined; the first six models of MODEL_ORDER keep their colours and the rest fold into Other. */
function byModel(d: Data, field: "cost" | "tokens"): Series[] {
  const days = d.agents.days.map((x: any) => {
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries<number>(x[field])) m[shortModel(k)] = (m[shortModel(k)] ?? 0) + v;
    return m;
  });
  const seen = [...new Set(days.flatMap((m: Record<string, number>) => Object.keys(m).filter((k) => m[k])))] as string[];
  const own = MODEL_ORDER.slice(0, COLORS.length).filter((m: string) => seen.includes(m)), rest = seen.filter((m) => !own.includes(m));
  const series = own.map((m: string) => ({ name: m, color: COLORS[MODEL_ORDER.indexOf(m)], values: days.map((x: Record<string, number>) => x[m] ?? 0) }));
  return rest.length ? [...series, { name: "Other", color: "chart-7", values: days.map((x: Record<string, number>) => rest.reduce((n, m) => n + (x[m] ?? 0), 0)) }] : series;
}

const weekday = (ms: number) => new Date(ms).toLocaleDateString("en-US", { weekday: "short" });
/** Tokens in millions, for a chart's top line. */
const mega = (n: number) => `${count(Math.round(n / 1e6))}M`;

function usageView(d: Data) {
  const A = d.agents, T = now(d), U = A.usage, r = A.rates;
  // The 7-day quota resets at `resets`, so the week began 7 days before it.
  const week = 7 * 864e5, gone = (100 * (T - (Date.parse(U.resets) - week))) / week;
  const labels = A.days.map((x: any) => weekday(x.at)), cost = byModel(d, "cost"), tokens = byModel(d, "tokens");
  // The quota at the end of each day of the cost chart: its last reading before the next day starts.
  const used: Series[] = [{ name: "used", color: "series-1", values: A.days.map((x: any) => U.series.findLast((p: any) => p.at < x.at + 864e5)?.used ?? 0) }];
  const roles = [...A.roles].filter((x: any) => x.hours).sort((a: any, b: any) => b.hours - a.hours), most = roles[0].hours;
  const hoursBars = barList(roles.map((x: any, i: number) => barRow(esc(x.name), (100 * x.hours) / most, esc(hours(x.hours)), { top: !i })).join(""));
  return band([
    { k: "Usage", v: pct(U.used), cmp: `${pct(gone)} of week gone`, trend: U.used <= gone ? "good" : "warn" },
    { k: "Success", v: cardPct(r.success), cmp: `${cardPct(r.baseline)} baseline`, trend: r.success >= r.baseline ? "good" : "warn" },
    { k: "Peak Live", v: count(A.peak), cmp: `mean ${A.mean}`, title: `cap ${count(A.cap)} workers` },
    { k: "Cost", v: money(weekCost(d)), cmp: `${money(A.models.spend.week)} OpenRouter` },
  ]) + charts([
    card("Cost by Model", columns(labels, cost, { stacked: true, fmt: money }), { aside: legend(cost), cls: "rt-agents-chart" }),
    card("Tokens by Model", columns(labels, tokens, { stacked: true, fmt: mega }), { aside: legend(tokens), cls: "rt-agents-chart" }),
    card("Usage", lines(labels, used, { fmt: pct }), { aside: "7-day quota" }),
    card("Hours by Role", hoursBars),
  ]);
}

export const page: Page = {
  id: "agents", title: "Agents", group: "Factory", order: 2, icon: "robot", route: "factory/agents",
  views: [{ id: "roles", label: "Roles", scope: true, draw: rolesView }, { id: "usage", label: "Usage", scope: true, draw: usageView }],
  attention: (d) => d.agents.models.down.map((m: string) => ({ tone: "error" as const, text: `Local model down: ${m}` })),
};
