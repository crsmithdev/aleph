/**
 * Always rules: for each reason the factory asks Chris, the action it may take
 * without asking. `always.json` in the factory dir maps a reason to `{ action, at }`.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { factoryDir, factoryLog } from "./factory.ts";

export interface Reason { actions: string[]; always: string }
export interface Granted { action: string; at: string }

const proposal: Reason = { actions: ["approve", "decline"], always: "approve" };

/**
 * Every reason the factory asks Chris, the actions it understands, and the one the Always button takes.
 * The first group is the spec's Ask reasons (approval: review, held-path, proposal; input: question, manual,
 * no-commit, part-dropped, triage-failed, host-check, rescue). The second group is kept as it was, because the spec
 * names no new home for it: run-cap, acceptance-failed, firefighter and the `proposal-<kind>:<place>` keys.
 */
export const ASK_REASONS: Record<string, Reason> = {
  "held-path": { actions: ["land", "drop"], always: "firefighter" },
  "review": { actions: ["land", "drop"], always: "firefighter" },
  // An empty `always`: the factory has no rule that acts on these, so the card offers no auto-yes.
  "proposal": { actions: ["start", "deny"], always: "start" },
  // Was `decision` (decide, deny; recommended) and `question` (answer, drop; firefighter): one reason now, so it lists both.
  "question": { actions: ["answer", "drop", "decide", "deny", "firefighter"], always: "recommended" },
  "manual": { actions: ["checked", "deny"], always: "" },
  "no-commit": { actions: ["rerun", "close"], always: "firefighter" },
  "part-dropped": { actions: ["rerun", "close"], always: "" },
  "triage-failed": { actions: ["retry", "close"], always: "retry" },
  "host-check": { actions: ["checked", "deny"], always: "" },
  "rescue": { actions: ["decide", "drop"], always: "recommended" },
  // Not Ask reasons of the spec; no new home is named for them.
  "run-cap": { actions: ["rerun", "close"], always: "firefighter" },
  "acceptance-failed": { actions: ["rerun", "close"], always: "firefighter" },
  "firefighter": { actions: ["land", "drop"], always: "land" },
  "proposal-check": proposal,
  "proposal-claude-md": proposal,
  "proposal-skill": proposal,
};

const file = () => join(factoryDir(), "always.json");
const legacyFile = () => join(factoryDir(), "standing.json");
/** The reasons standing.json used, as always.json names them. */
const RENAMED: Record<string, string> = { "held": "held-path", "triage-no-verdict": "triage-failed", "decision": "question" };

function readJson(f: string): Record<string, Granted> | null {
  try {
    const s = JSON.parse(readFileSync(f, "utf8"));
    if (s && typeof s === "object" && !Array.isArray(s)) return s;
  } catch {}
  return null;
}

/** always.json; when it is missing, standing.json under the new reason names (a legacy reader for step 6 to remove). A bad file is empty. */
export function readAlways(): Record<string, Granted> {
  const a = readJson(file());
  if (a) return a;
  if (existsSync(file())) return {};
  const old = readJson(legacyFile()) ?? {};
  return Object.fromEntries(Object.entries(old).map(([k, v]) => [RENAMED[k] ?? k, v]));
}

function write(s: Record<string, Granted>): void {
  mkdirSync(factoryDir(), { recursive: true });
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n");
  renameSync(tmp, file());
}

/** The Always rule for `reason`, or null. */
export const always = (reason: string): Granted | null => readAlways()[reason] ?? null;

/** Let the factory take `action` for `reason` without asking. Returns why it could not, or null. */
export function grant(reason: string, action: string): string | null {
  const r = ASK_REASONS[reason.startsWith("proposal-") ? reason.replace(/:[^:]*$/, "") : reason];
  if (!r) return `unknown reason ${reason}; known: ${Object.keys(ASK_REASONS).join(", ")}`;
  if (!r.actions.includes(action) && action !== r.always) return `${reason} has no action ${action}; actions: ${[...new Set([...r.actions, r.always])].join(", ")}`;
  write({ ...readAlways(), [reason]: { action, at: new Date().toISOString() } });
  return null;
}

export function revoke(reason: string): void {
  const s = readAlways();
  if (!(reason in s)) return;
  delete s[reason];
  write(s);
}

/** Whether Chris handed `reason` to the firefighter. */
export const handed = (reason: string): boolean => always(reason)?.action === "firefighter";

export const logAlways = (reason: string, action: string, ref: string): void => factoryLog(`always: ${reason}: ${action} on ${ref}`);
