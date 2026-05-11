/**
 * Shared detection patterns for e2e verification, artifacts, and unit tests.
 *
 * Single source of truth — used by:
 *   - quality-stop-check-e2e.ts (stop hook)
 *   - runner.ts (eval harness)
 *   - e2e tests (signal assertions)
 */

/** CLI execution, Playwright/Cypress, browser automation */
export const E2E_CMD = /playwright|cypress|puppeteer|agent-browser|(?:bun|npm|npx|yarn|pnpm)\s+(?:run\s+)?(?:e2e|integration|playwright)|(?:bun|npm|npx)\s+(?:run\s+)?dev\b|next\s+dev|vite\s+dev|(?:bun|node)\s+.*server/i;

/** Screenshot or saved output */
export const ARTIFACT_CMD = /--screenshot|screenshot|\.png|\.jpg|\.jpeg|> .*\.(txt|log|html|json)|tee\s/i;

/** Unit test runners — do NOT count as e2e */
export const UNIT_TEST_CMD = /^(?:bun test|npm test|npx jest|npx vitest|vitest|jest|pytest|cargo test|go test|dotnet test)(?:\s|$)/;

/** Direct functional verification — curl, wget, localhost hits */
export const FUNCTIONAL_CMD = /\bcurl\b|\bwget\b|\bhttpie\b|http:\/\/localhost|http:\/\/127\.\d/i;

/** Direct hook invocations — testing the hook script is NOT e2e */
export const HOOK_INVOCATION = /bun\s+src\/skills\/hooks\//;

/** git commit operations */
export const GIT_COMMIT_CMD = /git\s+commit\b/;
