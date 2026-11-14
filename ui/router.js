// The page shell: the router, the load path, the stream client and the action dispatch.
//
// Each module listed by /api/views exports
// view = { path, title, group, order, icon?, render(data, params, query), mount?(root, data, query), event?(root, ev), swap?(root), api?, more?, refresh?, live? }, and
// may export redirect(hash) -> new hash | null for an address it took over:
// `api` is the URL its data comes from (":params" filled in from the route), `more(data, query)` the promise of the data
// with what the view loads after it (a first load draws before it and again after it),
// `refresh` the seconds between reloads, `live` that /api/events also redraws it,
// `icon` its sidebar glyph, a Font Awesome name. The page builds the sidebar from
// them, in GROUPS order under the HEADERS, and routes by hash (#/jobs/aleph-52).
//
// `loader(env)` holds what a test can drive with a fake fetch and a fake EventSource; `start()` wires it to the page.
import { setCodes } from "../lib/naming.ts";
import { arm, cmd, notice, pageHead, postJson, say, actMessages, decided, denyReasons, endDraw, loadDiff, error, linkButton, esc, failMessage, loading, markLine, mountView, openDiffs, parseHash, recordState, restoreState, wireFolds, restoreFolds, scope, startDraw } from "./lib.js";

const GROUPS = ["factory", "claude"], HEADERS = { factory: "Factory", claude: "Claude" };

/** The paths of the views drawn by morphing, not by innerHTML. Empty: no view is on. */
export const morph = new Set();

/** The keys an answer was built from: the server names them in `x-aleph-keys`, split by spaces. */
export const keysOf = (res) => (res.headers.get("x-aleph-keys") ?? "").split(" ").filter(Boolean);

/** The mark of a key that failed to rebuild, `{ error, since }`, or null. */
export const markOf = (data) => (typeof data?.error === "string" && typeof data?.since === "string" ? { error: data.error, since: data.since } : null);

/** The URL of a route's data: `view.api` with its ":params" filled in. */
export const urlOf = ({ view, params, query }) =>
  typeof view.api === "function" ? view.api(params, query) : view.api.replace(/:(\w+)/g, (_, n) => encodeURIComponent(params[n] ?? ""));

/** A route's data: the answer of its URL, or of each URL `view.api` lists, joined by `view.combine`. */
export async function dataOf(route, get) {
  const answers = await Promise.all([urlOf(route)].flat().map(async (url) => {
    const res = await get(url);
    if (!res.ok) throw new Error(failMessage(url, res.status, await res.text().catch(() => "")));
    return res.json();
  }));
  return route.view.combine ? route.view.combine(answers) : answers[0];
}

/**
 * The one path for every load of the shown view: the first one, a `change`, the `refresh` timer and the reload after an action.
 * `env` is the page: fetch(url), EventSource, hidden(), focused() (an input has focus), armed() (a button waits for its
 * second click), ok(route), fail(route, error, first), draw(route, data, first) -> the mount's promise, event(ev).
 */
