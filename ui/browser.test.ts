import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromeUsable, startRig, type Page, type Rig } from "./test-browser.ts";

describe.skipIf(!chromeUsable)("the UI in Chrome", () => {
  let rig: Rig, page: Page;
  beforeAll(async () => { rig = await startRig(); page = await rig.open(); }, 60_000);
  afterAll(() => rig?.stop());

  const hash = () => page.ev<string>("location.hash");
  const title = () => page.ev<string>('document.querySelector("#view h1")?.textContent ?? ""');
  const click = (selector: string) => page.ev(`document.querySelector(${JSON.stringify(selector)}).click()`);

  test("the sidebar opens with the Factory header, with no link above it", async () => {
    expect(await page.ev('(() => { const li = document.querySelector("#nav li"); return [li.className, li.textContent, !!li.querySelector("a")]; })()')).toEqual(["head", "Factory", false]);
    // Every view the page loads sits in a group the sidebar shows under a header: no view keeps a hidden group.
    const heads = await page.ev<string[]>('[...document.querySelectorAll("#nav li.head")].map((li) => li.textContent.toLowerCase())');
    const groups = await page.ev<string[]>('fetch("/api/views").then((r) => r.json()).then((ns) => Promise.all(ns.map((n) => import("/views/" + n).then((m) => m.view?.group))))');
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
    await page.go("#/factory/jobs");
    expect(await page.ev('typeof document.querySelector("#view").onclick')).toBe("function");
    await page.go("#/issues");
    expect(await page.ev('[document.querySelector("#view").onclick, document.querySelector("#view").onchange]')).toEqual([null, null]);
    await click('#inv-filters .seg button[data-value="done"]');
    await page.until('location.hash === "#/issues?status=done"');
  }, 30_000);

  test("a badly encoded address shows the view's own answer, not the page before it, and throws nothing", async () => {
    await page.go("#/issues");
    const before = page.errors.length;
    await page.ev('void (location.hash = "#/jobs/%zz")');
    await page.until('!document.querySelector("#view .contents") && !/^\\s*Loading/.test(document.querySelector("#view").textContent)');
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
    await page.until(`[...document.querySelectorAll("#issues-table tbody tr")].map((r) => r.textContent).join("|") !== ${JSON.stringify(first)}`);
    await page.go("#/issues");
    const search = 'document.querySelector("#view input[type=search]")';
    await page.ev(`(() => { const i = ${search}; i.value = "zzzz-no-such-issue"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await page.until('document.querySelectorAll("#issues-table tbody tr").length < ' + all);
  }, 30_000);

  test("Memory: a row opens in the inspector", async () => {
    await page.go("#/memory");
    await page.until('document.querySelectorAll("#mem-table tr.nrow").length > 0');
    const all = await page.ev<number>('document.querySelectorAll("#mem-table tr.nrow").length');
    await page.ev('document.querySelector("#mem-table tr.nrow").click()');
    await page.until('document.querySelector("#mem-table tr.nrow[aria-selected=true]")');
    expect(all).toBeGreaterThan(0);
  }, 30_000);

  test("the sidebar collapses, keeps its links, and remembers it over a reload", async () => {
    await click("#collapse");
    await page.until('document.querySelector(".shell.collapsed")');
    expect(await page.ev('document.querySelector("#nav a").getBoundingClientRect().width')).toBeLessThan(60);
    await page.reload();
    expect(await page.ev('!!document.querySelector(".shell.collapsed")')).toBe(true);
    await click("#collapse");
    await page.until('!document.querySelector(".shell.collapsed")');
  }, 30_000);

  test("at phone width the nav wraps, the page does not scroll sideways, and group headers hide", async () => {
    await page.go("#/");
    await page.width(420);
    expect(await page.ev('document.documentElement.scrollWidth')).toBeLessThanOrEqual(420);
    expect(await page.ev('getComputedStyle(document.querySelector("#nav li.head")).display')).toBe("none");
    await page.width(1200);
    expect(await page.ev('getComputedStyle(document.querySelector("#nav li.head")).display')).not.toBe("none");
  }, 30_000);

  test("at 390 px a metric value stays one line and a segmented control stays one row or scrolls inside itself", async () => {
    await page.width(390);
    for (const route of ["#/", "#/issues", "#/jobs", "#/agents"]) {
      await page.go(route);
      await page.until('document.querySelector("#view .tile b, #view .empty, #view h2")');
      const r = await page.ev<any>(`(() => ({
        tall: [...document.querySelectorAll(".tile b")].filter((b) => b.getBoundingClientRect().height >= 1.5 * parseFloat(getComputedStyle(b).fontSize)).map((b) => b.textContent),
        seg: [...document.querySelectorAll(".seg")].filter((s) => new Set([...s.querySelectorAll("button")].map((b) => b.offsetTop)).size > 1 && !(s.scrollWidth > s.clientWidth && /auto|scroll/.test(getComputedStyle(s).overflowX))).length,
        wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }))()`);
      expect({ route, ...r, wide: Math.max(r.wide, 0) }).toEqual({ route, tall: [], seg: 0, wide: 0 });
    }
    await page.width(1200);
  }, 60_000);

  // flaky: tests/flaky.md#browser-timed-refresh
  test.skip("a timed refresh re-renders, except over an armed button", async () => {
    // Refresh every 200 ms: the shell reads the global setInterval when the route starts.
    // Each fetch waits 300 ms, so a refresh is in flight when the button is armed: its answer must not render over it.
    await page.ev("(() => { const real = window.setInterval; window.setInterval = (f, ms) => real(f, Math.min(ms, 200)); const rf = window.fetch; window.fetch = (...a) => new Promise((r) => setTimeout(r, 300)).then(() => rf(...a)).finally(() => { window.fetched = (window.fetched ?? 0) + 1; }); })()");
    await page.go("#/issues");
    await page.go("#/");
    const mark = 'document.querySelector("#view > *").dataset.mark = "1"';
    const buttons = `document.querySelector('#view button.act[data-act="drop"], #view :not(.choice) > button.act[data-act="land"]')`;
    await page.until(buttons);
    await page.ev(mark);
    await page.until('!document.querySelector("#view > *").dataset.mark'); // A refresh ran.
    // What the reader opened comes back after a refresh.
    await page.until('document.querySelector("#view details[data-keep]")');
    await page.ev('document.querySelector("#view details[data-keep]").open = true');
    await page.ev(mark);
    await page.until('!document.querySelector("#view > *").dataset.mark');
    expect(await page.ev('document.querySelector("#view details[data-keep]").open')).toBe(true);
    await page.ev(`${buttons}.click()`);
    await page.ev(mark);
    // Two refreshes answered while the button is armed: neither rendered over it.
    const n = await page.ev("window.fetched ?? 0");
    await page.until(`(window.fetched ?? 0) >= ${n} + 2`);
    expect(await page.ev('[!!document.querySelector("#view button.act.ask"), document.querySelector("#view > *").dataset.mark]')).toEqual([true, "1"]);
    await page.reload(); // Takes the patched timer away.
  }, 30_000);

  test("an action the server refuses shows the server's reason on the row", async () => {
    await page.go("#/");
    await page.until(`document.querySelector('#view button.act[data-act="land"], #view button.act[data-act="recheck"]')`);
    await page.ev(`(() => {
      const f = window.fetch;
      window.fetch = (u, o) => o?.method === "POST" ? Promise.resolve(new Response(JSON.stringify({ error: "it cannot wait" }), { status: 422 })) : f(u, o);
      const b = document.querySelector('#view button.act[data-act="land"], #view button.act[data-act="recheck"]');
      b.click();
      if (b.classList.contains("ask")) b.click();
    })()`);
    await page.until('document.querySelector("#view .act-msg")?.textContent.includes("it cannot wait")');
    expect(await page.ev('document.querySelector("#view .act-msg").closest("article").isConnected')).toBe(true);
    await page.reload(); // Takes the patched fetch away.
  }, 30_000);

  test("Enter in the reason box confirms a Deny, and the card leaves before any reload of the state", async () => {
    await page.go("#/");
    await page.until('document.querySelector("#view article.issue-row")');
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
    await page.until("!window.card.isConnected");
    expect(await page.ev('document.querySelector("#view > *").dataset.mark')).toBe("1");
    const posts = await page.ev<[string, string][]>("window.posts");
    expect(posts.map(([u, body]) => [u, JSON.parse(body)])).toEqual([["/api/issues/tools/4/drop", { reason: "Chris denied: not now" }]]);
    await page.reload(); // Takes the patched fetch away.
  }, 30_000);

  test("a dead blocker shows on Status and on the Issue page, and Stop waiting removes it", async () => {
    await page.go("#/");
    const row = `[...document.querySelectorAll("#lane-queued .queued-row")].find((r) => r.textContent.includes("Warm the cache on deploy"))`;
    await page.until(row);
    expect(await page.ev<string>(`${row}.querySelector(".blockers").textContent`)).toContain("Speed up the import");
    expect(await page.ev(`${row}.textContent.includes("Stop waiting")`)).toBe(true);
    await page.ev(`${row}.querySelector(".blockers a").click()`);
    await page.until(`location.hash === "#/issues/demo/10"`);
    await page.go("#/issues/demo/21");
    await page.until(`document.querySelector('.dp-blocked [data-act="unblock"]')`);
    expect(await page.ev<string>(`document.querySelector(".dp-blocked").textContent`)).toContain("Waits on");
    await page.ev(`document.querySelector('.dp-blocked [data-act="unblock"]').click()`);
    await page.until(`!document.querySelector('.dp-blocked [data-act="unblock"]')`);
    expect(await page.ev<string>(`document.querySelector(".dp-blocked")?.textContent ?? ""`)).not.toContain("Waits on");
    expect(page.errors).toEqual([]);
  }, 30_000);

  test("Log out shows only behind the password gate", async () => {
    expect(await page.ev('document.querySelector("#logout").hidden')).toBe(true);
  }, 30_000);

  test("a 401 reloads the page", async () => {
    await page.go("#/");
    await page.ev(`(() => { window.__before = 1; const f = window.fetch; window.fetch = (u, o) => String(u).startsWith("/api/") ? Promise.resolve(new Response("", { status: 401 })) : f(u, o); location.hash = "#/issues"; })()`);
    await page.until("window.__before === undefined");
    await page.until('document.querySelector("#nav li")');
  }, 30_000);
});

describe.skipIf(!chromeUsable)("Status lane cards", () => {
  let rig: Rig, page: Page;
  beforeAll(async () => { rig = await startRig(); page = await rig.open(); }, 60_000);
  afterAll(() => rig?.stop());

  const long = "A title that is long enough to wrap onto a second line in a narrow lane card, and then some more words";
  /** The lanes of Status, rendered by the page's own renderLanes from this state, and put in place of the lanes of the live page. */
  const fixture = `(async () => {
    const { renderLanes } = await import("/views/now.js");
    const long = ${JSON.stringify(long)};
    const part = { n: 1, m: 3, parent: "r-9", href: "#/issues/r/9" };
    const now = "2026-11-02T12:00:00Z", at = "2026-11-02T11:56:00Z";
    const job = (name, priority, title, p, started) => ({ name, repo: "r", item: { priority, title }, part: p, started, run: { kind: "build", started } });
    const queued = (id, priority, title, p, why) => ({ repo: "r", id, priority, title, part: p, why, at, since: at });
    const s = { now, factory: {}, done: [],
      runningIssues: [{ id: "r-20", href: "#/issues/r/20", stage: "working", priority: "high", title: "Short", at, since: at, of: { n: 3, m: 3 } }],
      running: [
        job("j-1", "medium", long, part, at),
        job("j-2", "low", "Short", null, at),
        job("j-3", "low", long, null, "2026-11-02T10:00:00Z"),
        job("j-4", "high", "Short", part, "2026-11-02T10:00:00Z"),
      ],
      queued: [
        queued("1", "high", long, part, "waits for r-9"),
        queued("2", "low", "Short", null, ""),
        queued("3", "medium", "Short", part, ""),
        queued("4", "low", long, null, "waits for r-9, which is a long wait"),
      ] };
    document.querySelector("#view .lanes").outerHTML = renderLanes(s);
  })()`;

  for (const w of [1440, 1060]) {
    test(`at ${w} px a lane card is a meta row and one title line, marks its kind, and ends a blocked one with the id`, async () => {
      await page.width(w);
      await page.go("#/");
      await page.ev(fixture);
      await page.ev(`(async () => {
        const { renderLanes } = await import("/views/now.js");
        const long = ${JSON.stringify(long)}, at = "2026-11-02T11:56:00Z";
        const run = (kind) => ({ name: "j-" + kind, repo: "r", item: { priority: "low", title: long }, started: at, run: { kind, started: at } });
        const s = { now: "2026-11-02T12:00:00Z", factory: {}, runningIssues: [], running: [run("land"), run("build")],
          queued: [{ repo: "r", id: "1", priority: "low", title: long, stage: "blocked", kind: "busy-file", why: "waits", on: "r-7", at, since: at }],
          done: [{ id: "r-3", title: long, href: "#/x", priority: "low", finished: at, since: at, jobs: [] }] };
        document.querySelector("#view .lanes").outerHTML = renderLanes(s);
      })()`);
      const m = await page.ev<any>(`(() => {
        const cs = [...document.querySelectorAll(".lane-card")].map((e) => {
          const r = e.getBoundingClientRect(), st = getComputedStyle(e), ih = e.querySelector(".ih").getBoundingClientRect(), t = e.querySelector(":scope > .t");
          return { h: r.height, pad: parseFloat(st.paddingTop) + parseFloat(st.paddingBottom) + parseFloat(st.borderTopWidth) + parseFloat(st.borderBottomWidth), ih: ih.height, line: parseFloat(getComputedStyle(t).lineHeight), tm: parseFloat(getComputedStyle(t).marginTop), cls: e.className, bw: parseFloat(st.borderLeftWidth), bc: st.borderLeftColor };
        });
        const b = document.querySelector(".blocked"), br = b.getBoundingClientRect(), ihr = b.parentElement.getBoundingClientRect();
        const probe = (v) => { const p = document.createElement("i"); p.style.color = v; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };
        return { cs, bcolor: getComputedStyle(b).color, muted: probe("var(--muted)"), done: probe("var(--done)"), gap: ihr.right - br.right };
      })()`);
      expect(m.cs.length).toBe(4);
      for (const c of m.cs) expect(c.h).toBeLessThanOrEqual(c.ih + c.tm + c.line + c.pad + 0.5);
      const land = m.cs.find((c: any) => c.cls.includes("kind-land")), worker = m.cs.find((c: any) => c.cls.includes("kind-worker"));
      expect(land.bc).toBe(m.done);
      expect(worker.bw).toBeGreaterThan(1);
      expect(m.bcolor).toBe(m.muted);
      expect(m.gap).toBeLessThan(1.5);
    }, 30_000);

    test(`at ${w} px the Running and Queued cards share one height, meta row and title font`, async () => {
      await page.width(w);
      await page.go("#/");
      await page.ev(fixture);
      const m = await page.ev<Record<string, { n: number; h: number[]; ih: number[]; font: string[] }>>(`(() => {
        const out = {};
        for (const id of ["running", "queued"]) {
          const c = [...document.querySelectorAll("#lane-" + id + " .lane-card")];
          out[id] = { n: c.length, h: c.map((e) => e.getBoundingClientRect().height), ih: c.map((e) => e.querySelector(".ih").getBoundingClientRect().height), font: c.map((e) => { const s = getComputedStyle(e.querySelector(":scope > .t")); return s.fontSize + "/" + s.lineHeight; }) };
        }
        out.dim = { n: document.querySelectorAll(".lane-card .badge.dim").length, h: [], ih: [], font: [] };
        out.part = { n: document.querySelectorAll(".lane-card .part").length, h: [], ih: [], font: [] };
        out.heads = { n: 0, h: [], ih: [], font: ["running", "queued", "done"].map((id) => getComputedStyle(document.querySelector("#h-" + id)).fontSize) };
        out.why = { n: document.querySelectorAll(".lane-card .why").length, h: [], ih: [], font: [] };
        return out;
      })()`);
      expect(m.running!.n).toBe(5);
      expect(m.queued!.n).toBe(4);
      expect(m.dim!.n).toBeGreaterThan(0);
      expect(m.part!.n).toBeGreaterThan(0);
      expect(m.why!.n).toBe(0);
      expect(new Set(m.heads!.font).size).toBe(1);
      const h = [...m.running!.h, ...m.queued!.h], ih = [...m.running!.ih, ...m.queued!.ih], font = [...m.running!.font, ...m.queued!.font];
      for (const x of h) expect(Math.abs(x - h[0]!)).toBeLessThan(0.5);
      for (const x of ih) expect(Math.abs(x - ih[0]!)).toBeLessThan(0.5);
      expect(new Set(font).size).toBe(1);
    }, 30_000);
  }

  for (const w of [1100, 420]) {
    test(`at ${w} px the outcome bar shows the whole label of a 2% segment and the page does not scroll sideways`, async () => {
      await page.width(w);
      await page.go("#/");
      const m = await page.ev<{ clip: boolean[]; widths: number[]; page: number }>(`import("/views/speed.js").then((v) => {
        const classes = [["landed", "Landed", 40], ["fixed", "Fixed", 20], ["nothing", "Late", 1.6], ["restarted", "Restarted", 10], ["dropped", "Dropped", 8]].map(([key, name, hours]) => ({ key, name, hours, text: name }));
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
    const m = await page.ev<{ sep: number[]; segs: number[][] }>(`import("/views/speed.js").then((v) => {
      const host = document.createElement("div");
      host.id = "obar-probe";
      document.querySelector("#view").prepend(host);
      host.innerHTML = v.bar({ classes: [{ key: "landed", name: "Landed", hours: 5, text: "" }, { key: "dropped", name: "Dropped", hours: 3, text: "" }] }, "");
      const r = (e) => e.getBoundingClientRect();
      const sep = r(host.querySelector(".osep"));
      return { sep: [sep.top, sep.bottom], segs: [...host.querySelectorAll(".osegs")].map((e) => [r(e).top, r(e).bottom]) };
    })`);
    for (const [top, bottom] of m.segs) {
      expect(Math.abs(m.sep[0]! - top!)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.sep[1]! - bottom!)).toBeLessThanOrEqual(1);
    }
    await page.ev('document.querySelector("#obar-probe").remove()');
  }, 30_000);

  test("the empty lane text is muted and smaller than the body, and the second tile figure uses --fs-2xl", async () => {
    await page.go("#/");
    const m = await page.ev<{ color: string; want: string; size: number; body: number; em: number; fs: number }>(`import("/views/now.js").then(async (n) => {
      const { statCard } = await import("/lib.js");
      const host = document.createElement("div");
      host.id = "lane-probe";
      document.querySelector("#view").prepend(host);
      host.innerHTML = n.renderLanes({ queued: [], running: [], done: [], factory: {} }) + '<section class="tiles">' + statCard({ k: "Landed", v: "5", v2: "9" }) + "</section>";
      const css = (e) => getComputedStyle(e);
      const probe = (v) => { const p = document.createElement("i"); p.style.color = v; host.append(p); return css(p).color; };
      const sz = (v) => { const p = document.createElement("i"); p.style.fontSize = v; host.append(p); return parseFloat(css(p).fontSize); };
      return { color: css(host.querySelector(".lane .empty p")).color, want: probe("var(--muted)"), size: parseFloat(css(host.querySelector(".lane .empty p")).fontSize), body: parseFloat(css(document.body).fontSize), em: parseFloat(css(host.querySelector(".tile.sc b em")).fontSize), fs: sz("var(--fs-2xl)") };
    })`);
    expect(m.color).toBe(m.want);
    expect(m.size).toBeLessThan(m.body);
    expect(m.em).toBe(m.fs);
    await page.ev('document.querySelector("#lane-probe").remove()');
  }, 30_000);
});
