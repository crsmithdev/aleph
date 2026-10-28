/**
 * review2's browser step, run by the harness outside the reviewer's sandbox: srt's
 * profile blocks the Unix sockets Chrome needs, and opening them would open every
 * host socket to worker-written code. The sandboxed reviewer starts `bun ui/server.ts`
 * on 127.0.0.1 and writes the URLs to tmp/views.txt; the harness then runs
 * /usr/bin/google-chrome --headless inside the sandbox's user and network namespaces
 * (`nsenter -U -n`), so it reaches that server and nothing else, drives it over
 * --remote-debugging-pipe (no debugging port), and writes the screenshots, console
 * errors and horizontal scroll of each view at 1440 and 390 px, light and dark, to
 * browser/ in the run folder, which the reviewer reads and cannot write.
 *
 * Chrome joins only the network and user namespaces, not the mount namespace, so it
 * keeps its own sandbox: there is no --no-sandbox fallback. When Chrome's sandbox
 * cannot start there, the report says so and the review goes on with no browser result.
 */
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, closeSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The reviewer's browse request, relative to the run folder: in tmp/, which REVIEW2_SANDBOX lets it write. */
export const VIEWS = "tmp/views.txt";
/** The harness's output, relative to the run folder: read-only for the reviewer. */
export const BROWSER = "browser";
export const SANDBOX_ERROR = "ERROR: Chrome sandbox unavailable in the review namespace";

const SIZES: [number, number][] = [[1440, 900], [390, 844]];
const SCHEMES = ["light", "dark"] as const;
const MAX_VIEWS = 8;
const chrome = () => process.env.ALEPH_REVIEW2_CHROME ?? "/usr/bin/google-chrome";

/** The URLs of a views file: http on localhost, 127.0.0.1 or [::1] only, at most MAX_VIEWS. Other lines are dropped. */
export function parseViews(text: string): { urls: string[]; dropped: number } {
  const urls: string[] = [];
  let dropped = 0;
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    let u: URL | null = null;
    try { u = new URL(line); } catch { /* not a URL */ }
    if (u && u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) && !u.username && !u.password && urls.length < MAX_VIEWS) urls.push(u.href);
    else dropped++;
  }
  return { urls, dropped };
}

const ns = (pid: number | "self", kind: string): string | null => { try { return readlinkSync(`/proc/${pid}/ns/${kind}`); } catch { return null; } };

