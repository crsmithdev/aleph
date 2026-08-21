/**
 * Boots the ACTUAL daemon entrypoint as a subprocess and talks to it over its
 * real Unix socket. No test imports daemon.ts and calls internals to simulate a
 * boot — "it compiles" and "the unit passed" are not evidence that it runs.
 */
import { existsSync } from "node:fs";
import { cliRequest } from "../../src/channels/cli/index.ts";

export interface RunningDaemon {
  proc: Bun.Subprocess;
  socket: string;
  call(op: string, args?: Record<string, unknown>, extra?: Record<string, unknown>): Promise<any>;
  send(text: string, topic?: string): Promise<string>;
  stop(signal?: NodeJS.Signals): Promise<number>;
  stdout(): Promise<string>;
}

export async function startDaemon(configFile: string, socket: string, env: Record<string, string> = {}): Promise<RunningDaemon> {
  const proc = Bun.spawn(["bun", "src/daemon.ts"], {
    env: { ...process.env, ALEPH_CONFIG: configFile, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (existsSync(socket)) {
      try { await cliRequest(socket, { op: "status" }, 5000); break; } catch { /* not up yet */ }
    }
    if (proc.exitCode !== null) {
      throw new Error(`daemon exited early (${proc.exitCode}): ${await new Response(proc.stderr as ReadableStream).text()}`);
    }
    await Bun.sleep(50);
  }

  return {
    proc,
    socket,
    call: (op, args = {}, extra = {}) => cliRequest(socket, { op, args, ...extra }, 120_000) as Promise<any>,
    async send(text, topic) {
      const r = (await cliRequest(socket, { op: "send", text, topic }, 300_000)) as { text: string };
      return r.text;
    },
    async stop(signal = "SIGTERM") {
      proc.kill(signal);
      return await proc.exited;
    },
    stdout: () => new Response(proc.stdout as ReadableStream).text(),
  };
}
