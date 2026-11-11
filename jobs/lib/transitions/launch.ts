/**
 * The launcher: every place that starts `aleph <verb>` as a process of its
 * own goes through here. A run's unit and a held run's review get a transient
 * systemd unit (or, with `ALEPH_JOB_FOREGROUND=1`, a plain child); a dispatch
 * or intake after a transition is a unit of its own too. The transitions themselves run in-process: see transitions.ts.
 */
import { logEvent } from "../../../lib/layout.ts";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { home } from "../../../lib/paths.ts";
import { dirname, join } from "node:path";
import { factoryDir } from "../gates/factory-status.ts";
import { LOW, type Repo } from "../records/ledger.ts";
import { dispatchOn, jobForeground } from "../infra/settings.ts";

/** jobs/cli.ts, the `aleph` command. */
export const CLI = join(import.meta.dir, "..", "..", "cli.ts");

/** The caller's PATH with ~/.local/bin and the directory of this bun added at the end when missing. */
export function runPath(env: Record<string, string | undefined> = process.env): string {
  const parts = (env.PATH ?? "").split(":").filter(Boolean);
  for (const d of [join(home(), ".local", "bin"), dirname(process.execPath)]) if (!parts.includes(d)) parts.push(d);
  return parts.join(":");
}

/** Units run in the foreground, as children: the tests, which have no systemd. */
const foreground = (): boolean => jobForeground();

/** The environment a unit gets: every `ALEPH_*` and `SIDETONE_*` variable, as `--setenv` flags. */
function passEnv(env: Record<string, string | undefined> = process.env): string[] {
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
    `--setenv=PATH=${runPath()}`, ...passEnv(), process.execPath, CLI, ...args], { stdout: "pipe", stderr: "pipe", env: process.env });
  if (p.exitCode !== 0) throw new Error(`systemd-run failed: ${p.stderr.toString().trim()}`);
  return undefined;
}

/** Per-process count of detached launches: the unit name's own part, so two calls in one millisecond differ. */
let detachedCount = 0;

/** Start `aleph <args>` detached, its output appended to `log`; the caller never waits and never sees it fail. */
export function detached(args: string[], log: string): void {
  try {
    mkdirSync(dirname(log), { recursive: true });
    // Its own transient unit: the caller's cgroup (a run's unit, or aleph-ui) stops its whole cgroup when it ends.
    // systemd-run refuses a name in use, so each call gets a name of its own: the count, not just the clock, tells them apart.
    const unit = `aleph-${args.join("-")}-${Date.now()}-${process.pid}-${++detachedCount}`.replace(/[^A-Za-z0-9:_.-]/g, "-");
    startUnit(args, { unit, cwd: dirname(log), output: { file: log },
      props: [`--property=StandardOutput=append:${log}`, `--property=StandardError=append:${log}`] });
  } catch (e: any) { logEvent({ by: "rule", subject: "detached", action: "failed", sub: "error", note: String(e?.message ?? e) }); }
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

/**
 * Start `aleph dispatch` detached, for a transition that may free a slot, clear a hold or ready a
 * issue: the caller never waits for the baseline checks, and a failure never reaches it. Off when
 * `ALEPH_DISPATCH=off`; the tick's sweep still dispatches what it finds missed.
 */
export function dispatchDetached(): void {
  if (!dispatchOn()) return;
  detached(["dispatch"], join(factoryDir(), "dispatch.log"));
}

/** Start `aleph intake <repo>-<id>` detached, for a factory repo's issue; it never fails the caller. */
export function intakeDetached(repo: Repo, id: number): void {
  if (!dispatchOn() || !repo.sandbox) return;
  detached(["intake", `${repo.key}-${id}`], join(factoryDir(), "dispatch.log"));
}

/** Start `aleph director` detached, for a new Ask: the director decides it now, not at a tick. It never fails the caller. */
export function directorDetached(): void {
  if (!dispatchOn()) return;
  detached(["director"], join(factoryDir(), "dispatch.log"));
}

/** Start `aleph suite` detached, for a main that moved while its record is red. It never fails the caller. */
export function suiteDetached(): void {
  if (!dispatchOn()) return;
  detached(["suite"], join(factoryDir(), "dispatch.log"));
}

