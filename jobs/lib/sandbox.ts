/**
 * Sandboxed steps of a factory run, under `srt` (Anthropic's sandbox-runtime).
 * Each run has a folder in ~/.aleph/runs/<id>/ with an empty home, a work
 * folder and the bundles; each step is one `srt` call with its own profile.
 * See "Sandbox" in docs/specs/2026-10-26-seed-factory.md.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expand } from "./ledger.ts";

export const runsDir = () => expand(process.env.ALEPH_RUNS_DIR ?? "~/.aleph/runs");
const SRT = () => expand(process.env.ALEPH_SRT ?? "~/.aleph/tools/bin/srt");
const TOKEN = () => expand(process.env.ALEPH_WORKER_TOKEN ?? "~/.aleph/secrets/worker-token");

/** The worker's token, or empty when the file is missing. Never printed. */
export const workerToken = (): string => existsSync(TOKEN()) ? readFileSync(TOKEN(), "utf8").trim() : "";

/** Resolve a command on the dispatcher's PATH to its real file, or null. */
function resolveBin(name: string): string | null {
  const p = Bun.which(name);
  return p ? realpathSync(p) : null;
}

/**
 * A new run folder: home/ with Claude Code settings (auto memory off, no
 * plugins) and a git identity, work/, tmp/, sock/ for srt's own sockets, out/
 * for the bundle the worker hands back, check/ and checklog/ for the checks,
 * and bin/ with links to claude, bun and bunx.
 */
export function makeRunFolder(id: string): string {
  const dir = join(runsDir(), id);
  rmSync(dir, { recursive: true, force: true });
  for (const d of ["home/.claude", "work", "tmp", "sock", "out", "check", "checklog", "bin"]) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, "home/.claude/settings.json"), JSON.stringify({ autoMemoryEnabled: false, enabledPlugins: {} }, null, 2) + "\n");
  writeFileSync(join(dir, "home/.gitconfig"), "[user]\n\tname = aleph factory\n\temail = factory@aleph.invalid\n[init]\n\tdefaultBranch = main\n");
  for (const name of ["claude", "bun"]) {
    const real = resolveBin(name);
    if (real) symlinkSync(real, join(dir, "bin", name));
  }
  // bun runs as bunx when it is started by that name.
  if (existsSync(join(dir, "bin", "bun"))) symlinkSync(realpathSync(join(dir, "bin", "bun")), join(dir, "bin", "bunx"));
  return dir;
}

export const removeRunFolder = (dir: string) => rmSync(dir, { recursive: true, force: true });

/**
 * The profile for one step: reads denied on /home and the other private
 * places, apart from the bundles, the pinned binaries and srt's own helper;
 * writes only where the step needs them. The network reaches the Anthropic
 * API and npm, and nothing else.
 */
export function profile(dir: string, o: { read: string[]; write: string[] }): string {
  const vendor = join(expand("~/.aleph/tools/lib/node_modules/@anthropic-ai/sandbox-runtime"), "vendor");
  const bins = ["claude", "bun"].map((b) => { try { return realpathSync(join(dir, "bin", b)); } catch { return null; } }).filter(Boolean) as string[];
  const settings = {
    network: { allowedDomains: ["api.anthropic.com", "registry.npmjs.org"], allowLocalBinding: false, deniedDomains: [] },
    filesystem: {
      denyRead: ["/home", "/root", "/mnt", "/run", "/var/run", "/srv", "/tmp"],
      allowRead: [...bins, vendor, join(dir, "bin"), join(dir, "sock"), ...o.read.map((p) => join(dir, p))],
      allowWrite: o.write.map((p) => join(dir, p)),
      denyWrite: [],
    },
  };
  const file = join(dir, `srt-${o.write.join("-").replaceAll("/", "") || "ro"}.json`);
  writeFileSync(file, JSON.stringify(settings, null, 1));
  return file;
}

export interface Step { code: number; timedOut: boolean; stalled: boolean }

/**
 * Run `script` with bash under srt, in `dir/<cwd>`. The environment is built
 * here from nothing: none of Chris's variables reach the sandbox. stdout and stderr go to the named files. With
 * ALEPH_SANDBOX_CMD set (the tests), that command replaces srt and its
 * profile: it tests the flow, not the isolation.
 */
export async function sandboxed(dir: string, script: string, o: {
  read: string[]; write: string[]; cwd: string; env?: Record<string, string>; stdout: string; stderr: string; limit?: number; stall?: number; stdin?: string;
  onSpawn?: (p: ReturnType<typeof Bun.spawn>) => void;
}): Promise<Step> {
  const inner: Record<string, string> = {
    HOME: join(dir, "home"), CLAUDE_CONFIG_DIR: join(dir, "home/.claude"), TMPDIR: join(dir, "tmp"),
    PATH: `${join(dir, "bin")}:/usr/local/bin:/usr/bin:/bin`, LANG: "C.UTF-8",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1", ...o.env,
  };
  const pass = process.env.ALEPH_SANDBOX_CMD;
  // srt adds the proxy variables the sandbox needs to the environment it gets, so the
  // clean environment is set on srt itself: an `env -i` inside would drop the proxy.
  // srt is a node script, run by node's real path, and keeps its own sockets in sock/.
  const argv = pass
    ? [pass, "-i", ...Object.entries(inner).map(([k, v]) => `${k}=${v}`), "bash", "-c", script]
    : [resolveBin("node") ?? "node", realpathSync(SRT()), "--settings", profile(dir, o), "--", "env", `TMPDIR=${inner.TMPDIR}`, "bash", "-c", script];
  const cmd = o.limit ? ["timeout", "--kill-after=30", String(o.limit), ...argv] : argv;
  const env = pass ? process.env : { ...inner, TMPDIR: join(dir, "sock") };
  const out = openSync(o.stdout, "a");
  const err = o.stderr === o.stdout ? out : openSync(o.stderr, "a");
  const start = performance.now();
  const p = Bun.spawn(cmd, { cwd: join(dir, o.cwd), env, stdin: o.stdin === undefined ? "ignore" : new Blob([o.stdin]), stdout: out, stderr: err });
  o.onSpawn?.(p);
  // Stall watch: when stdout has not grown for `stall` seconds, stop the step the way the time box does.
  let stalled = false;
  let size = statSync(o.stdout).size;
  let last = performance.now();
  const watch = o.stall ? setInterval(() => {
    const now = statSync(o.stdout).size;
    if (now !== size) { size = now; last = performance.now(); return; }
    if (performance.now() - last < o.stall! * 1000) return;
    stalled = true;
    clearInterval(watch);
    p.kill("SIGTERM");
    setTimeout(() => p.kill("SIGKILL"), 30_000).unref();
  }, Math.min(1000, o.stall * 250)) : undefined;
  const code = await p.exited;
  clearInterval(watch);
  closeSync(out);
  if (err !== out) closeSync(err);
  return { code, timedOut: !stalled && o.limit !== undefined && performance.now() - start >= o.limit * 1000, stalled };
}
