#!/usr/bin/env bun
import { createDb } from '@construct/data';
import { applyResearchDDL } from './ddl.js';
import { ResearchEngine, type LLMProvider } from './engine.js';
import { OpenRouterProvider } from './providers/openrouter.js';
import { Heartbeat, StepRateLimiter, isInActiveWindow, msUntilNextWindow } from './scheduler.js';
import { drainPendingSources } from './extractor.js';
import * as jobs from './services/jobs.js';
import { countActiveJobsForSession, getQueuedThreadsForNewJobs, createThreadJobIfNone, reclaimDeadWorkerJobs } from './services/jobs.js';
import * as sessions from './services/queries.js';
import { resetOrphanedActiveThreads } from './services/threads.js';
import { sessionsMissingConcepts } from './services/concepts.js';
import { registerBuiltinHooks } from './hooks/builtin.js';
import { runIterationCheck } from './hooks/iteration-check.js';
import { runPostMortem } from './hooks/post-mortem.js';
import { hasHooks } from './hooks/registry.js';

const ITERATION_CHECK_INTERVAL = 5;

// Poll cadence for picking up newly-queued jobs. Dropped from 5s → 1s
// to reduce thread-claim latency; cost is one cheap SELECT/sec/worker.
const POLL_INTERVAL_MS = 1_000;
const HEARTBEAT_INTERVAL_MS = 60_000;

const workerId = `worker-${process.pid}-${Date.now()}`;
let shutdownRequested = false;

process.on('SIGTERM', () => {
  console.log('[worker] SIGTERM received, finishing current iteration...');
  shutdownRequested = true;
});
process.on('SIGINT', () => {
  console.log('[worker] SIGINT received, finishing current iteration...');
  shutdownRequested = true;
});

// Load .env — search: relative to worker, then HOME
function loadEnv(content: string) {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}
const envCandidates = [
  new URL('../../../.env', import.meta.url).pathname,
  `${process.env.HOME}/.construct/.env`,
  `${process.env.HOME}/.env`,
];
for (const envPath of envCandidates) {
  try {
    loadEnv(await Bun.file(envPath).text());
    break;
  } catch { /* try next */ }
}

if (!process.env.OPENROUTER_API_KEY) {
  console.error('[worker] Set OPENROUTER_API_KEY');
  process.exit(1);
}

const openrouterApiKey = process.env.OPENROUTER_API_KEY;

function buildProvider(session: { config: { model?: string; providers?: { openrouter_api_key?: string; openrouter_models?: string[] } } }): LLMProvider {
  const model = session.config.model ?? 'openrouter/free';
  const key = session.config.providers?.openrouter_api_key ?? openrouterApiKey;
  if (!key) throw new Error('OpenRouter API key not set (pass via session config or OPENROUTER_API_KEY env)');
  const models = session.config.providers?.openrouter_models?.length
    ? session.config.providers.openrouter_models
    : [model];
  return new OpenRouterProvider({ apiKey: key, models });
}

const { sqlite } = createDb();
sqlite.exec('PRAGMA busy_timeout = 5000');
applyResearchDDL(sqlite);
// Register builtin agent hooks (iteration_check, post_mortem). Idempotent —
// also registered by the API; workers run in separate processes so this line
// is what makes the hooks fire here. Skip cleanly if no API key.
registerBuiltinHooks();

// On startup: reclaim jobs from dead worker PIDs (orphans from previous server runs)
const deadReclaimed = reclaimDeadWorkerJobs(sqlite);
if (deadReclaimed > 0) console.log(`[worker] reclaimed ${deadReclaimed} job(s) from dead workers`);

console.log(`[worker] started (${workerId})`);

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sleepWithShutdownCheck(ms: number, intervalMs = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end && !shutdownRequested) {
    await sleep(Math.min(intervalMs, end - Date.now()));
  }
}

function checkScheduledSessions(): void {
  const activeSessions = sessions.listSessions(sqlite, 'active');
  for (const session of activeSessions) {
    if (session.config.schedule.mode !== 'scheduled') continue;
    if (session.config.schedule.active_windows.length === 0) continue;

    const inWindow = isInActiveWindow(
      session.config.schedule.active_windows,
      session.config.schedule.timezone
    );
    if (!inWindow) continue;

    const existingJob = jobs.getActiveJobForSession(sqlite, session.id);
    if (existingJob) continue;

    jobs.createJob(sqlite, {
      session_id: session.id,
      mode: 'scheduled',
    });
    console.log(`[worker] created scheduled job for session ${session.id}`);
  }
}

/** Create one thread-level job per queued thread that has no active job,
 *  up to max_concurrent_threads slots per session. */
