/**
 * Which backend serves each model slot. The map lives in models.json in the factory folder;
 * a missing file or slot means "claude". The local backend is one fixed entry.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { layout } from "./layout.ts";

export const SLOTS = ["worker.haiku", "worker.sonnet", "merge", "title", "judge"] as const;
export const BACKENDS = ["claude", "local"] as const;
export type Slot = (typeof SLOTS)[number];
export type Backend = (typeof BACKENDS)[number];

/** The llama-server of aleph-1282. */
export const LOCAL = { baseUrl: "http://127.0.0.1:8012", model: "gpt-oss-20b" };

const file = (): string => join(layout().factory, "models.json");

function stored(): Partial<Record<Slot, Backend>> {
  try { return JSON.parse(readFileSync(file(), "utf8")); } catch { return {}; }
}

/** Every slot with its backend. */
export function readModels(): Record<Slot, Backend> {
  const m = stored();
  return Object.fromEntries(SLOTS.map((s) => [s, m[s] === "local" ? "local" : "claude"])) as Record<Slot, Backend>;
}

/** Writes one slot; returns an error text for a bad slot or backend, else null. */
export function setModel(slot: string, backend: string): string | null {
  if (!(SLOTS as readonly string[]).includes(slot)) return `unknown slot "${slot}"; slots: ${SLOTS.join(", ")}`;
  if (!(BACKENDS as readonly string[]).includes(backend)) return `unknown backend "${backend}"; backends: ${BACKENDS.join(", ")}`;
  mkdirSync(layout().factory, { recursive: true });
  writeFileSync(file(), JSON.stringify({ ...readModels(), [slot]: backend }, null, 2) + "\n");
  return null;
}

/** The env a local slot's claude call adds: the local base URL and a dummy token. */
export const LOCAL_ENV = {
  ANTHROPIC_BASE_URL: LOCAL.baseUrl,
  ANTHROPIC_AUTH_TOKEN: "local",
  // Equal to --ctx-size in jobs/lib/gpt-oss-start.ts. Claude Code compacts at window - min(max output, 20k) - 13k = 23,864.
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: "40960",
  CLAUDE_CODE_MAX_OUTPUT_TOKENS: "4096",
};
