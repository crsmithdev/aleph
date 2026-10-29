/**
 * Standing permissions: for each reason the factory asks Chris, the action it may take
 * without asking. `standing.json` in the factory dir maps a reason to `{ action, at }`.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { factoryDir, factoryLog } from "./factory.ts";

export interface Reason { actions: string[]; always: string }
export interface Granted { action: string; at: string }

const proposal: Reason = { actions: ["approve", "decline"], always: "approve" };

/** Every reason the factory asks Chris, the actions it understands, and the one the Always button takes. */
export const REASONS: Record<string, Reason> = {
  "held": { actions: ["land", "drop"], always: "firefighter" },
  "review": { actions: ["land", "drop"], always: "firefighter" },
  "question": { actions: ["drop", "drop"], always: "firefighter" },
  "no-commit": { actions: ["rerun", "close"], always: "firefighter" },
  "triage-no-verdict": { actions: ["retry", "close"], always: "retry" },
  "acceptance-failed": { actions: ["rerun", "close"], always: "firefighter" },
  "decision": { actions: ["decide", "deny"], always: "recommended" },
  "rescue": { actions: ["decide", "drop"], always: "recommended" },
  "proposal-check": proposal,
  "proposal-claude-md": proposal,
  "proposal-skill": proposal,
  "firefighter": { actions: ["land", "drop"], always: "land" },
};

const file = () => join(factoryDir(), "standing.json");

/** A missing or bad file is empty. */
export function readStanding(): Record<string, Granted> {
  try {
    const s = JSON.parse(readFileSync(file(), "utf8"));
    if (s && typeof s === "object" && !Array.isArray(s)) return s;
  } catch {}
  return {};
}

function write(s: Record<string, Granted>): void {
  mkdirSync(factoryDir(), { recursive: true });
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n");
  renameSync(tmp, file());
}

/** The standing permission for `reason`, or null. */
export const standing = (reason: string): Granted | null => readStanding()[reason] ?? null;

/** Let the factory take `action` for `reason` without asking. Returns why it could not, or null. */
export function grant(reason: string, action: string): string | null {
  const r = REASONS[reason];
  if (!r) return `unknown reason ${reason}; known: ${Object.keys(REASONS).join(", ")}`;
  if (!r.actions.includes(action) && action !== r.always) return `${reason} has no action ${action}; actions: ${[...new Set([...r.actions, r.always])].join(", ")}`;
  write({ ...readStanding(), [reason]: { action, at: new Date().toISOString() } });
  return null;
}

export function revoke(reason: string): void {
  const s = readStanding();
  if (!(reason in s)) return;
  delete s[reason];
  write(s);
}

/** Whether Chris handed `reason` to the firefighter. */
export const handed = (reason: string): boolean => standing(reason)?.action === "firefighter";

export const logStanding = (reason: string, action: string, ref: string): void => factoryLog(`standing: ${reason}: ${action} on ${ref}`);
