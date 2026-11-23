# Freshness

Freshness says how old the data of a page is: one word at the right of the page head, with the details in its tooltip.

- Use: on every page with a page head. The router draws it; a view does not.
- Not for: a failed load of the page; the `#offline` notice shows that.

## Helper

| Helper | Reference |
|---|---|
| `freshness(title, keys, live, now)` in `ui/views/lib/html.js`; `paintAge()` in `ui/views/lib/router.js` | `ui/views/design.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Word | Last in the controls, or at the right when the head has none. `error` when a key's build failed, `updating` while a rebuild runs, `live` on a live view with its stream open, else the age of the oldest key (`4m ago`) |  | `--num` `--fs-xs` `--fw-mid`; `--muted`, `live` in `--ink` after an open `--dot-s` ring, `error` in `--error` |
| Tooltip | The line of each mark (`Jobs is 12m 00s old: <error>`), then each key with its build time |  | the browser's `title` |

## Rules

- The worst state wins: `error`, then `updating`, then `live`, then the age.
- Show a failed build or a rebuild in the word and its tooltip only. Do not add a banner for it (Chris, 2026-11-23).
- Only `error` takes a tone. A rebuild is a normal state and stays muted.
- The server gives each key's build time as `x-aleph-at`, its mark as `x-aleph-error` and `x-aleph-since`, and a rebuild as `x-aleph-rebuild: 1`.

## Do and don't

| Do | Don't |
|---|---|
| `freshness("Jobs", page.fresh, page.live)` from the router | a view that draws its own age |
| `error`, with the build's error in the tooltip | a red banner over the page for an old answer |
