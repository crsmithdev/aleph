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
import { onResearchEvent, type ResearchEvent } from '../services/events.js';
import { getLoop } from './db.js';
import { runLoop } from './engine.js';
import { buildTemplate, type TemplateOverrides } from './templates/registry.js';

function parseArgs(argv: string[]): { db_path: string; loop_id: string; overrides: TemplateOverrides } {
  const positional: string[] = [];
  const overrides: TemplateOverrides = {};
  for (const arg of argv) {
    if (arg.startsWith('--processor-delay-ms=')) {
      overrides.processor_delay_ms = Number(arg.split('=')[1]);
    } else if (arg.startsWith('--cycles-target=')) {
      overrides.cycles_target = Number(arg.split('=')[1]);
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

  const template = buildTemplate(loop.template_id, loop.prompt, overrides);
  if (template === null) {
    process.stderr.write(`unknown template_id: ${loop.template_id}\n`);
    process.exit(2);
    return;
  }

  // Pipe every event to stdout. The supervisor re-emits these in the API
  // process so SSE listeners see real-time activity.
  const writeEvent = (e: ResearchEvent) => {
    try { process.stdout.write(JSON.stringify(e) + '\n'); }
    catch { /* broken pipe = supervisor went away; nothing useful to do */ }
  };
  onResearchEvent(writeEvent);

  try {
    await runLoop(sqlite, template, loop_id);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`runLoop failed: ${(err as Error).stack ?? err}\n`);
    process.exit(1);
  }
}

void main();
