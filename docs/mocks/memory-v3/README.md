# Memory v3 mocks

The user asked on 2026-11-20 for new memory page mocks after the changes of 2026-11-19:

- `c3d6e604` removes the factory memory writers: episodes, lessons, proposals.
- `f4df41a5` runs factory agents with no vault context, so recall serves the user's sessions only.
- `1697e58c` refuses a vault commit that grows a scope's start context past 6,000 bytes.

`build.ts` draws each board with the UI's own helpers (`ui/views/lib/html.js`) and `app.css`, on `data.json`: the live
`/api/memory`, `/api/memory/processes` and `/api/memory/log` of 2026-11-20. Rebuild with `bun docs/mocks/memory-v3/build.ts`.
Not built.

| Board | File | Shows |
|---|---|---|
| A · Headroom | `a-headroom.html` | Three tabs stay. Health leads with the budget: a headroom tile, a bar per scope and every core line, fewest offers first. |
| B · Two tiers | `b-two-tiers.html` | Notes splits into Every Session (MEMORY.md and core lines, with the budget) and On Recall (the wiki notes). |
| C · One page | `c-one-page.html` | No tabs. Tiles, budget, maintainer, notes, recent writes and lint on one page. |

## Decisions in every board

- **Budget in Needs you.** "aleph 50 B left" replaces "core lines cut". Since `1697e58c` a growing write is refused, so no line is cut.
  The item shows under 200 B left (design.md, Principle 5: show what needs the user).
- **Trim list.** Every kept core line, fewest offers in 8 days first, is the list to cut from when a write is refused.
- **Kind filter by note kind.** decision, gotcha, project, entity, concept replace the five memory types. Episodic held
  episode pages, which `c3d6e604` removes.
- **No episode charts.** The Log tab's Episode Page Writes chart and its filter go.
- **Terse text.** Ledes are one line; notes are one or two words (CLAUDE.md, UI).

## Open

- Real data shows 145 refused lint findings on 11 notes, 144 of them `dangling`. Each board shows them as they are.
- Core line bytes (4,148 B) plus MEMORY.md (1,838 B) exceed the 5,950 B sent, so the per-part split of today's Start
  Context card does not add up. The boards leave the "Tags and pointer" row out.
