#!/usr/bin/env bun
import { createDb } from '@construct/data';
import { applyResearchDDL } from './ddl.js';
import { ResearchEngine, AnthropicProvider, type LLMProvider } from './engine.js';
import { OllamaProvider } from './providers/ollama.js';
import { OpenRouterProvider } from './providers/openrouter.js';
import { Heartbeat, StepRateLimiter, isInActiveWindow, msUntilNextWindow } from './scheduler.js';
import * as jobs from './services/jobs.js';
import * as sessions from './services/sessions.js';

const POLL_INTERVAL_MS = 5_000;
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

// Load .env from .dev/ if present (dev mode)
const envPath = new URL('../../../.dev/.env', import.meta.url).pathname;
try {
  const envContent = await Bun.file(envPath).text();
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  // No .env file — fine, env vars should be set externally
}

const apiKey = process.env.ANTHROPIC_API_KEY;
const ollamaModel = process.env.OLLAMA_MODEL;
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL;

if (!apiKey && !ollamaModel && !process.env.OPENROUTER_API_KEY) {
  console.error('[worker] Set ANTHROPIC_API_KEY, OLLAMA_MODEL, or OPENROUTER_API_KEY');
  process.exit(1);
}

const openrouterApiKey = process.env.OPENROUTER_API_KEY;

function buildProvider(session: { config: { model?: string; models?: Record<string, string>; providers?: { primary?: string; openrouter_api_key?: string } } }): LLMProvider {
  const primary = session.config.providers?.primary;
  const model = session.config.model;
  if (primary === 'openrouter') {
    const key = session.config.providers?.openrouter_api_key ?? openrouterApiKey;
    if (!key) throw new Error('OpenRouter API key not set (pass via session config or OPENROUTER_API_KEY env)');
    const models = session.config.models
      ? Object.values(session.config.models).filter(Boolean)
      : [model ?? 'deepseek/deepseek-chat'];
    return new OpenRouterProvider({ apiKey: key, models: [...new Set(models)] as string[] });
  }
  if (primary === 'ollama' || (!apiKey && ollamaModel)) {
    return new OllamaProvider({ model: model || ollamaModel || 'qwen2.5:0.5b', baseUrl: ollamaBaseUrl });
  }
  // Default to OpenRouter if key is available and no explicit provider set
  if (!primary && openrouterApiKey) {
    const models = session.config.models
      ? Object.values(session.config.models).filter(Boolean)
      : [model ?? 'deepseek/deepseek-chat'];
    return new OpenRouterProvider({ apiKey: openrouterApiKey, models: [...new Set(models)] as string[] });
  }
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  return new AnthropicProvider(apiKey);
}

const { sqlite } = createDb();
sqlite.exec('PRAGMA busy_timeout = 5000');
applyResearchDDL(sqlite);

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

async function executeJob(job: import('./types.js').ResearchJob): Promise<void> {
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

  try {
    const engine = new ResearchEngine({
      sqlite,
      provider: buildProvider(session),
      maxIterations,
      signal: controller.signal,
      onIteration: (i) => {
        iterationsCompleted = job.iterations_completed + i;
        rateLimiter.record();
      },
    });

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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'This operation was aborted' || msg.includes('AbortError')) {
      // Graceful shutdown or cancellation — don't mark as failed
      jobs.updateHeartbeat(sqlite, job.id, workerId, iterationsCompleted);
      console.log(`[worker] job ${job.id} aborted (${iterationsCompleted} iterations completed)`);
    } else {
      jobs.failJob(sqlite, job.id, workerId, msg);
      console.error(`[worker] job ${job.id} failed:`, msg);
    }
  } finally {
    heartbeat.stop();
    clearInterval(shutdownCheck);
    clearInterval(cancelCheck);
  }
}

// Main loop
while (!shutdownRequested) {
  try {
    const reclaimed = jobs.reclaimStaleJobs(sqlite);
    if (reclaimed > 0) console.log(`[worker] reclaimed ${reclaimed} stale job(s)`);

    checkScheduledSessions();

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
