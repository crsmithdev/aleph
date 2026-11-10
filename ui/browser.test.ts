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
        return gate.then(() => f(u, o)).then((res) => { const j = res.json.bind(res); res.json = () => j().then((x) => { window.__parsed = true; return x; }); return res; });
      };
      const i = document.querySelector("[data-ui=mem-search]");
      i.value = "";  // the empty query: still the query after the reader leaves, so only the page check stops the redraw
      i.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await page.when("window.__pending");
    await page.ev('location.hash = "#/issues"');
    await page.when('document.querySelector("#view h1")?.textContent === "Issues"');
    await page.ev("window.__release()");
    await page.when("window.__parsed");
    expect(page.errors).toEqual([]);
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
    // A fetch of /api/state waits for window.gate, and counts in window.fetched after the load that reads it ends.
    await page.ev(`(() => {
      const now = Date.now;
      window.skew = 0;
      Date.now = () => now() + window.skew;
      window.later = () => { window.skew += 61_000; window.tick(); };
      window.setInterval = (f) => { window.tick = f; return 0; };
      const rf = window.fetch;
      window.fetch = (u, o) => !String(u).startsWith("/api/state") ? rf(u, o) : (window.gate ?? Promise.resolve()).then(() => rf(u, o)).then((r) => {
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
    // The page fetches /api/state again only on a change: its quiet timer waits a minute.
    const loads = 'performance.getEntriesByType("resource").filter((e) => e.name.includes("/api/state")).length';
    await page.go("#/factory/agents");
    await page.when('document.querySelector("#view aleph-chart")');
    const n = await page.ev<number>(loads);
    writeFileSync(join(env.ALEPH_FACTORY_DIR, "nudge.json"), "{}");
    await page.when(`${loads} > ${n}`);
  }, 30_000);

  test("a slow first load does not draw over a newer one", async () => {
    // Hold the fetch of the first /api/state load, let a second (the refresh timer) answer, then release the first.
    await page.ev(`(() => {
      const now = Date.now;
      window.skew = 0;
      Date.now = () => now() + window.skew;
      window.setInterval = (f) => { window.tick = f; return 0; };
      const rf = window.fetch;
      let held = true;
      window.fetch = (u, o) => {
        if (!String(u).startsWith("/api/state") || !held) return rf(u, o);
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
    const loads = 'performance.getEntriesByType("resource").filter((e) => e.name.includes("/api/state")).length';
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
    await page.ev(`import("/views/now.js").then(({ askRow }) => {
      const f = window.fetch;
      window.posts = [];
      window.fetch = (u, o) => o?.method === "POST" ? (window.posts.push([u, o.body]), Promise.resolve(new Response("{}"))) : window.posts.length ? new Promise(() => {}) : f(u, o);
      document.querySelector("#view > *").dataset.mark = "1";
      document.querySelector("#view > *").insertAdjacentHTML("afterbegin", askRow({ id: "tools-4", reason: "question", kind: "question", headline: "Support a second input file",
        situation: "Decide it.", escalated: true, actions: [{ act: "deny", label: "Deny", hint: "closes the question", args: { repo: "tools", id: "4" } }] }));
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
    expect(posts.map(([u, body]) => [u, JSON.parse(body)])).toEqual([["/api/issues/tools/4/drop", { reason: "Chris denied: not now" }]]);
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
        const classes = [["landed", 40], ["returned", 20], ["failed", 1.6], ["reran", 10], ["dropped", 8]].map(([key, hours]) => ({ key, name: key, hours, text: key }));
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
      host.innerHTML = v.bar({ classes: [{ key: "landed", name: "Landed", hours: 5, text: "" }, { key: "dropped", name: "Dropped", hours: 3, text: "" }] }, "");
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

  test("the empty Pipeline list text is muted and smaller than the body, and the second tile figure is a share of the value", async () => {
    await page.go("#/");
    const m = await page.ev<{ color: string; want: string; size: number; body: number; em: number; val: number }>(`import("/views/now.js").then(async (n) => {
      const { statCard } = await import("/lib.js");
      const host = document.createElement("div");
      host.id = "worst-probe";
      document.querySelector("#view").prepend(host);
      host.innerHTML = n.renderPipeline({ window: "week", stages: { rows: [], worst: {} } }, "") + '<section class="tiles">' + statCard({ k: "Landed", v: "5", v2: "9" }) + "</section>";
      const css = (e) => getComputedStyle(e);
      const probe = (v) => { const p = document.createElement("i"); p.style.color = v; host.append(p); return css(p).color; };
      const em = host.querySelector(".tile.sc b em"), val = host.querySelector(".tile.sc b");
      return { color: css(host.querySelector(".worst .empty p")).color, want: probe("var(--muted)"), size: parseFloat(css(host.querySelector(".worst .empty p")).fontSize), body: parseFloat(css(document.body).fontSize), em: parseFloat(css(em).fontSize), val: parseFloat(css(val).fontSize) };
    })`);
    expect(m.color).toBe(m.want);
    expect(m.size).toBeLessThan(m.body);
    expect(m.em / m.val).toBeCloseTo(0.62, 2);
    await page.ev('document.querySelector("#worst-probe").remove()');
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
