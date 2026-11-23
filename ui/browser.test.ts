import { afterAll, afterEach, beforeAll, describe, expect, test as bunTest } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { dock, root } from "./dock.ts";
import { annotationsFile } from "../lib/paths.ts";
import { chromeUsable, startRig, type Page, type Rig } from "./browser.testkit.ts";

/** The last test to start, and whether it ran to its end: one that threw or timed out leaves `ok` false, and the next test gets a clean page. */
let last = { ok: true };
const test = (name: string, fn: () => unknown, timeout?: number) => bunTest(name, async () => { const run = { ok: false }; last = run; await fn(); run.ok = true; }, timeout);
/** A test of a dock widget: it skips when aleph-tools is not on this machine (ui/dock.ts). */
const dockTest = (name: string, fn: () => unknown, timeout?: number) => (dock ? test : bunTest.skip)(name, fn, timeout);
/** `shelf note <verb> ...` of aleph-tools on the notes file of this run. */
const shelfNote = ([verb, ...rest]: string[]) => Bun.spawnSync([process.execPath, join(root, "shelf.ts"), "note", verb, "--file", annotationsFile(), ...rest], { env: process.env, stdout: "pipe", stderr: "pipe" });

describe.skipIf(!chromeUsable)("the UI in Chrome", () => {
  let rig: Rig, page: Page, env: Record<string, string>;
  beforeAll(async () => { rig = await startRig((e) => { env = e; }); page = await rig.open(); }, 150_000);
  afterAll(() => rig?.stop());
  afterEach(async () => { if (!last.ok) page = await rig.reset(); });

  const hash = () => page.ev<string>("location.hash");
  const click = (selector: string) => page.ev(`document.querySelector(${JSON.stringify(selector)}).click()`);

  test("the shell: the sidebar opens each page, an old, unknown or badly encoded address gets its answer, a view's handlers die with it, and a failed load says why", async () => {
    // The sidebar opens with the Factory header, with no link above it.
    expect(await page.ev('(() => { const li = document.querySelector("#nav li"); return [li.className, li.textContent, !!li.querySelector("a")]; })()')).toEqual(["head", "Factory", false]);
    // Every view the page loads sits in a group the sidebar shows under a header: no view keeps a hidden group.
    const heads = await page.ev<string[]>('[...document.querySelectorAll("#nav li.head")].map((li) => li.textContent.toLowerCase())');
    const groups = await page.ev<string[]>('fetch("/api/views").then((r) => r.json()).then((ns) => Promise.all(ns.map((n) => import("/views/" + n).then((m) => (m.views ?? (m.view ? [m.view] : [])).map((v) => v.group))))).then((gs) => gs.flat())');
    expect([...new Set(groups.filter(Boolean))].filter((g) => !heads.includes(g))).toEqual([]);
    // Every sidebar link opens its page and marks itself, with no page error.
    const links = await page.ev<[string, string][]>('[...document.querySelectorAll("#nav li a")].map((a) => [a.getAttribute("href"), a.textContent])');
    expect(links.length).toBeGreaterThan(3);
    for (const [href, name] of links) {
      await page.go(href);
      expect([href, await page.ev('document.querySelector("#nav a[aria-current]")?.textContent')]).toEqual([href, name]);
      expect(await page.ev('document.title')).toBe(`${name} · aleph`);
      expect(await page.ev('!!document.querySelector("#view > .page > .error")')).toBe(false);
    }
    expect(page.errors).toEqual([]);
    // An old address redirects and keeps its filters.
    await page.go("#/inventory?status=done");
    expect(await hash()).toBe("#/issues?status=done");
    await page.go("#/agents?days=30");
    expect(await hash()).toBe("#/sessions?days=30");
    await page.go("#/status/capacity");
    expect(await hash()).toBe("#/factory/agents");
    // An unknown address says so and links to Status.
    await page.go("#/nothing/here");
    expect(await page.ev('document.querySelector("#view header.ph h1")?.textContent')).toBe("Nothing at /nothing/here");
    expect(await page.ev('document.querySelectorAll("#view h1").length')).toBe(1);
    expect(await page.ev('document.querySelector("#view a[href=\\"#/\\"]").textContent')).toBe("Status");
    // A badly encoded address shows the view's own answer, not the page before it, and throws nothing.
    await page.go("#/issues");
    const before = page.errors.length;
    await page.ev('void (location.hash = "#/jobs/%zz")');
    await page.when('!document.querySelector("#view .browse") && !/^\\s*Loading/.test(document.querySelector("#view").textContent)');
    expect(page.errors.slice(before)).toEqual([]);
    // A view's handlers do not outlive it. go() can return while #view still shows the page before, so wait for the new view's own markup.
    await page.go("#/factory/jobs?view=timing");
    await page.when('document.querySelector("#view #perf") && typeof document.querySelector("#view").onclick === "function"');
    await page.go("#/issues");
    await page.when('document.querySelector("#view .browse")');
    expect(await page.ev('[document.querySelector("#view").onclick, document.querySelector("#view").onchange]')).toEqual([null, null]);
    expect(await page.ev('document.querySelector("#view").oninput')).toBeNull();
    await click('.ph button[data-view="flow"]');
    await page.when('location.hash === "#/issues?view=flow"');
    // A failed first load shows one line and no hint.
    await page.ev('(() => { const f = window.fetch; window.fetch = (u, o) => String(u).startsWith("/api/issues") ? Promise.reject(new Error("down")) : f(u, o); })()');
    await page.go("#/issues");
    expect(await page.ev('document.querySelectorAll("#view .error p").length')).toBe(1);
    expect(await page.ev('document.querySelector("#view .error p").textContent')).toBe("Issues did not load: down");
    await page.reload();
    // The server's stale header shows a notice with the restart command, which is copyable.
    await page.ev('(() => { const f = window.fetch; window.fetch = (u, o) => f(u, o).then((r) => new Response(r.body, { status: r.status, headers: [...r.headers, ["x-aleph-stale", "1"]] })); })()');
    await page.ev('dispatchEvent(new Event("hashchange"))');
    await page.when('document.querySelector("#stale .notice.bad")');
    expect(await page.ev('document.querySelector("#stale .cmd").dataset.cmd')).toBe("systemctl --user restart aleph-ui");
    await page.reload();
  }, 90_000);

  dockTest("the font picker changes the --display font of the page, with no page error", async () => {
    await page.go("#/");
    const root = () => page.ev<string>('getComputedStyle(document.documentElement).getPropertyValue("--display")');
    expect(await root()).toContain("Merriweather");
    await page.ev('(() => { const s = document.getElementById("dock-fonts").shadowRoot.querySelector("select[data-role=display]:not([data-prop])"); s.value = "Lora"; s.dispatchEvent(new Event("change", { bubbles: true })); })()');
    expect(await root()).toContain("Lora");
    expect(await page.ev<string>('getComputedStyle(document.querySelector(".mark")).fontFamily')).toContain("Merriweather");
    expect(page.errors).toEqual([]);
  }, 30_000);

  test("Issues: a filter and the search change the list in place, and a click selects a row", async () => {
    await page.go("#/issues");
    const rows = () => page.ev<number>('document.querySelectorAll(".lrows .lrow:not([hidden])").length');
    const all = await rows();
    expect(all).toBeGreaterThan(1);
    // The row's own project is a filter option: choosing one leaves fewer rows, All brings them back.
    const kind = '.lcard .seg[data-name="kind"] button';
    await click(`${kind}:not([data-value=""])`);
    await page.when('document.querySelectorAll(".lrows .lrow:not([hidden])").length <= ' + all);
    await click(`${kind}[data-value=""]`);
    const search = 'document.querySelector("#view input[type=search]")';
    await page.ev(`(() => { const i = ${search}; i.value = "zzzz-no-such-issue"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await page.when('document.querySelectorAll(".lrows .lrow:not([hidden])").length === 0');
    expect(await page.ev('!!document.querySelector("[data-nomatch]")')).toBe(true);
    await page.ev(`(() => { const i = ${search}; i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await page.when('document.querySelectorAll(".lrows .lrow:not([hidden])").length === ' + all);
    const key = await page.ev<string>('(() => { const r = [...document.querySelectorAll(".lrow")].at(-1); r.click(); return r.dataset.key; })()');
    expect(await page.ev(`document.querySelector('.lrow[data-key="${key}"]').getAttribute("aria-current")`)).toBe("true");
  }, 30_000);

  test("Memory: a row opens in the inspector", async () => {
    await page.go("#/memory");
    await page.when('document.querySelectorAll("#view .lrow:not([hidden])").length > 1');
    const title = 'document.querySelector("#view .ins h3").textContent';
    const first = await page.ev<string>(title);
    // A focused row opens on Enter, as on a click, and keeps focus.
    await page.ev('(() => { const r = document.querySelectorAll("#view .lrow:not([hidden])")[1]; r.focus(); r.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); })()');
    await page.when(`document.querySelectorAll("#view .lrow:not([hidden])")[1].getAttribute("aria-current") === "true" && ${title} !== ${JSON.stringify(first)}`);
    expect(await page.ev('document.activeElement === document.querySelectorAll("#view .lrow:not([hidden])")[1]')).toBe(true);
    await page.ev('document.querySelector("#view .lrow").click()');
    await page.when(`${title} === ${JSON.stringify(first)}`);
    expect(page.errors).toEqual([]);
  }, 30_000);

  test("Automation: Enter on a rule row opens its inspector, and a redraw keeps the row selected", async () => {
    const own = await startRig();
    try {
      const pg = await own.open("#/automation");
      await pg.when('document.querySelectorAll("#view .lrow").length > 1');
      await pg.ev('(() => { const r = document.querySelectorAll("#view .lrow")[1]; r.focus(); r.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); })()');
      await pg.when('document.querySelectorAll("#view .lrow")[1].getAttribute("aria-current") === "true"');
      const title = () => pg.ev<string>('document.querySelector("#view .ins h3").textContent');
      const was = await title();
      await pg.ev('import("/views/lib/router.js").then((m) => m.redraw(true))');
      await pg.when('document.querySelectorAll("#view .lrow")[1]?.getAttribute("aria-current") === "true"');
      expect(await title()).toBe(was);
      expect(pg.errors).toEqual([]);
    } finally { own.stop(); }
  }, 60_000);

  test("Automation: a cap save draws the Limits view again with the saved cap", async () => {
    const own = await startRig();
    try {
      const pg = await own.open("#/automation?view=limits");
      await pg.when('document.querySelector("form[data-cap=live]")');
      await pg.ev(`(() => {
        const f = document.querySelector("form[data-cap=live]");
        window.want = Number(f.elements.live.value) + 1;
        f.elements.live.value = String(window.want);
        f.dispatchEvent(new Event("input", { bubbles: true }));
        f.requestSubmit();
      })()`);
      // The hint shows the saved cap only once the page is drawn again, which a failed save never does.
      await pg.when('document.querySelector("form[data-cap=live] .hint").textContent.endsWith(" of " + window.want)');
      expect(pg.errors).toEqual([]);
    } finally { own.stop(); }
  }, 60_000);

  test("Status: a fold opened before the /api/flow load ends stays open through the redraw after it", async () => {
    await page.go("#/issues");
    // Hold the first /api/flow answer until the test opens a fold on the page drawn before it.
    await page.ev(`(() => {
      const rf = window.fetch;
      window.fetch = (u, o) => (String(u).startsWith("/api/flow") && !window.release ? new Promise((ok) => { window.release = () => ok(rf(u, o)); }) : rf(u, o));
    })()`);
    await page.ev('location.hash = "#/"');
    const fold = '[...document.querySelectorAll("#view details[data-keep]")][0]';
    await page.when(`window.release && ${fold}`);
    expect(await page.ev('!!document.querySelector("#pipeline .sstats")')).toBe(false);
    await page.ev(`${fold}.open = true; document.querySelector("#view > *").dataset.mark = "1"`);
    await page.ev("window.release()");
    await page.when('document.querySelector("#pipeline .sstats") && !document.querySelector("#view > *").dataset.mark');
    expect(await page.ev(`${fold}.open`)).toBe(true);
    await page.ev(`${fold}.open = false`);
    await page.reload(); // Takes the patched fetch away.
  }, 30_000);

  test("the sidebar collapses, keeps its links, and it and an open fold stay set over a reload, also under the older key", async () => {
    const tip = () => page.ev('[document.querySelector("#collapse").title, document.querySelector("#collapse").getAttribute("aria-label")]');
    const [t0, a0] = await tip();
    expect(t0).toBe(a0);
    await click("#collapse");
    const [t1, a1] = await tip();
    expect([t1, t1 === t0]).toEqual([a1, false]);
    await page.when('document.querySelector(".shell.collapsed")');
    expect(await page.ev('document.querySelector("#nav a").getBoundingClientRect().width')).toBeLessThan(60);
    await page.reload();
    expect(await page.ev('!!document.querySelector(".shell.collapsed")')).toBe(true);
    await click("#collapse");
    await page.when('!document.querySelector(".shell.collapsed")');
    // A reader who collapsed the sidebar under the older key still sees it collapsed.
    await page.ev('localStorage.clear(); localStorage.setItem("aleph-sidebar-collapsed", "1")');
    await page.reload();
    expect(await page.ev('!!document.querySelector(".shell.collapsed")')).toBe(true);
    await page.ev("localStorage.clear()");
    await click("#collapse");
    await page.when('!document.querySelector(".shell.collapsed")');
    await page.go("#/");
    await page.when('document.querySelector("#view details[data-keep]")');
    const fold = '[...document.querySelectorAll("#view details[data-keep]")][0]';
    await page.ev(`${fold}.open = true`);
    // The fold's state must reach storage before the reload, or the reload races the write.
    await page.when(`localStorage.getItem("aleph." + ${fold}.dataset.keep) === "true"`);
    await click("#collapse");
    await page.when('document.querySelector(".shell.collapsed")');
    await page.reload();
    await page.when(`${fold}`);
    expect(await page.ev(`[!!document.querySelector(".shell.collapsed"), ${fold}.open]`)).toEqual([true, true]);
    await page.ev(`${fold}.open = false`);
    await click("#collapse");
    await page.when('!document.querySelector(".shell.collapsed")');
  }, 60_000);

  test("the Status entry takes the status tone on any page, and follows a change with no reload", async () => {
    await page.go("#/factory/jobs");
    const colour = () => page.ev<string>('getComputedStyle(document.querySelector("#nav a[href=\'#/\']")).color');
    const token = (name: string) => page.ev<string>(`(() => { const e = document.createElement("i"); e.style.color = "var(${name})"; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; })()`);
    await page.when('document.querySelector("#nav a[href=\'#/\']").dataset.tone');
    // The tab shows again: the stream opens and its open reads /api/status, which the test answers.
    // The stream is a stub that opens at once, so the tone does not wait on a real /api/events open.
    const say = async (tone: string) => {
      await page.ev(`(() => { window.__E ??= window.EventSource; window.EventSource = class { constructor() { queueMicrotask(() => this.onopen?.()); } addEventListener() {} close() {} }; window.__f ??= window.fetch; window.fetch = (u, o) => String(u).startsWith("/api/status") ? Promise.resolve(Response.json({ tone: ${JSON.stringify(tone)} })) : window.__f(u, o); document.dispatchEvent(new Event("visibilitychange")); })()`);
      await page.when(`document.querySelector("#nav a[href='#/']").dataset.tone === ${JSON.stringify(tone)}`);
    };
    await say("fine");
    const fine = await colour();
    await say("alert");
    expect(await colour()).toBe(await token("--error"));
    await say("ask");
    expect(await colour()).toBe(await token("--need"));
    await say("fine");
    expect(await colour()).toBe(fine);
    expect(await page.ev("location.hash")).toBe("#/factory/jobs");
    await page.ev("window.fetch = window.__f; window.EventSource = window.__E");
  }, 30_000);

  test("a late /api/status answer does not overwrite the tone of a newer one", async () => {
    await page.go("#/factory/jobs");
    const tone = 'document.querySelector("#nav a[href=\'#/\']").dataset.tone';
    await page.when(tone);
    // Two stream opens each read /api/status; the test holds each answer and gives the second before the first.
    await page.ev(`(() => { window.__E = window.EventSource; window.EventSource = class { constructor() { queueMicrotask(() => this.onopen?.()); } addEventListener() {} close() {} }; window.__f = window.fetch; window.__held = []; window.fetch = (u, o) => String(u) === "/api/status" ? new Promise((ok) => window.__held.push(ok)) : window.__f(u, o); document.dispatchEvent(new Event("visibilitychange")); })()`);
    await page.when("window.__held.length === 1");
    await page.ev('document.dispatchEvent(new Event("visibilitychange"))');
    await page.when("window.__held.length === 2");
    await page.ev('window.__held[1]({ json: async () => ({ tone: "ask" }) })');
    await page.when(`${tone} === "ask"`);
    await page.ev('(async () => { window.__held[0]({ json: async () => ({ tone: "alert" }) }); await new Promise((ok) => setTimeout(ok)); })()');
    expect(await page.ev(tone)).toBe("ask");
    await page.ev("window.fetch = window.__f; window.EventSource = window.__E");
  }, 30_000);

  test("at phone width the nav wraps, the page does not scroll sideways, and group headers hide", async () => {
    await page.go("#/");
    await page.width(420);
    // The charts shrink when their ResizeObserver fires: wait until the page width fits, or holds for 30 frames.
    await page.ev(`new Promise((ok) => { let n = 0, w = -1; const f = () => { const s = document.documentElement.scrollWidth; n = s === w ? n + 1 : 0; w = s; s <= 420 || n >= 30 ? ok() : requestAnimationFrame(f); }; f(); })`);
    expect(await page.ev('document.documentElement.scrollWidth')).toBeLessThanOrEqual(420);
    expect(await page.ev('getComputedStyle(document.querySelector("#nav li.head")).display')).toBe("none");
    await page.width(1200);
    expect(await page.ev('getComputedStyle(document.querySelector("#nav li.head")).display')).not.toBe("none");
  }, 30_000);

  test("the Memory search and each segmented button fill --ctl-h, and a status dot is a pill", async () => {
    await page.go("#/memory");
    await page.when('document.querySelector("#view .lcard input[type=search]")');
    expect(await page.ev('getComputedStyle(document.querySelector("#view .lcard input[type=search]")).height')).toBe(await page.ev('getComputedStyle(document.documentElement).getPropertyValue("--ctl-h").trim()'));
    expect(await page.ev('getComputedStyle(document.documentElement).getPropertyValue("--ctl-h").trim()')).toBe("28px");
    await page.go("#/issues");
    await page.when('document.querySelector("#view .seg button")');
    await page.ev('document.documentElement.style.setProperty("--ctl-h", "40px")');
    const r = await page.ev<[number, number][]>('[...document.querySelectorAll("#view .seg")].map((s) => [s.clientHeight, s.querySelector("button").getBoundingClientRect().height])');
    expect(r.length).toBeGreaterThan(0);
    for (const [inner, h] of r) { expect(inner).toBeGreaterThanOrEqual(38); expect(h).toBe(inner); }
    await page.ev('document.documentElement.style.removeProperty("--ctl-h")');
    // The Design page draws the status light specimen: no page shows a live dot since the Agents scorecard dropped the OpenRouter light.
    await page.go("#/design");
    await page.when('document.querySelector(".event-dot")');
    expect(await page.ev('getComputedStyle(document.querySelector(".event-dot")).borderRadius')).toBe("999px");
  }, 30_000);

  test("a hovered select takes the --ink-2 border, and the others keep --rule", async () => {
    // The fixture has no transcripts, so a hook's page gets one hold: the log draws its filter bar only with a hold.
    const hold = { t: "2026-11-20T10:00:00.000Z", sid: "aaaaaaaa", project: "demo", hook: "gate", event: "Stop", kind: "judged", who: "interactive", out: "caught", why: "x" };
    await page.ev(`(() => { window.__f = window.fetch; window.fetch = (u, o) => String(u).startsWith("/api/hooks") ? Promise.resolve(Response.json({ event: "Stop", name: "gate", matcher: "", file: "hooks/gate.ts", command: "bun hooks/gate.ts", mode: "", timeout: 10, workers: "runs", source: [], holds: [${JSON.stringify(hold)}], byKind: [], errors: [] })) : window.__f(u, o); })()`);
    await page.go("#/hooks/Stop/gate");
    await page.when('document.querySelectorAll("#holds .fbar select").length > 1');
    const token = (name: string) => page.ev<string>(`(() => { const e = document.createElement("i"); e.style.color = "var(${name})"; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; })()`);
    const border = (n: number) => page.ev<string>(`getComputedStyle(document.querySelectorAll("#holds .fbar select")[${n}]).borderTopColor`);
    await page.hover("#holds .fbar select");
    expect([await border(0), await border(1)]).toEqual([await token("--ink-2"), await token("--rule")]);
    await page.ev("window.fetch = window.__f");
  }, 30_000);

  test("Design: every specimen draws and the charts draw from fixtures", async () => {
    await page.width(1200);
    await page.go("#/design");
    await page.when('document.querySelector(".design-swatch") && document.querySelectorAll("aleph-chart canvas").length >= 5');
    const r = await page.ev<any>(`({
      specimens: document.querySelectorAll('[data-annotate^="design/"]').length,
      swatches: document.querySelectorAll(".design-swatch").length,
      charts: document.querySelectorAll("aleph-chart canvas").length,
      noRules: [...document.querySelectorAll(".design-spec")].filter((s) => !s.querySelector(".design-rules")?.textContent.trim()).map((s) => s.querySelector("h3").textContent),
      values: document.querySelectorAll("#design-values .design-specimen tbody tr").length,
      contrast: document.querySelectorAll('[data-tokens="contrast"] tbody tr').length,
      error: !!document.querySelector("#view > .page > .error"),
    })`);
    expect(r).toMatchObject({ error: false, charts: 5 });
    // Each specimen shows its rules from the index at /api/design; the variants of a component have none.
    expect(r.noRules).toEqual(["Current page in the sidebar (mock)", "Table, fit", "Table, empty", "Chart panel, no data", "Search box, action"]);
    expect(r).toMatchObject({ values: 22, contrast: 13 });
    // The new specimens each have an id, the buttons their three kinds, the row action a last td.acts, and the Failed series is the Error colour.
    expect(await page.ev(`({
      ids: ["design-list", "design-row-cell"].map((i) => !!document.querySelector("#" + i + ".design-spec")),
      list: !!document.querySelector("#design-list .list > .card") && document.querySelectorAll("#design-list .grp[id]").length,
      gap: getComputedStyle(document.querySelectorAll("#design-list .grp[id]")[1]).marginTop,
      lede: document.querySelector("#design-card .lede")?.textContent,
      cell: document.querySelector("#design-row-cell td.wide")?.title,
      kinds: ["danger", "small", "always"].map((k) => !!document.querySelector("#design-button .act." + k)),
      acts: !!document.querySelector("#design-row-actions tbody td.acts:last-child .act.small"),
      failed: document.querySelector('aleph-chart[key="design/category"]').frame.by.keys.map((k) => k.color).slice(1),
    })`)).toEqual({ ids: [true, true], list: 2, gap: "16px", lede: "One sentence that sums up the card.", cell: "A title that takes the spare width, with its text as its title", kinds: [true, true, true], acts: true, failed: ["error", "error"] });
    expect(r.specimens).toBeGreaterThan(20);
    expect(r.swatches).toBeGreaterThan(20);
    // The empty and loading states are drawn: a line, a status line, a loading and a failed metric card, and the empty table and chart.
    expect(await page.ev(`({
      states: ["#design-states .empty", "#design-states p[role=status]", "#design-states .tile .spin[role=status]", "#design-states .tile .spin.bad"].map((q) => !!document.querySelector(q)),
      empties: ["design-table-empty", "design-chart-empty"].map((i) => !!document.querySelector("#" + i + " .empty")),
    })`)).toEqual({ states: [true, true, true, true], empties: [true, true] });
    // Every :root token (the --wa- and --dock- bridges aside) is named by a code element of a specimen, not of its rules.
    expect(await page.ev(`(() => {
      const named = new Set([...document.querySelectorAll(".design-specimen code")].flatMap((c) => c.textContent.match(/--[\\w-]+/g) ?? [])), bare = new Set();
      for (const sheet of document.styleSheets) for (const r of (() => { try { return sheet.cssRules; } catch { return []; } })()) if (r.selectorText === ":root") for (const p of r.style) if (p.startsWith("--") && !/^--(wa|dock)-/.test(p)) bare.add(p);
      return [...bare].filter((p) => !named.has(p));
    })()`)).toEqual([]);
    // Every component of the index has a specimen, and every specimen of a component has a component file.
    // The other specimens with rules show global rules: colours, type, space, values, words, page grammar and states.
    expect(await page.ev(`fetch("/api/design").then((r) => r.json()).then((d) => {
      const comps = d.filter((e) => e.kind === "component").map((e) => e.id), drawn = [...document.querySelectorAll(".design-spec[data-component]")].map((s) => s.dataset.component);
      const global = [...document.querySelectorAll(".design-spec:not([data-component])")].filter((s) => s.querySelector(".design-rules")).map((s) => s.querySelector("h3").textContent);
      return { missing: comps.filter((c) => !drawn.includes(c)), unfiled: drawn.filter((c) => !comps.includes(c)), global };
    })`)).toEqual({ missing: [], unfiled: [], global: ["Every component", "Surfaces and text", "Tones", "Data colours", "Contrast", "Type", "Space and shape", "Values", "Words", "Page grammar", "States"] });
    // The contents: one link per group and per specimen, each to an id on the page; a click scrolls, keeps the route and marks its entry.
    expect(await page.ev(`(() => { const nav = document.querySelector(".toc"), ids = [...nav.querySelectorAll("a")].map((a) => a.getAttribute("href").slice(1)), want = document.querySelectorAll("h2.design-h, .design-spec[id]");
      return { n: ids.length === want.length, ok: ids.every((i) => document.getElementById(i)), groups: [...nav.querySelectorAll("li:not(.sub) a")].map((a) => a.textContent) }; })()`)).toEqual({
      n: true, ok: true, groups: ["Every component", "Foundations", "Content", "Structure", "Page", "Data", "Lists of items", "Labels", "Actions", "Text", "Controls", "States"] });
    await page.ev('document.querySelector(".toc a[href=\'#design-table\']").click()');
    await page.when('document.querySelector(".toc a[aria-current]")?.textContent === "Table"');
    expect(await hash()).toMatch(/^#\/design/);
    expect(await page.ev('getComputedStyle(document.querySelector(".toc")).position')).toBe("sticky");
    // Mount the Design page again: one click on the confirm button arms it and does not drop it.
    await page.go("#/jobs");
    await page.go("#/design");
    await page.when('document.querySelector("[data-design-confirm]")');
    await page.ev('document.querySelector("[data-design-confirm]").click()');
    expect(await page.ev('document.querySelector("[data-design-confirm]").textContent')).toBe("Drop a1700? Click again");
    expect(page.errors).toEqual([]);
  }, 30_000);

  test("Design: the list surface selects by click and key, filters, says No match, and keeps its state through a morph; Save shows after a change", async () => {
    await page.go("#/design");
    await page.when('document.querySelector("[data-browse=design] .lrow")');
    const state = () => page.ev<any>(`(() => { const b = document.querySelector("[data-browse=design]"); return {
      rows: [...b.querySelectorAll(".lrow")].map((r) => r.dataset.key + (r.getAttribute("aria-current") === "true" ? "*" : "")).join(" "),
      none: !!b.querySelector("[data-nomatch]") }; })()`);
    // The filter starts on Yours: the factory row is not drawn; the first drawn row is selected.
    expect((await state()).rows).toBe("a1706* a1700");
    await click('[data-browse=design] .lrow[data-key="a1700"]');
    expect((await state()).rows).toBe("a1706 a1700*");
    await page.ev('document.querySelector("[data-browse=design] .lrow[data-key=a1706]").focus()');
    await page.key("Enter");
    expect((await state()).rows).toBe("a1706* a1700");
    // A group draws its first match only; a search reaches the rows it does not draw.
    await page.ev(`(() => { const q = document.querySelector("[data-browse=design] input[type=search]"); q.value = "a1698"; q.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    expect((await state()).rows).toBe("a1698");
    await page.ev(`(() => { const q = document.querySelector("[data-browse=design] input[type=search]"); q.value = ""; q.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    expect(await page.ev('document.querySelector("[data-browse=design] .lmore").textContent')).toBe("1 of 3");
    await page.ev(`(() => { const q = document.querySelector("[data-browse=design] input[type=search]"); q.value = "zzzz"; q.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    expect((await state()).none).toBe(true);
    // A redraw by the router's morph draws the list as the reader left it.
    await page.ev(`(async () => { const { Idiomorph } = await import("/vendor/idiomorph.js"), { browse } = await import("/views/lib/browse.js");
      const row = (k) => ({ key: k, lead: k, main: k, cells: [], text: k, data: { who: "yours" }, inspect: "<p>" + k + "</p>" });
      Idiomorph.morph(document.querySelector("[data-browse=design]").parentElement, browse({ id: "design", label: "Issues", search: "Search", filters: [{ label: "Who", name: "who", options: ["yours", "factory"], value: "yours" }], groups: [{ title: "G", count: "1", heads: [], rows: [row("a1706")] }] }), { morphStyle: "innerHTML", ignoreActiveValue: true }); })()`);
    expect((await state()).none).toBe(true);
    expect(await page.ev('document.querySelector("[data-browse=design] input[type=search]").value')).toBe("zzzz");
    // Save of a setting row shows only after its control changes.
    await page.go("#/design");
    await page.when('document.querySelector("#design-settings .srow")');
    const save = `getComputedStyle(document.querySelector("#design-settings .srow:first-child .sctl > button[type=submit]")).display`;
    expect(await page.ev(save)).toBe("none");
    await page.ev(`(() => { const i = document.querySelector("#design-settings .srow:first-child input"); i.value = "45min"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    expect(await page.ev(save)).not.toBe("none");
    // One menu picks the chart's form, and the panel draws again in it.
    expect(await page.ev('document.querySelectorAll("aleph-chart[key=\'design/time\'] select[data-form]").length + " " + document.querySelectorAll("aleph-chart[key=\'design/time\'] .seg").length')).toBe("1 0");
    await page.ev(`(() => { const m = document.querySelector("aleph-chart[key='design/time'] select[data-form]"); m.value = "lines"; m.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    expect(await page.ev('document.querySelector("aleph-chart[key=\'design/time\'] select[data-form]").value')).toBe("lines");
  }, 30_000);

  test("at 390 px a metric value stays one line and a segmented control stays one row or scrolls inside itself", async () => {
    await page.width(390);
    for (const route of ["#/", "#/issues", "#/jobs", "#/agents"]) {
      await page.go(route);
      await page.when('document.querySelector("#view .tile b, #view .empty, #view h2, #view .views")');
      const r = await page.ev<any>(`(() => ({
        tall: [...document.querySelectorAll(".tile b")].filter((b) => b.getBoundingClientRect().height >= 1.5 * parseFloat(getComputedStyle(b).fontSize)).map((b) => b.textContent),
        seg: [...document.querySelectorAll(".seg")].filter((s) => new Set([...s.querySelectorAll("button")].map((b) => b.offsetTop)).size > 1 && !(s.scrollWidth > s.clientWidth && /auto|scroll/.test(getComputedStyle(s).overflowX))).length,
        wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }))()`);
      expect({ route, ...r, wide: Math.max(r.wide, 0) }).toEqual({ route, tall: [], seg: 0, wide: 0 });
    }
    await page.width(1200);
  }, 60_000);

  test("Design: no two axis labels of the Timeline specimen intersect, at 390 px and at 1280 px", async () => {
    for (const w of [390, 1280]) {
      await page.width(w);
      await page.go("#/design");
      await page.when('document.querySelector("#design-timeline .dp-ticks span")');
      const r = await page.ev<number[][]>('[...document.querySelectorAll("#design-timeline .dp-ticks span")].map((s) => { const b = s.getBoundingClientRect(); return [b.left, b.right, b.top, b.bottom]; })');
      expect(r.length).toBeGreaterThan(1);
      for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) expect({ w, i, j, hit: r[i][0] < r[j][1] && r[j][0] < r[i][1] && r[i][2] < r[j][3] && r[j][2] < r[i][3] }).toEqual({ w, i, j, hit: false });
    }
    await page.width(1200);
  }, 30_000);

  test("at 390 px each text cut by an ellipsis has its full text in a title, on itself or on an ancestor", async () => {
    await page.go("#/");
    const hrefs = ["#/design", "#/issues/demo/21", "#/memory?view=health", "#/memory?view=log", ...await page.ev<string[]>('[...document.querySelectorAll("#nav li a")].map((a) => a.getAttribute("href"))')];
    await page.width(390);
    const cut = `[...document.querySelectorAll("#view *")].filter((e) => getComputedStyle(e).textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth).filter((e) => { const t = e.innerText.replace(/\\s+/g, " ").trim(); for (let a = e; a && a.id !== "view"; a = a.parentElement) if (typeof a.title === "string" && a.title.replace(/\\s+/g, " ").includes(t)) return false; return true; }).map((e) => e.className + ": " + e.textContent.trim().slice(0, 40))`;
    for (const href of hrefs) {
      await page.go(href);
      await page.when('!/^\\s*Loading/.test(document.querySelector("#view").textContent)');
      expect([href, await page.ev<string[]>(`(() => ${cut})()`)]).toEqual([href, []]);
    }
    await page.width(1200);
  }, 90_000);

  /**
   * Opens Status with its reloads in the test's hands. The page's stream is kept as window.es, and window.nudge() sends
   * it a `change` of the keys the last /api/factory answer named, as the server does when it rebuilds them. A fetch of
   * /api/factory waits for window.gate. A fetch of /api/flow, the last a Status load makes (its `more`), counts in
   * window.fetched after the load that reads it ends. The page's clock runs window.skew ms ahead.
   * The test ends with page.reload(), which takes the patched clock, stream and fetch away.
   */
  const changeRig = async () => {
    await page.ev(`(() => {
      const now = Date.now;
      window.skew = 0;
      Date.now = () => now() + window.skew;
      const ES = window.EventSource;
      window.EventSource = class extends ES { constructor(...a) { super(...a); window.es = this; } };
      window.nudge = () => window.es.dispatchEvent(new MessageEvent("change", { data: JSON.stringify({ keys: window.keys }) }));
      const rf = window.fetch;
      const keyed = (r) => { window.keys = r.headers.get("x-aleph-keys").split(" "); return r; };
      window.fetch = (u, o) => String(u).startsWith("/api/factory") ? (window.gate ?? Promise.resolve()).then(() => rf(u, o)).then(keyed) : !["/api/flow", "/api/memory"].some((p) => String(u).startsWith(p)) ? rf(u, o) : rf(u, o).then((r) => {
        const j = r.json.bind(r);
        const count = () => { window.fetched = (window.fetched ?? 0) + 1; };
        r.json = () => j().then((d) => { setTimeout(count); return d; });
        return r;
      });
    })()`);
    await page.go("#/issues");
    await page.go("#/");
    const buttons = `document.querySelector('#view button.act[data-act="drop"], #view :not(.choice) > button.act[data-act="land"]')`;
    await page.when(buttons);
    // The first load draws its buttons before its `more` (/api/flow, /api/memory and /api/memory/processes) ends: wait for those 3 counts, or a change's wait ends on them.
    await page.when("(window.fetched ?? 0) >= 3");
    const change = async () => {
      const n = await page.ev("window.fetched ?? 0");
      await page.ev("window.nudge()");
      await page.when(`(window.fetched ?? 0) >= ${n + 3}`);
    };
    return { buttons, change, mark: () => page.ev('document.querySelector("#view > *").dataset.mark = "1"') };
  };

  test("a change re-renders the page", async () => {
    const { change, mark } = await changeRig();
    await mark();
    await change();
    expect(await page.ev('document.querySelector("#view > *").dataset.mark')).toBeUndefined();
    await page.reload();
  }, 30_000);

  test("what the reader opened comes back after a change", async () => {
    const { change, mark } = await changeRig();
    await page.ev('document.querySelector("#view details[data-keep]").open = true');
    await mark();
    await change();
    expect(await page.ev('[document.querySelector("#view details[data-keep]").open, !!document.querySelector("#view > *").dataset.mark]')).toEqual([true, false]);
    await page.reload();
  }, 30_000);

  test("a change's reload in flight when a button is armed does not render over it", async () => {
    const { buttons, mark } = await changeRig();
    await page.ev("void (window.gate = new Promise((ok) => { window.release = ok; }))");
    const n = await page.ev("window.fetched ?? 0");
    await page.ev("window.nudge()");
    await page.ev(`${buttons}.click()`);
    await mark();
    await page.ev("window.gate = null; window.release()");
    await page.when(`(window.fetched ?? 0) > ${n}`);
    expect(await page.ev('[!!document.querySelector("#view button.act.ask"), document.querySelector("#view > *").dataset.mark]')).toEqual([true, "1"]);
    await page.reload();
  }, 30_000);

  test("a tab hidden past the out-of-date span does not say so while the reload on its return runs", async () => {
    await changeRig();
    const stale = 'document.querySelector("#view .shead .say").textContent.includes("out of date")';
    await page.ev('Object.defineProperty(document, "hidden", { configurable: true, get: () => window.away === true }); window.away = true; document.dispatchEvent(new Event("visibilitychange"))');
    await page.ev("window.skew += 4 * 60_000");
    // The tab shows again, and the shell checks at once; its reload waits on the gate, as a slow server would.
    expect(await page.ev(`(() => { window.gate = new Promise((ok) => { window.release = ok; }); window.away = false; document.dispatchEvent(new Event("visibilitychange")); return ${stale}; })()`)).toBe(false);
    await page.ev("window.gate = null; window.release()");
    await page.reload();
  }, 30_000);

  test("Status with its stream open does not say it is out of date after the clock moves 4 minutes", async () => {
    await changeRig();
    // Each out-of-date check reads document.hidden first: a read after the clock moved shows that a check ran since.
    await page.ev('window.looks = 0; Object.defineProperty(document, "hidden", { configurable: true, get: () => (window.looks++, false) })');
    // The clock moves and the stream delivers a ping in the same turn, as the server's ping every 25 s keeps doing.
    await page.ev('window.skew += 4 * 60_000; window.looks = 0; window.es.dispatchEvent(new Event("ping"))');
    await page.when("window.looks > 0");
    expect(await page.ev('document.querySelector("#view .shead .say").textContent.includes("out of date")')).toBe(false);
    await page.reload();
  }, 30_000);

  test("a change in the factory folder reloads a live page that used to poll", async () => {
    // The page fetches /api/factory again only on a change: its quiet timer waits a minute.
    const loads = 'performance.getEntriesByType("resource").filter((e) => e.name.includes("/api/factory")).length';
    await page.go("#/factory/agents?view=usage");
    await page.when('document.querySelector("#view aleph-chart")');
    const n = await page.ev<number>(loads);
    writeFileSync(join(env.ALEPH_FACTORY_DIR, "nudge.json"), "{}");
    await page.when(`${loads} > ${n}`);
  }, 30_000);

  test("a slow first load does not draw over a newer one", async () => {
    // Hold the fetch of the first /api/factory load, let a second (the reload after an action) answer, then release the first.
    // A read of /api/flow, the last a Status load makes (its `more`), sets window.flowRead after the load that reads it ends.
    await page.ev(`(() => {
      const rf = window.fetch;
      let held = true;
      window.fetch = (u, o) => {
        if (String(u).startsWith("/api/flow")) return rf(u, o).then((r) => {
          const j = r.json.bind(r);
          const read = () => { window.flowRead = true; };
          r.json = () => j().then((d) => { setTimeout(read); return d; });
          return r;
        });
        if (!String(u).startsWith("/api/factory") || !held) return rf(u, o);
        held = false;
        return new Promise((ok) => { window.release = () => ok(rf(u, o).then((r) => {
          const j = r.json.bind(r);
          const read = () => { window.firstRead = true; };
          r.json = () => j().then((d) => { setTimeout(read); return d; });
          return r;
        })); });
      };
    })()`);
    await page.go("#/issues");
    await page.ev('location.hash = "#/"');
    await page.when("window.release");
    await page.ev('void import("/views/lib/router.js").then((m) => m.redraw(true))');
    await page.when('document.querySelector("#view .page, #view > *") && !/^\\s*Loading/.test(document.querySelector("#view").textContent)');
    await page.when("window.flowRead"); // The second load's `more` drew: only the old answer could draw now.
    await page.ev('document.querySelector("#view > *").dataset.mark = "1"');
    await page.ev("window.release()");
    await page.when("window.firstRead");
    expect(await page.ev('document.querySelector("#view > *").dataset.mark')).toBe("1"); // The old answer did not redraw.
    await page.reload(); // Takes the patched fetch away.
  }, 30_000);

  test("a change that comes while an input has focus reloads the view after the input blurs", async () => {
    // Count the changes to the key the view reads, to know the change came before the check. Count the loads that start
    // and end, and the stream's open, to know the quiet reload that `onopen` starts has ended before the input takes focus.
    // The counts leave out a load of the Status page that is still in flight at the patch.
    await page.ev(`(() => {
      const ES = window.EventSource, rf = window.fetch;
      window.heard = 0; window.started = 0; window.ended = 0; window.opens = null;
      window.EventSource = class extends ES { constructor(...a) { super(...a); this.addEventListener("change", (m) => { if (JSON.parse(m.data).keys.includes("/api/factory")) window.heard++; }); this.addEventListener("open", () => { window.opens ??= window.started; }); } };
      window.fetch = (u, o) => {
        if (!String(u).startsWith("/api/factory")) return rf(u, o);
        window.started++;
        return rf(u, o).then((r) => { r.clone().arrayBuffer().finally(() => { window.ended++; }); return r; });
      };
    })()`);
    await page.go("#/factory/agents?view=usage");
    await page.when('document.querySelector("#view aleph-chart")');
    await page.when("window.opens !== null && window.started > window.opens && window.ended === window.started");
    await page.ev(`(() => { const i = document.createElement("input"); i.id = "probe"; document.body.append(i); i.focus(); })()`);
    const n = await page.ev<number>("window.started");
    writeFileSync(join(env.ALEPH_FACTORY_DIR, "nudge2.json"), "{}");
    await page.when("window.heard > 0");
    expect(await page.ev<number>("window.started")).toBe(n); // No load starts while focus stays.
    await page.ev('document.getElementById("probe").blur()');
    await page.when(`window.started > ${n}`);
    await page.ev('document.getElementById("probe").remove()');
    await page.reload(); // Takes the patched EventSource and fetch away.
  }, 30_000);

  test("Status: a refused action shows the reason on its row, Enter confirms a Deny, and a decided Ask stays off when the Herald draws again", async () => {
    await page.go("#/");
    await page.when(`document.querySelector('#view button.act[data-act="land"], #view button.act[data-act="recheck"]')`);
    await page.ev(`(() => {
      const f = window.fetch;
      window.fetch = (u, o) => o?.method === "POST" ? Promise.resolve(new Response(JSON.stringify({ error: "it cannot wait" }), { status: 422 })) : f(u, o);
      const b = document.querySelector('#view button.act[data-act="land"], #view button.act[data-act="recheck"]');
      b.click();
      if (b.classList.contains("ask")) b.click();
    })()`);
    await page.when('document.querySelector("#view .act-msg")?.textContent.includes("it cannot wait")');
    expect(await page.ev('document.querySelector("#view .act-msg").closest("article").isConnected')).toBe(true);
    await page.reload(); // Takes the patched fetch away.
    // Enter in the reason box confirms a Deny, and the card leaves before any reload of the state.
    await page.when('document.querySelector("#view article.issue-row")');
    // A real Ask card with a Deny, from the view's own renderer. After the POST every other fetch hangs, and the mark on #view shows that no render replaced it.
    await page.ev(`import("/views/lib/ask-cards.js").then(({ askCard }) => {
      const f = window.fetch;
      window.posts = [];
      window.fetch = (u, o) => o?.method === "POST" ? (window.posts.push([u, o.body]), Promise.resolve(new Response("{}"))) : window.posts.length ? new Promise(() => {}) : f(u, o);
      document.querySelector("#view > *").dataset.mark = "1";
      document.querySelector("#view > *").insertAdjacentHTML("afterbegin", askCard({ id: "tools-4", reason: "question", kind: "question", card: "decide", label: "Decide", headline: "Support a second input file",
        situation: "Decide it.", escalated: true, actions: [{ act: "deny", label: "Deny", hint: "closes the question", path: "/api/issues/tools-4/drop", body: { reason: "User denied it" }, input: { name: "reason", lead: "User denied: " } }] }));
      const b = document.querySelector('#view article.issue-row button.act[data-act="deny"]');
      window.card = b.closest("article");
      b.click();
      const inp = b.closest(".choice").querySelector("input.reason");
      inp.value = "not now";
      inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    })`);
    await page.when("!window.card.isConnected");
    expect(await page.ev('document.querySelector("#view > *").dataset.mark')).toBe("1");
    const posts = await page.ev<[string, string][]>("window.posts");
    expect(posts.map(([u, body]) => [u, JSON.parse(body)])).toEqual([["/api/issues/tools-4/drop", { reason: "User denied: not now" }]]);
    await page.reload(); // Takes the patched fetch away.
    // A decided Ask stays off the Status page when the Herald draws again from its last state.
    await page.when('document.querySelector("#herald")');
    // The Herald's last state lists the Ask; a stream event draws it again. After the POST every other fetch hangs.
    await page.ev(`Promise.all([import("/views/now.js"), fetch("/api/factory").then((r) => r.json())]).then(([{ view }, s]) => {
      s.asks = [{ id: "tools-5", reason: "question", kind: "question", card: "decide", label: "Decide", headline: "Support a third input file",
        situation: "Decide it.", escalated: true, actions: [{ act: "deny", label: "Deny", hint: "closes the question", path: "/api/issues/tools-5/drop", body: {}, input: { name: "reason", lead: "" } }] }];
      view.render(s, {}, new URLSearchParams());
      window.beat = () => view.event(document.querySelector("#view"), { seq: 1e9, rows: [] });
      window.beat();
      const f = window.fetch;
      window.posts = [];
      window.fetch = (u, o) => o?.method === "POST" ? (window.posts.push(u), Promise.resolve(new Response("{}"))) : window.posts.length ? new Promise(() => {}) : f(u, o);
      const b = document.querySelector('#herald article[data-ask="tools-5"] button.act[data-act="deny"]');
      b.click();
      const inp = b.closest(".choice").querySelector("input.reason");
      inp.value = "not now";
      inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    })`);
    await page.when('window.posts.length && !document.querySelector("#view article[data-ask=\'tools-5\']")');
    await page.ev("window.beat()");
    expect(await page.ev<number>('document.querySelectorAll("#view article.issue-row[data-ask=\'tools-5\']").length')).toBe(0);
    await page.reload(); // Takes the patched fetch away.
  }, 60_000);

  test("Issue: a dead blocker shows and Stop waiting removes it, an attached image shows in Media, and a pasted screenshot attaches", async () => {
    await page.go("#/issues/demo/21");
    await page.when(`document.querySelector('.dp-blocked [data-act="unblock"]')`);
    expect(await page.ev<string>(`document.querySelector(".dp-blocked").textContent`)).toContain("Waits on");
    await page.ev(`document.querySelector('.dp-blocked [data-act="unblock"]').click()`);
    await page.when(`!document.querySelector('.dp-blocked [data-act="unblock"]')`);
    expect(await page.ev<string>(`document.querySelector(".dp-blocked")?.textContent ?? ""`)).not.toContain("Waits on");
    expect(page.errors).toEqual([]);
    // An attached image shows in Media, and a pasted screenshot attaches.
    // A PNG drawn on a canvas, filed through the API as the new-issue form files it.
    const filed = await page.ev<{ key: string; n: number }>(`(async () => {
      const key = (await fetch("/api/issues").then((r) => r.json()).then((d) => (d.issues ?? d)[0].repo));
      const c = Object.assign(document.createElement("canvas"), { width: 40, height: 30 });
      c.getContext("2d").fillRect(0, 0, 20, 15);
      const data = c.toDataURL("image/png").split(",")[1];
      const r = await fetch("/api/issues", { method: "POST", headers: { "content-type": "application/json", "x-aleph-ui": "1" }, body: JSON.stringify({ repo: key, title: "Fix the header colour", body: "see the shot", media: [{ name: "shot.png", data }] }) }).then((r) => r.json());
      return { key, n: r.added };
    })()`);
    await page.go(`#/issues/${filed.key}/${filed.n}`);
    await page.when(`[...document.querySelectorAll(".media-grid img")].some((i) => i.complete && i.naturalWidth === 40)`);
    await page.ev(`(async () => {
      const blob = await fetch(document.querySelector(".media-grid img").src).then((r) => r.blob());
      const dt = new DataTransfer();
      dt.items.add(new File([blob], "", { type: "image/png" }));
      const form = document.querySelector('form[data-ui="issue-media"]');
      form.querySelector("input[type=file]").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      form.requestSubmit();
    })()`);
    await page.when(`document.querySelectorAll(".media-grid img").length === 2`);
    expect(await page.ev<string[]>(`[...document.querySelectorAll(".media-grid img")].map((i) => i.alt)`)).toEqual(["shot.png", "pasted.png"]);
  }, 90_000);

  test("the Issue page's contents link each panel it shows, a click keeps the route, and a click elsewhere leaves no entry current", async () => {
    await page.width(1400);
    await page.go("#/issues/demo/21");
    await page.when('document.querySelector(".issue-page .toc a")');
    expect(await page.ev(`(() => { const links = [...document.querySelectorAll(".toc a")];
      return { ok: links.every((a) => document.getElementById(a.getAttribute("href").slice(1))?.offsetParent), labels: links.map((a) => a.textContent) }; })()`))
      .toMatchObject({ ok: true, labels: expect.arrayContaining(["Media", "Notes"]) });
    // The click on Media ends the scroll at the end of the page, where the last entry would be current: the click keeps Media current.
    await page.ev('document.querySelector(".toc a[href=\'#issue-media\']").click()');
    await page.when("scrollY > 0 && scrollY + innerHeight >= document.documentElement.scrollHeight - 1");
    expect(await page.ev('[...document.querySelectorAll(".toc a[aria-current]")].map((a) => a.textContent)')).toEqual(["Media"]);
    expect(await hash()).toBe("#/issues/demo/21");
    // A scroll by hand drops the click: at the end of the page the last entry is current.
    await page.ev('dispatchEvent(new WheelEvent("wheel")); scrollTo(0, document.documentElement.scrollHeight)');
    await page.when('[...document.querySelectorAll(".toc a")].at(-1).hasAttribute("aria-current")');
    expect(await page.ev('[...document.querySelectorAll(".toc a[aria-current]")].map((a) => a.textContent)'))
      .toEqual([await page.ev('[...document.querySelectorAll(".toc a")].at(-1).textContent')]);
    expect(await page.ev('getComputedStyle(document.querySelector(".toc")).position')).toBe("sticky");
    // No entry stays current when a click elsewhere leaves no section in the band.
    await page.ev('document.querySelector(".toc a[href=\'#issue-notes\']").click()');
    await page.when('document.querySelector(".toc a[aria-current]")?.textContent === "Notes"');
    // The router's smooth scroll to Notes ends first, or it would carry on past the scroll to the top.
    await page.when("scrollY > 0 && (window.last === scrollY || ((window.last = scrollY), false))");
    await page.ev('document.querySelector(\'button[data-editor="start"]\').click(); scrollTo(0, 0)');
    await page.when('scrollY === 0 && !document.querySelector(".toc a[aria-current]")');
    expect(await page.ev('document.querySelectorAll(".toc a[aria-current]").length')).toBe(0);
    expect(page.errors).toEqual([]);
  }, 60_000);

});

describe.skipIf(!chromeUsable)("Status page", () => {
  let rig: Rig, page: Page;
  beforeAll(async () => { rig = await startRig(); page = await rig.open(); }, 150_000);
  afterAll(() => rig?.stop());
  afterEach(async () => { if (!last.ok) page = await rig.reset(); });


  test("a metric card keeps its second value at phone width", async () => {
    await page.width(400);
    await page.go("#/");
    const m = await page.ev<{ display: string; w: number; text: string; one: boolean }>(`import("/views/lib/html.js").then(({ statCard }) => {
      const host = document.createElement("div");
      host.id = "tile-probe";
      // Outside #view: the second draw of the page replaces the view and would take the probe with it.
      document.body.prepend(host);
      host.innerHTML = '<section class="tiles">' + statCard({ k: "Worker slots", v: "0", v2: "5", q: ["in use", "cap"] }) + "</section>";
      const em = host.querySelector(".tile.sc b em"), b = host.querySelector(".tile.sc b");
      return { display: getComputedStyle(em).display, w: em.getBoundingClientRect().width, text: b.textContent, one: em.getBoundingClientRect().height < b.getBoundingClientRect().height * 1.5 && b.scrollWidth <= b.clientWidth };
    })`);
    expect(m.display).not.toBe("none");
    expect(m.w).toBeGreaterThan(0);
    expect(m.text).toContain("/ 5");
    expect(m.one).toBe(true);
    await page.ev('document.querySelector("#tile-probe").remove()');
    await page.width(1200);
  }, 30_000);

  test("Design: at 390 px a key on two lines keeps the values of a metric row level, and the smallest value is the size floor", async () => {
    await page.width(390);
    await page.go("#/design");
    await page.when('document.querySelector("#design-metric .tile b")');
    const r = await page.ev<any>(`(() => {
      const tiles = [...document.querySelectorAll("#design-metric .tile")];
      const rows = {};
      for (const t of tiles) (rows[Math.round(t.getBoundingClientRect().top)] ??= []).push(t);
      const probe = document.createElement("i");
      probe.style.fontSize = "var(--fs-metric-min)";
      document.body.append(probe);
      const floor = parseFloat(getComputedStyle(probe).fontSize);
      probe.remove();
      return {
        wrapped: tiles.some((t) => {
          const k = t.querySelector(".k").getBoundingClientRect();
          return k.height > 1.5 * parseFloat(getComputedStyle(t.querySelector(".k")).fontSize) || [...t.querySelectorAll(".r1 > *")].some((c) => c.getBoundingClientRect().top > k.top + 1);
        }),
        tops: Object.values(rows).map((ts) => new Set(ts.map((t) => t.querySelector("b").getBoundingClientRect().top)).size),
        smallest: Math.min(...[...document.querySelectorAll(".tile b")].map((b) => parseFloat(getComputedStyle(b).fontSize))),
        floor,
      };
    })()`);
    expect(r.wrapped).toBe(true);
    expect(r.tops.every((n: number) => n === 1)).toBe(true);
    expect(r.floor).toBe(16);
    expect(r.smallest).toBe(r.floor);
    await page.width(1200);
  }, 30_000);

  dockTest("the dock holds the font picker, the theme picker, the annotations, the shelf and the chat", async () => {
    await page.width(1200);
    await page.go("#/");
    expect(await page.ev('[...document.querySelectorAll("#dock-host > div")].map((d) => d.id)')).toEqual(["dock-fonts", "dock-theme", "dock-annotate", "dock-shelf", "dock-chat"]);
  });

  dockTest("the theme picker's Dark holds on every page, and System clears it", async () => {
    const mode = (m: string) => page.ev(`document.getElementById("dock-theme").shadowRoot.querySelector('[data-mode="${m}"]').click()`);
    await page.go("#/");
    await mode("Dark");
    await page.go("#/jobs");
    expect(await page.ev("document.documentElement.dataset.theme")).toBe("dark");
    await page.reload();
    await page.when('document.getElementById("dock-theme")');
    expect(await page.ev("document.documentElement.dataset.theme")).toBe("dark");
    await mode("System");
    expect(await page.ev("document.documentElement.dataset.theme ?? null")).toBeNull();
  });

  dockTest("the font picker sets the sans font and the chart scale, and its reset clears them", async () => {
    await page.width(1200);
    await page.go("#/");
    const pick = (role: string, v: string) => page.ev(`(() => { const s = document.getElementById("dock-fonts").shadowRoot.querySelector('select[data-role="${role}"]:not([data-prop])'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await pick("sans", "Inter");
    expect(await page.ev('document.documentElement.style.getPropertyValue("--sans")')).toBe("'Inter', system-ui, sans-serif");
    // Charts read --chart-scale, which the picker sets from the Charts size step.
    await page.ev(`(() => { const s = document.getElementById("dock-fonts").shadowRoot.querySelector('select[data-role="chart"][data-prop="size"]'); s.value = "1.08"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    expect(await page.ev('document.documentElement.style.getPropertyValue("--chart-scale")')).toBe("1.08");
    await page.ev('document.getElementById("dock-fonts").shadowRoot.querySelector(".reset").click()');
    expect(await page.ev('document.documentElement.style.getPropertyValue("--sans")')).toBe("");
  });

  dockTest("a note saves to the server by you, an agent's note shows its own pin, and the notes list offers Send and Chat", async () => {
    await page.width(1200);
    await page.go("#/");
    // A click in pick mode opens a note instead of following the link; the saved note shows a pin and the Markdown names it.
    await page.ev('document.getElementById("dock-annotate").shadowRoot.querySelector(".pick").click()');
    const before = await page.ev<string>("location.hash");
    await page.ev('document.querySelector("#nav li a").click()');
    expect(await page.ev<string>("location.hash")).toBe(before);
    await page.ev('(() => { const l = document.getElementById("dock-annotate-layer").shadowRoot; l.querySelector("textarea.note").value = "rename this"; l.querySelector(".save").click(); })()');
    await page.when('document.getElementById("dock-annotate").shadowRoot.querySelector(".count").textContent === "1"');
    expect(await page.ev('document.getElementById("dock-annotate-layer").shadowRoot.querySelectorAll(".pin").length')).toBe(1);
    await page.ev('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
    // The note went to the server through the dock's notes handler, by you.
    // The updater signals a change once the file is written: each change signal is a read.
    const server = () => page.ev<{ id: string; note: string; by: string }[]>('fetch("/api/annotations").then((r) => r.json())');
    const saved = await page.ev<{ note: string; by: string }[]>(`new Promise((done) => {
      const es = new EventSource("/api/events");
      const read = () => fetch("/api/annotations").then((r) => r.json()).then((n) => { if (n.length) { es.close(); done(n); } });
      es.onopen = read;
      es.addEventListener("change", read);
    })`);
    expect(saved.map((n) => [n.note, n.by])).toEqual([["rename this", "you"]]);
    // An agent's note, added with the CLI, reaches the open page through the change signal, with its own pin.
    const cli = shelfNote;
    expect(cli(["add", "--selector", ".mark", "--", "from the agent"]).exitCode).toBe(0);
    await page.when('document.getElementById("dock-annotate").shadowRoot.querySelector(".count").textContent === "2"');
    expect(await page.ev('document.getElementById("dock-annotate-layer").shadowRoot.querySelectorAll(".pin.agent").length')).toBe(1);
    // The notes list of an open note offers both ways out: Send, from the `send` index.html gives annotate(), and Chat, from the tool.
    await page.ev('document.getElementById("dock-annotate").shadowRoot.querySelector(".count").click()');
    expect(await page.ev('(() => { const u = document.getElementById("dock-annotate").shadowRoot; return [u.querySelector(".term").hidden, u.querySelector(".term").textContent, u.querySelector(".send").hidden, u.querySelector(".send").textContent]; })()')).toEqual([false, "Send", false, "Chat"]);
    for (const n of await server()) expect(cli(["drop", n.id]).exitCode).toBe(0);
  }, 30_000);

  /**
   * Opens Status with a stand-in for the server's chat turn: it keeps each body the chat posts and ends the turn at
   * once. `say` sends a message and returns the body it posted. `done` restores the page and drops every note.
   */
  const chatRig = async () => {
    await page.width(1200);
    await page.go("#/");
    const cli = shelfNote;
    const chat = 'document.getElementById("dock-chat").shadowRoot', note = 'document.getElementById("dock-annotate")';
    await page.ev(`(() => { window.sent = []; window.realFetch = fetch; window.fetch = (u, o) => u === "/api/chat"
      ? (sent.push(JSON.parse(o.body)), Promise.resolve(new Response("event: end\\ndata: {}\\n\\n", { headers: { "content-type": "text/event-stream" } })))
      : realFetch(u, o); })()`);
    const say = async (text: string) => {
      const n = await page.ev<number>("sent.length");
      await page.ev(`(() => { const ui = ${chat}; ui.querySelector("textarea").value = ${JSON.stringify(text)}; ui.querySelector("form").requestSubmit(); })()`);
      await page.when(`sent.length === ${n + 1}`);
      return page.ev<{ text: string; annotations?: string[] }>("sent.at(-1)");
    };
    /** Adds the page's first note, "#1 the nav", and returns its id. */
    const navNote = async () => {
      expect(cli(["add", "--selector", "#nav", "--", "the nav"]).exitCode).toBe(0);
      await page.when(`${note}.shadowRoot.querySelector(".count").textContent === "1"`);
      return (await page.ev<{ id: string }[]>('fetch("/api/annotations").then((r) => r.json())'))[0].id;
    };
    const done = async () => {
      await page.ev(`window.fetch = realFetch; ${chat}.querySelector(".new").click(); ${chat}.querySelector(".fab").click()`);
      for (const n of await page.ev<{ id: string }[]>('fetch("/api/annotations").then((r) => r.json())')) expect(cli(["drop", n.id]).exitCode).toBe(0);
    };
    return { chat, note, say, navNote, done };
  };

  dockTest("the chat sends a chosen note of the page with the next message only", async () => {
    const { chat, say, navNote, done } = await chatRig();
    const old = await navNote();
    await page.ev(`${chat}.querySelector(".fab").click()`);
    expect(await page.ev(`${chat}.querySelector(".point").hidden`)).toBe(false);
    // The menu lists the page's note and a new pick; the chosen note shows as a chip and goes with the next message only.
    await page.ev(`${chat}.querySelector(".point").click()`);
    expect(await page.ev<string[]>(`[...${chat}.querySelectorAll(".menu button")].map((b) => b.textContent)`)).toEqual(["#1 the nav", "New: pick an element"]);
    await page.ev(`${chat}.querySelector(".menu button").click()`);
    expect(await page.ev(`${chat}.querySelector(".points").textContent`)).toContain("#1 the nav");
    expect((await say("rename it")).annotations).toEqual([old]);
    expect(await page.ev(`${chat}.querySelector(".points").textContent`)).toBe("");
    expect((await say("and now?")).annotations).toBeUndefined();
    await done();
  }, 30_000);

  dockTest("a note picked from the chat comes back as the chip and goes with the next message", async () => {
    const { chat, note, say, navNote, done } = await chatRig();
    const old = await navNote();
    await page.ev(`${chat}.querySelector(".fab").click()`);
    // New: the panel hides, a click picks an element, and the saved note comes back as the chip.
    await page.ev(`${chat}.querySelector(".point").click()`);
    await page.ev(`${chat}.querySelector(".menu .pick").click()`);
    expect(await page.ev(`${chat}.querySelector(".pop").hidden`)).toBe(true);
    expect(await page.ev(`${note}.shadowRoot.querySelector(".pick").getAttribute("aria-pressed")`)).toBe("true");
    await page.ev('document.querySelector("#nav li a").click()');
    expect(await page.ev(`${note}.shadowRoot.querySelector(".pick").getAttribute("aria-pressed")`)).toBe("false");
    await page.ev('(() => { const l = document.getElementById("dock-annotate-layer").shadowRoot; l.querySelector("textarea.note").value = "this link"; l.querySelector(".save").click(); })()');
    await page.when(`!${chat}.querySelector(".pop").hidden && ${chat}.querySelector(".points").textContent.includes("#2 this link")`);
    const fresh = await say("what is this");
    expect(fresh.annotations).toHaveLength(1);
    expect(fresh.annotations![0]).not.toBe(old);
    await done();
  }, 30_000);

  dockTest("a cancelled pick attaches nothing", async () => {
    const { chat, done } = await chatRig();
    await page.ev(`${chat}.querySelector(".fab").click()`);
    await page.ev(`${chat}.querySelector(".point").click()`);
    await page.ev(`${chat}.querySelector(".menu .pick").click()`);
    await page.ev('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
    await page.when(`!${chat}.querySelector(".pop").hidden`);
    expect(await page.ev(`${chat}.querySelector(".points").textContent`)).toBe("");
    await done();
  }, 30_000);

  dockTest("without the annotate tool the chat hides its point button and still sends", async () => {
    const { chat, note, say, done } = await chatRig();
    await page.ev(`${note}.id = "dock-annotate-off"`);
    await page.ev(`${chat}.querySelector(".fab").click()`);
    expect(await page.ev(`${chat}.querySelector(".point").hidden`)).toBe(true);
    expect((await say("plain")).text).toBe("plain");
    await page.ev('document.getElementById("dock-annotate-off").id = "dock-annotate"');
    await done();
  }, 30_000);

  test("Issue: in edit mode the title input fills the width of its heading", async () => {
    await page.go(await page.ev<string>('fetch("/api/issues").then((r) => r.json()).then((d) => (d.issues ?? d)[0].href)'));
    await page.when('document.querySelector(".issue-page [data-editor=start]")');
    await page.ev(`document.querySelector(".issue-page [data-editor=start]").click()`);
    await page.when(`document.querySelector(".issue-page.editing .title-edit")?.offsetWidth > 0`);
    const [input, h1] = await page.ev<number[]>(`[document.querySelector(".issue-page .title-edit").offsetWidth, document.querySelector(".issue-page .ph h1").clientWidth]`);
    expect(input).toBe(h1);
  });

  test("a redraw keeps a marked element connected, and one click on the status sentence, in the head marked before them, after two redraws jumps to the Herald once", async () => {
    await page.go("#/");
    await page.when('document.querySelector("#view #herald") && document.querySelector("#view #scorecard")');
    await page.ev('window.mark = [document.querySelector("#view #scorecard"), document.querySelector("#view .shead")]; window.n = 0; Element.prototype.scrollIntoView = function () { window.n++; }');
    for (let i = 0; i < 2; i++) await page.ev('import("/views/lib/router.js").then((m) => m.redraw())');
    expect(await page.ev('[document.querySelector("#view #scorecard") === mark[0], mark[0].isConnected, document.querySelector("#view .shead") === mark[1]]')).toEqual([true, true, true]);
    await page.ev('mark[1].querySelector(".say").click()');
    expect(await page.ev("window.n")).toBe(1);
    expect(page.errors).toEqual([]);
  }, 60_000);

  test("the Herald's tabs read Events, Active, Inspector, the Active tab shows its pane, and its one list keeps its rows through a redraw", async () => {
    await page.go("#/");
    await page.when('document.querySelector("#view #herald")');
    // The page's last state gets a running issue, a running job and a queued issue; a stream event draws the Herald again from it. Its `seq` of 0 leaves the state's feed rows for the next test.
    await page.ev(`import("/views/now.js").then(({ view }) => fetch("/api/factory").then((r) => r.json()).then((s) => {
      view.render({ ...s, runningIssues: [{ id: "aleph-9", title: "Sort it", href: "#/issues/aleph/9" }], running: [{ id: "job.0", name: "aleph-7", item: { title: "Fix it" } }], queued: [{ repo: "aleph", id: 12, title: "Wait" }] }, {}, new URLSearchParams());
      window.beat = () => view.event(document.querySelector("#view"), { seq: 0, rows: [] });
      window.beat();
    }))`);
    expect(await page.ev('[...document.querySelectorAll("#herald button[data-tab]")].map((b) => b.textContent)')).toEqual(["Events", "Active", "Inspector"]);
    await page.ev('document.querySelector("#herald button[data-tab=active]").click()');
    const listed = () => page.ev('[document.querySelector("#herald section[data-pane=active]").hidden, ...[...document.querySelectorAll("#herald [data-pane=active] a")].map((a) => a.getAttribute("href"))]');
    const all = [false, "#/issues/aleph/9", "#/issues/aleph/12", "#/jobs/job.0"];
    expect(await listed()).toEqual(all);
    await page.ev("window.beat()");
    expect(await listed()).toEqual(all);
    expect(page.errors).toEqual([]);
    // Drop the kept tab, and leave Status, so the next visit draws its own data on the Events tab.
    await page.ev('localStorage.removeItem("aleph.herald.inspect")');
    await page.go("#/issues");
  }, 60_000);

  test("the Herald's alerts show on each of its tabs", async () => {
    await page.go("#/");
    await page.when('document.querySelector("#view #herald")');
    // The page's last state gets an open Ask; a stream event of `seq` 0 draws the Herald again from it.
    await page.ev(`import("/views/now.js").then(({ view }) => fetch("/api/factory").then((r) => r.json()).then((s) => {
      s.asks = [{ id: "tools-6", reason: "question", kind: "question", card: "decide", label: "Decide", headline: "Pick a format", situation: "Decide it.", escalated: true, actions: [] }];
      view.render(s, {}, new URLSearchParams());
      view.event(document.querySelector("#view"), { seq: 0, rows: [] });
    }))`);
    const seen = [];
    for (const tab of ["events", "active", "inspector"]) {
      await page.ev(`document.querySelector("#herald button[data-tab=${tab}]").click()`);
      seen.push(await page.ev(`[document.querySelector("#herald section[data-pane=${tab}]").hidden, document.querySelector("#herald #needs")?.checkVisibility() ?? false]`));
    }
    expect(seen).toEqual([[false, true], [false, true], [false, true]]);
    // The alerts keep their own size: the open pane, not the block above it, takes the card's free height.
    expect(await page.ev(`(({ flexGrow, minHeight }) => [flexGrow, minHeight])(getComputedStyle(document.querySelector("#herald #needs")))`)).toEqual(["0", "auto"]);
    expect(page.errors).toEqual([]);
    await page.ev('localStorage.removeItem("aleph.herald.inspect")');
    await page.go("#/issues");
  }, 60_000);

  test("when the first of two running jobs ends, a redraw by morph fades a ghost of that job where its row was", async () => {
    await page.go("#/");
    await page.when('document.querySelector("#view #herald")');
    const ghost = await page.ev<string[]>(`Promise.all([import("/views/now.js"), import("/vendor/idiomorph.js"), fetch("/api/factory").then((r) => r.json())]).then(([{ view }, { Idiomorph }, s]) => {
      const root = document.querySelector("#view"), job = (name) => ({ name, started: "2026-11-15T10:00:00Z", item: { title: name } });
      const draw = (running) => Idiomorph.morph(root, view.render({ ...s, runningIssues: [], running }, {}, new URLSearchParams()), { morphStyle: "innerHTML" });
      draw([job("first job"), job("second job")]);
      const moved = view.swap(root);
      draw([job("second job")]);
      moved();
      // The redraw stops only the animations it started: the run dot's breath goes on.
      return [root.querySelector("#herald .run-now:not([data-job]) .run-title").textContent, ...root.querySelector("#herald .run-now[data-job] .run-dot").getAnimations().filter((a) => a.playState === "running").map((a) => a.animationName)];
    })`);
    expect(ghost).toEqual(["first job", "breathe"]);
    // The morph drew made-up jobs into #view: leave Status, so the next visit draws its own data.
    await page.go("#/issues");
  }, 60_000);

  /**
   * Opens Status and draws the rig once the page's own loads have ended, so that none of them draws over it. A load is
   * a fetch of /api/factory or /api/flow, and ends when its json is read and the draw that follows it has run. The
   * first load makes two. The stream's open starts a third, which draws only if its data differs.
   */
  const heraldRig = async () => {
    await page.go("#/issues");
    await page.ev(`(() => {
      window.loads = { started: 0, ended: 0 };
      if (window.rigged) return;
      window.rigged = true;
      const rf = window.fetch;
      window.fetch = (u, o) => {
        if (!/^\\/api\\/(factory|flow)/.test(String(u))) return rf(u, o);
        const l = window.loads, end = () => { l.ended++; };
        l.started++;
        return rf(u, o).then((r) => {
          const j = r.json.bind(r);
          r.json = () => j().then((d) => { setTimeout(end); return d; });
          return r;
        });
      };
    })()`);
    await page.go("#/");
    await page.when("window.loads.started > 2 && window.loads.ended === window.loads.started");
    await page.ev(drawRig);
  };

  // The Herald drawn from `rows` (one feed row each, keyed `row <id>`) by morph, as a redraw does; `window.herald(ids)` puts the rows in that order, newest first.
  const drawRig = `Promise.all([import("/views/now.js"), import("/vendor/idiomorph.js"), fetch("/api/factory").then((r) => r.json())]).then(([{ view }, { Idiomorph }, s]) => {
    const root = document.querySelector("#view");
    window.view = view; window.root = root;
    window.herald = (ids) => Idiomorph.morph(root, view.render({ ...s, runningIssues: [], running: [], herald: { ...s.herald, rows: ids.map((id, i) => ({ key: "row " + id, at: "2026-11-15T10:0" + (9 - i) + ":00Z", by: "gate", word: "filed", id: [], text: ["row " + id], more: 0, lines: [] })) } }, {}, new URLSearchParams()), { morphStyle: "innerHTML" });
    window.rows = () => Object.fromEntries([...root.querySelectorAll("#herald .herald-feed > [data-key]")].map((r) => [r.dataset.key, r]));
    window.herald(["a", "b", "c"]);
  })`;

  test("a redraw by morph that reorders the Herald's feed rows keeps each row's node", async () => {
    await heraldRig();
    expect(await page.ev<boolean[]>(`(() => {
      const before = rows(), moved = view.swap(root);
      herald(["c", "a", "b"]); moved();
      const after = rows();
      return [Object.keys(after).join() === "row c,row a,row b", ...Object.keys(before).map((k) => before[k] === after[k])];
    })()`)).toEqual([true, true, true, true]);
  }, 60_000);

  test("a second redraw by swap and morph leaves no animation of the first on any row, and glides each row from where it is", async () => {
    await heraldRig();
    // The second redraw comes 60 ms into the first: row d grows and row c glides up.
    const [count, left, before, after] = await page.ev<number[][]>(`(() => {
      const first = [], tops = () => Object.values(rows()).map((r) => r.getBoundingClientRect().top);
      let moved = view.swap(root);
      herald(["d", "c", "a", "b"]); moved();
      for (const r of Object.values(rows())) for (const a of r.getAnimations({ subtree: true })) { a.currentTime = 60; first.push(a); }
      const before = tops();
      moved = view.swap(root);
      herald(["d", "c", "a", "b"]); moved();
      return [[first.length], Object.values(rows()).map((r) => r.getAnimations({ subtree: true }).filter((a) => first.includes(a)).length), before, tops()];
    })()`);
    expect(count[0]).toBeGreaterThan(0);
    expect(left).toEqual([0, 0, 0, 0]);
    after.forEach((t, i) => expect(t).toBeCloseTo(before[i], 0));
  }, 60_000);

  test("a feed row that a redraw removes fades out as an exit element with its text", async () => {
    await heraldRig();
    const exit = await page.ev<[string, boolean]>(`(() => {
      const moved = view.swap(root);
      herald(["a", "c"]); moved();
      const ghost = [...root.querySelectorAll("#herald > .event-row")].find((r) => r.textContent.includes("row b"));
      return [ghost?.textContent ?? "", ghost?.getAnimations().some((a) => a.playState === "running" && a.effect.getKeyframes().some((k) => "opacity" in k || "height" in k))];
    })()`);
    expect(exit[0]).toContain("row b");
    expect(exit[1]).toBe(true);
  }, 60_000);

  test("a Herald feed row has the card background, and clips its content while it grows", async () => {
    await heraldRig();
    const [bg, overflow] = await page.ev<string[]>(`(() => {
      const moved = view.swap(root);
      herald(["d", "a", "b", "c"]); moved();
      const row = root.querySelector('#herald [data-key="row d"]');
      return [getComputedStyle(root.querySelector("#herald .event-row")).backgroundColor, getComputedStyle(row).overflow];
    })()`);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(["clip", "hidden"]).toContain(overflow);
  }, 60_000);

  test("a click on a feed row's chip word filters the Herald to that word until a click on the chip's X", async () => {
    await page.go("#/");
    await page.when('document.querySelector("#view #herald")');
    // Stream rows in two words; a stream event draws them, as `event` does for a new event.
    const seen = await page.ev<[string[], string][]>(`Promise.all([import("/views/now.js"), import("/views/lib/feed.js")]).then(([{ view }, { eventRow }]) => {
      const root = document.querySelector("#view"), out = [];
      const ev = (id, word) => ({ key: "row " + id, at: "2026-11-15T10:0" + id + ":00Z", by: "gate", word, id: [], text: ["row " + id], more: 0, lines: [] });
      const rows = [ev(1, "landed"), ev(2, "failed"), ev(3, "landed")];
      const beat = (seq) => view.event(root, { seq, rows });
      const look = () => out.push([[...root.querySelectorAll("#herald .herald-feed > [data-key^='row']")].map((r) => r.dataset.key), root.querySelector("#herald .herald-word")?.textContent ?? ""]);
      const word = (key) => root.querySelector('#herald [data-key="' + key + '"] .event-line > .badge').click();
      beat(1e9); look();
      word("row 1"); look();
      // Every row in the feed has the filter's word, so a row of another word is put in to take the click.
      root.querySelector("#herald .herald-feed").insertAdjacentHTML("afterbegin", eventRow(ev(2, "failed")).replace("<div", '<div data-key="row x"'));
      word("row x"); look();
      beat(1e9 + 1); look();
      root.querySelector("#herald .herald-word .ref-x").click(); look();
      return out;
    })`);
    expect(seen).toEqual([
      [["row 3", "row 2", "row 1"], ""],
      [["row 3", "row 1"], "landed ×"],
      [["row 2"], "failed ×"],
      [["row 2"], "failed ×"],
      [["row 3", "row 2", "row 1"], ""],
    ]);
    // The stream rows are made up: leave Status, so the next visit draws its own data.
    await page.go("#/issues");
  }, 60_000);
});

describe.skipIf(!chromeUsable)("Automation redraw", () => {
  let rig: Rig, page: Page;
  beforeAll(async () => { rig = await startRig(); page = await rig.open("#/automation?view=limits"); }, 150_000);
  afterAll(() => rig?.stop());

  const ready = () => page.when('document.querySelector("#view .ph h1")');
  const redraws = async () => { for (let i = 0; i < 2; i++) await page.ev('import("/views/lib/router.js").then((m) => m.redraw())'); };

  test("a redraw keeps a marked element connected", async () => {
    await ready();
    await page.ev('window.mark = document.querySelector("#view #gates-caps"); window.mark.old = 1');
    await redraws();
    expect(await page.ev('[document.querySelector("#view #gates-caps") === window.mark, window.mark.isConnected]')).toEqual([true, true]);
    expect(page.errors).toEqual([]);
  }, 60_000);


  test("the page head keeps its controls at the right, past the title", async () => {
    await page.go("#/automation");
    await page.when('document.querySelector("#view .ph .aside")');
    await ready();
    const [[phL, phR], [asideL, asideR], [, h1R]] = await page.ev<[number, number][]>(
      `[".ph", ".ph .aside", ".ph h1"].map((s) => { const b = document.querySelector("#view " + s).getBoundingClientRect(); return [b.left, b.right]; })`);
    expect(Math.abs(asideR - phR)).toBeLessThanOrEqual(1);
    expect(asideL).toBeGreaterThan(h1R);
    expect(phL).toBeLessThan(h1R);
    expect(page.errors).toEqual([]);
  }, 60_000);
});

describe.skipIf(!chromeUsable)("Factory Jobs and Agents redraw", () => {
  let rig: Rig, page: Page;
  beforeAll(async () => { rig = await startRig(); page = await rig.open("#/factory/jobs"); }, 150_000);
  afterAll(() => rig?.stop());

  const redraws = async () => { for (let i = 0; i < 2; i++) await page.ev('import("/views/lib/router.js").then((m) => m.redraw())'); };

  test("a redraw keeps a marked element connected on Jobs and on Agents", async () => {
    for (const [hash, sel] of [["#/factory/jobs?view=timing", "#perf"], ["#/factory/agents?view=usage", ".views"]]) {
      await page.go(hash);
      await page.when(`document.querySelector("#view ${sel} aleph-chart")`);
      await page.ev(`window.mark = document.querySelector("#view ${sel}"); window.mark.old = 1`);
      await redraws();
      expect(await page.ev(`[document.querySelector("#view ${sel}") === window.mark, window.mark.isConnected]`)).toEqual([true, true]);
    }
    expect(page.errors).toEqual([]);
  }, 60_000);

  test("after two redraws one click on a stage tile, marked before them, runs its handler once and shows the stage in the address", async () => {
    await page.go("#/factory/jobs?view=timing");
    await page.when('document.querySelector("#view button[data-tile=queue]")');
    await page.ev('window.tile = document.querySelector("#view button[data-tile=queue]")');
    await redraws();
    await page.ev('window.n = 0; const r = history.replaceState.bind(history); history.replaceState = (...a) => { window.n++; return r(...a); }; window.tile.click()');
    await page.when('location.hash.includes("stage=queue")');
    expect(await page.ev("[window.tile.isConnected, window.n]")).toEqual([true, 1]);
    await page.when('document.querySelector("#view button[data-tile=queue]").getAttribute("aria-pressed") === "true"');
    // Each chart shows the frame of the picked stage, not the one drawn first.
    await page.when('document.querySelector("#view aleph-chart[key=\\"factory/jobs/trend\\"]").frame.measure.name === document.querySelector("#view button[data-tile=queue] .k").textContent');
    expect(page.errors).toEqual([]);
  }, 60_000);
});

describe.skipIf(!chromeUsable)("Sessions redraw", () => {
  let rig: Rig, page: Page;
  beforeAll(async () => { rig = await startRig(); page = await rig.open(); await page.ev(sessions); }, 150_000);
  afterAll(() => rig?.stop());

  const redraws = async () => { for (let i = 0; i < 2; i++) await page.ev('import("/views/lib/router.js").then((m) => m.redraw())'); };
  // Langfuse is off in the rig, so the sessions come from a fetch that answers with two of them.
  const sessions = `(() => { const f = window.fetch, at = "2026-11-15T10:00:00Z", s = (id, cost) => ({ id, label: id, firstPrompt: "prompt " + id, project: "p", taskTypes: [], turns: 1, cost, start: at, last: at, who: "you" });
    window.fetch = (u, o) => String(u).startsWith("/api/sessions") ? Promise.resolve(new Response(JSON.stringify({ sessions: { sessions: [s("aaa", 1), s("bbb", 2)], projects: [] }, activity: { langfuse: "ok", tools: [], hooks: [] }, skills: { skills: [] } }), { headers: { "content-type": "application/json" } })) : f(u, o); })()`;

  test("a redraw keeps a marked element connected on Sessions", async () => {
    await page.go("#/sessions");
    await page.when('document.querySelector("#view .browse")');
    await page.ev('window.mark = document.querySelector("#view .browse"); window.mark.old = 1');
    await redraws();
    expect(await page.ev('[document.querySelector("#view .browse") === window.mark, window.mark.isConnected]')).toEqual([true, true]);
    expect(page.errors).toEqual([]);
  }, 60_000);

  test("after two redraws the search box keeps its typed text, and a search hides the rows it leaves out", async () => {
    await page.go("#/sessions");
    await page.when('document.querySelector("#view [data-ui=browse-sessions]")');
    await page.ev('document.querySelector("#view [data-ui=browse-sessions]").focus(); document.execCommand("insertText", false, "bbb")');
    await redraws();
    expect(await page.ev('[document.querySelector("#view [data-ui=browse-sessions]").value, document.activeElement === document.querySelector("#view [data-ui=browse-sessions]"), [...document.querySelectorAll("#view .lrow:not([hidden])")].map((r) => r.dataset.key)]')).toEqual(["bbb", true, ["bbb"]]);
    expect(page.errors).toEqual([]);
  }, 60_000);
});

describe.skipIf(!chromeUsable)("Memory and Skill redraw", () => {
  let rig: Rig, page: Page;
  beforeAll(async () => { rig = await startRig(); page = await rig.open("#/memory"); }, 150_000);
  afterAll(() => rig?.stop());

  const redraws = async () => { for (let i = 0; i < 2; i++) await page.ev('import("/views/lib/router.js").then((m) => m.redraw())'); };

  const filter = '#view .lcard select[name=type]', search = '#view .lcard input[type=search]';

  test("a redraw keeps a marked element connected on Memory and the search box keeps its typed text", async () => {
    await page.when(`document.querySelector("${filter}") && document.querySelector("${search}")`);
    await page.ev(`window.mark = document.querySelector("${filter}"); window.mark.old = 1; document.querySelector("${search}").focus(); document.execCommand("insertText", false, "zz")`);
    await redraws();
    expect(await page.ev(`[document.querySelector("${filter}") === window.mark, window.mark.isConnected, document.querySelector("${search}").value, document.activeElement === document.querySelector("${search}")]`)).toEqual([true, true, "zz", true]);
    expect(page.errors).toEqual([]);
  }, 60_000);

  test("after two redraws one change of the type selects it alone", async () => {
    await page.go("#/memory");
    await page.when(`document.querySelector("${filter}")`);
    await page.ev(`window.board = document.querySelector("${filter}")`);
    await redraws();
    await page.ev(`(() => { const s = document.querySelector("${filter}"); s.value = "procedural"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    expect(await page.ev(`[document.querySelector("${filter}") === window.board, document.querySelector("${filter}").value, JSON.parse(localStorage.getItem("aleph.browse.memory")).f.type]`)).toEqual([true, "procedural", "procedural"]);
    expect(page.errors).toEqual([]);
  }, 60_000);
});

describe.skipIf(!chromeUsable)("Resetting the page", () => {
  let rig: Rig, page: Page, width: number;
  beforeAll(async () => { rig = await startRig(); page = await rig.open(); width = await page.ev<number>("innerWidth"); }, 150_000);
  afterAll(() => rig?.stop());

  /** The reset page answers, sits at the start address, has the default width and an empty error list. */
  const clean = async () => {
    page = await rig.reset();
    expect(await page.ev("1 + 1")).toBe(2);
    expect(await page.ev("location.hash")).toBe("#/");
    expect(await page.ev("innerWidth")).toBe(width);
    expect(page.errors).toEqual([]);
  };

  test("after a test leaves a wait that never ends, a width, a hash and an error, the reset gives a clean page", async () => {
    void page.when("false");
    await page.width(333);
    await page.go("#/issues");
    await page.ev('queueMicrotask(() => { throw new Error("boom"); })');
    await clean();
  });

  test("after a test hangs the renderer, the reset gives a clean page", async () => {
    void page.ev("for (;;) {}");
    await clean();
  });

  test("when Chrome and the server are gone, as after a timeout, the reset starts them again and opens the page there, and the command the test left waiting adds no error", async () => {
    void page.ev("for (;;) {}");
    await rig.kill();
    await clean();
  });

  test("a call Chrome never answers fails with the name of the method, and the reset gives a clean page", async () => {
    // Not `expect().rejects`: when its promise never settles, Bun hangs past the test timeout.
    expect(await page.ev("for (;;) {}", 500).then(() => "", (e: Error) => e.message)).toContain("Runtime.evaluate");
    await clean();
  }, 30_000);
});
