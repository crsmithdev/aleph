/**
 * Screenshot requests from a worker that cannot run Chrome. The worker's `aleph-shot` (SHOT_CLIENT) writes a
 * request file under `$TMPDIR/shots/` in the run folder; `serveShots`, run by the harness outside the sandbox,
 * validates it, takes the shot in a Chrome of its own (`takeShot`, over CDP on a pipe, never --no-sandbox) and
 * writes `<id>.result.json` beside it.
 */
import { mkdirSync, mkdtempSync, lstatSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, sep } from "node:path";
import { Pipe, startChrome, tail } from "./review2-browser.ts";

export interface ShotRequest { url: string; out: string; width: number; height: number; scheme: string; click?: string; wait?: number }
export interface ShotResult { ok: boolean; out?: string; width?: number; height?: number; error?: string }

const MAX_REQUEST = 4096;
const SHOT_MS = 60_000;
const DEFAULT_WAIT = 500;

/** The text of `bin/aleph-shot`. */
export const SHOT_CLIENT = String.raw`#!/usr/bin/env bash
# aleph-shot <url> <out.png> [--width 1440] [--height 900] [--scheme light|dark] [--click <css selector>] [--wait <ms>]
# Asks the factory for a screenshot of a page on localhost; the factory runs Chrome, outside the sandbox.
set -u
usage() { echo "usage: aleph-shot <url> <out.png> [--width 1440] [--height 900] [--scheme light|dark] [--click <css selector>] [--wait <ms>]" >&2; exit 2; }
fail() { echo "shot failed: $1" >&2; exit 1; }
[ $# -ge 2 ] || usage
url=$1; out=$2; shift 2
width=1440; height=900; scheme=light; click=""; wait=500
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || usage
  case $1 in
    --width) width=$2;;
    --height) height=$2;;
    --scheme) scheme=$2;;
    --click) click=$2;;
    --wait) wait=$2;;
    *) usage;;
  esac
  shift 2
done
for n in "$width" "$height" "$wait"; do
  case $n in ""|*[!0-9]*) fail "--width, --height and --wait are whole numbers";; esac
done
case $out in /*) ;; *) out=$PWD/$out;; esac
esc() { printf '%s' "$1" | tr '\n\r\t' '   ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
tmp=$TMPDIR; [ -n "$tmp" ] || tmp=/tmp
dir=$tmp/shots
mkdir -p "$dir" || fail "cannot create $dir"
id=$(date +%s%N)-$$
printf '{"url":"%s","out":"%s","width":%s,"height":%s,"scheme":"%s","click":"%s","wait":%s}\n' \
  "$(esc "$url")" "$(esc "$out")" "$width" "$height" "$(esc "$scheme")" "$(esc "$click")" "$wait" > "$dir/$id.json.tmp" || fail "cannot write the request"
mv "$dir/$id.json.tmp" "$dir/$id.json" || fail "cannot write the request"
res=$dir/$id.result.json
deadline=$((SECONDS + 120))
while [ ! -f "$res" ]; do
  if [ $SECONDS -ge $deadline ]; then rm -f "$dir/$id.json"; fail "no answer from the factory within 120 s"; fi
  sleep 0.2
done
body=$(cat "$res"); rm -f "$res"
case $body in
  *'"ok":true'*) echo "shot: $out"" $width""x""$height"; exit 0;;
esac
err=$(printf '%s' "$body" | sed -n 's/.*"error":"\(.*\)"}.*/\1/p' | sed -e 's/\\n/ /g' -e 's/\\"/"/g' -e 's/\\\\/\\/g')
[ -n "$err" ] || err="unreadable answer: $body"
fail "$err"
`;

const rejectAfter = (ms: number, msg: string) => new Promise<never>((_, no) => setTimeout(() => no(new Error(msg)), ms).unref());

