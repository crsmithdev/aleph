# UI

`aleph-ui` serves the factory UI: the Status page, issues, jobs, sessions, skills and memory. It binds to `127.0.0.1` and prints its URL.

The design reference is [design/rules.md](../design/rules.md), with a file for each component in `design/components/`.

Components: [Ask card](../design/components/ask-card.md), [Attention rows](../design/components/attention-rows.md), [Badge](../design/components/badge.md), [Button](../design/components/button.md), [Card](../design/components/card.md), [Chart panel](../design/components/chart-panel.md), [Chip](../design/components/chip.md), [Command](../design/components/command.md), [Contents](../design/components/contents.md), [Detail panel](../design/components/detail-panel.md), [Diff](../design/components/diff.md), [Disclosure](../design/components/disclosure.md), [Edit toggle](../design/components/edit-toggle.md), [Empty state](../design/components/empty-state.md), [Fact list](../design/components/fact-list.md), [Facts line](../design/components/facts-line.md), [Field and form](../design/components/field-and-form.md), [Figure band](../design/components/figure-band.md), [Filter bar](../design/components/filter-bar.md), [Findings list](../design/components/findings-list.md), [Form message](../design/components/form-message.md), [Freshness](../design/components/freshness.md), [Inspector](../design/components/inspector.md), [KPI strip](../design/components/kpi-strip.md), [Lanes](../design/components/lanes.md), [Legend](../design/components/legend.md), [Link](../design/components/link.md), [Link button](../design/components/link-button.md), [List and group](../design/components/list-and-group.md), [List surface](../design/components/list-surface.md), [Markdown and code](../design/components/markdown-and-code.md), [Meter](../design/components/meter.md), [Metric card](../design/components/metric-card.md), [Needs-you strip](../design/components/needs-you-strip.md), [Page head](../design/components/page-head.md), [Pager](../design/components/pager.md), [Pair](../design/components/pair.md), [Row actions](../design/components/row-actions.md), [Row and cell](../design/components/row-and-cell.md), [Row bars](../design/components/row-bars.md), [Search box](../design/components/search-box.md), [Select](../design/components/select.md), [Settings list](../design/components/settings-list.md), [Split card](../design/components/split-card.md), [Status light](../design/components/status-light.md), [Status row](../design/components/status-row.md), [Tab card](../design/components/tab-card.md), [Table](../design/components/table.md), [Tabs](../design/components/tabs.md), [Timeline](../design/components/timeline.md), [Two-click confirm](../design/components/two-click-confirm.md).

The tokens are in `ui/app.css`. `design rules --for <component>` and `design tokens` print them.

```bash
aleph-ui --port 3020    # the default port is ALEPH_UI_PORT, else 3020
```

On the home machine, a systemd user unit (`aleph-ui.service`) runs it, and home-proxy serves it on the LAN as `aleph.home`. The unit runs the server under `bun --watch`, so it restarts by itself when a file it loads changes: a land, a merge or a pull in `~/aleph`.

The unit file is `jobs/systemd/aleph-ui.service`. To install it on the home machine, link it and enable it:

```bash
systemctl --user link ~/aleph/jobs/systemd/aleph-ui.service
systemctl --user enable --now aleph-ui.service
```

If the host already has a plain file at `~/.config/systemd/user/aleph-ui.service`, `systemctl --user link` refuses to replace it, so remove that file first.

## Access

The server binds `127.0.0.1`. home-proxy serves it on the LAN as `aleph.home`, so any device on the LAN can read it. The links that `shelf put` and `shelf url` print point at `ALEPH_HOME_URL` (default `http://aleph.home/`), the origin where a device is paired, so a note saved from a shelf page is not refused. A POST needs a paired device (`ui/pair.ts`), and the UI answers any other POST with a 401.

| Command | Does |
|---|---|
| `aleph ui pair [label]` | Prints a `/pair#<token>` link. Open it once on the device to pair it. |
| `aleph ui unpair <label>` | Drops the device |
| `aleph ui devices` | Lists the paired devices and the date of each |

`~/.aleph/ui-tokens` keeps the hash of each device's token.

## Status in a herdr panel

