/**
 * Real Chrome against a one-off UI server on the review fixture, for the tests of the shell and of mount code that
 * only a DOM can run. The sandbox of Chrome is off: it loads only this fixture, and CI runners refuse it.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromeArgv, Pipe } from "../jobs/lib/review-browser.ts";

const CHROME = "/usr/bin/google-chrome";

/** A sandboxed run (srt) has no working Chrome. CI must have one: there a missing Chrome fails, and does not skip. */
export const chromeUsable = process.env.CI === "true" || (existsSync(CHROME) && Bun.spawnSync([CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--dump-dom", "about:blank"], { stdout: "ignore", stderr: "ignore", timeout: 20_000, env: { ...process.env, HOME: tmpdir() } }).exitCode === 0);

export interface Page {
  errors: string[];
  ev<T = any>(expression: string): Promise<T>;
  /** Waits until the expression is true, and says which one was not. */
  until(expression: string, ms?: number): Promise<void>;
  /** Goes to a hash in the page already open, the way a link does. */
  go(hash: string): Promise<void>;
  reload(): Promise<void>;
  /** Sets the viewport width, in CSS pixels. */
  width(px: number): Promise<void>;
}

export interface Rig { url: string; open(hash?: string): Promise<Page>; stop(): void }

export async function startRig(): Promise<Rig> {
  const base = mkdtempSync(join(tmpdir(), "aleph-ui-browser-"));
  const build = Bun.spawnSync([process.execPath, join(import.meta.dir, "fixtures", "review", "build.ts"), join(base, "home")], { stdout: "pipe", stderr: "pipe" });
  if (build.exitCode !== 0) throw new Error(build.stderr.toString());
  const env: Record<string, string> = { ...process.env as Record<string, string>, LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", HOME: join(base, "empty") };
  for (const l of build.stdout.toString().trim().split("\n")) env[l.slice(0, l.indexOf("="))] = l.slice(l.indexOf("=") + 1);
  const server = Bun.spawn([process.execPath, join(import.meta.dir, "server.ts"), "--port", "0"], { env, stdout: "pipe", stderr: "ignore" });
  const line = new TextDecoder().decode((await (server.stdout as ReadableStream<Uint8Array>).getReader().read()).value);
  const url = line.trim();

  const profile = join(base, "profile");
  mkdirSync(profile);
  process.env.ALEPH_REVIEW_CHROME = CHROME;
  const argv = chromeArgv(profile);
  const chrome = spawn(argv[0]!, ["--no-sandbox", ...argv.slice(1)], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], env: { HOME: profile, TMPDIR: profile, PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" } });
  const cdp = new Pipe(chrome.stdio[3] as NodeJS.WritableStream, chrome.stdio[4] as NodeJS.ReadableStream);
  await cdp.send("Browser.getVersion");

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
    const until = async (expression: string, ms = 20_000) => {
      const end = Date.now() + ms;
      for (;;) {
        // A reload destroys the context under an evaluate: that is not yet true, not a failure.
        if (await ev(`!!(${expression})`).catch(() => false)) return;
        if (Date.now() > end) throw new Error(`not true after ${ms} ms: ${expression}\nat ${await ev("location.href").catch(() => "?")}\n${await ev('document.querySelector("#view")?.innerText.slice(0, 400)').catch(() => "?")}`);
        await Bun.sleep(25);
      }
    };
    const loaded = `document.querySelector("#nav li") && !/^\\s*Loading/.test(document.querySelector("#view").textContent) && document.querySelector("#view").textContent.trim()`;
    await cdp.send("Page.navigate", { url: url + hash }, sessionId);
    await until(loaded);
    return {
      errors, ev, until,
      go: async (h) => { await ev(`void (location.hash = ${JSON.stringify(h)})`); await Bun.sleep(0); await until(loaded); },
      width: async (px) => { await cdp.send("Emulation.setDeviceMetricsOverride", { width: px, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId); },
      reload: async () => { await cdp.send("Page.reload", {}, sessionId); await Bun.sleep(50); await until(loaded); },
    };
  };
  return { url, open, stop: () => { chrome.kill("SIGKILL"); server.kill(); rmSync(base, { recursive: true, force: true }); } };
}