/** The first descendant of `root`, breadth first, in another network namespace than this process: a process inside srt's sandbox. */
export function sandboxPid(root: number): number | null {
  const children = new Map<number, number[]>();
  for (const e of readdirSync("/proc")) {
    if (!/^\d+$/.test(e)) continue;
    try {
      // The ppid is the second field after the command, which sits in parentheses and may hold spaces.
      const stat = readFileSync(`/proc/${e}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      children.set(ppid, [...(children.get(ppid) ?? []), Number(e)]);
    } catch { /* gone */ }
  }
  const self = ns("self", "net");
  const queue = [...(children.get(root) ?? [])];
  while (queue.length) {
    const pid = queue.shift()!;
    const net = ns(pid, "net");
    if (net && net !== self) return pid;
    queue.push(...(children.get(pid) ?? []));
  }
  return null;
}

/** The argv that runs Chrome in `pid`'s user and network namespaces; with `pid` null, in this process's own (the tests' stand-in for srt). */
export function chromeArgv(pid: number | null, profileDir: string): string[] {
  const enter = pid === null ? [] : ["nsenter", "-t", String(pid), "--preserve-credentials",
    ...(ns(pid, "user") !== ns("self", "user") ? ["-U"] : []), "-n", "--"];
  return [...enter, chrome(), "--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profileDir}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync", "--disable-background-networking",
    "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--no-proxy-server", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost", "about:blank"];
}

/** A CDP connection over Chrome's pipe: commands on fd 3, answers and events on fd 4, each message ended by a NUL. */
class Pipe {
  private next = 1;
  private waiting = new Map<number, { ok: (v: any) => void; no: (e: Error) => void }>();
  private listeners: ((m: any) => void)[] = [];
  private buf = "";
  closed = false;
  constructor(private out: NodeJS.WritableStream, input: NodeJS.ReadableStream) {
    // A write to a Chrome that has exited fails with EPIPE: the waiting commands fail, nothing throws.
    out.on("error", () => this.close(new Error("Chrome closed its pipe")));
    input.on("data", (d: Buffer) => {
      this.buf += d.toString("utf8");
      let i: number;
      while ((i = this.buf.indexOf("\0")) >= 0) {
        const raw = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        let m: any;
        try { m = JSON.parse(raw); } catch { continue; }
        if (m.id !== undefined && this.waiting.has(m.id)) {
          const w = this.waiting.get(m.id)!;
          this.waiting.delete(m.id);
          m.error ? w.no(new Error(m.error.message ?? "CDP error")) : w.ok(m.result ?? {});
        } else for (const l of this.listeners) l(m);
      }
    });
    input.on("close", () => this.close(new Error("Chrome closed its pipe")));
    input.on("error", () => this.close(new Error("Chrome closed its pipe")));
  }
  close(e: Error) {
    this.closed = true;
    for (const w of this.waiting.values()) w.no(e);
    this.waiting.clear();
  }
  send(method: string, params: object = {}, sessionId?: string, ms = 15_000): Promise<any> {
    if (this.closed) return Promise.reject(new Error("Chrome closed its pipe"));
    const id = this.next++;
    return new Promise((ok, no) => {
      const t = setTimeout(() => { this.waiting.delete(id); no(new Error(`${method} timed out`)); }, ms);
      this.waiting.set(id, { ok: (v) => { clearTimeout(t); ok(v); }, no: (e) => { clearTimeout(t); no(e); } });
      this.out.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
  }
  on(l: (m: any) => void): () => void {
    this.listeners.push(l);
    return () => { this.listeners = this.listeners.filter((x) => x !== l); };
  }
}

interface Shot { width: number; scheme: string; file: string; overflow: string; errors: string[] }

const evalValue = async (cdp: Pipe, sessionId: string, expression: string): Promise<any> => {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(`Runtime.evaluate: ${r.exceptionDetails.text ?? "exception"}`);
  const v = r.result?.value;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return v; } }
  return v;
};

/** Up to 3 elements whose right edge is past the viewport, as tag#id.class and width. Runs in the page. */
const OFFENDERS = `JSON.stringify([...document.querySelectorAll("body *")].map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => r.width > 0 && r.right > document.documentElement.clientWidth + 0.5).slice(0, 3).map(([e, r]) => ({ selector: e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\\s+/)[0] : ""), width: Math.round(r.width) })))`;

/** `overflow: none`, or `overflow: <scrollWidth> > <clientWidth>` and up to 3 offending elements. */
async function measure(cdp: Pipe, sessionId: string): Promise<string> {
  const w = await evalValue(cdp, sessionId, "JSON.stringify({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })");
  const sw = Number(w?.scrollWidth), cw = Number(w?.clientWidth);
  if (!Number.isFinite(sw) || !Number.isFinite(cw)) throw new Error("scrollWidth and clientWidth unreadable");
  if (!(sw > cw)) return "overflow: none";
  let els: { selector: string; width: number }[] = [];
  try { const v = await evalValue(cdp, sessionId, OFFENDERS); if (Array.isArray(v)) els = v.slice(0, 3); } catch { /* the widths stand */ }
  return `overflow: ${sw} > ${cw}${els.length ? ` — ${els.map((e) => `${String(e.selector).replace(/[|\s]+/g, " ")} (${e.width}px)`).join(", ")}` : ""}`;
}

/** One view at one size and scheme, in its own tab. */
async function shoot(cdp: Pipe, url: string, width: number, height: number, scheme: string, file: string): Promise<Shot> {
  const errors: string[] = [];
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  let loaded!: () => void;
  const load = new Promise<void>((ok) => { loaded = ok; });
  const off = cdp.on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Page.loadEventFired") loaded();
    else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.exception?.description?.split("\n")[0] ?? m.params.exceptionDetails?.text ?? "exception");
    else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(`console.error: ${(m.params.args ?? []).map((a: any) => a.value ?? a.description ?? "").join(" ")}`);
    else if (m.method === "Log.entryAdded" && m.params.entry?.level === "error") errors.push(`${m.params.entry.text}${m.params.entry.url ? ` (${m.params.entry.url})` : ""}`);
  });
  try {
    for (const d of ["Page.enable", "Runtime.enable", "Log.enable"]) await cdp.send(d, {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 }, sessionId);
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] }, sessionId);
    const nav = await cdp.send("Page.navigate", { url }, sessionId);
    if (nav.errorText) errors.push(`navigation: ${nav.errorText}`);
    await Promise.race([load, Bun.sleep(15_000)]);
    // A moment for the view's scripts to draw after load.
    await Bun.sleep(Number(process.env.ALEPH_REVIEW2_SETTLE_MS ?? 500));
    const overflow = await measure(cdp, sessionId);
    const shotH = await cdp.send("Page.getLayoutMetrics", {}, sessionId).then((m) => Math.min(4000, Math.max(height, Math.ceil(m.cssContentSize?.height ?? height)))).catch(() => height);
    const png = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: shotH, scale: 1 } }, sessionId);
    writeFileSync(file, Buffer.from(png.data, "base64"));
    return { width, scheme, file, overflow, errors };
  } finally {
    off();
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

const tail = (file: string, n = 20) => { try { return readFileSync(file, "utf8").trimEnd().split("\n").slice(-n).join("\n"); } catch { return ""; } };

/**
 * Load each view in `urls` at 1440 and 390 px, light and dark, in Chrome inside `pid`'s namespaces,
 * and write `<folder>/browser/report.md` (atomically, last), the screenshots and chrome.log. Never throws.
 */
export async function browserStep(folder: string, urls: string[], pid: number | null, dropped = 0): Promise<void> {
  const out = join(folder, BROWSER);
  const log = join(out, "chrome.log");
  const lines: string[] = ["# Browser", ""];
  const report = () => { writeFileSync(join(out, "report.md.part"), lines.join("\n") + "\n"); renameSync(join(out, "report.md.part"), join(out, "report.md")); };
  // Chrome's profile is the harness's own, outside the run folder: the reviewer cannot plant one.
  const profileDir = mkdtempSync(join(tmpdir(), "aleph-review2-chrome-"));
  let child: ReturnType<typeof spawn> | null = null;
  try {
    if (dropped) lines.push(`${dropped} line(s) of ${VIEWS} dropped: only http URLs on localhost, 127.0.0.1 or [::1], at most ${MAX_VIEWS}.`, "");
    if (!urls.length) { lines.push("ERROR: no view to load"); return report(); }
    const fd = openSync(log, "a");
    const argv = chromeArgv(pid, profileDir);
    try {
      child = spawn(argv[0], argv.slice(1), {
        stdio: ["ignore", fd, fd, "pipe", "pipe"],
        env: { HOME: profileDir, TMPDIR: profileDir, PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" },
      });
    } finally { closeSync(fd); }
    const exited = new Promise<void>((ok) => { child!.on("exit", () => ok()); child!.on("error", () => ok()); });
    const cdp = new Pipe(child.stdio[3] as NodeJS.WritableStream, child.stdio[4] as NodeJS.ReadableStream);
    exited.then(() => cdp.close(new Error("Chrome exited")));
    let version: string;
    try {
      version = (await cdp.send("Browser.getVersion", {}, undefined, 30_000)).product ?? "Chrome";
    } catch {
      const t = tail(log);
      lines.push(/sandbox/i.test(t) ? SANDBOX_ERROR : "ERROR: Chrome did not start in the review namespace", "", "```", t, "```");
      return report();
    }
    lines.push(`${version}, run by the harness in the reviewer's network namespace. Screenshots are full page, up to 4000 px tall.`, "");
    let n = 0;
    for (const url of urls) {
      n++;
      lines.push(`## ${n}. ${url}`, "", "| width | scheme | overflow | errors | screenshot |", "|---|---|---|---|---|");
      const errs: string[] = [];
      for (const [w, h] of SIZES) for (const scheme of SCHEMES) {
        const file = join(out, `${n}-${w}-${scheme}.png`);
        try {
          const s = await shoot(cdp, url, w, h, scheme, file);
          lines.push(`| ${w} | ${scheme} | ${s.overflow} | ${s.errors.length} | ${file} |`);
          errs.push(...s.errors.map((e) => `- ${w} ${scheme}: ${e.replace(/\s+/g, " ").slice(0, 300)}`));
        } catch (e: any) {
          lines.push(`| ${w} | ${scheme} | overflow: ? | ? | ERROR: CDP failed: ${String(e?.message ?? e).replace(/\s+/g, " ")} |`);
        }
      }
      lines.push("", ...(errs.length ? ["Errors:", ...errs] : ["No page errors."]), "");
    }
    report();
  } catch (e: any) {
    try { lines.push(`ERROR: browser step: ${String(e?.message ?? e).replace(/\s+/g, " ")}`); report(); } catch { /* the run folder is gone */ }
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([new Promise((ok) => child!.once("exit", ok)), Bun.sleep(5000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    rmSync(profileDir, { recursive: true, force: true });
  }
}

/**
 * Watch `<folder>/tmp/views.txt` while the reviewer runs (`root` is the sandbox's outer process), and
 * run the browser step on each request. The request is taken (read, then removed) before Chrome starts,
 * so the reviewer may write a new one for a second round. `stop` waits for a step under way.
 */
export function watchViews(folder: string, root: () => number | undefined, o: { sandbox: boolean; every?: number }): { stop: () => Promise<void> } {
  const file = join(folder, VIEWS);
  let busy: Promise<void> | null = null;
  const tick = () => {
    if (busy || !existsSync(file)) return;
    busy = (async () => {
      let text = "";
      // Only a regular file: a link the reviewer planted is not followed out of the sandbox.
      try { if (lstatSync(file).isFile()) text = readFileSync(file, "utf8"); } catch { /* taken */ }
      rmSync(file, { force: true });
      const out = join(folder, BROWSER);
      for (const e of existsSync(out) ? readdirSync(out) : []) rmSync(join(out, e), { recursive: true, force: true });
      mkdirSync(out, { recursive: true });
      const { urls, dropped } = parseViews(text);
      const r = root();
      const pid = o.sandbox ? (r === undefined ? null : sandboxPid(r)) : null;
      if (o.sandbox && pid === null) {
        writeFileSync(join(out, "report.md"), "# Browser\n\nERROR: the reviewer's sandbox has no network namespace of its own to load the views in\n");
        return;
      }
      await browserStep(folder, urls, pid, dropped);
    })().catch(() => {}).finally(() => { busy = null; });
  };
  const t = setInterval(tick, o.every ?? 1000);
  return { stop: async () => { clearInterval(t); await busy; } };
}
