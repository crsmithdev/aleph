import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aleph, fakeLog, repo, setup, specFile, state, teardown } from "./cli.helpers";

/** A stand-in for Chrome (as in lib/shot.test.ts): answers captureScreenshot with a PNG header of the requested width. */
const FAKE_CHROME = `#!${process.execPath}
import { createReadStream, createWriteStream } from "node:fs";
const out = createWriteStream("", { fd: 4 });
const send = (m) => out.write(JSON.stringify(m) + "\\0");
const widths = {};
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
    else if (m.method === "Page.captureScreenshot") {
      const b = Buffer.alloc(24); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.write("IHDR", 12);
      b.writeUInt32BE(widths[s], 16); b.writeUInt32BE(m.params.clip.height, 20);
      result = { data: b.toString("base64") };
    }
    send({ id: m.id, result, ...(s ? { sessionId: s } : {}) });
    if (m.method === "Page.navigate") send({ method: "Page.loadEventFired", sessionId: s, params: {} });
  }
});
`;

let tmp: string, srv: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  setup();
  tmp = mkdtempSync(join(tmpdir(), "factory-shot-"));
  writeFileSync(join(tmp, "chrome"), FAKE_CHROME, { mode: 0o755 });
  srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("<p>x</p>") });
});
afterAll(() => { srv.stop(true); rmSync(tmp, { recursive: true, force: true }); teardown(); });

describe("a factory run", () => {
  test("a worker's aleph-shot call yields a committed PNG of the requested width", async () => {
    const r = await aleph(["job", "fac", "fshot", "--spec", specFile(`Goal: fshot\nACTION: shot http://127.0.0.1:${srv.port}/\n`)], { ALEPH_REVIEW2_CHROME: join(tmp, "chrome") });
    const log = (f: string) => { try { return readFileSync(join(fakeLog, f), "utf8"); } catch { return ""; } };
    expect(log("shot.out") + log("shot.code")).toContain("shot:");
    expect(state(r.json.run).state).not.toBe("stuck");
    const png = Buffer.from(Bun.spawnSync(["git", "-C", repo, "show", "factory/fshot:shot.png"]).stdout);
    expect(png.readUInt32BE(16)).toBe(1440);
    await aleph(["drop", "fshot"]);
  }, 60_000);
});
