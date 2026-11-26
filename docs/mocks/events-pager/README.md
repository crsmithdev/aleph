# Events pager options

Request: page every list in one form (codebase-design, "A route is a module"). `/api/jobs` and `/api/sessions` page by cursor (`before`, `next`). `/api/log` and the session chat page by number (`page`, `from`). The user chose the cursor form, and `design/components/pager.md` bans a More button that grows the page. This mock shows the three ways out.

`build.ts` draws page 2 of the Events card with the real `renderLog` from `data.json`: two live pages of 25 events from a week of 2888 (2026-11-25).

- **1, cursor with Previous and Next.** The pager stays as `pager.md` draws it. The reply adds `prev` and `from`, so the pager can go back and show `26–50 of 2888`. One param form for every list.
- **2, cursor with More.** More adds 25 rows below. The page grows, which `pager.md` "Do and don't" bans, so that rule changes too.
- **3, two forms by source.** No change to the log or the chat. The rule in codebase-design changes to: cursor for a list read in pages from its source, page numbers for a list the server holds whole.

Seen in the data: 25 API rows draw as 13 table rows, because a run's rows fold into one. A page edge can split a run: page 2 opens with the `started` row of j11251, whose `done` row is on page 1. Option 2 joins the two halves; options 1 and 3 do not.

`mock.css` holds the frame only, and the `.api` block that shows each request.

Round 2, the user's note: glyphs in place of "Previous 25" and "Next 25". Each pager button is a Font Awesome chevron (`wa-icon`, the icon set the sidebar and table heads use), with its words in `aria-label` and `title` (`design/rules.md`, "Ellipsis and icons"). The range sits between the two chevrons. More is a down chevron. The new class `button.act.glyph` in `mock.css` needs a home in `ui/app.css` and `design/components/pager.md` if it is chosen.
