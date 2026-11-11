import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromeUsable, startRig, type Page, type Rig } from "./test-browser.ts";

describe.skipIf(!chromeUsable)("the UI in Chrome", () => {
  let rig: Rig, page: Page, env: Record<string, string>;
  beforeAll(async () => { rig = await startRig((e) => { env = e; }); page = await rig.open(); }, 150_000);
  afterAll(() => rig?.stop());

  const hash = () => page.ev<string>("location.hash");
  const title = () => page.ev<string>('document.querySelector("#view h1")?.textContent ?? ""');
  const click = (selector: string) => page.ev(`document.querySelector(${JSON.stringify(selector)}).click()`);

  test("the sidebar opens with the Factory header, with no link above it", async () => {
    expect(await page.ev('(() => { const li = document.querySelector("#nav li"); return [li.className, li.textContent, !!li.querySelector("a")]; })()')).toEqual(["head", "Factory", false]);
    // Every view the page loads sits in a group the sidebar shows under a header: no view keeps a hidden group.
    const heads = await page.ev<string[]>('[...document.querySelectorAll("#nav li.head")].map((li) => li.textContent.toLowerCase())');
    const groups = await page.ev<string[]>('fetch("/api/views").then((r) => r.json()).then((ns) => Promise.all(ns.map((n) => import("/views/" + n).then((m) => (m.views ?? (m.view ? [m.view] : [])).map((v) => v.group))))).then((gs) => gs.flat())');
    expect([...new Set(groups.filter(Boolean))].filter((g) => !heads.includes(g))).toEqual([]);
  });

  test("every sidebar link opens its page and marks itself, with no page error", async () => {
    const links = await page.ev<[string, string][]>('[...document.querySelectorAll("#nav li a")].map((a) => [a.getAttribute("href"), a.textContent])');
    expect(links.length).toBeGreaterThan(3);
    for (const [href, name] of links) {
      await page.go(href);
      expect([href, await page.ev('document.querySelector("#nav a[aria-current]")?.textContent')]).toEqual([href, name]);
      expect(await page.ev('document.title')).toBe(`${name} · aleph`);
      expect(await page.ev<string>('document.querySelector("#view").textContent')).not.toMatch(/Could not load|failed to render/);
    }
    expect(page.errors).toEqual([]);
  }, 60_000);

  test("an old address redirects and keeps its filters", async () => {
    await page.go("#/inventory?status=done");
    expect(await hash()).toBe("#/issues?status=done");
    await page.go("#/agents?days=30");
    expect(await hash()).toBe("#/sessions?days=30");
    await page.go("#/status/capacity");
    expect(await hash()).toBe("#/factory/agents");
  }, 30_000);

  test("a view's handlers do not outlive it", async () => {
    // go() can return while #view still shows the page before, so wait for the new view's own markup.
    await page.go("#/factory/jobs");
    await page.when('document.querySelector("#view #perf") && typeof document.querySelector("#view").onclick === "function"');
    expect(await page.ev('typeof document.querySelector("#view").oninput')).toBe("function");
    await page.go("#/issues");
    await page.when('document.querySelector("#view #inv-filters")');
    expect(await page.ev('[document.querySelector("#view").onclick, document.querySelector("#view").onchange]')).toEqual([null, null]);
    expect(await page.ev('document.querySelector("#view").oninput')).toBeNull();
    await click('#inv-filters .seg button[data-value="done"]');
    await page.when('location.hash === "#/issues?status=done"');
  }, 30_000);

  test("a badly encoded address shows the view's own answer, not the page before it, and throws nothing", async () => {
    await page.go("#/issues");
    const before = page.errors.length;
    await page.ev('void (location.hash = "#/jobs/%zz")');
    await page.when('!document.querySelector("#view .contents") && !/^\\s*Loading/.test(document.querySelector("#view").textContent)');
    expect(page.errors.slice(before)).toEqual([]);
  }, 30_000);

  test("the font picker changes the --display font of the page, with no page error", async () => {
    await page.go("#/");
    const root = () => page.ev<string>('getComputedStyle(document.documentElement).getPropertyValue("--display")');
    expect(await root()).toContain("Merriweather");
    await page.ev('(() => { const s = document.getElementById("kit-fonts").shadowRoot.querySelector("select[data-role=display]:not([data-prop])"); s.value = "Lora"; s.dispatchEvent(new Event("change", { bubbles: true })); })()');
    expect(await root()).toContain("Lora");
    expect(await page.ev<string>('getComputedStyle(document.querySelector(".mark")).fontFamily')).toContain("Merriweather");
    expect(page.errors).toEqual([]);
  }, 30_000);

  test("an unknown address says so and links to Status", async () => {
    await page.go("#/nothing/here");
    expect(await title()).toContain("Nothing at /nothing/here");
    expect(await page.ev('document.querySelector("#view a[href=\\"#/\\"]").textContent')).toBe("Status");
  }, 30_000);

  test("Issues: a filter, a sort and the search change the table in place", async () => {
    await page.go("#/issues");
    const rows = () => page.ev<number>('document.querySelectorAll("#issues-table tbody tr").length');
    const all = await rows();
    expect(all).toBeGreaterThan(1);
    const titles = () => page.ev<string>('[...document.querySelectorAll("#issues-table tbody tr")].map((r) => r.textContent).join("|")');
    const first = await titles();
    await click("#issues-table th:first-child button[data-sort]");
    await page.when(`[...document.querySelectorAll("#issues-table tbody tr")].map((r) => r.textContent).join("|") !== ${JSON.stringify(first)}`);
    await page.go("#/issues");
    const search = 'document.querySelector("#view input[type=search]")';
    await page.ev(`(() => { const i = ${search}; i.value = "zzzz-no-such-issue"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await page.when('document.querySelectorAll("#issues-table tbody tr").length < ' + all);
  }, 30_000);

  test("Memory: a row opens in the inspector", async () => {
    await page.go("#/memory");
    await page.when('document.querySelectorAll("#mem-results .mrow").length > 0');
    const all = await page.ev<number>('document.querySelectorAll("#mem-results .mrow").length');
    await page.ev('document.querySelector("#mem-results .mrow").click()');
    await page.when('document.querySelector("#mem-results .mrow[aria-selected=true]")');
    await page.when('document.querySelector("#mem-inspector h3")');
    expect(all).toBeGreaterThan(0);
    // A search that answers after the reader has left: it lands on another page, which it must not touch.
    await page.ev(`(() => {
      const f = window.fetch, gate = new Promise((r) => { window.__release = r; });
      window.fetch = (u, o) => {
        if (!String(u).startsWith("/api/memory/search")) return f(u, o);
        window.__pending = true;
        return gate.then(() => f(u, o)).then((res) => { window.__answered = true; return res; });
      };
      const i = document.querySelector("[data-ui=mem-search]");
      i.value = "";  // the empty query: still the query after the reader leaves, so only the route check drops the answer
      i.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await page.when("window.__pending");
    await page.ev('location.hash = "#/issues"');
    await page.when('document.querySelector("#view h1")?.textContent === "Issues"');
    await page.ev("window.__release()");
    await page.when("window.__answered");
    await page.ev("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))"); // the dropped answer's handlers have run
    expect(page.errors).toEqual([]);
    expect(await page.ev<string>('document.querySelector("#view h1")?.textContent')).toBe("Issues");
  }, 30_000);

  test("Automation: a log row's clamp button opens and closes the text from the keyboard", async () => {
    const own = await startRig((env) => { const ev = join(env.ALEPH_FACTORY_DIR, "events"); mkdirSync(ev, { recursive: true }); const at = new Date(statSync(env.ALEPH_FACTORY_DIR).mtimeMs).toISOString(); writeFileSync(join(ev, `${at.slice(0, 10)}.jsonl`), `${JSON.stringify({ at, by: "director", subject: "aleph-1", action: "answered", note: "word ".repeat(60) })}\n`); });
    try {
      const pg = await own.open("#/automation");
      const btn = "#gates-log .clamp-btn";
      await pg.when(`document.querySelector("${btn}")`);
      await pg.ev('document.querySelector("#gates-log").scrollIntoView()');
      for (let i = 0; i < 80 && !(await pg.ev<boolean>(`document.activeElement?.matches("${btn}")`)); i++) await pg.key("Tab");
      const state = () => pg.ev<[string, boolean]>(`[document.activeElement.getAttribute("aria-expanded"), document.activeElement.previousElementSibling.classList.contains("clamp")]`);
      expect(await state()).toEqual(["false", true]);
      await pg.key("Enter");
      expect(await state()).toEqual(["true", false]);
      await pg.key("Enter");
      expect(await state()).toEqual(["false", true]);
    } finally { own.stop(); }
  }, 60_000);

  test("Automation: a redraw keeps focus on an open clamp button and keeps its text open, with a new row above it", async () => {
    let dir = "", at = 0;
    const own = await startRig((env) => { dir = env.ALEPH_FACTORY_DIR; mkdirSync(join(dir, "events"), { recursive: true }); at = statSync(dir).mtimeMs; const iso = new Date(at).toISOString(); writeFileSync(join(dir, "events", `${iso.slice(0, 10)}.jsonl`), `${JSON.stringify({ at: iso, by: "director", subject: "aleph-1", action: "answered", note: "word ".repeat(60) })}\n`); });
    try {
      const pg = await own.open("#/automation");
      const btn = "#gates-log .clamp-btn";
      await pg.when(`document.querySelector("${btn}")`);
      await pg.ev(`(() => { const b = document.querySelector("${btn}"); b.focus(); b.click(); b.old = true; })()`);
      // A newer row with its own note lands above the open one; the redraw must keep the same button, not the first one.
      // The fixture logs other events on the same day, so the test takes the one row with the note.
      const day = join(dir, "events", `${new Date(at).toISOString().slice(0, 10)}.jsonl`), ev = JSON.parse(readFileSync(day, "utf8").split("\n").find((l) => l.includes("word "))!);
      appendFileSync(day, `${JSON.stringify(ev).replaceAll("word ", "other ").replace(ev.at, new Date(Date.parse(ev.at) + 1000).toISOString())}\n`);
      await pg.ev('document.dispatchEvent(new Event("visibilitychange"))');
      await pg.when(`document.querySelectorAll("${btn}").length === 2 && !document.querySelector("${btn}").old`);
      expect(await pg.ev<unknown[]>(`(() => { const b = document.activeElement; return [b.matches("${btn}"), b.previousElementSibling.textContent.startsWith("word"), b.getAttribute("aria-expanded"), b.previousElementSibling.classList.contains("clamp"), b.textContent]; })()`)).toEqual([true, true, "true", false, "Show less"]);
    } finally { own.stop(); }
  }, 60_000);

  test("Automation: a cap save keeps the Monitor fold open through the redraw", async () => {
    const own = await startRig((env) => { const dir = join(env.ALEPH_FACTORY_DIR, "monitor"); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "2026-11-03.json"), JSON.stringify({ day: "2026-11-03", table: { today: { stages: [], holds: [] }, trailing: { stages: [], holds: [] } }, text: "READER-TEXT", findings: ["FIRST-ONE"] })); });
    try {
      const pg = await own.open("#/automation");
      await pg.when('document.querySelector("#monitor details") && document.querySelector("form.capform[data-cap=live]")');
      await pg.ev(`(() => {
        const d = document.querySelector("#monitor details"), f = document.querySelector("form.capform[data-cap=live]");
        d.open = true;
        d.old = true;
        f.elements.live.value = "4";
        f.requestSubmit();
      })()`);
      await pg.when('!document.querySelector("#monitor details").old');
      expect(await pg.ev("document.querySelector(\"#monitor details\").open")).toBe(true);
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
    expect(await page.ev('!!document.querySelector("#outcome .obar")')).toBe(false);
    await page.ev(`${fold}.open = true; document.querySelector("#view > *").dataset.mark = "1"`);
    await page.ev("window.release()");
    await page.when('document.querySelector("#outcome .obar") && !document.querySelector("#view > *").dataset.mark');
    expect(await page.ev(`${fold}.open`)).toBe(true);
    await page.ev(`${fold}.open = false`);
    await page.reload(); // Takes the patched fetch away.
  }, 30_000);

  test("the sidebar collapses, keeps its links, and remembers it over a reload", async () => {
    await click("#collapse");
    await page.when('document.querySelector(".shell.collapsed")');
    expect(await page.ev('document.querySelector("#nav a").getBoundingClientRect().width')).toBeLessThan(60);
    await page.reload();
    expect(await page.ev('!!document.querySelector(".shell.collapsed")')).toBe(true);
    await click("#collapse");
    await page.when('!document.querySelector(".shell.collapsed")');
  }, 30_000);

  test("an open fold and a collapsed sidebar are both still set after a page reload", async () => {
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

  test("at 390 px a metric value stays one line and a segmented control stays one row or scrolls inside itself", async () => {
    await page.width(390);
    for (const route of ["#/", "#/issues", "#/jobs", "#/agents"]) {
      await page.go(route);
      await page.when('document.querySelector("#view .tile b, #view .empty, #view h2")');
      const r = await page.ev<any>(`(() => ({
        tall: [...document.querySelectorAll(".tile b")].filter((b) => b.getBoundingClientRect().height >= 1.5 * parseFloat(getComputedStyle(b).fontSize)).map((b) => b.textContent),
        seg: [...document.querySelectorAll(".seg")].filter((s) => new Set([...s.querySelectorAll("button")].map((b) => b.offsetTop)).size > 1 && !(s.scrollWidth > s.clientWidth && /auto|scroll/.test(getComputedStyle(s).overflowX))).length,
        wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }))()`);
      expect({ route, ...r, wide: Math.max(r.wide, 0) }).toEqual({ route, tall: [], seg: 0, wide: 0 });
    }
    await page.width(1200);
  }, 60_000);

  test("a timed refresh re-renders, except over an armed button", async () => {
    // The shell reads the global setInterval when the route starts: keep the route's refresh as window.tick, and run it here.
    // The refresh loads only after a quiet minute: window.later() moves the page's clock past it.
    // A fetch of /api/factory waits for window.gate. A fetch of /api/flow, the last a Status load makes (its `more`), counts in
    // window.fetched after the load that reads it ends.
    await page.ev(`(() => {
      const now = Date.now;
      window.skew = 0;
      Date.now = () => now() + window.skew;
      window.later = () => { window.skew += 61_000; window.tick(); };
      window.setInterval = (f) => { window.tick = f; return 0; };
      const rf = window.fetch;
      window.fetch = (u, o) => String(u).startsWith("/api/factory") ? (window.gate ?? Promise.resolve()).then(() => rf(u, o)) : !String(u).startsWith("/api/flow") ? rf(u, o) : rf(u, o).then((r) => {
        const j = r.json.bind(r);
        const count = () => { window.fetched = (window.fetched ?? 0) + 1; };
        r.json = () => j().then((d) => { setTimeout(count); return d; });
        return r;
      });
    })()`);
    await page.go("#/issues");
    await page.go("#/");
    const mark = 'document.querySelector("#view > *").dataset.mark = "1"';
    const buttons = `document.querySelector('#view button.act[data-act="drop"], #view :not(.choice) > button.act[data-act="land"]')`;
    const refresh = async () => {
      const n = await page.ev("window.fetched ?? 0");
      await page.ev("window.later()");
      await page.when(`(window.fetched ?? 0) > ${n}`);
    };
    await page.when(buttons);
    await page.ev(mark);
    await refresh();
    expect(await page.ev('document.querySelector("#view > *").dataset.mark')).toBeUndefined(); // The refresh rendered.
    // What the reader opened comes back after a refresh.
    await page.ev('document.querySelector("#view details[data-keep]").open = true');
    await page.ev(mark);
    await refresh();
    expect(await page.ev('[document.querySelector("#view details[data-keep]").open, !!document.querySelector("#view > *").dataset.mark]')).toEqual([true, false]);
    // A refresh is in flight when the button is armed: its answer must not render over it.
    await page.ev("void (window.gate = new Promise((ok) => { window.release = ok; }))");
    const n = await page.ev("window.fetched ?? 0");
    await page.ev("window.later()");
    await page.ev(`${buttons}.click()`);
    await page.ev(mark);
    await page.ev("window.gate = null; window.release()");
    await page.when(`(window.fetched ?? 0) > ${n}`);
    expect(await page.ev('[!!document.querySelector("#view button.act.ask"), document.querySelector("#view > *").dataset.mark]')).toEqual([true, "1"]);
    await page.reload(); // Takes the patched timer and fetch away.
  }, 30_000);

  test("a change in the factory folder reloads a live page that used to poll", async () => {
    // The page fetches /api/factory again only on a change: its quiet timer waits a minute.
    const loads = 'performance.getEntriesByType("resource").filter((e) => e.name.includes("/api/factory")).length';
    await page.go("#/factory/agents");
    await page.when('document.querySelector("#view aleph-chart")');
    const n = await page.ev<number>(loads);
    writeFileSync(join(env.ALEPH_FACTORY_DIR, "nudge.json"), "{}");
    await page.when(`${loads} > ${n}`);
  }, 30_000);

  test("a slow first load does not draw over a newer one", async () => {
    // Hold the fetch of the first /api/factory load, let a second (the refresh timer) answer, then release the first.
    await page.ev(`(() => {
      const now = Date.now;
      window.skew = 0;
      Date.now = () => now() + window.skew;
      window.setInterval = (f) => { window.tick = f; return 0; };
      const rf = window.fetch;
      let held = true;
      window.fetch = (u, o) => {
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
    await page.ev("window.skew += 61_000; window.tick()");
    await page.when('document.querySelector("#view .page, #view > *") && !/^\\s*Loading/.test(document.querySelector("#view").textContent)');
    await page.ev('document.querySelector("#view > *").dataset.mark = "1"');
    await page.ev("window.release()");
    await page.when("window.firstRead");
    expect(await page.ev('document.querySelector("#view > *").dataset.mark')).toBe("1"); // The old answer did not redraw.
    await page.reload(); // Takes the patched timer and fetch away.
  }, 30_000);

  test("a change that comes while an input has focus reloads the view after the input blurs", async () => {
    const loads = 'performance.getEntriesByType("resource").filter((e) => e.name.includes("/api/factory")).length';
    // Count the change events the page hears, to know the change came before the check.
    await page.ev(`(() => {
      const ES = window.EventSource;
      window.heard = 0;
      window.EventSource = class extends ES { constructor(...a) { super(...a); this.addEventListener("change", () => { window.heard++; }); } };
    })()`);
    await page.go("#/factory/agents");
    await page.when('document.querySelector("#view aleph-chart")');
    await page.ev(`(() => { const i = document.createElement("input"); i.id = "probe"; document.body.append(i); i.focus(); })()`);
    const n = await page.ev<number>(loads);
    writeFileSync(join(env.ALEPH_FACTORY_DIR, "nudge2.json"), "{}");
    await page.when("window.heard > 0");
    expect(await page.ev<number>(loads)).toBe(n); // No redraw while focus stays.
    await page.ev('document.getElementById("probe").blur()');
    await page.when(`${loads} > ${n}`);
    await page.ev('document.getElementById("probe").remove()');
    await page.reload(); // Takes the patched EventSource away.
  }, 30_000);

  test("an action the server refuses shows the server's reason on the row", async () => {
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
  }, 30_000);

  test("Enter in the reason box confirms a Deny, and the card leaves before any reload of the state", async () => {
    await page.go("#/");
    await page.when('document.querySelector("#view article.issue-row")');
    // A real Ask card with a Deny, from the view's own renderer. After the POST every other fetch hangs, and the mark on #view shows that no render replaced it.
    await page.ev(`import("/views/cards.js").then(({ askCard }) => {
      const f = window.fetch;
      window.posts = [];
      window.fetch = (u, o) => o?.method === "POST" ? (window.posts.push([u, o.body]), Promise.resolve(new Response("{}"))) : window.posts.length ? new Promise(() => {}) : f(u, o);
      document.querySelector("#view > *").dataset.mark = "1";
      document.querySelector("#view > *").insertAdjacentHTML("afterbegin", askCard({ id: "tools-4", reason: "question", kind: "question", card: "decide", label: "Decide", headline: "Support a second input file",
        situation: "Decide it.", escalated: true, actions: [{ act: "deny", label: "Deny", hint: "closes the question", path: "/api/issues/tools-4/drop", body: { reason: "Chris denied it" }, input: { name: "reason", lead: "Chris denied: " } }] }));
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
    expect(posts.map(([u, body]) => [u, JSON.parse(body)])).toEqual([["/api/issues/tools-4/drop", { reason: "Chris denied: not now" }]]);
    await page.reload(); // Takes the patched fetch away.
  }, 30_000);

  test("a dead blocker shows on the Issue page, and Stop waiting removes it", async () => {
    await page.go("#/issues/demo/21");
    await page.when(`document.querySelector('.dp-blocked [data-act="unblock"]')`);
    expect(await page.ev<string>(`document.querySelector(".dp-blocked").textContent`)).toContain("Waits on");
    await page.ev(`document.querySelector('.dp-blocked [data-act="unblock"]').click()`);
    await page.when(`!document.querySelector('.dp-blocked [data-act="unblock"]')`);
    expect(await page.ev<string>(`document.querySelector(".dp-blocked")?.textContent ?? ""`)).not.toContain("Waits on");
    expect(page.errors).toEqual([]);
  }, 30_000);

  test("Log out shows only behind the password gate", async () => {
    expect(await page.ev('document.querySelector("#logout").hidden')).toBe(true);
  }, 30_000);

  test("a 401 reloads the page", async () => {
    await page.go("#/");
    await page.ev(`(() => { window.__before = 1; const f = window.fetch; window.fetch = (u, o) => String(u).startsWith("/api/") ? Promise.resolve(new Response("", { status: 401 })) : f(u, o); location.hash = "#/issues"; })()`);
    await page.when("window.__before === undefined");
    await page.when('document.querySelector("#nav li")');
  }, 30_000);
});

describe.skipIf(!chromeUsable)("Status page", () => {
  let rig: Rig, page: Page;
  beforeAll(async () => { rig = await startRig(); page = await rig.open(); }, 150_000);
  afterAll(() => rig?.stop());

  for (const w of [1100, 420]) {
    test(`at ${w} px the outcome bar shows the whole label of a 2% segment and the page does not scroll sideways`, async () => {
      await page.width(w);
      await page.go("#/");
      const m = await page.ev<{ clip: boolean[]; widths: number[]; page: number }>(`import("/views/speed.js").then((v) => {
        const classes = [["landed", 40], ["returned", 20], ["failed", 1.6], ["reran", 10], ["dropped", 8]].map(([key, hours], i) => ({ key, lost: i > 1, hours, text: key }));
        const host = document.createElement("div");
        host.id = "obar-probe";
        document.querySelector("#view").prepend(host);
        host.innerHTML = v.bar({ classes }, "");
        const segs = [...host.querySelectorAll(".osegs > *")];
        return {
          clip: segs.flatMap((s) => [...s.querySelectorAll("b, span")].map((e) => e.scrollWidth > e.clientWidth)),
          widths: segs.map((s) => s.getBoundingClientRect().width),
          page: document.documentElement.scrollWidth,
        };
      })`);
      expect(m.clip).not.toContain(true);
      expect(m.widths[0]!).toBeGreaterThan(m.widths[2]!);
      expect(m.page).toBeLessThanOrEqual(w);
      await page.ev('document.querySelector("#obar-probe").remove()');
    }, 30_000);
  }

  test("the outcome bar mark is as tall as the segments", async () => {
    await page.width(1100);
    await page.go("#/");
    const m = await page.ev<{ sep: number[]; segs: number[][] }[]>(`import("/views/speed.js").then((v) => {
      const host = document.createElement("div");
      host.id = "obar-probe";
      document.querySelector("#view").prepend(host);
      host.innerHTML = v.bar({ classes: [{ key: "landed", lost: false, hours: 5, text: "" }, { key: "dropped", lost: true, hours: 3, text: "" }] }, "");
      const r = (e) => e.getBoundingClientRect();
      const at = () => { const sep = r(host.querySelector(".osep")); return { sep: [sep.top, sep.bottom], segs: [...host.querySelectorAll(".osegs")].map((e) => [r(e).top, r(e).bottom]) }; };
      const out = [at()];
      // A bigger label font grows the label line box, so a fixed offset shows here as a gap of 10px.
      document.documentElement.style.setProperty("--fs-xs", "20px");
      out.push(at());
      document.documentElement.style.removeProperty("--fs-xs");
      return out;
    })`);
    for (const { sep, segs } of m) {
      for (const [top, bottom] of segs) {
        expect(Math.abs(sep[0]! - top!)).toBeLessThanOrEqual(0.1);
        expect(Math.abs(sep[1]! - bottom!)).toBeLessThanOrEqual(0.1);
      }
    }
    await page.ev('document.querySelector("#obar-probe").remove()');
  }, 30_000);

  test("the second tile figure is a share of the value", async () => {
    await page.go("#/");
    const m = await page.ev<{ em: number; val: number }>(`import("/lib.js").then(({ statCard }) => {
      const host = document.createElement("div");
      host.id = "tile-probe";
      document.querySelector("#view").prepend(host);
      host.innerHTML = '<section class="tiles">' + statCard({ k: "Landed", v: "5", v2: "9" }) + "</section>";
      const em = host.querySelector(".tile.sc b em"), val = host.querySelector(".tile.sc b");
      return { em: parseFloat(getComputedStyle(em).fontSize), val: parseFloat(getComputedStyle(val).fontSize) };
    })`);
    expect(m.em / m.val).toBeCloseTo(0.62, 2);
    await page.ev('document.querySelector("#tile-probe").remove()');
  }, 30_000);

  test("the font picker, the annotations and the chat mount in the dock and work", async () => {
    await page.width(1200);
    await page.go("#/");
    expect(await page.ev('[...document.querySelectorAll("#kit-dock > div")].map((d) => d.id)')).toEqual(["kit-fonts", "kit-annotate", "kit-chat"]);
    const pick = (role: string, v: string) => page.ev(`(() => { const s = document.getElementById("kit-fonts").shadowRoot.querySelector('select[data-role="${role}"]:not([data-prop])'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await pick("sans", "Inter");
    expect(await page.ev('document.documentElement.style.getPropertyValue("--sans")')).toBe("'Inter', system-ui, sans-serif");
    // Charts read --chart-scale, which the picker sets from the Charts size step.
    await page.ev(`(() => { const s = document.getElementById("kit-fonts").shadowRoot.querySelector('select[data-role="chart"][data-prop="size"]'); s.value = "1.08"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    expect(await page.ev('document.documentElement.style.getPropertyValue("--chart-scale")')).toBe("1.08");
    await page.ev('document.getElementById("kit-fonts").shadowRoot.querySelector(".reset").click()');
    expect(await page.ev('document.documentElement.style.getPropertyValue("--sans")')).toBe("");
    // A click in pick mode opens a note instead of following the link; the saved note shows a pin and the Markdown names it.
    await page.ev('document.getElementById("kit-annotate").shadowRoot.querySelector(".pick").click()');
    const before = await page.ev<string>("location.hash");
    await page.ev('document.querySelector("#nav li a").click()');
    expect(await page.ev<string>("location.hash")).toBe(before);
    await page.ev('(() => { const l = document.getElementById("kit-annotate-layer").shadowRoot; l.querySelector("textarea.note").value = "rename this"; l.querySelector(".save").click(); })()');
    await page.when('document.getElementById("kit-annotate").shadowRoot.querySelector(".count").textContent === "1"');
    expect(await page.ev('document.getElementById("kit-annotate-layer").shadowRoot.querySelectorAll(".pin").length')).toBe(1);
    await page.ev('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
    // The note went to the server through `aleph annotation put`, by you.
    // The server answers once the CLI wrote the file and the updater rebuilt the key; the test waits frames, not time.
    const server = () => page.ev<{ id: string; note: string; by: string }[]>('fetch("/api/annotations").then((r) => r.json())');
    let saved = await server();
    for (let i = 0; i < 600 && !saved.length; i++) { await page.ev("new Promise((r) => requestAnimationFrame(r))"); saved = await server(); }
    expect(saved.map((n) => [n.note, n.by])).toEqual([["rename this", "you"]]);
    // An agent's note, added with the CLI, reaches the open page through the change signal, with its own pin.
    const cli = (args: string[]) => Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "jobs", "cli.ts"), "annotation", ...args], { env: process.env, stdout: "pipe", stderr: "pipe" });
    expect(cli(["add", "--selector", ".mark", "--", "from the agent"]).exitCode).toBe(0);
    await page.when('document.getElementById("kit-annotate").shadowRoot.querySelector(".count").textContent === "2"');
    expect(await page.ev('document.getElementById("kit-annotate-layer").shadowRoot.querySelectorAll(".pin.agent").length')).toBe(1);
    for (const n of await server()) expect(cli(["drop", n.id]).exitCode).toBe(0);
  }, 30_000);

  test("the chat points a message at a note of the page, or at a new one picked from the chat", async () => {
    await page.width(1200);
    await page.go("#/");
    const cli = (args: string[]) => Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "jobs", "cli.ts"), "annotation", ...args], { env: process.env, stdout: "pipe", stderr: "pipe" });
    const chat = 'document.getElementById("kit-chat").shadowRoot', note = 'document.getElementById("kit-annotate")';
    // A stand-in for the server's turn: it keeps each body the chat posts and ends the turn at once.
    await page.ev(`(() => { window.sent = []; window.realFetch = fetch; window.fetch = (u, o) => u === "/api/chat"
      ? (sent.push(JSON.parse(o.body)), Promise.resolve(new Response("event: end\\ndata: {}\\n\\n", { headers: { "content-type": "text/event-stream" } })))
      : realFetch(u, o); })()`);
    const say = async (text: string) => {
      const n = await page.ev<number>("sent.length");
      await page.ev(`(() => { const ui = ${chat}; ui.querySelector("textarea").value = ${JSON.stringify(text)}; ui.querySelector("form").requestSubmit(); })()`);
      await page.when(`sent.length === ${n + 1}`);
      return page.ev<{ text: string; annotations?: string[] }>("sent.at(-1)");
    };
    const added = cli(["add", "--selector", "#nav", "--", "the nav"]);
    expect(added.exitCode).toBe(0);
    await page.when(`${note}.shadowRoot.querySelector(".count").textContent === "1"`);
    const old = (await page.ev<{ id: string }[]>('fetch("/api/annotations").then((r) => r.json())'))[0].id;
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
    // New: the panel hides, a click picks an element, and the saved note comes back as the chip.
    await page.ev(`${chat}.querySelector(".point").click()`);
    await page.ev(`${chat}.querySelector(".menu .pick").click()`);
    expect(await page.ev(`${chat}.querySelector(".pop").hidden`)).toBe(true);
    expect(await page.ev(`${note}.shadowRoot.querySelector(".pick").getAttribute("aria-pressed")`)).toBe("true");
    await page.ev('document.querySelector("#nav li a").click()');
    expect(await page.ev(`${note}.shadowRoot.querySelector(".pick").getAttribute("aria-pressed")`)).toBe("false");
    await page.ev('(() => { const l = document.getElementById("kit-annotate-layer").shadowRoot; l.querySelector("textarea.note").value = "this link"; l.querySelector(".save").click(); })()');
    await page.when(`!${chat}.querySelector(".pop").hidden && ${chat}.querySelector(".points").textContent.includes("#2 this link")`);
    const fresh = await say("what is this");
    expect(fresh.annotations).toHaveLength(1);
    expect(fresh.annotations![0]).not.toBe(old);
    // A cancelled pick attaches nothing.
    await page.ev(`${chat}.querySelector(".point").click()`);
    await page.ev(`${chat}.querySelector(".menu .pick").click()`);
    await page.ev('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
    await page.when(`!${chat}.querySelector(".pop").hidden`);
    expect(await page.ev(`${chat}.querySelector(".points").textContent`)).toBe("");
    // Without the annotate tool the button does not show, and the chat still sends.
    await page.ev(`${note}.id = "kit-annotate-off"`);
    await page.ev(`${chat}.querySelector(".fab").click(); ${chat}.querySelector(".fab").click()`);
    expect(await page.ev(`${chat}.querySelector(".point").hidden`)).toBe(true);
    expect((await say("plain")).text).toBe("plain");
    await page.ev(`document.getElementById("kit-annotate-off").id = "kit-annotate"; window.fetch = realFetch; ${chat}.querySelector(".new").click(); ${chat}.querySelector(".fab").click()`);
    for (const n of await page.ev<{ id: string }[]>('fetch("/api/annotations").then((r) => r.json())')) expect(cli(["drop", n.id]).exitCode).toBe(0);
  }, 30_000);

  test("the chat keeps a session per idea page and returns to the general one", async () => {
    await page.width(1200);
    await page.go("#/");
    const chat = 'document.getElementById("kit-chat").shadowRoot';
    await page.ev(`(() => { window.sent = []; window.realFetch = fetch; window.fetch = (u, o) => u === "/api/chat"
      ? (sent.push(JSON.parse(o.body)), Promise.resolve(new Response('data: {"session_id":"s-' + (JSON.parse(o.body).idea ?? "general") + '"}\\n\\nevent: end\\ndata: {}\\n\\n', { headers: { "content-type": "text/event-stream" } })))
      : realFetch(u, o); })()`);
    const say = async (text: string) => {
      const n = await page.ev<number>("sent.length");
      await page.ev(`(() => { const ui = ${chat}; ui.querySelector("textarea").value = ${JSON.stringify(text)}; ui.querySelector("form").requestSubmit(); })()`);
      await page.when(`sent.length === ${n + 1} && !${chat}.querySelector(".busy")`);
      return page.ev<{ idea?: string; session?: string }>("sent.at(-1)");
    };
    expect((await say("zero")).idea).toBeUndefined();
    await page.go("#/ideas/issue-history");
    const mine = await say("one");
    expect([mine.idea, mine.session]).toEqual(["issue-history", undefined]);
    expect(await page.ev('JSON.parse(localStorage.getItem("chat:idea:issue-history")).session')).toBe("s-issue-history");
    await page.go("#/");
    const general = await say("two");
    expect(general.idea).toBeUndefined();
    expect(general.session).toBe("s-general");
    await page.ev(`window.fetch = realFetch; ${chat}.querySelector(".new").click(); localStorage.removeItem("chat:idea:issue-history")`);
  }, 30_000);

  test("every indented list takes its left padding from --indent-list", async () => {
    await page.width(1200);
    await page.go("#/");
    const pads = await page.ev<string[]>(`(() => {
      const mk = (parent, tag) => { const el = document.createElement(tag); parent.append(el); return el; };
      const wrap = (cls) => { const d = document.createElement("div"); d.className = cls; document.body.append(d); return d; };
      const row = wrap("issue-row"), dec = mk(row, "div"); dec.className = "decision";
      const body = wrap("body"), tight = document.createElement("ul"); tight.className = "tight"; document.body.append(tight);
      const chat = wrap("chat"), msg = mk(chat, "div"); msg.className = "msg";
      const lists = [mk(dec, "ul"), mk(body, "ul"), tight, mk(msg, "ul"), mk(msg, "ol")];
      const out = lists.map((l) => getComputedStyle(l).paddingLeft);
      for (const e of [row, body, tight, chat]) e.remove();
      return out;
    })()`);
    expect(pads).toEqual(["18px", "18px", "18px", "18px", "18px"]);
  }, 30_000);
  test("Issue: an attached image shows in Media, and a pasted screenshot attaches", async () => {
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
  }, 60_000);
});

describe.skipIf(!chromeUsable)("Ideas", () => {
  let rig: Rig, page: Page;
  beforeAll(async () => {
    rig = await startRig((e) => {
      e.ALEPH_IDEAS = join(e.HOME, "ideas");
      mkdirSync(join(e.ALEPH_IDEAS, "issue-history", "lenses"), { recursive: true });
      writeFileSync(join(e.ALEPH_IDEAS, "issue-history", "idea.md"), "---\ntitle: Issue history\nstatus: exploring\nbuilt: []\n---\nA sketch.\n\n## Log\n");
      for (const f of ["prior-art-2026-11-01-0900.html", "prior-art-2026-11-02-1000.html"]) writeFileSync(join(e.ALEPH_IDEAS, "issue-history", "lenses", f), `<p>${f}</p>`);
    });
    page = await rig.open("#/ideas");
  }, 150_000);
  afterAll(() => rig?.stop());

  test("the list shows an idea after Issues in the nav, and the idea page shows its tabs and the newest prior art", async () => {
    await page.when('document.querySelector("#view tbody tr")');
    expect(await page.ev<string>('document.querySelector("#view tbody tr").textContent')).toContain("Issue historyexploringnew project");
    
    expect(await page.ev<boolean>('(() => { const n = [...document.querySelectorAll("#nav li a")].map((a) => a.textContent); return n.indexOf("Ideas") === n.indexOf("Issues") + 1; })()')).toBe(true);
    await page.go("#/ideas/issue-history");
    await page.when('document.querySelector("#view [data-tab]")');
    expect(await page.ev<string[]>('[...document.querySelectorAll("#view [data-tab]")].map((b) => b.textContent)')).toEqual(["Write-up", "Prior art", "Red team", "Explainer", "Log"]);
    await click('#view [data-tab="prior-art"]');
    await page.when('document.querySelector("#view section[data-pane=prior-art]:not([hidden]) iframe")');
    const frame = 'document.querySelector("#view section[data-pane=prior-art] iframe")';
    expect(await page.ev<string>(`${frame}.getAttribute("src")`)).toBe("/api/ideas/issue-history/lenses/prior-art-2026-11-02-1000.html");
    expect(await page.ev<boolean>(`${frame}.hasAttribute("sandbox")`)).toBe(true);
    expect(await page.ev<string>('document.querySelector("#view section[data-pane=prior-art] ul").textContent')).toMatch(/^(11\/01 09:00|2026-11-01)$/);
    expect(page.errors).toEqual([]);
  }, 60_000);

  const click = (selector: string) => page.ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
});
