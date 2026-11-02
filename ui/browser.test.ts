import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromeUsable, startRig, type Page, type Rig } from "./test-browser.ts";

describe.skipIf(!chromeUsable)("the UI in Chrome", () => {
  let rig: Rig, page: Page;
  beforeAll(async () => { rig = await startRig(); page = await rig.open(); }, 60_000);
  afterAll(() => rig?.stop());

  const hash = () => page.ev<string>("location.hash");
  const title = () => page.ev<string>('document.querySelector("#view h1")?.textContent ?? ""');
  const click = (selector: string) => page.ev(`document.querySelector(${JSON.stringify(selector)}).click()`);

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
    await page.go("#/jobs");
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
    await click('#issues-table button[data-sort]');
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

  test("a timed refresh re-renders, except over an armed button", async () => {
    // Refresh every 200 ms: the shell reads the global setInterval when the route starts.
    // Each fetch waits 300 ms, so a refresh is in flight when the button is armed: its answer must not render over it.
    await page.ev("(() => { const real = window.setInterval; window.setInterval = (f, ms) => real(f, Math.min(ms, 200)); const rf = window.fetch; window.fetch = (...a) => new Promise((r) => setTimeout(r, 300)).then(() => rf(...a)); })()");
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
    await Bun.sleep(1000);
    expect(await page.ev('[!!document.querySelector("#view button.act.ask"), document.querySelector("#view > *").dataset.mark]')).toEqual([true, "1"]);
    await page.reload(); // Takes the patched timer away.
  }, 30_000);

  test("ask rows: the button sits right of its text at 1280 px and under it at 720 px; deny reveals its input as Confirm", async () => {
    await page.go("#/");
    await page.until('document.querySelector("#view .choice .act")');
    await page.ev('document.querySelectorAll("#view details.cfold").forEach((d) => { d.open = true; })');
    await page.width(1280);
    const geo = `(() => { const c = document.querySelector("#view .choice"); const t = c.querySelector(".choice-text").getBoundingClientRect(), b = c.querySelector(".act").getBoundingClientRect(); return { right: b.right > t.right - 1 && b.left >= t.right - 1, rowTop: b.top < t.bottom && b.bottom > t.top, under: b.top >= t.bottom - 1 }; })()`;
    const g = await page.ev<any>(geo);
    expect(g.right && g.rowTop).toBe(true);
    await page.width(720);
    expect((await page.ev<any>(geo)).under).toBe(true);
    await page.width(1280);
    await page.ev('document.querySelector("#view button.act[data-act=deny]").click()');
    expect(await page.ev('[document.querySelector("#view button.act[data-act=deny]").textContent, document.querySelector("#view button.act[data-act=deny]").closest(".choice").querySelector("input.reason").hidden]')).toEqual(["Confirm", false]);
    await page.reload();
  }, 30_000);

  test("a folded ask card and a folded stuck card show no choice and stay within 3 lines plus the toggle; the fold opens in place and survives a refresh", async () => {
    await page.go("#/");
    await page.until('document.querySelector("#view .issue-row details.cfold")');
    await page.width(1280);
    const kinds = ['.issue-row:not(.stuck) details.cfold', '.issue-row.stuck details.cfold'];
    for (const sel of kinds) {
      if (!(await page.ev(`!!document.querySelector(${JSON.stringify("#view " + sel)})`))) continue;
      const q = JSON.stringify("#view " + sel);
      expect(await page.ev(`(() => { const d = document.querySelector(${q}); d.open = false; const b = d.querySelector(".act"); return !!b && b.offsetParent === null; })()`)).toBe(true);
      // Height of the card: at most 3 line-heights of content, the meta row, the toggle and the padding.
      const fits = await page.ev<boolean>(`(() => { const d = document.querySelector(${q}), c = d.closest(".issue-row"); const lh = parseFloat(getComputedStyle(c).lineHeight) || 20; const p = (n) => parseFloat(getComputedStyle(c)[n]) || 0; const t = d.querySelector("summary").getBoundingClientRect().height; const kids = [...c.children].filter((e) => e !== d); const body = kids.reduce((h, e) => h + e.getBoundingClientRect().height, 0); return body <= 4 * lh + 8 && c.getBoundingClientRect().height <= body + t + p("paddingTop") + p("paddingBottom") + 16; })()`);
      expect(fits).toBe(true);
      await page.ev(`document.querySelector(${q}).querySelector("summary").click()`);
      expect(await page.ev(`(() => { const d = document.querySelector(${q}); const b = d.querySelector(".act"); return d.open && b.offsetParent !== null && b.getBoundingClientRect().top >= d.querySelector("summary").getBoundingClientRect().bottom - 1; })()`)).toBe(true);
      const key = await page.ev<string>(`document.querySelector(${q}).dataset.keep`);
      // A timed refresh (patched to 200 ms) re-renders the view; the open fold comes back open.
      await page.ev("(() => { const real = window.setInterval; window.setInterval = (f, ms) => real(f, Math.min(ms, 200)); })()");
      await page.go("#/issues");
      await page.go("#/");
      await page.until(`document.querySelector('#view details.cfold[data-keep="${key}"]')`);
      expect(await page.ev(`document.querySelector('#view details.cfold[data-keep="${key}"]').open`)).toBe(false); // Closed by default.
      await page.ev(`document.querySelector('#view details.cfold[data-keep="${key}"]').open = true`);
      await page.ev('document.querySelector("#view > *").dataset.mark = "1"');
      await page.until('!document.querySelector("#view > *").dataset.mark'); // A refresh ran.
      expect(await page.ev(`document.querySelector('#view details.cfold[data-keep="${key}"]').open`)).toBe(true);
      await page.reload();
    }
  }, 60_000);

  test("a land button in an ask row posts on the first click", async () => {
    await page.go("#/");
    await page.until('document.querySelector("#view .choice button.act[data-act=land]")');
    await page.ev(`(() => {
      window.__posts = [];
      const f = window.fetch;
      window.fetch = (u, o) => { if (o?.method === "POST") { window.__posts.push(String(u)); return Promise.resolve(new Response("{}", { status: 422 })); } return f(u, o); };
      document.querySelector("#view .choice button.act[data-act=land]").click();
    })()`);
    await page.until("window.__posts.length === 1");
    expect(await page.ev<string>("window.__posts[0]")).toContain("land");
    await page.reload(); // Takes the patched fetch away.
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
    expect(await page.ev<string>(`document.querySelector(".dp-blocked").textContent`)).toContain("Blocked by");
    await page.ev(`document.querySelector('.dp-blocked [data-act="unblock"]').click()`);
    await page.until(`!document.querySelector('.dp-blocked [data-act="unblock"]')`);
    expect(await page.ev<string>(`document.querySelector(".dp-blocked")?.textContent ?? ""`)).not.toContain("Blocked by");
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