/** Take one shot of `chromeUrl` in a Chrome of its own and write the PNG to `req.out`. Throws on any failure; Chrome and its profile are gone after. */
export async function takeShot(req: ShotRequest, chromeUrl: string): Promise<void> {
  const profileDir = mkdtempSync(join(tmpdir(), "aleph-shot-chrome-"));
  const log = join(profileDir, "chrome.log");
  const wait = req.wait ?? DEFAULT_WAIT;
  let child: ReturnType<typeof startChrome> | null = null;
  try {
    child = startChrome(profileDir, log);
    const exited = new Promise<void>((ok) => { child!.on("exit", () => ok()); child!.on("error", () => ok()); });
    const cdp = new Pipe(child.stdio[3] as NodeJS.WritableStream, child.stdio[4] as NodeJS.ReadableStream);
    exited.then(() => cdp.close(new Error("Chrome exited")));
    try {
      await cdp.send("Browser.getVersion", {}, undefined, 30_000);
    } catch {
      throw new Error(`Chrome did not start: ${tail(log, 10).replace(/\s+/g, " ")}`);
    }
    const run = async () => {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      let loaded!: () => void;
      const load = new Promise<void>((ok) => { loaded = ok; });
      cdp.on((m) => { if (m.sessionId === sessionId && m.method === "Page.loadEventFired") loaded(); });
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Runtime.enable", {}, sessionId);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: req.width, height: req.height, deviceScaleFactor: 1, mobile: req.width < 600 }, sessionId);
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: req.scheme }] }, sessionId);
      const nav = await cdp.send("Page.navigate", { url: chromeUrl }, sessionId);
      if (nav.errorText) throw new Error(`navigation to ${chromeUrl}: ${nav.errorText}`);
      await Promise.race([load, Bun.sleep(15_000)]);
      await Bun.sleep(wait);
      if (req.click !== undefined && req.click !== "") {
        const r = await cdp.send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(req.click)}).click()`, returnByValue: true }, sessionId);
        if (r.exceptionDetails) {
          const d = r.exceptionDetails.exception?.description?.split("\n")[0] ?? r.exceptionDetails.text ?? "exception";
          throw new Error(`click ${req.click}: ${d} (no element matches?)`);
        }
        await Bun.sleep(wait);
      }
      const png = await cdp.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: req.width, height: req.height, scale: 1 } }, sessionId);
      writeFileSync(req.out, Buffer.from(png.data, "base64"));
    };
    await Promise.race([run(), rejectAfter(SHOT_MS, "the shot took more than 60 s")]);
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([new Promise((ok) => child!.once("exit", ok)), Bun.sleep(5000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    rmSync(profileDir, { recursive: true, force: true });
  }
}

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/** The request in `file` checked, or the reason it is refused. Nothing is started. */
function validate(file: string, dir: string): ShotRequest | string {
  let raw: string;
  try {
    if (statSync(file).size > MAX_REQUEST) return "request is over 4 KB";
    raw = readFileSync(file, "utf8");
  } catch (e: any) { return `cannot read the request: ${e?.message ?? e}`; }
  let r: any;
  try { r = JSON.parse(raw); } catch { return "request is not JSON"; }
  if (!r || typeof r !== "object") return "request is not an object";
  let u: URL;
  try { u = new URL(String(r.url)); } catch { return `bad url: ${String(r.url).slice(0, 200)}`; }
  if (u.protocol !== "http:" || (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") || !u.port) return "url must be http://127.0.0.1:<port> or http://localhost:<port>";
  if (typeof r.out !== "string" || !isAbsolute(r.out) || !r.out.endsWith(".png")) return "out must be an absolute path ending in .png";
  try {
    const work = realpathSync(join(dir, "work"));
    const parent = realpathSync(dirname(r.out));
    if (parent !== work && !parent.startsWith(work + sep)) return "out must be under work/";
  } catch { return "out must be under work/ (its folder does not exist)"; }
  try {
    if (lstatSync(r.out).isSymbolicLink()) return "out is a symlink";
  } catch { /* not there yet: fine */ }
  if (!isInt(r.width, 100, 4000) || !isInt(r.height, 100, 4000)) return "width and height must be whole numbers from 100 to 4000";
  if (r.scheme !== "light" && r.scheme !== "dark") return "scheme must be light or dark";
  if (r.click !== undefined && typeof r.click !== "string") return "click must be a string";
  if (r.wait !== undefined && !isInt(r.wait, 0, 10_000)) return "wait must be a whole number of ms up to 10000";
  return { url: u.href, out: r.out, width: r.width, height: r.height, scheme: r.scheme, click: r.click, wait: r.wait };
}

const writeResult = (file: string, res: ShotResult) => {
  writeFileSync(file + ".tmp", JSON.stringify(res) + "\n");
  renameSync(file + ".tmp", file);
};

/**
 * Serve the shot requests in `dir/tmp/shots/`, one at a time, until `stop()`, which finishes the one in flight.
 * `reach` maps the worker's URL to the URL Chrome loads. Never throws.
 */
export function serveShots(dir: string, o: { reach?: (url: string) => Promise<{ url: string; stop: () => Promise<void>; stderr?: () => string }> } = {}): { stop(): Promise<void> } {
  const shots = join(dir, "tmp", "shots");
  let stopping = false;
  const seen = new Set<string>();
  const handle = async (name: string) => {
    const id = name.slice(0, -".json".length);
    const result = join(shots, `${id}.result.json`);
    let res: ShotResult;
    try {
      const req = validate(join(shots, name), dir);
      if (typeof req === "string") res = { ok: false, error: req };
      else {
        const reached = o.reach ? await o.reach(req.url) : { url: req.url, stop: async () => {} };
        try { await takeShot(req, reached.url); } catch (e: any) {
          // The bridge's own stderr names the cause that Chrome only reports as ERR_EMPTY_RESPONSE.
          const lines = (reached.stderr?.() ?? "").replace(/\s+/g, " ").trim().slice(-400);
          if (!lines) throw e;
          const msg = String(e?.message ?? e).replace(/\s+/g, " ");
          const tailText = ` [bridge stderr: ${lines}]`;
          throw new Error(msg.slice(0, 1000 - tailText.length) + tailText);
        } finally { await reached.stop().catch(() => {}); }
        res = { ok: true, out: req.out, width: req.width, height: req.height };
      }
    } catch (e: any) { res = { ok: false, error: String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 1000) }; }
    try { writeResult(result, res); } catch { /* the folder is gone */ }
  };
  const loop = (async () => {
    mkdirSync(shots, { recursive: true });
    while (!stopping) {
      try {
        const names = readdirSync(shots).filter((n) => n.endsWith(".json") && !n.endsWith(".result.json") && !n.endsWith(".tmp") && !seen.has(n)).sort();
        for (const n of names) {
          if (stopping) break;
          seen.add(n);
          await handle(n);
        }
      } catch { /* try again on the next poll */ }
      await Bun.sleep(250);
    }
  })().catch(() => {});
  return { stop: async () => { stopping = true; await loop; } };
}
