# HTML

Adapted from the HTML report of Matt Pocock's `improve-codebase-architecture` (github.com/mattpocock/skills @4ae2317).
[REPORT.md](REPORT.md) says what the report holds; this file says how it looks. [example.html](example.html) is a
worked report, a cut of a refit-code scan: copy its markup. Its look comes from two stylesheets in the run directory:

- `app.css`: the copy of `ui/app.css` that REPORT.md's Directory names.
- `report.css`: a copy of [report.css](report.css). It holds the sizes, the finding row and the figure layer, on the
  tokens of `app.css`.

The report adds no `<style>` and no `<script>`. A rule that `report.css` lacks goes into `report.css`, so every
refit skill gets it.

## Markup

The parts, in the order of REPORT.md's Parts:

```html
<header class="ph"><h1>Refit</h1><span class="count">{{skill}} · {{repo}}</span><div class="aside"><a href="{{shelf base}}/shelf/">Shelf</a></div></header>

<section class="card ov" id="overview" aria-label="Overview">
  <dl class="facts"><div><dt>Commit</dt><dd>{{sha}}</dd></div>...</dl>
  <div class="tally">
    <a class="need" href="#ask"><b>{{asks}}</b><span>ask: need you</span></a>
    <a href="#auto"><b>{{autos}}</b><span>auto: safe to fix</span></a>
    <a href="#dropped"><b>{{dropped}}</b><span>dropped</span></a>
  </div>
  <details><summary>{{fold names}}</summary><h4>{{fact}}</h4><ul><li>...</li></ul></details>
</section>

<section class="card" id="ask" aria-label="Ask">
  <div class="sh"><h2>Ask</h2><span class="count">{{asks}}</span></div>
  <p class="lede">Each fix changes behaviour someone sees.</p>
  <div class="group"><h3 class="gh">{{group}}<span class="count">{{n}}</span></h3>
    <div class="finding" id="f{{n}}" data-annotate="f{{n}}">
      <p class="ft"><span class="n">{{n}}</span><span class="t">{{title}}</span><code class="u">{{unit}}</code><span class="chips"><span class="badge {{tone}}">{{strength}}</span><span class="sig">{{signal}}</span></span></p>
      <div class="fb">
        <p class="ask"><span class="badge need">ask</span> {{trigger}}</p>
        <p class="fix">{{fix}}</p>
        {{the diff panel or the figure}}
        <details class="more"><summary>Locations, guard</summary><ul class="locs"><li><code>{{file:line}}</code></li></ul><p class="aux"><b>Guard</b>: {{guard}}</p></details>
      </div>
    </div>
  </div>
</section>

<section class="card" id="auto" aria-label="Auto">
  <!-- as Ask, with each finding a closed <details class="finding"> and its row the <summary class="ft"> -->
  <p class="clean">No findings: <code>{{unit}}</code>, ...</p>
</section>

<section class="card" id="dropped" aria-label="Dropped">
  <details><summary>Dropped: {{dropped}}</summary><div class="tscroll"><table class="tbl">...</table></div></details>
</section>
```

- **Row.** The number, the title, the unit in `code.u`, then at the right the strength badge and the signal. The
  group head names the lens, so the row shows no lens chip.
- **Strength tone.** `Disagrees` and a proven or 4-5 rating are `error`. `Duplicates`, `measured` and a 1-3 rating
  are `need`. A dead tier is `quiet`.
- **Diff panel.** With `figure` false, `before` and `after` go into one `.diff-panel`: each line of `before` is a
  `<span class="l d-del">- ...</span>`, each line of `after` a `<span class="l d-add">+ ...</span>`. An `after` that
  says the lines go, such as `(gone)`, is one `<span class="l d-hunk">` line. A layout finding shows its file tree
  this way.
- **Legend.** The Ask card holds the figure key above its first group, as `svg.key` in example.html. It shows only
  when the report draws a figure.

## Figure

One figure per finding with `figure` true, in place of the diff panel: one `<figure class="refit">` with one inline
`<svg>` of one `viewBox`, two side-by-side panels, "Before" on the left and "After" on the right, and one
`<figcaption>` that states the gain in one sentence with its glossary term ("Locality: the regex lives in one
module"). The caption does not repeat the title. The page holds the arrow markers once, in the hidden `<svg>` at the
top of `<body>` in example.html.

- **Same place.** Each node keeps its position in both panels. At most 8 boxes per panel. Over 8: draw the owner and the 7 largest, and name the rest in the Locations fold.
- **After.** The fix's owner is the one dark box (`.own`). What the fix removes is greyed (`.gone`, dashed) or dropped. A former copy that stays as a caller is grey.
- **Before.** A disagreement or leak is a red dashed edge (`.leak`) with its verb on it.
- **Verbs.** Each arrow carries a verb: `calls`, `reads`, `diverges`.
- **State twice.** Each state has a class and a word in the box: `owner`, `copy`, `caller`, `gone`. A line has a dash pattern as well as a colour.
- **Size.** Labels are 14 units or larger and 9 units above their line, about 18 characters per line (a second line is a `<tspan x=".." dy="1.2em">`). Boxes are 40 units apart or more, and arrows run in right angles (`M x y H x V y`).
- **Evidence.** A box holds the file name and the line or symbol of the finding, in full. Over 18 characters, drop
  the directory, then widen the box: a label never ends in "...".

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
  <figcaption>Locality: both callers use parseRef, so one regex stays.</figcaption>
</figure>
```

## Tone

Use the words of `aleph:codebase-design` exactly: module, interface, implementation, depth, deep, shallow, seam,
adapter, leverage, locality. Do not use component, service or unit for module, API or signature for interface,
or boundary for seam. A gain names its glossary term ("locality: bugs concentrate in one module"), never "easier
to maintain" or "cleaner code".