export function loader(env) {
  let shown = null, seq = 0, drawn = Promise.resolve(), pending = false, reloading = false, again = false, events = null, heardAt = 0;
  const read = new Set(); // the keys the shown view's loads returned

  const slots = new Map(); // a view's own load by name: the number of its newest call

  /** A GET for the shown view: its keys join the ones a `change` reloads it for. With a `slot`, the answer is null when
   * the route changed or a newer call of the same slot started meanwhile, so an older answer never draws. */
  async function get(url, slot) {
    const route = shown, mine = slot ? (slots.get(slot) ?? 0) + 1 : 0;
    if (slot) slots.set(slot, mine);
    const res = await env.fetch(url);
    if (route !== shown || (slot && slots.get(slot) !== mine)) return slot ? null : res;
    for (const k of keysOf(res)) read.add(k);
    return res;
  }

  /** Draw `data` for the load numbered `mine`, after the draw before it ends; false when a newer load or route came. */
  async function put(route, mine, data, first, at) {
    await drawn;
    if (route !== shown || mine !== seq) return false; // the reader moved on, or a newer load started, while this loaded
    // The reader armed a button while this loaded: the caller's check came too early, and the next reload catches up.
    if (!first && env.armed()) return false;
    route.data = data; // what `redraw` draws again
    route.at = at; // when its load started
    drawn = env.draw(route, data, first);
    await drawn;
    return true;
  }

  // Each load takes a number; an answer that finds a newer number is dropped, so an old load never draws over a new one.
  // `drawn` is the last mount: the next draw waits for it.
  async function load(route, first) {
    const mine = ++seq, more = route.view.more, at = Date.now();
    let data = null;
    if (route.view.api) {
      try {
        data = await dataOf(route, get);
        if (route === shown) env.ok(route);
      } catch (e) {
        if (route !== shown || mine !== seq) return;
        env.fail(route, e, first);
        return;
      }
    }
    // A first load draws its data before `more` ends, so the page shows at once; a reload draws once, with all of it.
    if (more && first && !(await put(route, mine, data, true, at))) return;
    if (more) data = await more(data, route.query);
    await put(route, mine, data, first && !more, at);
  }

  /** Draw the shown view again for the address's `query`: with its data, or with data loaded again when `fresh`. */
  function redraw(query, fresh) {
    if (!shown?.view) return;
    shown.query = query;
    if (fresh) return load(shown, false);
    const route = shown;
    return (drawn = drawn.then(() => (route === shown ? env.draw(route, route.data, false) : undefined)));
  }

  // One reload at a time; a call that comes during it makes one more. A reload waits while the reader types (the blur
  // runs it) and does not draw over a button armed for its second click, which stands for five seconds at most.
  async function reload() {
    if (!shown?.view) return;
    if (reloading) { again = true; return; }
    if (env.armed()) return;
    if (env.focused()) { pending = true; return; }
    reloading = true;
    try { await load(shown, false); } finally { reloading = false; }
    if (again) { again = false; reload(); }
  }

  /** Focus left an input: run the reload it held back. */
  function blur() {
    if (pending && !env.focused()) { pending = false; return reload(); }
  }

  /** A `change` names the keys the server rebuilt: reload only a view that read one of them. */
  function change(keys) {
    env.changed?.(keys);
    if (shown?.view?.live && keys.some((k) => read.has(k))) return reload();
  }

  // The stream is open on every page in a visible tab (the sidebar follows the status tone), and only a live view reloads on it: a browser allows few connections to one host.
  // The server pings every 25 s; a stream with no message for 60 s, or one the browser gave up on (a 502 from the
  // proxy while the server restarts ends it for good), is opened again, and the view loads in full.
  function follow() {
    events?.close();
    events = null;
    if (!shown?.view || env.hidden()) return;
    let lost = false;
    const es = events = new env.EventSource(scope(shown.query).url("/api/events"));
    heardAt = Date.now();
    const heard = () => { heardAt = Date.now(); };
    es.addEventListener("ping", heard);
    es.addEventListener("change", (m) => { heard(); change(JSON.parse(m.data).keys); });
    // An event of the event log, as it is written: a view with `event` shows it before the reload that `change` brings.
    es.addEventListener("ev", (m) => { heard(); try { env.event(JSON.parse(m.data)); } catch (e) { console.error("event failed", e); } });
    es.onerror = () => {
      lost = true;
      if (es.readyState === env.EventSource.CLOSED && es === events) setTimeout(() => { if (es === events) { follow(); if (shown?.view?.live) reload(); } }, 2000);
    };
    es.onopen = () => { heard(); env.opened?.(); if (lost && shown?.view?.live) reload(); };
  }

  /** Open the stream again when it went quiet for 60 s. */
  function check() {
    if (events && Date.now() - heardAt > 60_000) { follow(); if (shown?.view?.live) reload(); }
  }

  /** Show `route` (`{ view: null }` for an address no view has) and load it; the promise settles when the load ends. */
  function show(route) {
    shown = route;
    read.clear();
    follow();
    return route.view ? load(route, true) : Promise.resolve();
  }

  return { get, reload, redraw, blur, change, follow, check, show, get shown() { return shown; }, get keys() { return [...read]; } };
}

