// Builds index.html from a fixture (issue.3350, 2026-11-19) with the page's own helpers: bun docs/mocks/investigator/gen.ts
import { cpSync, writeFileSync } from "node:fs";
import { actButton, card, crumb, dataTable, esc, facts, fold, heads, list, pageHead, tag } from "../../../ui/views/lib/html.js";

const ref = (r: string) => `<code>${esc(r)}</code>`;
const btn = (label: string, o = {}) => actButton(label, {}, { kind: "small", ...o });

const run = { at: "Nov 19 22:41", model: "opus", cost: "$1.84", took: "11m 20s" };
const summary = "The build passed, then the land hit a merge conflict with a3349 in vault/lib/vault.ts. The merge round ran on the small model, then deepseek on OpenRouter, and got a 402. The user moved small to haiku 30 s later, but the retry was a recheck, which cannot resolve a conflict, and the credit hold kept the rerun waiting for OpenRouter.";
const timeline = [
  ["21:21", "Build job.10466 commits 1cd3a9c7; 104 tests pass", "job.10466/result.md"],
  ["21:23", "Land job.10474 fails: merge conflict in vault/lib/vault.ts", "job.10474/log.txt:8"],
  ["21:23", "Merge round job.10475 on small (deepseek) gets 402", "job.10475/transcript.jsonl:17"],
  ["21:23", "Credit hold on OpenRouter holds issue.3350", "event 05:23:49Z"],
  ["21:24", "the user sets small to haiku", "event 05:24:19Z"],
  ["21:24", "Recheck job.10476 hits the same conflict; job dropped for a rerun", "job.10476/log.txt"],
];
const causes = [
  ["A recheck reruns the land, so it cannot fix a merge conflict; the retry after the 402 needed a merge round.", ["jobs/lib/land/rescue.ts:248", "job.10476/log.txt"], "measured"],
  ["heldIssue() binds an issue the hold listed even after its next run moved off the held backend.", ["jobs/lib/gates/holds.ts:76", "event 05:24:27Z"], "measured"],
  ["Two issues filed together edited startContext() in one file, so the second land conflicted.", ["2ae23106", "1cd3a9c7"], "inferred"],
];
const issues = [
  { title: "Retry a credit-held merge round as a merge round", kind: "bug", scores: [4, 3, 2], spec: "When a merge round ends with the API credit error, the retry after the hold must start a merge round again, not a recheck.", fate: "" },
  { title: "Lift a credit hold on issues moved off the held backend", kind: "bug", scores: [3, 2, 2], spec: "Bind a held issue only while viaOfRun of its next run is the held backend.", fate: "a3356" },
  { title: "Order issues filed together that edit one function", kind: "task", scores: [2, 2, 3], spec: "When two open issues of one batch name the same function, set the second `after` the first.", fate: "" },
];

const scores = ([i, r, e]: number[]) => `<span class="quiet" title="impact, risk, effort">${i} · ${r} · ${e}</span>`;
const issueRow = (x: typeof issues[number]) => `<tr><td class="wide"><b>${esc(x.title)}</b> ${tag(x.kind)}${fold("Spec", `<p>${esc(x.spec)}</p>`)}</td><td>${scores(x.scores)}</td>` +
  `<td>${x.fate === "a3356" ? `${tag("existing")} <a href="#">a3356</a> ${btn("Note")}` : `${btn("File", { primary: true })} ${btn("Dismiss")}`}</td></tr>`;

const panel = card("Investigation",
  `<p>${esc(summary)}</p>` +
  `<h3 class="sub-head">Causes</h3>` + dataTable(heads(["Cause", "Evidence", "Confidence"]), causes.map(([c, ev, conf]) => `<tr><td class="wide">${esc(c as string)}</td><td>${(ev as string[]).map(ref).join("<br>")}</td><td>${tag(conf as string)}</td></tr>`).join("")) +
  `<h3 class="sub-head">Recommended issues</h3>` + dataTable(heads(["Issue", "I · R · E", ""]), issues.map(issueRow).join("")) +
  fold("Timeline", dataTable(heads(["Time", "What", "Evidence"]), timeline.map(([t, w, e]) => `<tr><td class="time">${t}</td><td class="wide">${esc(w)}</td><td>${ref(e)}</td></tr>`).join(""))) +
  fold("Earlier investigations", `<p class="quiet">None</p>`),
  { aside: `${run.at} · ${run.model} · ${run.cost} · ${run.took}`, cls: "inv" });

const head = (button: string) => pageHead("", { after: `<h1>Refuse a core write only when it grows an over-budget scope</h1>`, aside: button + " " + actButton("Edit") });
const issueFacts = facts([["Status", tag("done", "good")], ["Jobs", "job.10466 · 4 runs"], ["Landed", "74a5cd53"]]);

// Stand-ins for the issue page's own sections, in its order: the Investigation section sits after the Spec.
const top = card("Description", `<p>A vault write to the core refuses when the core is over budget, even when the write shrinks it.</p>`) +
  card("Spec", `<p>Refuse a core write only when it grows a scope that is over budget.</p>`);
const bottom = card("Notes", `<p class="quiet">2 notes</p>`) + card("Commits", `<p class="quiet">74a5cd53 refuse a core write only when it grows</p>`);
const page = (button: string, inv: string) => `<div class="page dp-page">${crumb("#", [["issues", "#"], ["aleph", "#"], ["a3350"]])}${head(button)}${issueFacts}${list(top + inv + bottom)}</div>`;
const idle = actButton("Investigate"), busy = `<button class="act" type="button" disabled>Running</button>`;

const done = page(idle, panel);
const running = page(busy, card("Investigation", `<p class="quiet">Started 22:30 · opus · reading 6 runs</p>`, { cls: "inv" }));
const none = page(idle, "");

const dir = import.meta.dir;
cpSync(`${dir}/../../../ui/app.css`, `${dir}/app.css`);
writeFileSync(`${dir}/index.html`, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Investigator on the issue page</title>
<link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/hack-font/3.3.0/web/hack.min.css" rel="stylesheet">
<link rel="stylesheet" href="app.css">
<style>/* Proposed for app.css: the light mark on the Investigation section. */ .inv { border-left: 3px solid var(--focus); }
/* Mock only: the frame labels. */ .mock-h { font-size: var(--fs-sm); color: var(--muted); margin: var(--sp-24) 0 var(--sp-8); text-transform: uppercase; letter-spacing: .06em; }</style>
</head><body><main>
<p class="mock-h">1. After a run</p>${done}
<p class="mock-h">2. While a run is live</p>${running}
<p class="mock-h">3. No investigations: no section</p>${none}
</main></body></html>
`);
console.log("index.html written");
