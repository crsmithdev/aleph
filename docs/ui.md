# UI

`aleph-ui` serves the factory UI: the Status page, issues, jobs, sessions, skills and memory. It binds to `127.0.0.1` and prints its URL.

The design reference (tokens, formats, tables, charts and components) is [docs/design.md](design.md).

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

## Log in

Set `ALEPH_UI_PASSWORD` in `~/.aleph/.env` to turn on the password gate. With it unset, the UI has no login and answers only requests whose Host header names this machine (`127.0.0.1`, `localhost` or `[::1]`); any other Host, such as `aleph.home`, gets a 403 page.

With the gate on, `/` shows a login form. The right password sets the `aleph_session` cookie, which keeps the device logged in for a year. The sessions are in `~/.aleph/factory/ui-sessions.json`, so a restart keeps every device logged in. The factory keeps one token of its own in that file, which its smoke test and `aleph doctor` send as the cookie. The token comes back into the file when it is missing.

| To | Do |
|---|---|
| Log out one device | Use the `Log out` link on it |
| Log out every device | Delete `~/.aleph/factory/ui-sessions.json` |
| Change the password | Edit `~/.aleph/.env`, then `systemctl --user restart aleph-ui` |

## Routes

`GET /` is `ui/index.html`, with its styles in `ui/app.css`. Pages use hash routes, such as `#/jobs/a1430%231`. The pages send no project in the hash; each `/api` route takes `?project=<key>` as its own filter.

A URL names the data it returns in the terms of `docs/naming.md`. An action is a POST under the thing it acts on. An `/api` path with no route answers 404, whatever the method.

| Route | Returns |
|---|---|
| `GET /api/factory` | The Status page: the factory, the live jobs, the queue, the Done lane and its count for `?window=` |
| `POST /api/factory/pause`, `/resume` | Pauses or resumes the factory |
| `GET /api/flow` | The Flow page and the Jobs page charts, for `?window=` |
| `GET /api/automation` | The Automation page: the asks, the rules, the caps' settings, held paths and the decision log |
| `POST /api/automation/caps`, `/schedules`, `/rules/:reason/grant`, `/rules/:reason/revoke` | Changes a cap, a schedule or a standing rule |
| `POST /api/proposals/:id/approve`, `/decline` | Decides a proposal |
| `GET /api/issues` | The Issues page rows, with stage, job count and cost |
| `GET /api/issues/:id`, `/api/issues/:id/jobs` | One issue by its short ID (`a1430`), and its jobs |
| `POST /api/issues/:id/{edit,note,media,decide,unblock,drop,retriage,rerun,checked}` | Acts on one issue |
| `GET /api/jobs` | One row per job, newest first; `?window=`, `?state=`, `?limit=` and `?before=` (the `next` of the last page) |
| `GET /api/jobs/:id`, `/diff`, `/logs/:file` | One job by its ID (`a1430#2`, sent as `a1430%232`) |
| `POST /api/jobs/:id/{land,recheck,drop,wait,answer}` | Acts on that job only |
| `GET /api/sessions` | The Sessions page; `?window=` in days, and `?limit=` and `?before=` for the session list. `partial` says Langfuse held more pages than a read takes |
| `GET /api/sessions/:id`, `/chat`, `/turns/:n`, `GET /api/skills/:name` | One session, its chat, one turn, one skill |
| `GET /api/projects` | A map of each project key to its code |
| `GET /api/views` | The files under `ui/views/` |

Times are ISO 8601 UTC strings and durations are in seconds. `ui/schemas.ts` holds the schema of each GET route, and `ui/schemas.test.ts` checks every route against it.

## Add a page

Add two files and change no shared file.

1. `ui/views/<page>.js` exports `view`:
   ```js
   import { esc, empty } from "../lib.js";

   export const view = {
     path: "/widgets/:name",   // the hash route; a path with a :param stays out of the sidebar
     title: "Widget",
     group: "factory",         // work, factory or claude
     order: 50,                // sorts the page in its group
     icon: "cube",             // a Font Awesome name
     api: "/api/widgets/:name",   // or a function of (params, query); a list of URLs needs combine(answers)
     refresh: 30,              // seconds between reloads
     render: (data, params) => data ? `<h1>${esc(data.name)}</h1>` : empty("No widget."),
   };
   ```
2. `ui/api/<page>.ts` exports `routes`, a map from a method and path to a handler:
   ```ts
   import type { Routes } from "../server.ts";

   export const routes: Routes = {
     "GET /api/widgets/:name": (_req, params, url) =>
       Response.json({ name: params.name, project: url.searchParams.get("project") }),
   };
   ```

Add the route's schema to `ui/schemas.ts`. The server loads every `ui/api/*.ts` at start. `bun --watch` does not see a new file, so restart `aleph-ui` after you add one. To share a helper, add it to `ui/lib.js` without changing what is there.
