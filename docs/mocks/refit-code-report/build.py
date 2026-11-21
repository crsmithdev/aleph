"""Draw the refit-code run of 2026-11-20 in the proposed report shape.

Input: findings.json (the run's record) and figures.json (the run's figures, cut from its index.html).
Output: index.html, or with `example` the short worked page skills/refit/example.html.
Run: python3 build.py [example]
"""
import sys
import json
import re
from collections import defaultdict
from html import escape as e

run = json.load(open("findings.json"))
art = json.load(open("figures.json"))
fs = run["findings"]
EXAMPLE = {"f25", "f55", "f20", "f21", "f24", "f36", "f1", "f17", "d1", "d7"}
example = sys.argv[1:] == ["example"]
if example:
    fs = [f for f in fs if f["id"] in EXAMPLE]
found = [f for f in fs if f["id"].startswith("f")]
rest = [f for f in fs if f["id"].startswith("d")]
asks = [f for f in found if f["tier"] == "ask"]
autos = [f for f in found if f["tier"] == "auto"]
ov = run["overview"]

TONE = {"Disagrees": "error", "Duplicates": "need", "measured": "need", "proven": "error"}


def tone(s):
    if s in TONE:
        return TONE[s]
    if s.isdigit():
        return "error" if int(s) >= 4 else "need"
    return "quiet"


def short(path):
    return path.split(" ")[0]


def diff(f):
    if "before" not in f:
        return ""
    out = [f'<span class="l d-del">- {e(x)}</span>' for x in f["before"].splitlines()]
    after = f["after"]
    if after.startswith("(gone"):
        out.append(f'<span class="l d-hunk">{e(after)}</span>')
    else:
        out += [f'<span class="l d-add">+ {e(x)}</span>' for x in after.splitlines()]
    return f'<div class="diff-panel"><pre>{"".join(out)}</pre></div>'


def figure(f):
    fig = art["figs"].get(f["id"])
    if not fig:
        return ""
    # the caption repeats the title before its first colon
    # the run cut long labels to "dir/fil..."; HTML.md wants the whole file name
    names = [l.split(":")[0].rsplit("/", 1)[-1] for l in f["locations"]]
    fig = re.sub(r">[\w-]+/([\w.-]+?)(?:\.{3,4}|…)<", lambda m: ">" + next(n for n in names if n.startswith(m.group(1))) + "<", fig)
    head, _, tail = fig.partition("<figcaption>")
    cap, _, end = tail.partition("</figcaption>")
    if cap.startswith(f["title"] + ": "):
        cap = cap[len(f["title"]) + 2:]
    return f"{head}<figcaption>{cap[:1].upper()}{cap[1:]}</figcaption>{end}"


def locs(f):
    return "".join(f"<li><code>{e(l)}</code></li>" for l in f["locations"])


def body(f):
    ask = ""
    if f["tier"] == "ask":
        ask = f'<p class="ask"><span class="badge need">ask</span> {e(f["trigger"])}</p>'
    return (
        f'{ask}<p class="fix">{e(f["fix"])}</p>{diff(f)}{figure(f)}'
        f'<details class="more"><summary>Locations, guard</summary><ul class="locs">{locs(f)}</ul>'
        f'<p class="aux"><b>Guard</b>: {e(f["guard"])}</p></details>'
    )


def head(f):
    return (
        f'<span class="n">{f["id"][1:]}</span><span class="t">{e(f["title"])}</span><code class="u">{e(f["unit"])}</code>'
        f'<span class="chips">'
        f'<span class="badge {tone(f["strength"])}">{e(f["strength"])}</span>'
        f'<span class="sig">{e(f["signal"])}</span></span>'
    )


def finding(f, fold):
    if fold:
        tag = " open" if example and f["id"] == "f21" else ""
        return (
            f'<details class="finding"{tag} id="{f["id"]}" data-annotate="{f["id"]}"><summary class="ft">{head(f)}</summary>'
            f'<div class="fb">{body(f)}</div></details>'
        )
    return f'<div class="finding" id="{f["id"]}" data-annotate="{f["id"]}"><p class="ft">{head(f)}</p><div class="fb">{body(f)}</div></div>'


LENS = ["one-way", "depth", "seams", "waste", "slop", "dead", "layout"]


