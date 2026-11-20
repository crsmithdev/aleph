// The Investigate button and the Investigation panel of an issue page and a job page, from the API's `investigations`, newest first.
import { dur, money, shortModel, when } from "./format.js";
import { actButton, dataTable, esc, fold, heads, idLink, note, subHead, tag } from "./html.js";
import { panel } from "./timeline.js";
import { issueHref, jobHref, shownKey } from "../../../lib/naming.ts";

/** Investigate, or Running, disabled, while a run on `subject` is live. */
export const investigateButton = (subject, runs = []) => (runs[0]?.state === "running"
  ? `<button class="act" type="button" disabled>Running</button>`
  : `${actButton("Investigate", { act: "investigate", path: "/api/investigate", label: "Investigate", body: JSON.stringify({ subject }) })}<span class="act-msg" role="status"></span>`);

const ref = (r) => `<code>${esc(r)}</code>`;
const key = (k, repo) => idLink(shownKey(k), issueHref(k, repo));
const meta = (x) => [when(x.started), shortModel(x.model), x.cost != null && money(x.cost), x.ended && dur((Date.parse(x.ended) - Date.parse(x.started)) / 1000)].filter(Boolean).join(" · ");

/** A recommended issue's actions: File and Dismiss, Note in place of File when an open issue covers it, or what Chris did. */
function actions(f, id, i, repo) {
  if (f.fate) {
    const [did, k] = f.fate.split(" ");
    return k ? `${esc(did)} ${key(k, repo)}` : esc(did);
  }
  const path = `/api/investigations/${encodeURIComponent(id)}/${i}`;
  const btn = (label, act, primary = false) => actButton(label, { act: "finding", path, label, body: JSON.stringify({ act }) }, { kind: "small", primary });
  return f.existing ? `${key(f.existing, repo)} ${btn("Note", "note", true)} ${btn("Dismiss", "dismiss")}` : `${btn("File", "file", true)} ${btn("Dismiss", "dismiss")}`;
}

function result(x, repo) {
  const r = x.result;
  if (x.state === "running") return `<p class="quiet">Running</p>`;
  if (!r) return note(x.reason ?? "No reply");
  const causes = r.causes.map((c) => `<tr><td class="wide">${esc(c.claim)}</td><td>${c.evidence.map(ref).join("<br>")}</td><td>${tag(c.confidence)}</td></tr>`).join("");
  const issues = r.issues.map((f, i) => `<tr><td class="wide"><b>${esc(f.title)}</b> ${tag(f.kind)}${fold("Spec", `<p>${esc(f.spec)}</p>`)}</td>` +
    `<td class="num" title="impact, risk, effort">${f.impact} · ${f.risk} · ${f.effort}</td><td>${actions(f, x.id, i, repo)}</td></tr>`).join("");
  return `<p>${esc(r.summary)}</p>` +
    (causes ? subHead("Causes") + dataTable(heads(["Cause", "Evidence", "Confidence"]), causes) : "") +
    (issues ? subHead("Recommended issues") + dataTable(heads(["Issue", "I · R · E", ""], ["I · R · E"]), issues) : "") +
    (r.timeline.length ? fold("Timeline", dataTable(heads(["Time", "What", "Evidence"]), r.timeline.map((t) => `<tr><td class="time">${esc(when(t.at))}</td><td class="wide">${esc(t.what)}</td><td>${ref(t.evidence)}</td></tr>`).join(""))) : "");
}

/** The Investigation panel: the newest run in full, the older ones in a fold; "" when there is none. */
export function investigationPanel(runs = [], repo) {
  if (!runs.length) return "";
  const [x, ...older] = runs;
  const earlier = older.length ? fold("Earlier investigations", older.map((o) => `<p>${idLink(shownKey(o.id), jobHref(o.id))} <span class="quiet">${esc(meta(o))}</span> ${esc(o.reason ?? o.state)}</p>`).join("")) : "";
  return panel("investigation", "Investigation", `<div class="dp-body">${result(x, repo)}${earlier}</div>`, esc(meta(x)), "dp-marked");
}
