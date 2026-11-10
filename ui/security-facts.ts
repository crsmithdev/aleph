/**
 * Prints the held paths (gate.ts SECURITY_PATHS) as JSON, for /api/automation. It runs as its own process: the UI server
 * imports no security path (jobs/lib/infra/ui-graph.test.ts), so a change to them shows on the next request with no restart.
 */
import { SECURITY_PATHS } from "../jobs/lib/gates/gate.ts";

if (import.meta.main) console.log(JSON.stringify({ held: SECURITY_PATHS }));
