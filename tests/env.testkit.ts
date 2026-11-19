import { afterAll, beforeAll } from "bun:test";

/**
 * Puts process.env back after a file's tests as it was before its hooks ran, so a variable that a setup hook sets
 * does not reach the next file in the process. Call it before the file's other hooks.
 */
export function keepEnv(): void {
  let saved: Record<string, string | undefined> = {};
  beforeAll(() => { saved = { ...process.env }; });
  afterAll(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });
}
