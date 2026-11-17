# HTML

Adapted from the HTML report of Matt Pocock's `improve-codebase-architecture` (github.com/mattpocock/skills @4ae2317). [REPORT.md](REPORT.md) says what the report holds; this file says how it looks.

The report uses the aleph classes of `app.css`: `page`, `card`, `sh`, `sub-head`, `facts`, `tbl`, `badge` and `tscroll`. It uses no Tailwind. The one script is the Mermaid import from its CDN, and the report needs it only when a diagram uses Mermaid. Mermaid handles graph-shaped diagrams reliably. Hand-built divs and inline SVG handle the more editorial visuals (mass diagrams, cross-sections). Mix the two: Mermaid for everything looks generic.

## Scaffold

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Refit retro for {{repo}}</title>
  <link rel="stylesheet" href="app.css">
  <style>
    /* the diagram layer: tokens from app.css, so light and dark both work */
    .seam { stroke-dasharray: 4 4; }
    .leak { stroke: var(--error); }
    .deep { background: var(--ink); color: var(--surface); }
    .caller { background: var(--sunk); color: var(--muted); }
    /* Mermaid labels ignore classDef color: set it in both themes */
    .mermaid .deep .nodeLabel, .mermaid .deep .nodeLabel p { color: #fff !important; }
    .mermaid .leak .nodeLabel, .mermaid .leak .nodeLabel p, .mermaid .caller .nodeLabel, .mermaid .caller .nodeLabel p { color: #292D3E !important; }
  </style>
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    mermaid.initialize({ startOnLoad: true, theme: dark ? "dark" : "neutral", securityLevel: "loose" });
  </script>
</head>
<body>
<div class="page sp">
  <header class="ph"><h1>Refit Retro</h1><span class="count">{{skill}}</span><div class="aside"><a href="{{shelf base}}/shelf/">Shelf</a></div></header>

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
        <div class="tscroll">{{diagram}}</div>
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

A report with no Mermaid diagram leaves out the `<script>`. `app.css` sets light and dark, so the report needs no extra code for either.

## Diagram patterns

Pick the pattern that fits the candidate, and vary them across the report.

| Pattern | Use it when | How |
|---|---|---|
| Mermaid graph | X calls Y calls Z, and the point is the mess | A `flowchart` in a `div.tscroll`. Give each `classDef` a `fill` and a `color`, so a node reads in light and dark. A sequence diagram shows "before: 6 round-trips, after: 1". |
| Hand-built boxes | The after diagram is one thick deep module with faded internals | `<div>` boxes, with inline SVG arrows placed over a relative container |
| Cross-section | A call passes through layers that do nothing | Stacked bands: 6 thin ones before, 1 thick labelled one after |
| Mass diagram | The interface is as wide as the implementation | Two rectangles per module, interface against implementation |
| Call-graph collapse | Many calls become internal to one module | Nested boxes before, one box with faded calls inside after |

```html
<div class="tscroll">
  <pre class="mermaid">
    flowchart LR
      A[OrderHandler] --> B[OrderValidator]
      B --> C[OrderRepo]
      C -.leak.-> D[PricingClient]
      classDef leak fill:#ECEAF6,color:#292D3E,stroke:#C0304C,stroke-width:2px;
      class C,D leak
  </pre>
</div>
```

## Style guidance

- Use the look of `app.css`. Do not add fonts or a palette. Use its tokens in a diagram.
- Colour sparingly: red (`--error`) for leakage and amber (`--need`) for warnings.
- Keep diagrams ~320px tall so before/after sits comfortably side by side without scrolling.
- Set module labels inside diagrams in small uppercase letters, so they read as schematic, not as UI.

## Tone

Use the words of `aleph:codebase-design` exactly: module, interface, implementation, depth, deep, shallow, seam,
adapter, leverage, locality. Do not use component, service or unit for module, API or signature for interface,
or boundary for seam. A gain names its glossary term ("locality: bugs concentrate in one module"), never "easier
to maintain" or "cleaner code".
