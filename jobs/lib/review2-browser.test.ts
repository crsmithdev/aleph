import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A stand-in for Chrome that speaks CDP on fds 3 and 4: a page whose URL holds "wide" overflows at 390 px, one holding "fail" fails Runtime.evaluate. */
const FAKE_CHROME = `#!${process.execPath}
import { createReadStream, createWriteStream } from "node:fs";
const out = createWriteStream("", { fd: 4 });
const send = (m) => out.write(JSON.stringify(m) + "\\0");
const widths = {}, urls = {};
let n = 0, buf = "";
createReadStream("", { fd: 3 }).on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\\0")) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    const s = m.sessionId;
    let result = {};
    if (m.method === "Browser.getVersion") result = { product: "FakeChrome/1" };
    else if (m.method === "Target.createTarget") result = { targetId: "t" + ++n };
    else if (m.method === "Target.attachToTarget") result = { sessionId: "s" + n };
    else if (m.method === "Emulation.setDeviceMetricsOverride") widths[s] = m.params.width;
    else if (m.method === "Page.navigate") urls[s] = m.params.url;
    else if (m.method === "Runtime.evaluate") {
      if (urls[s].includes("fail")) { send({ id: m.id, error: { message: "Cannot find context" }, sessionId: s }); continue; }
      const over = widths[s] === 390 && urls[s].includes("wide");
      if (m.params.expression.includes("scrollWidth")) result = { result: { value: JSON.stringify({ scrollWidth: over ? 412 : widths[s], clientWidth: widths[s] }) } };
      else result = { result: { value: JSON.stringify([{ selector: "div#wide.card", width: 412 }]) } };
    }
    else if (m.method === "Page.getLayoutMetrics") result = { cssContentSize: { width: widths[s], height: 1200 } };
    else if (m.method === "Page.captureScreenshot") result = { data: Buffer.from("PNG").toString("base64") };
    send({ id: m.id, result, ...(s ? { sessionId: s } : {}) });
    if (m.method === "Page.navigate") send({ method: "Page.loadEventFired", sessionId: s, params: {} });
  }
});
`;

let base: string, srv: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "review2-browser-"));
  writeFileSync(join(base, "chrome"), FAKE_CHROME, { mode: 0o755 });
  process.env.ALEPH_REVIEW2_CHROME = join(base, "chrome");
  srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("{}") });
});
afterAll(() => { srv.stop(true); rmSync(base, { recursive: true, force: true }); });

describe("review2 browser argv", () => {
  test("the resolver rule maps every host to NOTFOUND but leaves loopback by name and by address", async () => {
    const { chromeArgv } = await import("./review2-browser.ts");
    const rule = chromeArgv("/p").find((a) => a.startsWith("--host-resolver-rules="));
    expect(rule).toBeDefined();
    const entries = rule!.slice("--host-resolver-rules=".length).split(",").map((e) => e.trim());
    expect(entries).toContain("MAP * ~NOTFOUND");
    expect(entries).toContain("EXCLUDE localhost");
    expect(entries).toContain("EXCLUDE 127.0.0.1");
  });
});

describe("review2 browser step overflow over CDP", () => {
  test("report.md has the overflow with its element for one view, none for another, and a CDP failure stays with its view", async () => {
    const { browserStep } = await import("./review2-browser.ts");
    const folder = join(base, "run");
    mkdirSync(join(folder, "browser"), { recursive: true });
    const u = `http://127.0.0.1:${srv.port}`;
    await browserStep(folder, [`${u}/wide`, `${u}/fine`, `${u}/fail`]);
    const report = readFileSync(join(folder, "browser/report.md"), "utf8");
    expect(report).toContain("overflow: 412 > 390");
    expect(report).toContain("div#wide.card (412px)");
    expect(report).toContain(`| 390 | dark | overflow: 412 > 390 — div#wide.card (412px) | 0 | ${join(folder, "browser/1-390-dark.png")} |`);
    expect(report).toContain(`| 1440 | light | overflow: none | 0 | ${join(folder, "browser/1-1440-light.png")} |`);
    expect(report).toContain(`| 390 | light | overflow: none | 0 | ${join(folder, "browser/2-390-light.png")} |`);
    expect(report.match(/ERROR: CDP failed: Cannot find context/g)?.length).toBe(4);
    expect(existsSync(join(folder, "browser/3-390-dark.png"))).toBe(false);
  }, 30_000);
});
