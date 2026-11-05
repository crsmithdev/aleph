/**
 * Start of aleph-gpt-oss.service: choose --n-cpu-moe from the free VRAM,
 * then run llama-server. See docs/findings/2026-11-04-gpt-oss-20b-llama-server.md.
 */
import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";

export const LAYERS = 24;
export const FALLBACK = 12;
/** GPU share of llama-server with every expert layer on the CPU, KV cache and compute buffers included. */
export const BASE_MIB = 3750;
/** GPU share that one expert layer adds. */
export const LAYER_MIB = 400;
/** Free VRAM that must stay free after the load. */
export const HEADROOM_MIB = 1536;

/** The smallest --n-cpu-moe whose GPU share and headroom fit in `freeMiB`. */
export function chooseNCpuMoe(freeMiB: number): number {
  const layersOnGpu = Math.floor((freeMiB - HEADROOM_MIB - BASE_MIB) / LAYER_MIB);
  if (!Number.isFinite(layersOnGpu)) return FALLBACK;
  return LAYERS - Math.min(LAYERS, Math.max(0, layersOnGpu));
}

/** Free MiB from `nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits`, or null when unparsable. */
export function parseFreeMiB(out: string): number | null {
  const text = out.trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

export function readFreeMiB(): number | null {
  try {
    const out = execFileSync("nvidia-smi", ["--query-gpu=memory.free", "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 10_000 });
    return parseFreeMiB(out);
  } catch {
    return null;
  }
}

export function serverArgs(home: string, freeMiB: number | null): string[] {
  const llama = `${home}/.local/src/llama.cpp`;
  const nCpuMoe = freeMiB === null ? FALLBACK : chooseNCpuMoe(freeMiB);
  return [
    "--model", `${home}/.local/share/gpt-oss-20b.gguf`, "--alias", "gpt-oss-20b",
    "--host", "127.0.0.1", "--port", "8012", "--jinja",
    "--chat-template-file", `${llama}/models/templates/openai-gpt-oss-120b.jinja`,
    "--ctx-size", "40960", "--n-gpu-layers", "99", "--n-cpu-moe", String(nCpuMoe),
    "--reasoning-budget", "0", "--threads", "6",
  ];
}

if (import.meta.main) {
  const home = homedir();
  const free = readFreeMiB();
  const args = serverArgs(home, free);
  console.log(`free VRAM ${free ?? "unknown"} MiB, --n-cpu-moe ${args[args.indexOf("--n-cpu-moe") + 1]}`);
  const child = spawn(`${home}/.local/src/llama.cpp/build/bin/llama-server`, args, { stdio: "inherit" });
  /** llama-server stays in "cleaning up before exit" after a stop signal, so SIGKILL it after this long. */
  const KILL_AFTER_MS = 5000;
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => {
    child.kill(sig);
    setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_MS).unref();
  });
  child.on("exit", (code, sig) => process.exit(code ?? (sig ? 1 : 0)));
}