def units(group, fold):
    by = defaultdict(list)
    for f in group:
        by[f["lens"]].append(f)
    out = []
    for u in [l for l in LENS if l in by]:
        xs = by[u]
        out.append(
            f'<div class="group"><h3 class="gh">{u}<span class="count">{len(xs)}</span></h3>'
            + "".join(finding(f, fold) for f in xs)
            + "</div>"
        )
    return "".join(out)


lenses = defaultdict(int)
for f in found:
    lenses[f["lens"]] += 1
seed = ov["seed"]


def li(xs):
    return "".join(f"<li><code>{e(x)}</code></li>" for x in xs)


dropped = "".join(
    f'<tr class="quiet"><td class="num">{f["id"]}</td><td>{e(f["title"])}<br><small>{e(f["reason"] or "")}</small></td>'
    f'<td>{f["status"]}</td><td>{f["lens"]}</td></tr>'
    for f in rest
)

legend = (
    '<svg class="key" viewBox="0 0 640 28" role="img" aria-label="Figure key">'
    '<rect class="node" x="2" y="4" width="34" height="20" rx="3"/><text x="44" y="19">module or copy</text>'
    '<rect class="node own" x="170" y="4" width="34" height="20" rx="3"/><text x="212" y="19">owner</text>'
    '<rect class="node gone" x="282" y="4" width="34" height="20" rx="3"/><text x="324" y="19">caller</text>'
    '<path class="edge leak" d="M400 14 H450"/><text x="462" y="19">disagrees or leaks</text></svg>'
)


page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Refit scan for aleph</title><link rel="stylesheet" href="app.css"><link rel="stylesheet" href="report.css"></head><body>
{art["defs"]}
<div class="page sp">
<header class="ph"><h1>Refit</h1><span class="count">refit-code · aleph</span><div class="aside"><a href="http://127.0.0.1:3020/shelf/">Shelf</a></div></header>

<section class="card ov" id="overview" aria-label="Overview">
<dl class="facts"><div><dt>Commit</dt><dd>{run["commit"]}</dd></div><div><dt>Date</dt><dd>2026-11-20</dd></div><div><dt>Mode</dt><dd>{run["mode"]}</dd></div><div><dt>Baseline</dt><dd>{e(ov["baseline"])}</dd></div></dl>
<div class="tally">
<a class="need" href="#ask"><b>{len(asks)}</b><span>ask: need you</span></a>
<a href="#auto"><b>{len(autos)}</b><span>auto: safe to fix</span></a>
<a href="#dropped"><b>{len(rest)}</b><span>dropped</span></a>
</div>
<details><summary>Lenses, seed, sweep</summary>
<h4>Lenses</h4><ul>{"".join(f"<li>{k} {v}</li>" for k, v in sorted(lenses.items(), key=lambda kv: -kv[1]))}</ul>
<h4>Most fixed, 90 days</h4><ul>{li(seed["fixes"])}</ul>
<h4>Changed together</h4><ul>{li(seed["pairs"])}</ul>
<h4>Copies</h4><ul>{li(seed["clones"])}</ul>
<h4>Sweep</h4><ul><li>None in every category.</li><li>Dead lens: knip 5, entry points from bin/, hooks.json, systemd units and the router.</li></ul>
</details>
</section>

<section class="card" id="ask" aria-label="Ask">
<div class="sh"><h2>Ask</h2><span class="count">{len(asks)}</span></div>
<p class="lede">Each fix changes behaviour someone sees.</p>
{legend}
{units(asks, False)}
</section>

<section class="card" id="auto" aria-label="Auto">
<div class="sh"><h2>Auto</h2><span class="count">{len(autos)}</span></div>
<p class="lede">Each fix keeps behaviour. Open a row for the fix and its diff or figure.</p>
{units(autos, True)}
<p class="clean">No findings: {", ".join(f"<code>{e(c)}</code>" for c in art["clean"])}</p>
</section>

<section class="card" id="dropped" aria-label="Dropped">
<details><summary>Dropped: {len(rest)}</summary>
<div class="tscroll"><table class="tbl"><thead><tr><th class="num">#</th><th>Candidate</th><th>Verdict</th><th>Lens</th></tr></thead><tbody>{dropped}</tbody></table></div>
</details>
</section>
</div></body></html>
"""
open("../../../skills/refit/example.html" if example else "index.html", "w").write(page)
print(len(asks), len(autos), len(rest))
