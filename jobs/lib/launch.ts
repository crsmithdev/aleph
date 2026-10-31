/**
 * The launcher: every place that starts `aleph <verb>` as a process of its
 * own goes through here. A run's unit and a held run's review get a transient
 * systemd unit (or, with `ALEPH_JOB_FOREGROUND=1`, a plain child); a dispatch
 * or triage after a transition is a detached process; the UI runs a verb and
 * reads its output. The transitions themselves run in-process: see transitions.ts.
 */
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { LOW } from "./ledger.ts";
import { runPath } from "./sandbox.ts";

/** jobs/cli.ts, the `aleph` command. */
export const CLI = join(import.meta.dir, "..", "cli.ts");

/** The argv that runs the CLI: `$ALEPH_CLI` when set (the UI tests' fake), else bun on jobs/cli.ts. */
export const cliArgv = (): string[] => (process.env.ALEPH_CLI ? [process.env.ALEPH_CLI] : [process.execPath, CLI]);

/** Units run in the foreground, as children: the tests, which have no systemd. */
export const foreground = (): boolean => process.env.ALEPH_JOB_FOREGROUND === "1";

/** The environment a unit gets: every `ALEPH_*` and `SIDETONE_*` variable, as `--setenv` flags. */
export function passEnv(env: Record<string, string | undefined> = process.env): string[] {
  return Object.entries(env).filter(([k]) => k.startsWith("ALEPH_") || k.startsWith("SIDETONE_")).map(([k, v]) => `--setenv=${k}=${v}`);
}

/** Where a started process writes its output: inherited, nowhere, or appended to a file. */
export type Output = "inherit" | "ignore" | { file: string };

function open(o: Output): { fd: "inherit" | "ignore" | number; close: () => void } {
  if (typeof o === "string") return { fd: o, close: () => {} };
  mkdirSync(dirname(o.file), { recursive: true });
  const fd = openSync(o.file, "a");
  return { fd, close: () => closeSync(fd) };
}

export interface UnitOpts {
  /** The systemd unit's name. */
  unit: string;
  cwd: string;
  /** More `--property=` flags for systemd-run. */
  props?: string[];
  /** In the foreground: where the child writes. Under systemd the output goes to the journal unless `props` say otherwise. */
  output?: Output;
  /** In the foreground: the caller waits on the child, so it is not detached. */
  attach?: boolean;
}

/**
 * Start `aleph <args>` in a transient systemd unit of its own, so it outlives the caller's cgroup.
 * In the foreground it is a child: attached (returned, for the caller to wait on) or detached.
 * Throws when systemd-run fails.
 */
export function startUnit(args: string[], o: UnitOpts): ReturnType<typeof Bun.spawn> | undefined {
  if (foreground()) {
    const out = open(o.output ?? (o.attach ? "inherit" : "ignore"));
    try {
      const child = Bun.spawn([process.execPath, CLI, ...args], { cwd: o.cwd, env: process.env, stdin: "ignore", stdout: out.fd, stderr: out.fd, detached: !o.attach });
      if (!o.attach) { child.unref(); return undefined; }
      return child;
    } finally {
      out.close();
    }
  }
  const p = Bun.spawnSync(["systemd-run", "--user", "--collect", "--quiet", ...LOW, `--unit=${o.unit}`, `--working-directory=${o.cwd}`, ...(o.props ?? []),
    `--setenv=PATH=${runPath()}`, ...passEnv(), process.execPath, CLI, ...args], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`systemd-run failed: ${p.stderr.toString().trim()}`);
  return undefined;
}

/** Start `aleph <args>` detached, its output appended to `log`; the caller never waits and never sees it fail. */
export function detached(args: string[], log: string): void {
  try {
    const out = open({ file: log });
    try {
      Bun.spawn([process.execPath, CLI, ...args], { env: process.env, stdin: "ignore", stdout: out.fd, stderr: out.fd, detached: true }).unref();
    } finally {
      out.close();
    }
  } catch {}
}

/** Run `aleph <args>` and wait for it, its output appended to `log`. Returns its exit code. */
export async function runLogged(args: string[], log: string): Promise<number | null> {
  try {
    const out = open({ file: log });
    try {
      return await Bun.spawn([process.execPath, CLI, ...args], { env: process.env, stdin: "ignore", stdout: out.fd, stderr: out.fd }).exited;
    } finally {
      out.close();
    }
  } catch {
    return null;
  }
}

/** Run `aleph <args>` (`$ALEPH_CLI` when set) and read what it says: for the UI, whose actions are the CLI's commands. */
export async function runCli(args: string[], o: { stdin?: string } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = Bun.spawn([...cliArgv(), ...args], { stdin: o.stdin === undefined ? "ignore" : new Blob([o.stdin]), stdout: "pipe", stderr: "pipe", env: process.env });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, stdout, stderr };
}
