# HTML

Adapted from the HTML report of Matt Pocock's `improve-codebase-architecture` (github.com/mattpocock/skills @4ae2317). [REPORT.md](REPORT.md) says what the report holds; this file says how it looks.

The report uses the aleph classes of `app.css`: `page`, `card`, `sh`, `sub-head`, `facts`, `tbl`, `badge` and `tscroll`. It uses no Tailwind and no script. A finding gets a figure only when `figure` is true in `findings.json`: a fix that changes how two or more files relate. A finding in one file shows its lines or text before and after in a `<pre>`, and gets no figure.

## Scaffold

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Refit {{mode}} for {{repo}}</title>
  <link rel="stylesheet" href="app.css">
  <style>
    /* the figure layer: tokens from app.css, so light and dark both work */
    figure.refit { margin: 0; }
    figure.refit svg { width: 100%; height: auto; display: block; }
    figure.refit text { font-size: 14px; fill: var(--ink); }
    figure.refit text.t-head { font-weight: 600; }
    .panel { fill: none; stroke: var(--rule); stroke-width: 1.5; }
    .node { fill: var(--surface); stroke: var(--ink); stroke-width: 1.5; }
    .node.own { fill: var(--ink); }
    .node.gone { fill: var(--sunk); stroke: var(--muted); stroke-dasharray: 6 4; }
    figure.refit text.on-own { fill: var(--surface); }
    figure.refit text.on-gone { fill: var(--muted); }
    .edge { fill: none; stroke: var(--muted); stroke-width: 1.5; marker-end: url(#arrow); }
    .edge.leak { stroke: var(--error); stroke-dasharray: 4 4; marker-end: url(#arrow-leak); }
    figure.refit text.leak-t { fill: var(--error); }
  </style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--muted)"/></marker>
  <marker id="arrow-leak" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--error)"/></marker>
</defs></svg>
<div class="page sp">
  <header class="ph"><h1>Refit</h1><span class="count">{{skill}}</span><div class="aside"><a href="{{shelf base}}/shelf/">Shelf</a></div></header>

  <section class="card" id="overview" aria-label="Overview">
    <div class="sh"><h2>Overview</h2><span class="count">{{n}} findings</span></div>
    <dl class="facts"><div><dt>Repo</dt><dd>{{repo}}</dd></div><div><dt>Date</dt><dd>{{date}}</dd></div><div><dt>Commit</dt><dd>{{sha}}</dd></div><div><dt>Mock</dt><dd><a href="{{mock shelf url}}" target="_blank">{{mock}}</a></dd></div></dl>
  </section>

  <section class="card" id="units" aria-label="Units">
    <div class="sh"><h2>Units</h2></div>
    <div data-annotate="{{unit id}}">
      <h3 class="sub-head">{{unit}}</h3>
      <div data-annotate="f{{n}}">
        <p><strong>{{title}}</strong> <span class="badge error">{{lens}}</span> <span class="badge need">{{strength}}</span></p>
        <p>Fix: ...</p>
        {{figure, or the lines before and after in a <pre>}}
        <details><summary>Details</summary>
          <ul><li><code>{{file:line}}</code></li></ul>
          <p>Guard: <code>...</code></p>
        </details>
      </div>
    </div>
    <div data-annotate="{{other unit id}}"><h3 class="sub-head">{{unit}}</h3><p>No issues.</p></div>
  </section>

  <section class="card" id="findings" aria-label="Findings">
    <details><summary>Findings: {{n}}, and {{dropped}} dropped</summary>
    <div class="tscroll"><table class="tbl"><thead><tr><th class="num">#</th><th>Finding</th><th>Kind</th><th>Lens</th></tr></thead><tbody>
      <tr><td class="num">{{n}}</td><td><a href="#f{{n}}">{{title}}</a></td><td>{{kind}}</td><td>{{lens}}</td></tr>
      <tr class="quiet"><td class="num">d{{n}}</td><td>{{title}}<br><small>{{reason}}</small></td><td>{{verdict}}</td><td>{{lens}}</td></tr>
    </tbody></table></div></details>
  </section>

  <section class="card" id="proposals" aria-label="Proposals">...</section>
</div>
</body>
</html>
```

`app.css` sets light and dark, so the report needs no extra code for either.

## Figure

One figure per finding with `figure` true, in the finding card where its text says "Fix": one `<figure class="refit">` with one inline `<svg>` of one `viewBox`, two side-by-side panels, "Before" on the left and "After" on the right, and one `<figcaption>` that states the gain in one sentence with its glossary term ("locality: the regex lives in one module").

- **Same place.** Each node keeps its position in both panels. At most 8 boxes per panel. Over 8: draw the owner and the 7 largest, and name the rest in Details.
- **After.** The fix's owner is the one dark box (`.own`). What the fix removes is greyed (`.gone`, dashed) or dropped. A former copy that stays as a caller is grey.
- **Before.** A disagreement or leak is a red dashed edge (`.leak`) with its verb on it.
- **Verbs.** Each arrow carries a verb: `calls`, `reads`, `diverges`.
- **State twice.** Each state has a class and a word in the box: `owner`, `copy`, `caller`, `gone`. A line has a dash pattern as well as a colour.
- **Size.** Labels are 14 units or larger and 9 units above their line, about 18 characters per line (a second line is a `<tspan x=".." dy="1.2em">`). Boxes are 40 units apart or more, and arrows run in right angles (`M x y H x V y`).
- **Evidence.** A box holds the real file name and the real symbol of the finding.

```html
<figure class="refit">
  <svg viewBox="0 0 1000 290" role="img" aria-label="Before and after">
    <rect class="panel" x="4" y="4" width="488" height="282" rx="6"/>
    <rect class="panel" x="508" y="4" width="488" height="282" rx="6"/>
    <text class="t-head" x="20" y="28">Before</text>
    <text class="t-head" x="524" y="28">After</text>

    <!-- Before: two copies disagree, the owner has no caller here -->
    <rect class="node" x="20" y="50" width="150" height="56" rx="4"/>
    <text x="30" y="74">ui/issue.ts</text><text x="30" y="94">copy</text>
    <rect class="node" x="20" y="206" width="150" height="56" rx="4"/>
    <text x="30" y="230">jobs/run.ts</text><text x="30" y="250">copy</text>
    <path class="edge leak" d="M95 106 V206"/>
    <text class="leak-t" x="105" y="160">diverges</text>
    <rect class="node" x="316" y="128" width="160" height="56" rx="4"/>
    <text x="326" y="152">lib/naming.ts</text><text x="326" y="172">parseRef</text>

    <!-- After: the same places; the copies are grey callers, the owner is dark -->
    <rect class="node gone" x="524" y="50" width="150" height="56" rx="4"/>
    <text class="on-gone" x="534" y="74">ui/issue.ts</text><text class="on-gone" x="534" y="94">caller</text>
    <rect class="node gone" x="524" y="206" width="150" height="56" rx="4"/>
    <text class="on-gone" x="534" y="230">jobs/run.ts</text><text class="on-gone" x="534" y="250">caller</text>
    <path class="edge" d="M674 78 H740 V146 H820"/>
    <text x="680" y="69">calls</text>
    <path class="edge" d="M674 234 H740 V166 H820"/>
    <text x="680" y="225">calls</text>
    <rect class="node own" x="820" y="128" width="160" height="56" rx="4"/>
    <text class="on-own" x="830" y="152">lib/naming.ts</text><text class="on-own" x="830" y="172">parseRef, owner</text>
  </svg>
  <figcaption>Both callers use parseRef, so one regex stays: locality.</figcaption>
</figure>
```

## Style guidance

- Use the look of `app.css`. Do not add fonts or a palette. Use its tokens in a figure.
- Colour sparingly: red (`--error`) for leakage and amber (`--need`) for warnings.

## Tone

Use the words of `aleph:codebase-design` exactly: module, interface, implementation, depth, deep, shallow, seam,
adapter, leverage, locality. Do not use component, service or unit for module, API or signature for interface,
or boundary for seam. A gain names its glossary term ("locality: bugs concentrate in one module"), never "easier
to maintain" or "cleaner code".
