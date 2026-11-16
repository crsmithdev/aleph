# HTML

Adapted from the HTML report of Matt Pocock's `improve-codebase-architecture` (github.com/mattpocock/skills @4ae2317). [REPORT.md](REPORT.md) says what the report holds; this file says how it looks.

The report is a directory in the OS temp directory: `index.html` and `app.css`. It uses the aleph classes of `app.css`: `page`, `card`, `sh`, `sub-head`, `facts`, `tbl`, `badge` and `tscroll`. It uses no Tailwind. The one script is the Mermaid import from its CDN, and the report needs it only when a diagram uses Mermaid. Mermaid handles graph-shaped diagrams reliably. Hand-built divs and inline SVG handle the more editorial visuals (mass diagrams, cross-sections). Mix the two: Mermaid for everything looks generic.

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
    .leak { stroke: var(--stuck); }
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
  <header class="ph"><h1>Refit Retro</h1><span class="count">{{skill}}</span></header>

  <section class="card" id="overview" aria-label="Overview">
    <div class="sh"><h2>Overview</h2><span class="count">{{n}} findings</span></div>
    <dl class="facts"><div><dt>Repo</dt><dd>{{repo}}</dd></div><div><dt>Date</dt><dd>{{date}}</dd></div><div><dt>Commit</dt><dd>{{sha}}</dd></div></dl>
    <div class="tscroll"><table class="tbl"><thead><tr><th>Lens</th><th>Candidates</th><th>Findings</th><th>Dropped</th></tr></thead><tbody>...</tbody></table></div>
    <h3 class="sub-head">{{kind}}: {{theme}}</h3>
    <ul>...</ul>
    <h3 class="sub-head">Actions</h3>
    <ol>...</ol>
    <details><summary>Raw listing ({{candidates}})</summary>
      <div class="tscroll"><table class="tbl"><thead><tr><th>Lens</th>...<th>Verdict</th><th>Reason</th></tr></thead><tbody>...</tbody></table></div>
    </details>
  </section>

  <section class="card" id="units" aria-label="Units">
    <div class="sh"><h2>Units</h2></div>
    <div data-annotate="{{unit id}}">
      <h3 class="sub-head">{{unit}}</h3>
      <div data-annotate="f{{n}}">
        <p><strong>{{title}}</strong> <span class="badge stuck">{{lens}}</span> <span class="badge need">{{strength}}</span></p>
        <ul><li><code>{{file:line}}</code></li></ul>
        <div class="tscroll">{{diagram}}</div>
        <p>Proof: ...</p><p>Fix: ...</p><p>Hold: <code>...</code></p>
      </div>
    </div>
    <div data-annotate="{{other unit id}}"><h3 class="sub-head">{{unit}}</h3><p>No issues.</p></div>
  </section>

  <section class="card" id="proposals" aria-label="Proposals">...</section>
</div>
</body>
</html>
```

A report with no Mermaid diagram leaves out the `<script>`. A report draws in light and dark with no extra code, because `app.css` sets both. Without a `ui/app.css`, replace the link with a small `<style>` that defines the same class names.

## Diagram patterns

Pick the pattern that fits the candidate. Mix them. Don't make every diagram look the same. Variety is part of the point.

### Mermaid graph (the workhorse for dependencies / call flow)

Use a Mermaid `flowchart` or `graph` when the point is "X calls Y calls Z, and look at the mess." Put it in a `div.tscroll` inside the finding. Style with classDef to colour leakage edges red and the deep module dark. Give every classDef a `fill` and a `color` pair, so a node reads in light and dark. Sequence diagrams work well for "before: 6 round-trips; after: 1."

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

### Hand-built boxes-and-arrows (when Mermaid's layout fights you)

Modules as `<div>`s with borders and labels. Arrows as inline SVG `<line>` or `<path>` elements positioned absolutely over a relative container. Reach for this when you want the "after" diagram to feel like one thick-bordered deep module with greyed-out internals, since Mermaid won't render that with the right weight.

### Cross-section (good for layered shallowness)

Stack horizontal bands (`div`s of equal height with a left border) to show layers a call passes through. Before: 6 thin layers each doing nothing. After: 1 thick band labelled with the consolidated responsibility.

### Mass diagram (good for "interface as wide as implementation")

Two rectangles per module: one for interface surface area, one for implementation. Before: interface rectangle is nearly as tall as the implementation rectangle (shallow). After: interface rectangle is short, implementation rectangle is tall (deep).

### Call-graph collapse

Before: a tree of function calls rendered as nested boxes. After: the same tree collapsed into one box, with the now-internal calls shown faded inside it.

## Style guidance

- Use the look of `app.css`. Do not add fonts or a palette. Use its tokens in a diagram.
- Colour sparingly: red (`--stuck`) for leakage and amber (`--need`) for warnings.
- Keep diagrams ~320px tall so before/after sits comfortably side by side without scrolling.
- Set module labels inside diagrams in small uppercase letters, so they read as schematic, not as UI.
- The only script is the Mermaid ESM import. The report is otherwise static: no app code, no interactivity beyond Mermaid's own rendering.

## Tone

Plain English, concise, but the architectural nouns and verbs come straight from the `aleph:codebase-design` skill. Concision is not an excuse to drift.

**Use exactly:** module, interface, implementation, depth, deep, shallow, seam, adapter, leverage, locality.

**Never substitute:** component, service, unit (for module) · API, signature (for interface) · boundary (for seam) · layer, wrapper (for module, when you mean module).

**Phrasings that fit the style:**

- "Order intake module is shallow: interface nearly matches the implementation."
- "Pricing leaks across the seam."
- "Deepen: one interface, one place to test."
- "Two adapters justify the seam: HTTP in prod, in-memory in tests."

**Wins bullets** name the gain in glossary terms: *"locality: bugs concentrate in one module"*, *"leverage: one interface, N call sites"*, *"interface shrinks; implementation absorbs the wrappers"*. Don't write *"easier to maintain"* or *"cleaner code"*, because those terms aren't in the glossary and don't earn their place.

No hedging, no throat-clearing, no "it's worth noting that…". If a sentence could be a bullet, make it a bullet. If a bullet could be cut, cut it. If a term isn't in the `aleph:codebase-design` glossary, reach for one that is before inventing a new one.