function checkQueuedThreads(): void {
  const activeSessions = sessions.listSessions(sqlite, 'active');
  for (const session of activeSessions) {
    if (session.config.schedule.mode === 'scheduled') continue; // handled by checkScheduledSessions
    const maxConcurrent = session.config.max_concurrent_threads ?? 3;
    const activeCount = countActiveJobsForSession(sqlite, session.id);
    if (activeCount >= maxConcurrent) continue;
    const slots = maxConcurrent - activeCount;
    const queuedThreads = getQueuedThreadsForNewJobs(sqlite, session.id, slots);
    for (const thread of queuedThreads) {
      const created = createThreadJobIfNone(sqlite, { session_id: session.id, thread_id: thread.id });
      if (created) console.log(`[worker] queued thread job for thread ${thread.id.slice(0, 8)} (session=${session.id.slice(0, 8)})`);
    }
  }
}

async function executeSessionJob(job: import('./types.js').ResearchJob): Promise<void> {
  jobs.markRunning(sqlite, job.id, workerId);
  console.log(`[worker] executing job ${job.id} (session=${job.session_id}, mode=${job.mode})`);

  const controller = new AbortController();
  const shutdownCheck = setInterval(() => {
    if (shutdownRequested) controller.abort();
  }, 1_000);

  // Also abort if job is cancelled in DB
  const cancelCheck = setInterval(() => {
    const current = jobs.getJob(sqlite, job.id);
    if (current?.status === 'cancelled') controller.abort();
  }, 5_000);

  let iterationsCompleted = job.iterations_completed;

  const heartbeat = new Heartbeat(() => {
    jobs.updateHeartbeat(sqlite, job.id, workerId, iterationsCompleted);
  });
  heartbeat.start(HEARTBEAT_INTERVAL_MS);

  const session = sessions.getSession(sqlite, job.session_id);
  if (!session) {
    jobs.failJob(sqlite, job.id, workerId, 'Session not found');
    heartbeat.stop();
    clearInterval(shutdownCheck);
    clearInterval(cancelCheck);
    return;
  }

  const rateLimiter = new StepRateLimiter(session.config.max_steps_per_hour);

  // For scheduled mode, check window before starting
  if (job.mode === 'scheduled') {
    const { active_windows, timezone } = session.config.schedule;
    if (!isInActiveWindow(active_windows, timezone)) {
      const waitMs = msUntilNextWindow(active_windows, timezone);
      if (waitMs === null) {
        jobs.completeJob(sqlite, job.id, workerId);
        heartbeat.stop();
        clearInterval(shutdownCheck);
        clearInterval(cancelCheck);
        return;
      }
      console.log(`[worker] job ${job.id} waiting ${Math.round(waitMs / 60000)}m for next window`);
      await sleepWithShutdownCheck(waitMs);
      if (shutdownRequested) {
        heartbeat.stop();
        clearInterval(shutdownCheck);
        clearInterval(cancelCheck);
        return;
      }
    }
  }

  const maxIterations = job.mode === 'burst'
    ? (job.max_iterations ?? 5) - job.iterations_completed
    : Infinity;

  const jobStartedMs = Date.now();
  let durationCheck: ReturnType<typeof setInterval> | null = null;
  try {
    const engine = new ResearchEngine({
      sqlite,
      provider: buildProvider(session),
      maxIterations,
      signal: controller.signal,
      onIteration: (i) => {
        iterationsCompleted = job.iterations_completed + i;
        rateLimiter.record();
        // Every N iterations, fire the iteration_check hook in the background.
        // Non-blocking: the engine continues the next iteration without waiting.
        if (i > 0 && i % ITERATION_CHECK_INTERVAL === 0 && hasHooks('iteration_check')) {
          runIterationCheck(
            sqlite,
            { id: session.id, prompt: session.prompt, prompt_hints: session.prompt_hints as Record<string, unknown> },
            job.id,
            iterationsCompleted,
          ).catch(err => console.warn('[iteration_check] dispatch threw:', err));
        }
      },
    });

    // Live mode wall-clock cap: when set, write a best-effort document snapshot
    // and pause/complete the session before aborting. Reads cap/expiry policy
    // from session config; null cap = today's behavior (no wall clock).
    let durationFired = false;
    durationCheck = setInterval(() => {
      if (durationFired) return;
      const cap = session.config.schedule.max_session_duration_minutes;
      if (cap == null) return;
      const elapsedMin = (Date.now() - new Date(session.created_at).getTime()) / 60_000;
      if (elapsedMin < cap) return;
      durationFired = true;
      console.log(`[worker] live-mode wall clock expired (${cap.toFixed(1)}m, elapsed ${elapsedMin.toFixed(1)}m) for session ${job.session_id}`);
      // Snapshot + status flip run in the background — we don't want to block
      // the interval. Errors are logged but don't fail the job.
      (async () => {
        try {
          await engine.updateDocument(job.session_id);
        } catch (err) {
          console.warn(`[worker] snapshot updateDocument failed for ${job.session_id}:`, err);
        }
        const finalStatus = session.config.on_duration_expiry === 'complete' ? 'completed' : 'paused';
        try {
          sessions.updateQuery(sqlite, job.session_id, { status: finalStatus });
        } catch (err) {
          console.warn(`[worker] status flip failed for ${job.session_id}:`, err);
        }
        controller.abort();
      })();
    }, 5_000);

    // Rate limit check before starting
    if (!rateLimiter.canProceed()) {
      const waitMs = rateLimiter.msUntilNextSlot();
      console.log(`[worker] rate limited, waiting ${Math.round(waitMs / 1000)}s`);
      await sleepWithShutdownCheck(waitMs);
    }

    await engine.runIterations(job.session_id);

    // Update final iteration count
    jobs.updateHeartbeat(sqlite, job.id, workerId, iterationsCompleted);
    jobs.completeJob(sqlite, job.id, workerId);
    console.log(`[worker] job ${job.id} completed (${iterationsCompleted} iterations)`);
    // post_mortem hook: fire-and-forget. One call per completed session job.
    if (hasHooks('post_mortem')) {
      runPostMortem(sqlite, job.session_id, job.id, Date.now() - jobStartedMs)
        .catch(err => console.warn('[post_mortem] dispatch threw:', err));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'This operation was aborted' || msg.includes('AbortError')) {
      // Graceful shutdown or cancellation — don't mark as failed
      jobs.updateHeartbeat(sqlite, job.id, workerId, iterationsCompleted);
      console.log(`[worker] job ${job.id} aborted (${iterationsCompleted} iterations completed)`);
    } else {
      jobs.failJob(sqlite, job.id, workerId, msg);
      console.error(`[worker] job ${job.id} failed:`, msg);
      // post_mortem also fires on failed jobs — a failure mode is a key signal.
      if (hasHooks('post_mortem')) {
        runPostMortem(sqlite, job.session_id, job.id, Date.now() - jobStartedMs)
          .catch(err => console.warn('[post_mortem] dispatch threw:', err));
      }
    }
  } finally {
    heartbeat.stop();
    clearInterval(shutdownCheck);
    clearInterval(cancelCheck);
    if (durationCheck) clearInterval(durationCheck);
  }
}

