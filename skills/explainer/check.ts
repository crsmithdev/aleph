/**
 * Check an explainer page: `bun check.ts <page.html>`. It prints one line per fault, each starting with ✗, and the
 * paths of three screenshots in `<dir>/.shots/`: the first screen, the whole page, and the whole page in dark mode.
 * It exits 1 when it finds a fault.
 *
 * The source: no placeholder of base.html is left, each figure has a caption, the page has a sources table, and it
 * loads nothing but its fonts. In Chrome, with no network and no transitions, so a screenshot never catches a fade: no script error, no sideways scroll at 1280 or 390 px, and
 * no SVG label that overlaps another or leaves its drawing.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { launchChrome } from "../../ui/test-browser.ts";

const file = resolve(process.argv[2] ?? "");
const html = readFileSync(file, "utf8");
const faults: string[] = [];
const fault = (s: string) => faults.push(`✗ ${s}`);

const text = html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<!--[\s\S]*?-->/g, "");
for (const p of ["TITLE", "KICKER", "HEADLINE", "ANSWER", "CLAIM", "SOURCE"]) if (new RegExp(`\\b${p}\\b`).test(text)) fault(`the placeholder ${p} is still on the page`);
const figures = (text.match(/<figure[\s>]/g) ?? []).length, captions = (text.match(/<figcaption[\s>]/g) ?? []).length;
if (!figures) fault("the page has no <figure>");
if (captions < figures) fault(`${figures - captions} of ${figures} figures have no <figcaption>`);
if (!/<section id="sources">[\s\S]*?<td/.test(text)) fault(`the page has no <section id="sources"> with a row`);
for (const m of html.matchAll(/(?:src|href)\s*=\s*["'](https?:[^"']+)|url\(\s*["']?(https?:[^"')]+)/g)) {
  const url = m[1] ?? m[2];
  if (!/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)) fault(`the page loads ${url}`);
}

/** In the page: labels that overlap another label in the same drawing, or reach past the drawing's box. */
const LABELS = `(() => {
  const out = [], hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  document.querySelectorAll("figure svg").forEach((svg, i) => {
    const box = svg.getBoundingClientRect();
    const ts = [...svg.querySelectorAll("text")].filter((t) => t.textContent.trim() && !t.closest(".hide, [hidden]")).map((t) => [t.textContent.trim().slice(0, 30), t.getBoundingClientRect()]);
    ts.forEach(([s, r], j) => {
      if (r.left < box.left - 2 || r.right > box.right + 2 || r.top < box.top - 2 || r.bottom > box.bottom + 2) out.push("figure " + (i + 1) + ": the label \\"" + s + "\\" reaches past the drawing");
      for (const [s2, r2] of ts.slice(j + 1)) if (hit(r, r2)) out.push("figure " + (i + 1) + ": the labels \\"" + s + "\\" and \\"" + s2 + "\\" overlap");
    });
  });
  return out;
})()`;

const base = mkdtempSync(join(tmpdir(), "explainer-check-"));
const chrome = await launchChrome(base);
const shots = join(dirname(file), ".shots"), name = basename(file, ".html");
mkdirSync(shots, { recursive: true });
try {
  const { cdp } = chrome;
  for (const scheme of ["light", "dark"]) {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (m: string, p: object = {}) => cdp.send(m, p, sessionId);
    const errors: string[] = [];
    cdp.on((m) => { if (m.sessionId === sessionId && m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.exception?.description?.split("\n")[0] ?? m.params.exceptionDetails?.text); });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    const ev = async (expression: string) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
    const width = async (w: number) => { await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false }); return ev("document.documentElement.scrollWidth"); };
    await width(1280);
    const loaded = new Promise<void>((ok) => { const off = cdp.on((m) => { if (m.sessionId === sessionId && m.method === "Page.loadEventFired") { off(); ok(); } }); });
    await send("Page.navigate", { url: `file://${file}` });
    await Promise.race([loaded, Bun.sleep(20_000)]);
    await ev(`document.head.append(Object.assign(document.createElement("style"), { textContent: "*, *::before, *::after { transition: none !important; animation: none !important; }" }))`);
    const shot = async (path: string, full: boolean) => {
      const h = full ? await ev("document.documentElement.scrollHeight") : 900;
      const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full, clip: { x: 0, y: 0, width: 1280, height: h, scale: 1 } });
      writeFileSync(path, Buffer.from(data, "base64"));
    };
    if (scheme === "light") {
      for (const f of await ev(LABELS) as string[]) fault(f);
      if (await width(1280) > 1280) fault("the page scrolls sideways at 1280 px");
      await shot(join(shots, `${name}.first.png`), false);
      await shot(join(shots, `${name}.full.png`), true);
      if (await width(390) > 390) fault("the page scrolls sideways at 390 px");
    } else {
      await shot(join(shots, `${name}.dark.png`), true);
    }
    for (const e of errors) fault(`script error (${scheme}): ${e}`);
    await cdp.send("Target.closeTarget", { targetId });
  }
} finally {
  chrome.kill();
  rmSync(base, { recursive: true, force: true });
}

console.log([...faults, ...["first", "full", "dark"].map((s) => `screenshot: ${join(shots, `${name}.${s}.png`)}`)].join("\n"));
process.exit(faults.length ? 1 : 0);