function compile(path) {
  const names = [];
  const src = path.split("/").map((seg) => seg.startsWith(":") ? (names.push(seg.slice(1)), "([^/]+)") : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/");
  return { re: new RegExp(`^${src}/?$`), names };
}
// A hand-typed `%zz` is no encoding: it stands for itself, and the view says it found nothing.
const decodeParam = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/** The route of `path` among `views`, or null. */
export function match(views, path, query) {
  for (const v of views) {
    const m = path.match(v._route.re);
    if (m) return { view: v, query, params: Object.fromEntries(v._route.names.map((n, i) => [n, decodeParam(m[i + 1])])) };
  }
  return null;
}

let page = null;

/** A view's own GET: through the page's loader, so a `change` of its keys reloads the view, and with a `slot` an older
 * answer comes back null. A view a test mounts with no page fetches plainly. */
export const get = (url, slot) => (page ? page.get(url, slot) : fetch(url, { cache: "no-store" }));

/** Draw the shown view again through the one draw, after a choice of the reader changed the address (`setQuery`) or,
 * with `fresh`, the server's data (an action). */
export const redraw = (fresh = false) => page?.redraw(parseHash(location.hash).query, fresh);

/** Wire the shell to the page and route to the hash. */
export async function start() {
  const $ = (id) => document.getElementById(id);
  const typing = () => !!document.activeElement?.matches("input, textarea, select");
  const armed = () => !!$("view").querySelector("button.act.ask");
  let views = [], redirects = [], timer = 0;

  // The page imports each view once; when the server restarts or a land changes a page file (the version header changes), reload to load it, unless the reader is typing.
  let version = null;
  async function api(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 401) { location.reload(); return res; }
    if (res.headers.get("x-aleph-login") === "1") $("logout").hidden = false;
    const stale = res.headers.get("x-aleph-stale") === "1";
    if (stale === $("stale").hidden) {
      $("stale").hidden = !stale;
      $("stale").innerHTML = stale ? notice("The server runs older code than the checkout. Restart it:", true) + cmd("systemctl --user restart aleph-ui") : "";
    }
    const v = res.headers.get("x-aleph-version");
    if (v && version && v !== version && !typing()) location.reload();
    if (v && !version) version = v;
    return res;
  }

  // Out-of-date check for a view with `outOfDate`: the browser's clock, from the last good response (or the route's start).
  // A hidden tab loads nothing, so its time does not count: the clock starts again when the tab shows, and the reload
  // that the tab's return starts has the full span to land.
  let goodAt = Date.now(), shownAt = Date.now(), failed = false, wasOut = false;
  function checkOut() {
    const v = page.shown?.view;
    if (!v?.outOfDate || document.hidden) return;
    const out = failed || Date.now() - Math.max(goodAt, shownAt) > 3 * 60 * 1000;
    if (out !== wasOut) { wasOut = out; v.outOfDate($("view"), out); }
  }

  /** Render the view, put back what the reader set, and mount it; the promise settles when the mount ends. */
  async function draw({ view, params, query, at }, data, first) {
    // A refresh render throws away what the reader set (open folds, shown diffs, typed text); put it back.
    const saved = first ? null : recordState($("view"));
    // A view's `swap` sees the page before the redraw replaces it; the function it returns runs after, as for motion.
    const swapped = first ? null : view.swap?.($("view"));
    try {
      startDraw();
      const out = view.render(data, params, query);
      endDraw(at);
      // Spike: a refresh of a view whose path is in `morph` is merged into the page by idiomorph, which keeps the elements that match.
      if (morph.has(view.path) && !first) (await import("./vendor/idiomorph.js")).Idiomorph.morph($("view"), out, { morphStyle: "innerHTML" });
      else $("view").innerHTML = out;
    } catch (e) { $("view").innerHTML = `<div class="page">${error(`${view.title} did not render: ${e.message}`, "Reload the page. If it stays, this is a bug in the view.")}</div>`; return; }
    if (saved) restoreState($("view"), saved);
    swapped?.();
    const mark = markOf(data);
    $("aged").hidden = !mark;
    $("aged").innerHTML = mark ? notice(markLine(view.title, mark), true) : "";
    // Keyed <details> keep their open state by data-keep, and that state goes through keep(),
    // one key per fold: it survives a redraw and a reload. A fold the reader never touched
    // has no kept state, and shows its own default.
    restoreFolds($("view"));
    // `mount` runs after render, for what needs a DOM (the charts); a view without one is left alone.
    try { await mountView(view, $("view"), data, query); } catch (e) { console.error(view.title, "mount failed", e); }
    // A good response clears the alert.
    wasOut = false;
    if (view.outOfDate) view.outOfDate($("view"), false);
  }

  page = loader({
    fetch: api,
    // Read at each open, as the old shell did, so a patched EventSource takes effect.
    get EventSource() { return window.EventSource; },
    hidden: () => document.hidden,
    focused: typing,
    armed,
    ok: () => { $("offline").hidden = true; goodAt = Date.now(); failed = false; },
    fail: ({ view }, e, first) => {
      failed = true;
      checkOut();
      if (first) $("view").innerHTML = `<div class="page">${error(`${view.title} did not load: ${e.message}`)}</div>`;
      else $("offline").hidden = false;
    },
    draw,
    event: (ev) => page.shown?.view?.event?.($("view"), ev),
    // The keys of each `change`, for code outside the views: the kit's note tool reloads on /api/annotations.
    changed: (keys) => { if (keys.includes("/api/status")) readTone(); dispatchEvent(new CustomEvent("aleph:change", { detail: keys })); },
    opened: () => readTone(),
  });

  $("logout").addEventListener("click", async (e) => {
    e.preventDefault();
    await postJson("/api/logout").catch(() => {});
    location.reload();
  });

  // The tone of the status sentence, from /api/status, kept for the Status entry of each nav draw.
  let tone = "fine";
  /** Colour the Status entry by `tone`: a data attribute that app.css reads, and the tone in the title. */
  function paintTone() {
    const a = $("nav").querySelector?.('a[href="#/"]');
    if (!a) return;
    a.dataset.tone = tone;
    a.title = tone === "fine" ? "Status" : `Status: ${tone}`;
  }
  let reads = 0;
  async function readTone() {
    const mine = ++reads;
    try {
      const t = (await (await fetch("/api/status", { cache: "no-store" })).json()).tone;
      // An answer that a later read has overtaken is stale: it must not overwrite the newer tone.
      if (mine === reads && typeof t === "string" && t !== tone) { tone = t; paintTone(); }
    } catch {}
  }

  function nav(path) {
    // The entry whose path is the longest segment prefix of the route is active: #/jobs/x marks Jobs.
    let active = null;
    for (const v of views) {
      if (v.path.includes(":")) continue;
      const hit = v.path === "/" ? path === "/" : path === v.path || path.startsWith(v.path + "/");
      if (hit && (!active || v.path.length > active.path.length)) active = v;
    }
    const items = views.filter((v) => GROUPS.includes(v.group) && !v.path.includes(":") && v.nav !== false).sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
    $("nav").innerHTML = `<ul>${items.map((v, i) =>
      `${v.group !== items[i - 1]?.group && HEADERS[v.group] ? `<li class="head">${HEADERS[v.group]}</li>` : ""}<li><a href="#${esc(v.path)}" title="${esc(v.title)}"${v === active ? ' aria-current="page"' : ""}><wa-icon name="${esc(v.icon)}" aria-hidden="true"></wa-icon><span class="lbl">${esc(v.title)}</span></a></li>`).join("")}</ul>`;
    paintTone();
    $("nav").querySelector?.('[aria-current="page"]')?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }

  // Focus moves after `focusout`, so look once it has settled.
  document.addEventListener("focusout", () => setTimeout(page.blur));
  setInterval(page.check, 5000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) shownAt = Date.now();
    checkOut();
    page.follow();
    if (!document.hidden && page.shown?.view?.live) page.reload();
  });

  function route() {
    // A view may take over an old address (a view exports `redirect(hash)`).
    for (const r of redirects) {
      const to = r(location.hash);
      if (to) { history.replaceState(null, "", to); break; }
    }
    const { path, query } = parseHash(location.hash);
    nav(path);
    clearInterval(timer);
    // #view outlives its views, so a view's handlers on it must not reach the next one.
    $("view").onclick = $("view").onchange = $("view").onkeydown = $("view").oninput = null;
    $("aged").hidden = true;
    const m = match(views, path, query);
    if (!m) {
      page.show({ view: null });
      document.title = "Not found · aleph";
      $("view").innerHTML = `<div class="page nf">${pageHead(`Nothing at ${path}`)}${linkButton("Status", "#/")}</div>`;
      $("offline").hidden = true;
      return;
    }
    document.title = `${m.view.title} · aleph`;
    $("view").innerHTML = loading(m.view.title);
    goodAt = Date.now(); failed = false; wasOut = false;
    page.show(m);
    // `refresh` is a quiet timer: it reloads the view when no load came for that many seconds, for what changes with the
    // clock and not with a file (liveness, ages, the next tick). A hidden tab does not load.
    if (m.view.refresh) timer = setInterval(() => { if (!document.hidden && Date.now() - goodAt >= m.view.refresh * 1000) page.reload(); }, 5000);
  }

  setInterval(checkOut, 1000);

  // In-page anchors (#needs) scroll to their element instead of routing.
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || a.getAttribute("href").startsWith("#/")) return;
    const el = document.getElementById(a.getAttribute("href").slice(1));
    e.preventDefault();
    if (el) el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });

  // Copy a command to the clipboard; fall back to selecting it. One handler,
  // because the buttons are rebuilt on every refresh.
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".cmd[data-cmd]");
    if (!b) return;
    const cp = b.querySelector(".cp"), text = b.dataset.cmd;
    const done = (ok) => {
      if (!ok) {
        const rg = document.createRange(); rg.selectNodeContents(b.firstElementChild);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg);
      }
      cp.textContent = ok ? "Copied" : "Press Ctrl+C";
      b.classList.add("copied");
      $("copied").textContent = (ok ? "Copied: " : "Selected: ") + text;
      clearTimeout(b._t);
      b._t = setTimeout(() => { cp.textContent = "Copy"; b.classList.remove("copied"); }, 1600);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    else done(false);
  });

  document.addEventListener("input", (e) => {
    const f = e.target.closest && e.target.closest("input.reason[data-id]");
    if (f) f.value ? denyReasons.set(`${f.dataset.repo}-${f.dataset.id}`, f.value) : denyReasons.delete(`${f.dataset.repo}-${f.dataset.id}`);
  });

  // Enter in a reason or answer box does what the box's Confirm button does.
  document.addEventListener("keydown", (e) => {
    const f = e.key === "Enter" && e.target.closest && e.target.closest("input.reason");
    if (!f) return;
    e.preventDefault();
    f.closest(".choice")?.querySelector("button.act[data-act]")?.click();
  });

  document.addEventListener("click", dispatch);

  setCodes(Object.fromEntries(Object.entries(await fetch("/api/projects", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}))).filter(([, p]) => p.code).map(([k, p]) => [k, p.code])));
  const names = await fetch("/api/views", { cache: "no-store" }).then((r) => r.json()).catch(() => []);
  const mods = await Promise.all(names.map((n) => import(`/views/${n}`).then((m) => (typeof m.redirect === "function" && redirects.push(m.redirect), m.views ?? (m.view ? [m.view] : [])), (e) => { console.error(n, e); return []; })));
  views = mods.flat().filter((v) => v && typeof v.path === "string" && typeof v.render === "function")
    .map((v) => ({ ...v, _route: compile(v.path) }));
  addEventListener("hashchange", route);
  wireFolds($("view"));
  route();
}