async function executeThreadJob(job: import('./types.js').ResearchJob): Promise<void> {
  jobs.markRunning(sqlite, job.id, workerId);
  console.log(`[worker] executing thread job ${job.id.slice(0, 8)} (thread=${job.thread_id?.slice(0, 8)}, session=${job.session_id.slice(0, 8)})`);

  if (!job.thread_id) {
    jobs.failJob(sqlite, job.id, workerId, 'thread_id missing on thread job');
    return;
  }

  const session = sessions.getSession(sqlite, job.session_id);
  if (!session) {
    jobs.failJob(sqlite, job.id, workerId, 'Session not found');
    return;
  }

  // Budget check before starting
  const costData = sessions.getQueryCost(sqlite, job.session_id);
  if (session.config.budget_daily_usd && costData.today_cost >= session.config.budget_daily_usd) {
    sessions.updateQuery(sqlite, job.session_id, { status: 'halted' });
    jobs.completeJob(sqlite, job.id, workerId);
    return;
  }
  if (session.config.budget_total_usd && costData.total_cost >= session.config.budget_total_usd) {
    sessions.updateQuery(sqlite, job.session_id, { status: 'halted' });
    jobs.completeJob(sqlite, job.id, workerId);
    return;
  }

  const controller = new AbortController();
  const shutdownCheck = setInterval(() => {
    if (shutdownRequested) controller.abort();
  }, 1_000);
  const cancelCheck = setInterval(() => {
    const current = jobs.getJob(sqlite, job.id);
    if (current?.status === 'cancelled') controller.abort();
  }, 5_000);

  const heartbeat = new Heartbeat(() => {
    jobs.updateHeartbeat(sqlite, job.id, workerId, 0);
  });
  heartbeat.start(HEARTBEAT_INTERVAL_MS);

  const engine = new ResearchEngine({
    sqlite,
    provider: buildProvider(session),
    signal: controller.signal,
  });

  // Live mode wall-clock cap (mirrors executeSessionJob).
  let durationFired = false;
  const durationCheck = setInterval(() => {
    if (durationFired) return;
    const cap = session.config.schedule.max_session_duration_minutes;
    if (cap == null) return;
    const elapsedMin = (Date.now() - new Date(session.created_at).getTime()) / 60_000;
    if (elapsedMin < cap) return;
    durationFired = true;
    console.log(`[worker] live-mode wall clock expired (${cap.toFixed(1)}m, elapsed ${elapsedMin.toFixed(1)}m) for session ${job.session_id}`);
    (async () => {
      try {
        await engine.updateDocument(job.session_id);
      } catch (err) {
        console.warn(`[worker] snapshot updateDocument failed for ${job.session_id}:`, err);
      }
      const finalStatus = session.config.on_duration_expiry === 'complete' ? 'completed' : 'paused';
      try {
        sessions.updateQuery(sqlite, job.session_id, { status: finalStatus });
      } catch (err) {
        console.warn(`[worker] status flip failed for ${job.session_id}:`, err);
      }
      controller.abort();
    })();
  }, 5_000);

  try {
    await engine.runThread(job.session_id, job.thread_id);
    jobs.completeJob(sqlite, job.id, workerId);
    console.log(`[worker] thread job ${job.id.slice(0, 8)} completed`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'This operation was aborted' || msg.includes('AbortError')) {
      console.log(`[worker] thread job ${job.id.slice(0, 8)} aborted`);
    } else {
      jobs.failJob(sqlite, job.id, workerId, msg);
      console.error(`[worker] thread job ${job.id.slice(0, 8)} failed:`, msg);
    }
  } finally {
    heartbeat.stop();
    clearInterval(shutdownCheck);
    clearInterval(cancelCheck);
    clearInterval(durationCheck);
  }
}

