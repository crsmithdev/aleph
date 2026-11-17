# Design report

The report of a refit-design run. It has the shape of [refit/REPORT.md](../refit/REPORT.md), with the
scaffold and class names of [refit/HTML.md](../refit/HTML.md). This file holds only what is specific to design. The
report uses the aleph classes and tokens of `ui/app.css`, no Tailwind. It cites only rules of `docs/design.md`.

## Directory

The run directory of [refit/FINDINGS.md](../refit/FINDINGS.md), besides `index.html` and `app.css` it holds
`shots/<route>-<theme>-<width>.png`, one file per screenshot, linked by a relative path.

Link the live Kit by its absolute URL, such as `http://aleph.home/#/kit`, because the shelf serves the report from
another host, where `/#/kit` finds nothing. The link text names the specimen by its id, the first argument of a
`spec(id, ...)` call in `ui/views/kit.js`, such as `Kit: metric`. The Kit section of that id has the anchor
`kit-<id>`.

## Differences from the shared shape

1. **Findings** (the card above Proposals). The kinds are missing token, one-off, mismatch, local defect, state, stress, hand
   markup and slop.
2. **Units.** The unit is a component kind of the page, in the page's order, as an `h3.sub-head`. Under it, list
   the findings in the page's order. List only the components with a broken rule: a component that passes gets
   no line, badge or list. A metric card is one component for all its variants unless a
   variant differs. A table is its own component when its columns or rows differ from the specimen.
3. **Proposals.** Each change to `docs/design.md` that the scan asks for: where, the evidence (3 or more uses, with
   `file:line`) and the sentence the doc needs.

## Finding

The finding comes first, and the components it breaks come under its title. A finding is a
`<div class="finding" id="f<n>">`, in this order:

1. the title: its number, the change as an imperative, and the chips of its lens, kind and tier (**auto** or **ask**),
   then its result as refit/REPORT.md gives it, then the Kit link. Put `data-annotate="<kind>[/<variant>]"` on the finding, with the kind and the variant as the
   Kit names them in lower case, such as `metric-card/status` or `table/roles`. A finding that breaks a rule in two
   components sits under the kind of the first. No line under the title names the component again;
2. the fix, one sentence as PROVE.md's step 2 gives it;
3. a screenshot of the part the finding names, as drawn on the page, cropped from the shots, with no caption: its
   `alt` names it. Show it at most 480px wide, as a link that opens the full shot in a new tab. Show no Kit
   specimen: the Kit link stands for the rule. Show each picture once;
4. one closed `<details>`, summary "Details", that holds the rest: the rule (its `docs/design.md` section and the
   rule text, quoted), the locations (`file:line`, one each), a "Shot: see" line with a link to the finding that
   shows a repeated picture, and the guard, one sentence.

**No rule.** A component that no rule of `docs/design.md` covers says "No rule covers this." It is a proposal in
Proposals when 3 or more places use it.

```html
<section class="card" id="components" aria-label="Components">
  <div class="sh"><h2>Components</h2></div>
  <h3 class="sub-head">{{kind}}</h3>
  <div class="finding" id="f{{n}}" data-annotate="{{kind}}/{{variant}}">
    <p class="ft"><b>{{n}}. {{title}}</b> <span class="chip">{{lens}}</span><span class="chip">{{kind}}</span><span class="chip">{{tier}}</span> <span class="quiet">{{result}}</span> <a href="http://aleph.home/#/kit">Kit: {{id}}</a></p>
    <p class="fix"><b>Fix</b>: ...</p>
    <figure><a href="shots/{{file}}.png" target="_blank"><img src="shots/{{file}}.png" alt="{{part}}" style="max-width:480px"></a></figure>
    <details><summary>Details</summary>
      <p class="aux"><b>Rule</b>: {{rule}}</p>
      <ul class="locs"><li><code>{{file:line}}</code></li></ul>
      <p class="aux"><b>Guard</b>: ...</p>
    </details>
  </div>
</section>
```

Size shows rank, and no part outranks its parent. The page title, the card head and the kind head
step down from `--fs-metric` to `--fs-2xl`. A finding's title is below them at `--fs-lg`, then the fix at `--fs-md`.
The rule, the locations and the guard recede at `--fs-sm` in `--muted`. Set it in the report's `<style>`, from tokens:

```css
.ph h1 { font-size: var(--fs-metric); }
.sh h2 { font-size: var(--fs-xl); }
#components h3.sub-head { font-size: var(--fs-2xl); }
.finding .ft { font-size: var(--fs-lg); color: var(--ink); margin: 0 0 var(--sp-4); }
.finding .fix { font-size: var(--fs-md); color: var(--ink); margin: var(--sp-8) 0; }
.finding .fix b { color: var(--done); }
.finding .aux, .finding ul.locs { font-size: var(--fs-sm); color: var(--muted); }
```

Give an image its `max-width` through a `style` attribute only when `app.css` has no class for it. Add no `<script>`.
