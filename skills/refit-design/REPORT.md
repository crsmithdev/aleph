# Design report

The report of a refit-design run. It has the shape of [refit/REPORT.md](../refit/REPORT.md), with the
markup and `report.css` of [refit/HTML.md](../refit/HTML.md). This file holds only what is specific to design. The
report uses the aleph classes and tokens of `ui/app.css`, no Tailwind. It cites only rules of `design/rules.md` and `design/components/`.

## Directory

The run directory of [refit/FINDINGS.md](../refit/FINDINGS.md), besides `index.html`, `app.css` and `report.css` it holds
`shots/<route>-<theme>-<width>.png`, one file per screenshot, linked by a relative path.

Link the live Design page by its absolute URL, such as `http://aleph.home/#/design`, because the shelf serves the report from
another host, where `/#/design` finds nothing. The link text names the specimen by its id, the first argument of a
`spec(id, ...)` call in `ui/views/design.js`, such as `Design: metric`. The Design section of that id has the anchor
`design-<id>`.

## Differences from the shared shape

1. **Groups.** A group is a component kind of the page, in the page's order, in place of a lens. Under it, list the
   findings in the page's order. List only the components with a broken rule: a component that passes gets
   no line, badge or list. A metric card is one component for all its variants unless a
   variant differs. A table is its own component when its columns or rows differ from the specimen.
2. **Row.** The strength is the kind: missing token, one-off, mismatch, local defect, state, stress, hand markup or
   slop. The signal is the lens. After the signal, the Design link.
3. **Proposals.** Each change to `design/` that the scan asks for: where, the evidence (3 or more uses, with
   `file:line`) and the sentence the doc needs.

## Finding

The finding card of [refit/REPORT.md](../refit/REPORT.md), with three changes:

1. `data-annotate="<kind>[/<variant>]"` in place of `f<n>`, with the kind and the variant as the Design page names
   them in lower case, such as `metric-card/status` or `table/roles`. A finding that breaks a rule in two
   components sits under the kind of the first.
2. **Before / after** is a screenshot of the part the finding names, as drawn on the page, cropped from the shots,
   with no caption: its `alt` names it. Show it at most 480px wide, as a link that opens the full shot in a new
   tab. Show no Design specimen: the Design link stands for the rule. Show each picture once.
3. **Locations, guard** opens with the rule: its rule id and the rule text, quoted. A repeated
   picture gets a "Shot: see" line with a link to the finding that shows it.

**No rule.** A component that no rule in `design/` covers says "No rule covers this." It is a proposal in
Proposals when 3 or more places use it.

```html
<div class="group"><h3 class="gh">{{kind}}<span class="count">{{n}}</span></h3>
  <div class="finding" id="f{{n}}" data-annotate="{{kind}}/{{variant}}">
    <p class="ft"><span class="n">{{n}}</span><span class="t">{{title}}</span><code class="u">{{variant}}</code><span class="chips"><span class="badge {{tone}}">{{design kind}}</span><span class="sig">{{lens}}</span> <a href="http://aleph.home/#/design">Design: {{id}}</a></span></p>
    <div class="fb">
      <p class="fix">{{fix}}</p>
      <figure><a href="shots/{{file}}.png" target="_blank"><img src="shots/{{file}}.png" alt="{{part}}" style="max-width:480px"></a></figure>
      <details class="more"><summary>Locations, guard</summary>
        <p class="aux"><b>Rule</b>: {{rule}}</p>
        <ul class="locs"><li><code>{{file:line}}</code></li></ul>
        <p class="aux"><b>Guard</b>: ...</p>
      </details>
    </div>
  </div>
</div>
```