async function executeJob(job: import('./types.js').ResearchJob): Promise<void> {
  if (job.thread_id) {
    return executeThreadJob(job);
  }
  return executeSessionJob(job);
}

// Main loop
while (!shutdownRequested) {
  try {
    const reclaimed = jobs.reclaimStaleJobs(sqlite);
    if (reclaimed > 0) console.log(`[worker] reclaimed ${reclaimed} stale job(s)`);

    const orphaned = resetOrphanedActiveThreads(sqlite);
    if (orphaned > 0) console.log(`[worker] reset ${orphaned} orphaned active thread(s) to queued`);

    checkScheduledSessions();
    checkQueuedThreads();

    // Backfill concepts for findings that have none yet. Handles both the
    // pre-feature case (sessions created before concept extraction existed)
    // and transient failures from the inline extraction path.
    try {
      const sessionIds = sessionsMissingConcepts(sqlite, 1);
      if (sessionIds.length > 0) {
        const sid = sessionIds[0];
        const session = sessions.getQuery(sqlite, sid);
        if (session) {
          const engine = new ResearchEngine({ sqlite, provider: buildProvider(session) });
          const done = await engine.backfillConcepts(sid, 5);
          if (done > 0) console.log(`[worker] backfilled concepts for ${done} finding(s) in session ${sid}`);
        }
      }
    } catch (err) {
      console.warn('[worker] concept backfill error:', err);
    }

    // Drain the extraction queue (no-op when JINA key is missing; drainPendingSources
    // throws inside fetchPageContent → per-source failExtraction will record the reason).
    if (process.env.JINA_API_KEY) {
      try {
        const r = await drainPendingSources(sqlite, {
          batchSize: 10,
          concurrency: 8,
          onExtracted: async (source) => {
            // Re-run concept extraction for findings citing this URL with the
            // newly-available full text as context. Build a per-session engine
            // because concept extraction uses the session's configured model.
            const session = sessions.getSession(sqlite, source.session_id);
            if (!session) return;
            try {
              const engine = new ResearchEngine({ sqlite, provider: buildProvider(session) });
              await engine.relinkConceptsForSource(source);
            } catch (err) {
              console.warn(`[worker] relink concepts failed for ${source.id}:`, err);
            }
          },
        });
        if (r.claimed > 0) {
          console.log(`[worker] extraction drained ${r.claimed} (ok=${r.extracted}, fail=${r.failed}, skip=${r.skipped})`);
        }
      } catch (err) {
        console.warn('[worker] extraction drain error:', err);
      }
    }

    const pending = jobs.findPendingJob(sqlite);
    if (!pending) {
      await sleepWithShutdownCheck(POLL_INTERVAL_MS);
      continue;
    }

    const claimed = jobs.claimJob(sqlite, pending.id, workerId);
    if (!claimed) continue;

    await executeJob(claimed);
  } catch (err) {
    console.error('[worker] loop error:', err);
    await sleep(POLL_INTERVAL_MS);
  }
}

console.log(`[worker] shut down (${workerId})`);
sqlite.close();
