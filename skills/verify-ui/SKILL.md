---
name: verify-ui
description: >
  Verify a UI change in a real browser with playwright-cli: a one-off server
  from the worktree, screenshots of the changed screens, their console
  errors, then teardown. Use after changing a view, a style or a page's
  client code, when a screenshot or the console is what proves the change.
---

# Verify UI

`playwright-cli` is the driver of all four steps: it opens the browser, captures the page and reads the
console, so the whole check replays from the transcript. Run the steps from the worktree you changed, so the
server serves that tree.

## 1. Serve the worktree on a free port

The pages have to arrive over http: `playwright-cli` refuses a `file:` URL with
`Access to "file:" protocol is blocked` and captures a blank page after one, so a page opened from disk proves
nothing. Take a free port at or above 3002 and start a one-off server on it, in the background.

```sh
port=$(bun -e 'const n=require("node:net");(async()=>{for(let p=3002;p<3200;p++){if(await new Promise(k=>{const s=n.createServer();s.once("error",()=>k(false));s.listen(p,"127.0.0.1",()=>s.close(()=>k(true)))})){console.log(p);return}}})()')
ALEPH_UI_PASSWORD= bun ui/server.ts --port "$port" >/tmp/verify-ui.log 2>&1 & echo $! > /tmp/verify-ui.pid
```

`ALEPH_UI_PASSWORD=` drops the password gate, which a one-off server on loopback does not need. The server
prints its URL. Done when `curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/"` prints 200.

The UI is a hash router: a screen's address is `http://127.0.0.1:<port>/#/<route>`, so `#/flow` reaches the
Flow page while a bare `/flow` answers 404.

## 2. Screenshot the changed screens

Run `playwright-cli` from a scratch directory: it writes its page snapshots and console logs under
`.playwright-cli/` in the current directory, which would leave the worktree dirty.

```sh
mkdir -p /tmp/verify-ui && cd /tmp/verify-ui
playwright-cli open "http://127.0.0.1:$port/#/flow"
playwright-cli screenshot --filename=flow.png
```

Read the PNG back and look at it. A capture that is blank or half drawn is the failure a screenshot exists to
catch, and it passes unnoticed because the command exits 0.

**Trap.** A headless `--screenshot` hangs on a page that holds an SSE stream open, and the UI's `/api/events`
is one; the same flag captures before a page's client code has drawn it, so a blank PNG reads as a rendered
page. Capture through `playwright-cli`.

Done when each changed screen has a PNG you have looked at.

## 3. Read the console errors

```sh
playwright-cli console error
```

Each entry prints as `[ERROR] <message> @ <url>:<line>`. `playwright-cli console` lists every level, and each
navigation reports its own count (`- Console: 1 errors, 0 warnings`) in the step 2 output.

Done when each error is either fixed, or named with its reason in what you report.

## 4. Stop the server and the browser session

```sh
playwright-cli close
kill "$(cat /tmp/verify-ui.pid)"
```

Done when `playwright-cli list` prints `(no browsers)` and the port answers no more
(`curl -s --max-time 3 "http://127.0.0.1:$port/"` fails).
