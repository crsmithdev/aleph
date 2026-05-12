#!/usr/bin/env bun
/**
 * Child-process entry point — runs one loop to completion.
 *
 * Invoked by the API supervisor as:
 *   bun run.ts <db_path> <loop_id> [--processor-delay-ms=N] [--cycles-target=N]
 *
 * Contract:
 *  - Opens the shared SQLite DB (WAL mode tolerates concurrent API readers).
 *  - Subscribes to `onResearchEvent` and pipes each event to stdout as one JSON
 *    line. The supervisor parses these and re-emits via `emitResearchEvent` in
 *    the API process so SSE listeners + the research-logger see real-time
 *    activity from the child.
 *  - Calls `runLoop`. Exits 0 on terminal status, 1 on unhandled error.
 *  - Crash resume: a kill mid-cycle leaves partial ledger entries; the next
 *    spawn finds them via input-hash and skips re-doing the work.
 *
 * Stdout is reserved for JSON events. Diagnostics go to stderr.
 */
import { createDb } from '@construct/data';
import { applyResearchDDL } from '../ddl.js';
import { OpenRouterProvider } from '../providers/openrouter.js';
import { onResearchEvent, type ResearchEvent } from '../services/events.js';
import { getDefaults } from '../services/defaults.js';
import { bumpUsage, createArtifact, getLoop, readState, updateLoopStatus } from './db.js';
import { generateDocument } from './document.js';
import { runLoop } from './engine.js';
import type { LLMProvider } from './llm.js';
import type { Sqlite } from '@construct/data';
import { ensureScheduleArtifact } from './shape.js';
import { buildTemplate, type TemplateDeps, type TemplateOverrides } from './templates/registry.js';

/**
 * Wire production deps for the given template. Honours OPENROUTER_API_KEY +
 * OPENROUTER_BASE_URL (the latter is how integration tests redirect the
 * provider at a local fake server — see `src/ui/e2e/fake-llm-server.ts`).
 * Templates that don't need an LLM (noop) get an empty deps object.
 */
/**
 * Mark the loop `failed` so the supervisor stops respawning. Used when the
 * child can't even start (missing env, unknown template). The respawn loop
 * only continues if the loop status is non-terminal.
 */
function failLoop(sqlite: Sqlite, loop_id: string, reason: string): void {
  process.stderr.write(`run.ts failing loop ${loop_id}: ${reason}\n`);
  try { updateLoopStatus(sqlite, loop_id, 'failed'); }
  catch (err) { process.stderr.write(`(also: failed to mark loop status: ${(err as Error).message})\n`); }
}

function buildDeps(template_id: string): TemplateDeps {
  if (template_id === 'research' || template_id === 'monitor') {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(`${template_id} template requires OPENROUTER_API_KEY in the environment`);
    }
    const llm: LLMProvider = new OpenRouterProvider({ apiKey, models: [] });
    return { llm };
  }
  return {};
}

