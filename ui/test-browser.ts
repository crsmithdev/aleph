/**
 * Real Chrome against a one-off UI server on the review fixture, for the tests of the shell and of mount code that
 * only a DOM can run. The sandbox of Chrome is off: it loads only this fixture, and CI runners refuse it.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CHROME = "/usr/bin/google-chrome";

/** The argv that runs Chrome headless on a pipe (no debugging port), with a profile of its own. */
function chromeArgv(profileDir: string): string[] {
  return [CHROME, "--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profileDir}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync", "--disable-background-networking",
    "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--no-proxy-server", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1", "about:blank"];
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
  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    if (this.closed) return Promise.reject(new Error("Chrome closed its pipe"));
    const id = this.next++;
    return new Promise((ok, no) => {
      this.waiting.set(id, { ok, no });
      this.out.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
  }
  on(l: (m: any) => void): () => void {
    this.listeners.push(l);
    return () => { this.listeners = this.listeners.filter((x) => x !== l); };
  }
}

/**
 * The tests that start Chrome run only with ALEPH_BROWSER_TESTS=1: `bun run test:all`, CI and the factory's checks
 * set it, and a plain `bun run test` skips them. CI must have one:
 * there a missing Chrome fails, and does not skip.
 */
export const chromeUsable = process.env.ALEPH_BROWSER_TESTS === "1" && (process.env.CI === "true" || (existsSync(CHROME) && Bun.spawnSync([CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--dump-dom", "about:blank"], { stdout: "ignore", stderr: "ignore", timeout: 20_000, env: { ...process.env, HOME: tmpdir() } }).exitCode === 0));

export interface Page {
  errors: string[];
  ev<T = any>(expression: string): Promise<T>;
  /** Waits until the expression is true: the page checks it on each frame, and again after a reload. */
  when(expression: string): Promise<void>;
  /** Goes to a hash in the page already open, the way a link does. */
  go(hash: string): Promise<void>;
  reload(): Promise<void>;
  /** Presses and releases one key ("Tab" or "Enter") on the keyboard of the page. */
  key(name: "Tab" | "Enter"): Promise<void>;
  /** Sets the viewport width, in CSS pixels. */
  width(px: number): Promise<void>;
  /** Saves a PNG of the viewport at its current width to `path` (folders made). */
  shot(path: string): Promise<void>;
}

export interface Rig { url: string; open(hash?: string): Promise<Page>; stop(): void }

/** `prepare` runs after the fixture is built and before the server starts, with the fixture's ALEPH_* variables: a test adds its own state to the store there. */
export async function startRig(prepare?: (env: Record<string, string>) => void | Promise<void>): Promise<Rig> {
  const base = mkdtempSync(join(tmpdir(), "aleph-ui-browser-"));
  const build = Bun.spawnSync([process.execPath, join(import.meta.dir, "fixtures", "review", "build.ts"), join(base, "home")], { stdout: "pipe", stderr: "pipe" });
  if (build.exitCode !== 0) throw new Error(build.stderr.toString());
  const env: Record<string, string> = { ...process.env as Record<string, string>, LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", HOME: join(base, "empty"),
    // A test that files or answers an issue must not start a real intake or dispatch.
    ALEPH_DISPATCH: "off" };
  for (const l of build.stdout.toString().trim().split("\n")) env[l.slice(0, l.indexOf("="))] = l.slice(l.indexOf("=") + 1);
  if (prepare) await prepare(env);
  const server = Bun.spawn([process.execPath, join(import.meta.dir, "server.ts"), "--port", "0"], { env, stdout: "pipe", stderr: "ignore" });
  const line = new TextDecoder().decode((await (server.stdout as ReadableStream<Uint8Array>).getReader().read()).value);
  const url = line.trim();

  // The first call waits for Chrome to start. A Chrome that closes its pipe is killed and started once more, with a new profile.
  const waits: string[] = [];
  let chrome!: ReturnType<typeof spawn>;
  let cdp!: Pipe;
  for (let n = 1; n <= 2; n++) {
    const profile = join(base, `profile${n}`);
    mkdirSync(profile);
    const argv = chromeArgv(profile);
    chrome = spawn(argv[0]!, ["--no-sandbox", ...argv.slice(1)], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
      env: { HOME: profile, TMPDIR: profile, PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" } });
    cdp = new Pipe(chrome.stdio[3] as NodeJS.WritableStream, chrome.stdio[4] as NodeJS.ReadableStream);
    try { await cdp.send("Browser.getVersion"); break; } catch (e) {
      chrome.kill("SIGKILL");
      waits.push(`try ${n}: ${(e as Error).message}`);
      if (n === 2) { server.kill(); rmSync(base, { recursive: true, force: true }); throw new Error(`Chrome failed both tries; ${waits.join("; ")}`); }
    }
  }

  const open = async (hash = "#/"): Promise<Page> => {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const errors: string[] = [];
    cdp.on((m) => { if (m.sessionId === sessionId && m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.exception?.description?.split("\n")[0] ?? m.params.exceptionDetails?.text); });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    const ev = async <T>(expression: string): Promise<T> => {
      const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw new Error(`${expression}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    };
    /** A promise for the next load event of the page, and the call that stops the wait. */
    const load = (): [Promise<void>, () => void] => {
      let off!: () => void;
      return [new Promise((ok) => { off = cdp.on((m) => { if (m.sessionId === sessionId && m.method === "Page.loadEventFired") ok(); }); }), () => off()];
    };
    const when = async (expression: string) => {
      for (;;) {
        const [again, off] = load();
        // A reload destroys the context under an evaluate: wait for the load and ask again.
        try { await ev(`new Promise((ok) => { const f = () => { let t = false; try { t = !!(${expression}); } catch {} t ? ok() : requestAnimationFrame(f); }; f(); })`); return; } catch { await again; } finally { off(); }
      }
    };
    const loaded = `document.querySelector("#nav li") && !/^\\s*Loading/.test(document.querySelector("#view").textContent) && document.querySelector("#view").textContent.trim()`;
    await cdp.send("Page.navigate", { url: url + hash }, sessionId);
    await when(loaded);
    return {
      errors, ev, when,
      go: async (h) => { await ev(`new Promise((ok) => { if (location.hash === ${JSON.stringify(h)}) return ok(); addEventListener("hashchange", () => ok(), { once: true }); location.hash = ${JSON.stringify(h)}; })`); await when(loaded); },
      width: async (px) => { await cdp.send("Emulation.setDeviceMetricsOverride", { width: px, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId); },
      shot: async (path) => {
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, Buffer.from(data, "base64"));
      },
      key: async (name) => {
        const k = name === "Tab" ? { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 } : { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" };
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...k }, sessionId);
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...k }, sessionId);
      },
      reload: async () => { const [done, off] = load(); await cdp.send("Page.reload", {}, sessionId); await done; off(); await when(loaded); },
    };
  };
  return { url, open, stop: () => { chrome.kill("SIGKILL"); server.kill(); rmSync(base, { recursive: true, force: true }); } };
}
