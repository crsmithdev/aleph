import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let base: string, srv: ReturnType<typeof Bun.serve>, record: string;

/** A stand-in for Chrome: logs its start, the scheme, the URL and the click to `record`, and answers captureScreenshot with a PNG header of the requested width. */
const fakeChrome = () => `#!${process.execPath}
import { appendFileSync, createReadStream, createWriteStream } from "node:fs";
const rec = (o) => appendFileSync(${JSON.stringify(record)}, JSON.stringify(o) + "\\n");
rec({ start: true });
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
    else if (m.method === "Emulation.setEmulatedMedia") rec({ scheme: m.params.features[0].value });
    else if (m.method === "Page.navigate") { rec({ navigate: m.params.url }); if (m.params.url.includes("/refuse")) result = { errorText: "net::ERR_EMPTY_RESPONSE" }; }
    else if (m.method === "Runtime.evaluate") rec({ expression: m.params.expression });
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

const records = () => (existsSync(record) ? readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "shot-test-"));
  record = join(base, "record.jsonl");
  writeFileSync(join(base, "chrome"), fakeChrome(), { mode: 0o755 });
  process.env.ALEPH_REVIEW_CHROME = join(base, "chrome");
  srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("<p class=row>x</p>") });
});
afterAll(() => { srv.stop(true); rmSync(base, { recursive: true, force: true }); });

/** A run folder with bin/aleph-shot, work/docs and tmp; runs the client in it. */
async function setup(name: string) {
  const { SHOT_CLIENT, serveShots } = await import("./shot.ts");
  const dir = join(base, name);
  mkdirSync(join(dir, "bin"), { recursive: true });
  mkdirSync(join(dir, "work/docs"), { recursive: true });
  mkdirSync(join(dir, "tmp"), { recursive: true });
  writeFileSync(join(dir, "bin/aleph-shot"), SHOT_CLIENT, { mode: 0o755 });
  const run = async (...args: string[]) => {
    const p = Bun.spawn(["bash", "bin/aleph-shot", ...args], { cwd: dir, env: { ...process.env, TMPDIR: join(dir, "tmp") }, stdout: "pipe", stderr: "pipe" });
    const [o, e, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out: o, err: e, code };
  };
  return { dir, run, serveShots };
}

describe("aleph-shot and serveShots", () => {
  test("a shot with click and dark scheme gives a PNG of the requested width", async () => {
    const { dir, run, serveShots } = await setup("one");
    const server = serveShots(dir, {});
    try {
      const url = `http://127.0.0.1:${srv.port}/`;
      const r = await run(url, "work/docs/x.png", "--width", "1440", "--height", "900", "--scheme", "dark", "--click", ".row", "--wait", "50");
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      expect(r.out).toBe(`shot: ${join(dir, "work/docs/x.png")} 1440x900\n`);
      expect(readFileSync(join(dir, "work/docs/x.png")).readUInt32BE(16)).toBe(1440);
      const rec = records();
      expect(rec).toContainEqual({ scheme: "dark" });
      expect(rec).toContainEqual({ expression: `document.querySelector(".row").click()` });
    } finally { await server.stop(); }
  }, 30_000);

  test("an out outside work, a symlinked out and another host fail without starting Chrome", async () => {
    const { dir, run, serveShots } = await setup("two");
    const server = serveShots(dir, {});
    rmSync(record, { force: true });
    try {
      const url = `http://127.0.0.1:${srv.port}/`;
      writeFileSync(join(base, "target.png"), "");
      symlinkSync(join(base, "target.png"), join(dir, "work/docs/link.png"));
      for (const [u, out] of [[url, join(base, "elsewhere.png")], [url, "work/docs/link.png"], [`http://example.com:80/`, "work/docs/y.png"]]) {
        const r = await run(u, out);
        expect(r.code).toBe(1);
        expect(r.err).toContain("shot failed:");
      }
      expect(records()).toEqual([]);
    } finally { await server.stop(); }
  }, 30_000);

  test("reach gets the worker's URL and Chrome loads the URL it returns", async () => {
    const { dir, run, serveShots } = await setup("three");
    const seen: string[] = [];
    let stopped = false;
    const server = serveShots(dir, { reach: async (u) => { seen.push(u); return { url: `http://127.0.0.1:${srv.port}/mapped`, stop: async () => { stopped = true; } }; } });
    rmSync(record, { force: true });
    try {
      const r = await run("http://localhost:4999/page", "work/docs/z.png", "--wait", "50");
      expect(r.code).toBe(0);
      expect(seen).toEqual(["http://localhost:4999/page"]);
      expect(records()).toContainEqual({ navigate: `http://127.0.0.1:${srv.port}/mapped` });
      expect(stopped).toBe(true);
    } finally { await server.stop(); }
  }, 30_000);

  test("a failed shot through a bridge holds the bridge stderr lines in its error", async () => {
    const { dir, run, serveShots } = await setup("four");
    const server = serveShots(dir, { reach: async () => ({ url: "http://127.0.0.1:9/refuse", stop: async () => {}, stderr: () => "nsenter: setns failed\nsocat: Connection refused" }) });
    try {
      const r = await run("http://localhost:4999/page", "work/docs/w.png", "--wait", "50");
      expect(r.code).toBe(1);
      expect(r.err).toContain("shot failed:");
      expect(r.err).toContain("ERR_EMPTY_RESPONSE");
      expect(r.err).toContain("nsenter: setns failed socat: Connection refused");
    } finally { await server.stop(); }
  }, 30_000);
});
