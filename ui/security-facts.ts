/**
 * Prints the held paths (gate.ts SECURITY_PATHS) as JSON, for /api/gates. It runs as its own process: the UI server
 * imports no security path (jobs/lib/ui-graph.test.ts), so a change to them shows on the next request with no restart.
 */
import { SECURITY_PATHS } from "../jobs/lib/gate.ts";

if (import.meta.main) console.log(JSON.stringify({ held: SECURITY_PATHS }));
