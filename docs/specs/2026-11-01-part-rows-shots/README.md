# Shots of the part rows at 1280 px

Part of aleph-933. These are the first browser shots of the part rows (`.part-row`, rendered by `renderRow`) and the Parts table on the Issue page, for the fixture issue demo-28 and its two parts, taken at the branch head (468f738).

Fixture and server: `eval "$(bun ui/fixtures/review/build.ts /tmp/fx | sed 's/^/export /')" && bun ui/server.ts --port 3002` (the build prints the ALEPH_* variables the server needs). Shots by `aleph-shot`, light scheme, 1280x900:

- `aleph-shot 'http://127.0.0.1:3002/#/inventory?q=export&status=any' docs/specs/2026-11-01-part-rows-shots/inventory-1280.png --width 1280 --height 900`
- `aleph-shot 'http://127.0.0.1:3002/#/issues/demo/28' docs/specs/2026-11-01-part-rows-shots/issue-demo-28-1280.png --width 1280 --height 900`

The plain Inventory URL puts demo-28 below the fold (27 open issues, newest first), so the Inventory URL carries `q=export`. It also carries `status=any`: with the default Show=open filter the done part 28.1 is hidden and only 28.2 shows.

| File | URL | Width |
| --- | --- | --- |
| inventory-1280.png | http://127.0.0.1:3002/#/inventory?q=export&status=any | 1280 |
| issue-demo-28-1280.png | http://127.0.0.1:3002/#/issues/demo/28 | 1280 |

## Findings

- inventory-1280.png: Rows 28.1 and 28.2 sit directly under the demo-28 row "Split the export into stages". Their ids are dotted and their titles are indented about 22 px under the parent title. The stage badges differ (28.1 `done` in green, 28.2 `queued` in blue, parent `building`). The 28.1 title is cut with an ellipsis ("Write the export mani…") by the table's usual title truncation; part rows have a × only while open. no defect
- issue-demo-28-1280.png: The Parts heading shows count 2. The Parts table has the columns Part, Title, Stage, Condition and Job, with one row each for 28.1 "Write the export manifest" (`done`) and 28.2 "Export each file in turn" (`queued`), both with "No job yet". The columns line up with the page width and nothing overlaps. no defect
