---
name: explainer
description: >
  Explainer: draw an issue, a plan, an idea, a system or a change as one self-contained HTML page of figures, with
  each fact traced to its source. Use when asked to explain something visually, to diagram or draw it, or for an
  explainer, an infographic or a picture of how something works.
---

# Explainer

One HTML page that a reader understands in ten seconds. Figures carry the page; words label them. Each fact on the
page has a source, so the page is a map that can be checked against the territory.

Methods drawn from nicobailon/visual-explainer (figure rules), erenilhan/claude-explain (claims and sources) and
coleam00/excalidraw-diagram-skill (shape follows meaning, render and look).

## Steps

1. **Ground.** Read the subject itself: `aleph issue show <repo> <n>`, its spec and notes, the code it touches, the
   vault notes it names, the git log. List each fact you will draw beside its source: `file:line`, issue ID, commit,
   vault note or URL. Done when every fact on the list has a source, or is marked inferred.
2. **State the answer.** Write the one sentence the page exists to say, for example "An open issue starts a build
   within a minute, so park work you build yourself". Done when the sentence makes a claim, not a topic.
3. **Pick the figures** from the table below, one claim each, three to six in all. Sketch each in ASCII on a grid
   before any SVG. Done when each sketch has its claim written above it.
4. **Write the page.** Copy [`base.html`](base.html) to `~/.aleph/explainers/<slug>.html` (the slug names the
   subject: `aleph-1733-test-git-leak`) and fill it. Use its classes and tokens; add CSS only for what the page
   needs that the base lacks.
5. **Check and look.** Run `bun <this skill's directory>/check.ts <page>`. Fix each `✗` line. Then read the three
   screenshots it prints and fix what a reader would trip on: a crowded figure, a first screen that is not the
   answer, a label too small. Fix with small edits and run the check again. Done when the check prints no `✗` and
   the first-screen screenshot shows the headline, the answer and the start of the first figure.
6. **Reply** with the page's path and the answer sentence.

## Figures

| Content | Figure |
|---|---|
| Flow, pipeline, architecture, sequence, before and after | inline SVG boxes and arrows |
| A process over time, a state machine, a queue | SVG stepper: one change per step |
| Options, cases, failure modes | small multiples: one mini drawing per case, same coordinates |
| A plan's parts and their order | a timeline or a dependency graph in SVG |
| Many items with a status | a table with chips |
| Numbers | bars, a sparkline or a dimension line, beside or on the drawing |
| An idea not yet decided | the decided parts solid, the open parts in `.idea` (dashed, violet) |

- **One claim per figure.** The `<figcaption>` states it in one sentence: "The retry doubles the wait", not "Retries".
- **Draw the mechanism.** Draw the request's path through the cache, not one box named "cache". Each arrow carries a
  verb on it: `writes`, `polls 30 s`, `pushes`.
- **Shape follows meaning.** Fan-out for one to many, a funnel for many to one, a line for a sequence, a loop for a
  retry. A grid of equal cards is for items that are equal.
- **Shape says the kind.** A rect is a process or service, a cylinder is a store, a dashed rect is optional or off,
  a dashed boundary `.bnd` with a `.bnd-t` label is a machine, repo or trust zone.
- **Encode state twice:** a class (`.ok`, `.risk`, `.warn`, `.key`) and a word or a dash pattern, so it reads
  without colour.
- **The key path** is `.edge.key` and `.node.key`, one per figure: the part the caption is about.
- **Numbers get pictures.** A span (a wait, a size) gets a dimension line `.dim` on the span, with its value above.
- **Real evidence.** Put the real command, file name, field or JSON in the figure (`.t-mono`), not a stand-in.
- **Grid geometry.** Columns 200–240 units apart, at least 40 units between boxes, orthogonal arrows
  (`M x y H x V y`), labels 14 units or larger and 9 units above their line. SVG text does not wrap: about 18
  characters per line, a second line as `<tspan x=".." dy="1.2em">`. Over 12 nodes: draw a 5–8 node overview and a
  second figure for the detail.
- **Callouts** `.co` (a numbered circle and a `.lead` line ending on the point) for 3–6 points per figure, explained
  in an `<ol class="notes">` below the drawing.
- **Stepper:** `<figure data-steps="N">`; an element with `data-s="k"` shows from step k on, `data-only="k"` only at
  step k; `<li data-say="k">` in an `<ol hidden>` inside the figure gives step k its line. The base page adds Back and Next.

## Page

- The first screen is the answer: the kicker (what the subject is: `aleph-1733 · bug`), a headline that states the
  takeaway, the answer sentence, and the first figure. A reader who stops there has the point.
- Then one section per figure, each opened by its figure, with one to three sentences of reasoning after it.
- Last, `<section id="sources">`: one row per claim, the claim and its source. A claim you inferred has
  `<span class="inferred">inferred</span>` in its source cell.
- Words: the sentence rules of `identity/VOICE.md` (ASD-STE100).
- The page stands alone. It loads only its fonts, and it reads the same with them blocked; the aleph UI shows it in a
  sandboxed frame.
