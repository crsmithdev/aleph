// Archived goal tests from ui/browser.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromeUsable, startRig, type Page, type Rig } from "../../ui/test-browser.ts";

describe.skipIf(!chromeUsable)("the UI in Chrome", () => {
  let rig: Rig, page: Page;
  beforeAll(async () => { rig = await startRig(); page = await rig.open(); }, 60_000);
  afterAll(() => rig?.stop());

  test("ask cards: compact shows the buttons alone; open, the button sits left of its text at 1280 px and over it at 720 px; deny reveals its input as Confirm", async () => {
    await page.go("#/");
    await page.until('document.querySelector("#view .issue-row[data-card] .choice .act")');
    await page.width(1280);
    const card = 'document.querySelector("#view .issue-row[data-card] .choice .act").closest(".issue-row")';
    expect(await page.ev(`(() => { const c = ${card}; return [c.querySelector(".ask-fold").open, c.querySelector(".choice-text").getClientRects().length, c.querySelector(".act").getClientRects().length > 0]; })()`)).toEqual([false, 0, true]);
    await page.ev(`${card}.querySelector(".ask-fold > summary").click()`);
    const geo = `(() => { const c = ${card}.querySelector(".choice"); const t = c.querySelector(".choice-text").getBoundingClientRect(), b = c.querySelector(".act").getBoundingClientRect(); return { left: b.right <= t.left + 1, rowTop: b.top < t.bottom && b.bottom > t.top, under: t.top >= b.bottom - 1 }; })()`;
    const g = await page.ev<any>(geo);
    expect(g.left && g.rowTop).toBe(true);
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
      // The card above the fold is at most the meta row and 3 lines, and the closed fold is no taller than its toggle.
      // The card's own height is not compared: the lane grid stretches a card to the tallest card in its row.
      const fits = await page.ev<boolean>(`(() => { const d = document.querySelector(${q}), c = d.closest(".issue-row"); const lh = parseFloat(getComputedStyle(c).lineHeight) || 20; const t = d.querySelector("summary").getBoundingClientRect().height; const kids = [...c.children].filter((e) => e !== d); const body = kids.reduce((h, e) => h + e.getBoundingClientRect().height, 0); return body <= 4 * lh + 8 && d.getBoundingClientRect().height <= t + 16; })()`);
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
});