// Diff opens the run's diff, Always grants a rule; every other button posts the request its data names
// (path, body, confirm), then the view reloads. A button with confirm asks for a second click.
async function dispatch(e) {
  const b = e.target.closest && e.target.closest("button.act[data-act]");
  if (!b) return;
  const { act, label, name } = b.dataset;
  // A draw that came while the action ran (a first load's `more`) replaced the row: draw again, and the row shows the kept message.
  const note = (m) => { say(b.parentElement.lastElementChild, m); if (name) actMessages.set(name, m); if (!b.isConnected) redraw(); };
  if (act === "diff") {
    const panel = b.closest("article").querySelector(".diff-panel");
    if (!panel.hidden) { panel.hidden = true; openDiffs.delete(name); return; }
    panel.hidden = false;
    openDiffs.set(name, "");
    const t = await loadDiff(panel, `/api/diff/${encodeURIComponent(name)}`);
    if (t === null) openDiffs.delete(name); else openDiffs.set(name, t);
    return;
  }
  // A choice with a text box: the first click shows the box, the next one posts.
  const box = b.closest(".choice")?.querySelector("input.reason");
  if (box?.hidden) {
    box.hidden = false;
    b.classList.add("ask");
    b.textContent = "Confirm";
    box.focus();
    return;
  }
  if (b.dataset.confirm && arm(b, name ? `${label} ${name}? Click again` : `${label}? Click again`)) return;
  clearTimeout(b._t);
  if (act === "always") {
    // Grant the standing permission, then click the row's first action (its second-click confirm applies).
    const { reason, action, first } = b.dataset;
    b.disabled = true;
    try {
      await postJson(`/api/automation/rules/${encodeURIComponent(reason)}/grant`, { action });
    } catch (err) { b.disabled = false; note(`${act} failed: ${err.message}`); return; }
    const next = [...b.closest("article").querySelectorAll("button.act:not(.always)")].find((x) => x.dataset.act === first);
    b.disabled = false;
    if (next) { next.click(); return; }
    page.reload();
    return;
  }
  // The button's request: its body, and the box's text under the box's name after its lead.
  const body = JSON.parse(b.dataset.body || "{}"), typed = box?.value.trim() ?? "";
  if (typed) body[box.name] = (box.dataset.lead ?? "") + typed;
  if (box && body[box.name] === undefined) { note(`${act} failed: type an answer first`); return; }
  const bs = [...(b.closest(".actions") ?? b.parentElement).querySelectorAll("button.act")];
  bs.forEach((x) => { x.disabled = true; });
  if (name) actMessages.delete(name);
  try {
    await postJson(b.dataset.path, body);
    if (box?.dataset.id) denyReasons.delete(`${box.dataset.repo}-${box.dataset.id}`);
  } catch (err) { bs.forEach((x) => { x.disabled = false; x.classList.remove("ask"); x.textContent = x.dataset.label; }); note(`${act} failed: ${err.message}`); return; }
  const row = b.closest("article.issue-row");
  if (row?.dataset.ask) decided.set(row.dataset.ask, Date.now());
  row?.remove();
  page.reload();
}
