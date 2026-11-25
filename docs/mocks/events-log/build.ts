// Builds index.html: the Events card as it is now, and three options, all drawn by the real helpers from data.json.
// Run: TZ=America/Los_Angeles bun docs/mocks/events-log/build.ts
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { renderLog } from "../../../ui/views/now.js";
import { clock, count, dur } from "../../../ui/views/lib/format.js";
import { card, chips, dataTable, esc, fold, heads, iconHead, idLink, row, tag, tone } from "../../../ui/views/lib/html.js";

const here = import.meta.dir, log = JSON.parse(readFileSync(`${here}/data.json`, "utf8"));

const logTag = (r) => tag(r.action, r.action === "started" ? "run" : tone(r.action));
const runs = (rows) => rows.reduce((acc, r) => {
  const last = acc.at(-1), of = (x) => x?.issue?.to ?? x?.job?.to;
  if (of(r) && of(last?.[0]) === of(r)) last.push(r);
  else acc.push([r]);
  return acc;
}, []);
const older = (rest) => `<ul class="tight">${rest.map((o) => `<li>${esc(clock(o.at))} ${logTag(o)} ${o.job ? idLink(o.job.id, o.job.to) : ""} ${esc(o.by)}</li>`).join("")}</ul>`;
const said = (r) => chips(r.keys) + esc(r.title);
const titled = (run, lead = "") => {
  const [r, ...rest] = run;
  return rest.length ? fold(`<span>${lead}${said(r)}</span>${rest.length}`, older(rest), { cls: "line" }) : lead + said(r);
};
const ref = (r) => (r.issue ? idLink(r.issue.id, r.issue.to) : r.job ? idLink(r.job.id, r.job.to) : "");
const bar = renderLog(log).match(/<div class="fbar"><div class="fg">.*?<\/div><\/div><\/div>/)[0];
const shell = (body) => card("Events", bar + body, { count: count(log.total) });

// A: one Ref column, the issue or else the job; the job of an issue event is one click away on the issue.
const a = shell(dataTable(iconHead("clock", "Time", { num: false }) + heads(["Event", "Ref", "Title", "By"]) + iconHead("stopwatch", "Took"),
  runs(log.rows).map((run) => { const r = run[0]; return row([`<td class="time lead">${esc(clock(r.at))}</td>`, `<td>${logTag(r)}</td>`, `<td>${ref(r)}</td>`, `<td class="wide">${titled(run)}</td>`, `<td>${esc(r.by)}</td>`, `<td class="num">${r.took == null ? "" : dur(r.took)}</td>`]); }).join("")));

// B: the ids lead the title; who, job and time taken sit in one quiet cell at the right.
const tail = (r) => [r.issue && r.job ? idLink(r.job.id, r.job.to) : "", esc(r.by), r.took == null ? "" : `<b>${dur(r.took)}</b>`].filter(Boolean).join(`<i>·</i>`);
const lineB = (run) => { const r = run[0]; return row([`<td class="time lead">${esc(clock(r.at))}</td>`, `<td>${logTag(r)}</td>`, `<td class="wide">${titled(run, `<span class="ref">${ref(r)}</span>`)}</td>`, `<td class="tail">${tail(r)}</td>`]); };
const headB = iconHead("clock", "Time", { num: false }) + heads(["Event", "Title"]) + `<th class="num">By</th>`;
const b = shell(dataTable(headB, runs(log.rows).map(lineB).join("")));

// C: B under a row per day, so a time past midnight reads as the day before.
const dayOf = (iso) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const today = dayOf(new Date().toISOString());
const c = shell(dataTable(headB, runs(log.rows).map((run, i, all) => {
  const d = dayOf(run[0].at), head = i === 0 || dayOf(all[i - 1][0].at) !== d ? `<tr class="day"><th colspan="4">${d === today ? "Today" : esc(d)}</th></tr>` : "";
  return head + lineB(run);
}).join("")));

const part = (k, name, why, html) => `<section class="opt"><h2>${k} · ${name}</h2><p>${why}</p>${html}</section>`;
cpSync(`${here}/../../../ui/app.css`, `${here}/app.css`);
writeFileSync(`${here}/index.html`, `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><title>Events log options</title>
<link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/hack-font/3.3.0/web/hack.min.css" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.14.0/dist-cdn/styles/themes/default.css">
<script type="module" src="https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.14.0/dist-cdn/webawesome.loader.js"></script>
<link rel="stylesheet" href="app.css"><link rel="stylesheet" href="mock.css"></head><body><main class="mock">
${part("Now", "Seven columns", "Issue is empty on job-only rows. Took is empty on starts and rule events.", renderLog(log).replace(/<div class="fbar"><input.*?<\/div>/, ""))}
${part("A", "One Ref column", "Issue and Job merge into Ref: the issue, else the job. Six columns.", a)}
${part("B", "Ids lead the title", "The id sits before the title. By, the job of an issue event, and Took share one quiet cell at the right. Four columns.", b)}
${part("C", "B with day rows", "B, plus a row for each day, so a time after midnight reads as its own day.", c)}
</main></body></html>`);