function parseArgs(argv: string[]): { db_path: string; loop_id: string; overrides: TemplateOverrides } {
  const positional: string[] = [];
  const overrides: TemplateOverrides = {};
  for (const arg of argv) {
    if (arg.startsWith('--processor-delay-ms=')) {
      overrides.processor_delay_ms = Number(arg.split('=')[1]);
    } else if (arg.startsWith('--cycles-target=')) {
      overrides.cycles_target = Number(arg.split('=')[1]);
    } else if (arg.startsWith('--poll-every=')) {
      overrides.poll_every = Number(arg.split('=')[1]);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length < 2) {
    throw new Error('usage: run.ts <db_path> <loop_id> [--processor-delay-ms=N] [--cycles-target=N]');
  }
  return { db_path: positional[0], loop_id: positional[1], overrides };
}

async function main() {
  const { db_path, loop_id, overrides } = parseArgs(process.argv.slice(2));

  const { sqlite } = createDb(db_path);
  applyResearchDDL(sqlite);

  const loop = getLoop(sqlite, loop_id);
  if (loop === null) {
    process.stderr.write(`loop ${loop_id} not found in ${db_path}\n`);
    process.exit(2);
    return;
  }

  let deps: TemplateDeps;
  try {
    deps = buildDeps(loop.template_id);
  } catch (err) {
    failLoop(sqlite, loop_id, `buildDeps: ${(err as Error).message}`);
    process.exit(2);
    return;
  }
  // Pull model defaults from research_defaults so the user's persisted choice
  // for iteration_check_model / post_mortem_model wins over the template's
  // baked-in default. CLI flags (parseArgs) still override these.
  try {
    const defaults = getDefaults(sqlite);
    if (overrides.iteration_check_model === undefined) {
      overrides.iteration_check_model = defaults.iteration_check_model;
    }
    if (overrides.post_mortem_model === undefined) {
      overrides.post_mortem_model = defaults.post_mortem_model;
    }
  } catch (err) {
    process.stderr.write(`[run] getDefaults failed, using template baked-in models: ${(err as Error).message}\n`);
  }

  let template;
  try {
    template = buildTemplate(loop.template_id, loop.prompt, overrides, deps);
  } catch (err) {
    failLoop(sqlite, loop_id, `buildTemplate: ${(err as Error).message}`);
    process.exit(2);
    return;
  }
  if (template === null) {
    failLoop(sqlite, loop_id, `unknown template_id: ${loop.template_id}`);
    process.exit(2);
    return;
  }

  // Phase 3 — detect output_shape and persist on a schedule artifact before
  // the engine runs. Idempotent: a respawn after crash skips re-detection.
  // Templates with no schedule (noop) skip this entirely.
  if (deps.llm) {
    try {
      await ensureScheduleArtifact(sqlite, loop_id, loop.prompt, deps.llm);
    } catch (err) {
      failLoop(sqlite, loop_id, `ensureScheduleArtifact: ${(err as Error).message}`);
      process.exit(2);
      return;
    }
  }

  // Pipe every event to stdout. The supervisor re-emits these in the API
  // process so SSE listeners see real-time activity.
  const writeEvent = (e: ResearchEvent) => {
    try { process.stdout.write(JSON.stringify(e) + '\n'); }
    catch { /* broken pipe = supervisor went away; nothing useful to do */ }
  };
  onResearchEvent(writeEvent);

  try {
    const result = await runLoop(sqlite, template, loop_id);

    // Auto-polish on natural completion: fire the document generator once
    // before the child exits, so the user lands on a finished article when
    // they open /research/:id. Failure here doesn't fail the loop —
    // observable via stderr per Commandment 1, and the regenerate endpoint
    // lets the user retry from the UI.
    if (result.status === 'completed' && deps.llm) {
      try {
        const doc = await generateDocument(sqlite, loop_id, loop.prompt, deps.llm);
        if (!doc) {
          process.stderr.write(`[document] generateDocument: no render artifact to polish for ${loop_id}\n`);
        }
      } catch (err) {
        process.stderr.write(`[document] generateDocument failed for ${loop_id}: ${(err as Error).message}\n`);
      }

      // Optional post-mortem hook — fires once on natural completion only
      // (envelope_exhausted doesn't trigger). Writes a `post_mortem` artifact
      // that createArtifact also emits as an `artifact` event. Failure must
      // NOT propagate (Commandment 1 — log to stderr, loop stays completed).
      if (template.postMortem) {
        try {
          const finalState = readState(sqlite, loop_id);
          const pm = await template.postMortem(finalState);
          if (pm.cost_usd > 0) bumpUsage(sqlite, loop_id, { cost_usd: pm.cost_usd });
          createArtifact(sqlite, {
            loop_id,
            cycle_id: null,
            kind: 'post_mortem',
            payload: pm.output as unknown as Record<string, unknown>,
          });
        } catch (err) {
          process.stderr.write(`[post_mortem] failed for ${loop_id}: ${(err as Error).message}\n`);
        }
      }
    }

    process.exit(0);
  } catch (err) {
    process.stderr.write(`runLoop failed: ${(err as Error).stack ?? err}\n`);
    process.exit(1);
  }
}

void main();
