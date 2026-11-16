# Design retro report

The report of a refit-design `retro`. It replaces refit-code's [REPORT.md](../refit-code/REPORT.md) and
[HTML.md](../refit-code/HTML.md) for this skill. A design report uses the design language of the UI it scans: aleph
classes and tokens from `ui/app.css`, no Tailwind. It cites only rules of `docs/design.md`.

## Directory

Write `<tmpdir>/refit-design-retro-<timestamp>/`, with `<tmpdir>` from `$TMPDIR`, else `/tmp`:

- `index.html`: the report.
- `app.css`: a copy of `ui/app.css` from the scanned commit (`git show <commit>:ui/app.css`), so the report keeps its
  look when the CSS changes.
- `shots/<route>-<theme>-<width>.png`: each screenshot, as a file. Link it with a relative path.

The report links the live Kit at `/#/kit` on the same origin. The link text names the specimen by its id, the first
argument of a `spec(id, ...)` call in `ui/views/kit.js`, such as `Kit: metric`. The Kit section of that id has the
anchor `kit-<id>`. A report opened from a host that has no Kit says so in the Header and drops the links.

## Parts

Five parts, in this order. Each is a `<section class="card">`, so `.card` rules apply and no card sits in a card:
a variant is an `<h3 class="sub-head">`, not a card.

1. **Header.** Repo name, date, the commit scanned, the scope, the lenses run. A count line per lens: candidates,
   findings, dropped. Use `.facts` for the first four and a table for the lens counts.
2. **Summary.** The findings grouped by kind (missing token, one-off, mismatch, local defect), then by theme inside a
   kind: one `<h3 class="sub-head">` per theme, one line for each finding with its component and rule. Then
   **Actions**: a numbered list in the order to act, one sentence each. Rank by drift that already cost a fix, then by
   the pages that the finding touches. A repeated cause is one theme and one action. This part replaces a top finding.
3. **All candidates, raw.** One `<details>` that is closed. It holds one table: one row per candidate, with every field
   the hunt returned, copied verbatim (rule, `file:line` or screenshot, kind, lens, the proof text), then the verdict
   (finding, dropped, accepted) and its reason. Add no field and edit no text. It replaces the Accepted and Dropped
   tables.
4. **Components.** One section per component kind of the page, in the page's order. Inside it, one subsection per
   variant of the kind. List every component on the page, with or without an issue, one entry each. A metric card is
   one entry for all its variants unless a variant differs; a table gets its own entry when its columns or rows
   differ from the specimen. Put `data-annotate="<kind>[/<variant>]"` on each entry, with the kind and the variant
   as the Kit names them in lower case, such as `metric-card/status` or `table/roles`.
5. **Proposals.** Each change to `docs/design.md` that the scan asks for: where, the evidence (3 or more uses, with
   `file:line`) and the sentence the doc needs. Omit the part when there are none. The skill changes no doc text.

## Component entry

An entry is a `<div data-annotate="...">`. A broken rule and a kept rule differ:

**Rules broken.** One block per finding, with:

- the rule: its `docs/design.md` section and the rule text, quoted;
- a screenshot of the component as drawn, cropped from the shots, and a link to its specimen on the live Kit
  (`/#/kit`, text `Kit: <id>`);
- the location, `file:line`, one each;
- the proof, the fix and the hold, one sentence each as PROVE.md's step 2 gives them.

**Rules followed.** One list item per rule the component keeps: the `docs/design.md` section, then the rule text,
quoted. Name the most specific rules. "Follows the design" is not an item. Cite the rule, such as "Table: Put each
number in `td.num`".

**No rule.** A component that no rule of `docs/design.md` covers says "No rule covers this." It is a proposal in part
5 when 3 or more places use it.

An entry with no issue has the followed list only. An entry with issues has both lists.

## Scaffold

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Design retro for {{repo}}</title>
  <link rel="stylesheet" href="app.css">
</head>
<body>
<div class="page sp">
  <header class="ph"><h1>Design Retro</h1><span class="count">{{route}}</span></header>

  <section class="card" id="header" aria-label="Header">
    <div class="sh"><h2>Header</h2></div>
    <dl class="facts"><div><dt>Repo</dt><dd>{{repo}}</dd></div><div><dt>Commit</dt><dd>{{sha}}</dd></div></dl>
  </section>

  <section class="card" id="summary" aria-label="Summary">
    <div class="sh"><h2>Summary</h2></div>
    <h3 class="sub-head">{{kind}}: {{theme}}</h3>
    <ol>...</ol>
  </section>

  <section class="card" id="raw" aria-label="All candidates">
    <div class="sh"><h2>All Candidates</h2><span class="count">{{n}}</span></div>
    <details><summary>Raw listing</summary>
      <div class="tscroll"><table class="tbl"><thead><tr><th>Lens</th>...</tr></thead><tbody>...</tbody></table></div>
    </details>
  </section>

  <section class="card" id="components" aria-label="Components">
    <div class="sh"><h2>Components</h2></div>
    <h3 class="sub-head">{{kind}}</h3>
    <div data-annotate="{{kind}}/{{variant}}">
      <p><span class="badge stuck">broken</span> {{component}} <a href="/#/kit">kit {{id}}</a></p>
      <img src="shots/{{file}}.png" alt="{{component}}">
      <ul><li>{{rule}}</li></ul>
    </div>
  </section>

  <section class="card" id="proposals" aria-label="Proposals">...</section>
</div>
</body>
</html>
```

Use `badge` tones for a status: `stuck` for a broken entry, `done` for a passing one. A report draws in light and
dark with no extra code, because `app.css` sets both. Give an image a `max-width: 100%` through a `style` attribute
only when `app.css` has no class for it. Add no `<script>`.
