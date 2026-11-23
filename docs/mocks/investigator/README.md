# Investigator on the issue page

Request (the user, 2026-11-19): an investigator agent started by a button on issue and job pages, whose findings and
recommended issues show when it ends. Spec: `docs/specs/2026-11-19-investigator.md`.

`index.html` is drawn by `gen.ts` with the page's own helpers (`ui/views/lib/html.js`) and a copy of `ui/app.css`.
Rebuild: `bun docs/mocks/investigator/gen.ts`.

## Decisions

1. Investigate sits in the page head beside Edit, as Run now does (`issueHead`, `ui/views/issues.js`). While a run is
   live it reads Running and is disabled.
2. The result is one card, Investigation, under the facts: summary, causes, recommended issues. The timeline and older
   runs fold, because the causes and issues are what the user acts on.
3. Each cause shows its evidence and its confidence (`measured`, `reported`, `inferred`, the vault's words).
4. Each recommended issue has File and Dismiss. One that an open issue covers shows `existing`, its link and Note.
5. The card's aside gives when, model, cost and time, so each run's cost is in view (PRINCIPLES.md rule 6).

## Fixture

The content is issue.3350 as this session traced it by hand. It shows the shape, not a real run: the first cause and
the first and third issues are examples, not verified findings.
