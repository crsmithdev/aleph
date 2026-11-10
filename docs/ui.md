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

`GET /` is `ui/index.html`, with its styles in `ui/app.css`. Pages use hash routes, such as `#/jobs/aleph-52`. The pages send no project in the hash; each `/api` route takes `?project=<key>` as its own filter.

| Route | Returns |
|---|---|
| `GET /api/state` | The Status page's state, from the ledger, the factory directory and the work store. It writes nothing |
| `GET /api/projects/keys` | The repos in the registry |
| `GET /api/views` | The files under `ui/views/` |

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
     api: "/api/widgets/:name",
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

The server loads every `ui/api/*.ts` at start. `bun --watch` does not see a new file, so restart `aleph-ui` after you add one. To share a helper, add it to `ui/lib.js` without changing what is there.
