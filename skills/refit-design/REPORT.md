# Design retro report

The report of a refit-design `retro`. It has the shape of refit-code's [REPORT.md](../refit-code/REPORT.md): Header,
Summary, All candidates raw, Units, Proposals, in a directory with `index.html` and `app.css`. Its scaffold and
class names are in refit-code's [HTML.md](../refit-code/HTML.md). This file holds only what is specific to design.
A design report uses the design language of the UI it scans: aleph classes and tokens from `ui/app.css`, no Tailwind.
It cites only rules of `docs/design.md`.

## Directory

Write `<tmpdir>/refit-design-retro-<timestamp>/`. Besides `index.html` and `app.css` it holds
`shots/<route>-<theme>-<width>.png`: each screenshot, as a file. Link it with a relative path.

The report links the live Kit at `/#/kit` on the same origin. The link text names the specimen by its id, the first
argument of a `spec(id, ...)` call in `ui/views/kit.js`, such as `Kit: metric`. The Kit section of that id has the
anchor `kit-<id>`. A report opened from a host that has no Kit says so in the Header and drops the links.

## Differences from the shared shape

1. **Summary.** The kinds are missing token, one-off, mismatch and local defect. One line for each finding with its
   component and rule.
2. **All candidates, raw.** The fields of a row are the rule, `file:line` or screenshot, kind, lens and the proof
   text.
3. **Units.** The unit is a component kind of the page, in the page's order. Inside it, one subsection per variant of
   the kind. List every component on the page, with or without an issue, one entry each. A metric card is one entry
   for all its variants unless a variant differs. A table gets its own entry when its columns or rows differ from
   the specimen. Put `data-annotate="<kind>[/<variant>]"` on each entry, with the kind and the variant as the Kit
   names them in lower case, such as `metric-card/status` or `table/roles`. A component entry takes the place of
   the unit section and of its finding cards: its broken rules are the findings.
4. **Proposals.** Each change to `docs/design.md` that the scan asks for: where, the evidence (3 or more uses, with
   `file:line`) and the sentence the doc needs.

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

**No rule.** A component that no rule of `docs/design.md` covers says "No rule covers this." It is a proposal in
Proposals when 3 or more places use it.

An entry with no issue has the followed list only. An entry with issues has both lists.

```html
<section class="card" id="components" aria-label="Components">
  <div class="sh"><h2>Components</h2></div>
  <h3 class="sub-head">{{kind}}</h3>
  <div data-annotate="{{kind}}/{{variant}}">
    <p><span class="badge stuck">broken</span> {{component}} <a href="/#/kit">kit {{id}}</a></p>
    <img src="shots/{{file}}.png" alt="{{component}}">
    <ul><li>{{rule}}</li></ul>
  </div>
</section>
```

Use `badge` tones for a status: `stuck` for a broken entry, `done` for a passing one. Give an image a
`max-width: 100%` through a `style` attribute only when `app.css` has no class for it. Add no `<script>`.