The Status page also runs as text in a [herdr](https://herdr.dev) side panel. It redraws every 10 s and on a resize; `q` or Ctrl-C quits.

```bash
herdr plugin link ~/aleph/herdr
herdr plugin pane open --plugin aleph.status --entrypoint status --placement split --direction right --width 30% --no-focus
```

## Usage and skills

| Variable | Default | Does |
|---|---|---|
| `ALEPH_USAGE_URL` | `https://api.anthropic.com/api/oauth/usage` | The address that the UI polls for the Claude plan usage |
| `ALEPH_CLAUDE_CREDENTIALS` | `~/.claude/.credentials.json` | The file with the OAuth token for that poll |
| `ALEPH_SKILLS_DIR` | the `skills` directory of the repo | The directory of the skills that the Skills and Memory pages list |
| `ALEPH_SKILLS_STORE` | `~/.aleph/skills-store.json` | The base name of the Skills page's cache of Langfuse observations, one file per Langfuse base |
| `ALEPH_CHAT_IDLE_MS` | 600000 | Milliseconds the chat panel's process waits for the next turn before it ends |
| `ALEPH_TOOLS` | `~/aleph-tools` | The aleph-tools checkout that holds the shelf and the dock. The UI runs without it |

## Routes

`GET /` is `ui/index.html`, with its styles in `ui/app.css`. Pages use hash routes, such as `#/jobs/a1430%231`. The pages send no project in the hash; each `/api` route takes `?project=<key>` as its own filter. `?window=` is a window name of `lib/windows.ts` (`hour`, `day`, `week`, `month`, `quarter`); `scopeOf` in `ui/api/scope.ts` reads both, and a window the route does not take is a 400.

A URL names the data it returns in the terms of `docs/naming.md`. An action is a POST under the thing it acts on. An `/api` path with no route answers 404, whatever the method.

| Route | Returns |
|---|---|
| `GET /api/factory` | The Status page: the factory, the asks, the live jobs, the queue, the Done lane |
| `GET /api/status` | The tone of the status sentence (`alert`, `warning`, `ask` or `fine`), for the sidebar |
| `POST /api/factory/pause`, `/resume` | Pauses or resumes the factory |
| `GET /api/flow` | The Status, Agents and Jobs pages, for `?window=` |
| `GET /api/log` | The Status page's event log: one event a row, newest first, 25 a page; `?window=`, `?kind=` (`problem`, `landed`, `ask`, `hold`), `?q=` and `?page=` |
| `GET /api/automation` | The Automation page: the rules, the caps' settings, held paths and the decision log |
| `POST /api/automation/caps`, `/schedules`, `/rules/:reason/grant`, `/rules/:reason/revoke` | Changes a cap, a schedule or a standing rule |
| `GET /api/issues` | The Issues page rows, with stage, job count and cost |
| `GET /api/issues/:id` | One issue by its short ID (`a1430`) |
| `POST /api/issues/:id/{edit,note,media,decide,unblock,drop,retriage,rerun}` | Acts on one issue |
| `GET /api/jobs` | One row per job, newest first; `?window=`, `?state=`, `?limit=` and `?before=` (the `next` of the last page) |
| `GET /api/jobs/:id`, `/diff`, `/logs/:file` | One job by its ID (`a1430#2`, sent as `a1430%232`) |
| `POST /api/jobs/:id/{land,recheck,drop,wait,answer}` | Acts on that job only |
| `GET /api/sessions` | The Sessions page; `?window=` (week, month or quarter), and `?limit=` and `?before=` for the session list. `partial` says Langfuse held more pages than a read takes |
| `GET /api/sessions/:id`, `/chat`, `/turns/:n`, `GET /api/skills/:name` | One session, its chat, one turn, one skill |
| `GET /api/projects` | Each project key to its code, its count of open issues and `onboarded` |
| `GET /api/views` | The files under `ui/views/` |

Times are ISO 8601 UTC strings and durations are in seconds. `ui/schemas.ts` holds the schema of each GET route, and `ui/schemas.test.ts` checks every route against it.

## Add a page

Add two files and change no shared file.

1. `ui/views/<page>.js` exports `view`:
   ```js
   import { esc, empty } from "./lib/html.js";

   export const view = {
     path: "/widgets/:name",   // the hash route; a path with a :param stays out of the sidebar
     title: "Widget",
     group: "factory",         // factory or claude
     order: 50,                // sorts the page in its group
     icon: "cube",             // a Font Awesome name
     api: "/api/widgets/:name",   // or a function of (params, query); a list of URLs needs combine(answers)
     refresh: 30,              // seconds between reloads
     live: true,               // also redraw on a pushed change
     render: (data, params) => data ? `<h1>${esc(data.name)}</h1>` : empty("No widget."),
     mount: (root) => { root.onclick = (e) => {}; },   // runs after each render: use on* properties, not addEventListener
   };
   ```
   The `view-module` and `view-mount` rules in [design/rules.md](../design/rules.md) list each field and the rules for `mount`.
2. `ui/api/<page>.ts` exports `routes`, a map from a method and path to a handler:
   ```ts
   import type { Routes } from "../server.ts";

   export const routes: Routes = {
     "GET /api/widgets/:name": (_req, params, url) =>
       Response.json({ name: params.name, project: url.searchParams.get("project") }),
   };
   ```

3. Add the route's schema to `ui/schemas.ts`.
4. Restart `aleph-ui`. The server loads every `ui/api/*.ts` at start, and `bun --watch` does not see a new file.
5. Open `#/widgets/<name>` and see the page.

A view that needs a second answer after its data returns the data with it from `more(data, query)`: the first load draws before `more` ends and again after it. After a choice changes the address (`setQuery`) or an action changes the server's data, the view calls `redraw()` or `redraw(true)` from `ui/views/lib/router.js`, which draws through the router's one draw and keeps the open folds, the focus and the typed text. A view never sets its own root's `innerHTML`.

To share a helper, add it to the module of `ui/views/lib/` that holds its kind (`format.js`, `html.js`, `address.js`, `chart-theme.js` or `decisions.js`) without changing what is there. A route reads Langfuse only through the port in `lib/langfuse.ts` (`langfuse()`, `need()`) and the UI's reads of it in `ui/langfuse.ts` (`list()`, `recent()`); a test gives it rows with `use(memory(...))`.
