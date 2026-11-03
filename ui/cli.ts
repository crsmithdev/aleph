import { join } from "node:path";
import { cliOverride } from "../jobs/lib/settings.ts";

/** The argv that runs the CLI: `$ALEPH_CLI` when set (the UI tests' fake), else bun on jobs/cli.ts. */
export const cliArgv = (): string[] => (cliOverride() ? [cliOverride()!] : [process.execPath, join(import.meta.dir, "..", "jobs", "cli.ts")]);

/** Run `aleph <args>` (`$ALEPH_CLI` when set) and read what it says: the UI's actions are the CLI's commands, in a process of their own. */
export async function runCli(args: string[], o: { stdin?: string } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = Bun.spawn([...cliArgv(), ...args], { stdin: o.stdin === undefined ? "ignore" : new Blob([o.stdin]), stdout: "pipe", stderr: "pipe", env: process.env });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, stdout, stderr };
}
