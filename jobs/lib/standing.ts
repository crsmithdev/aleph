/**
 * Shim until step 5 (the UI): the old names of always.ts. `REASONS` keeps the old reason keys the UI reads.
 */
import { readAlways, type Granted, type Reason } from "./always.ts";

export type { Granted } from "./always.ts";
/** The old reason names of the ones always.json renamed (`decision` became `question` with no old name of its own to go back to). */
export const OLD_REASON: Record<string, string> = { "held": "held-path", "triage-no-verdict": "triage-failed", "decision": "question" };
const NEW_TO_OLD: Record<string, string> = { "held-path": "held", "triage-failed": "triage-no-verdict" };
/** The Always rules under the old reason names, as the UI reads them. */
export const readStanding = (): Record<string, Granted> => Object.fromEntries(Object.entries(readAlways()).map(([k, v]) => [NEW_TO_OLD[k] ?? k, v]));

const proposal: Reason = { actions: ["approve", "decline"], always: "approve" };
export const REASONS: Record<string, Reason> = {
  "held": { actions: ["land", "drop"], always: "firefighter" },
  "review": { actions: ["land", "drop"], always: "firefighter" },
  "question": { actions: ["answer", "drop"], always: "firefighter" },
  "no-commit": { actions: ["rerun", "close"], always: "firefighter" },
  "run-cap": { actions: ["rerun", "close"], always: "firefighter" },
  "triage-no-verdict": { actions: ["retry", "close"], always: "retry" },
  "acceptance-failed": { actions: ["rerun", "close"], always: "firefighter" },
  "decision": { actions: ["decide", "deny"], always: "recommended" },
  "rescue": { actions: ["decide", "drop"], always: "recommended" },
  "proposal": { actions: ["start", "deny"], always: "start" },
  "host-check": { actions: ["checked", "deny"], always: "" },
  "proposal-check": proposal,
  "proposal-claude-md": proposal,
  "proposal-skill": proposal,
  "firefighter": { actions: ["land", "drop"], always: "land" },
};
