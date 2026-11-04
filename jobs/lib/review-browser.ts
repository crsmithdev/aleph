/**
 * Chrome for the harness, outside the sandbox. (Inside it, Chrome runs only in a step whose profile allows
 * Unix sockets: see `sockets` in sandbox.ts.) The harness runs /usr/bin/google-chrome --headless over --remote-debugging-pipe (no
 * debugging port), with a profile of its own. shot.ts takes the workers' screenshots with it.
 *
 * Chrome keeps its own sandbox: there is no --no-sandbox fallback.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { closeSync, openSync, readFileSync } from "node:fs";

const FIRST_PORT = 3002;
const chrome = () => process.env.ALEPH_REVIEW_CHROME ?? "/usr/bin/google-chrome";

/** The argv that runs Chrome headless on a pipe, with a profile of the harness's own. */
export function chromeArgv(profileDir: string): string[] {
  return [chrome(), "--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profileDir}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync", "--disable-background-networking",
    "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--no-proxy-server", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1", "about:blank"];
}

/** Spawn Chrome on a pipe with `profileDir` as its profile and HOME, its output appended to `log`. */
export function startChrome(profileDir: string, log: string): ReturnType<typeof spawn> {
  const fd = openSync(log, "a");
  const argv = chromeArgv(profileDir);
  try {
    return spawn(argv[0], argv.slice(1), {
      stdio: ["ignore", fd, fd, "pipe", "pipe"],
      env: { HOME: profileDir, TMPDIR: profileDir, PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" },
    });
  } finally { closeSync(fd); }
}

/** The first port at or above FIRST_PORT that 127.0.0.1 can bind. */
export async function freePort(from = FIRST_PORT): Promise<number> {
  for (let port = from; port < from + 200; port++) {
    const ok = await new Promise<boolean>((done) => {
      const s = createServer();
      s.once("error", () => done(false));
      s.listen(port, "127.0.0.1", () => s.close(() => done(true)));
    });
    if (ok) return port;
  }
  throw new Error(`no free port from ${from}`);
}

/** A CDP connection over Chrome's pipe: commands on fd 3, answers and events on fd 4, each message ended by a NUL. */
export class Pipe {
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

export const tail = (file: string, n = 20) => { try { return readFileSync(file, "utf8").trimEnd().split("\n").slice(-n).join("\n"); } catch { return ""; } };
