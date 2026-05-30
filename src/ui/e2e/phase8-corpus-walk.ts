#!/usr/bin/env bun
/**
 * Phase 8 corpus walk — runs the remaining acceptance prompts:
 *   1. Awesome-Deep-Research (URL grounding)
 *   2. Smashed-Burgers (mixed shape: history + list >= 5 places)
 *
 * HSV/HPV is covered by loop-research-real-quality.test.ts.
 * Sourdough smoke is covered by loop-research-real-smoke.test.ts.
 *
 * Captures artifacts + a transcript of Activity events per loop and writes
 * a summary to tmp/phase8-corpus-results.md so the build-plan doc update
 * has concrete evidence.
 */
import { mkdtempSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

const realKey = process.env.OPENROUTER_API_KEY;
if (!realKey || realKey.startsWith('fake-') || realKey.startsWith('sk-test-')) {
  console.error('[corpus] OPENROUTER_API_KEY missing; cannot run real-LLM walk');
  process.exit(1);
}

const webDir = resolve(import.meta.dirname, '../web');
if (!existsSync(join(webDir, 'dist'))) {
  console.log('[corpus] Building UI bundle…');
  const r = spawnSync('bun', ['run', 'build'], { cwd: webDir, stdio: 'inherit' });
  if (r.status !== 0) { console.error('[corpus] FATAL: ui build failed'); process.exit(1); }
}

const tmpDir = mkdtempSync(join(tmpdir(), 'aleph-corpus-'));
const dbPath = join(tmpDir, 'test.db');

const { startFakeProviderServer } = await import('./fake-llm-server.js');
const fake = startFakeProviderServer();

process.env.ALEPH_DB_PATH = dbPath;
process.env.NODE_ENV = 'production';
process.env.HOME = tmpDir;
process.env.TAVILY_BASE_URL = fake.baseUrl;
process.env.TAVILY_API_KEY = 'fake-tavily-key';
delete process.env.OPENROUTER_BASE_URL;

const { chromium } = await import('playwright');
const { createDb } = await import('@aleph/data');
const { applyDDL } = await import('@aleph/goals');
const { applyResearchDDL } = await import('@aleph/research');
const { createApp } = await import('../api/src/app.js');

const { sqlite } = createDb(dbPath);
applyDDL(sqlite);
applyResearchDDL(sqlite);
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY, url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '[]', secret TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
sqlite.close();

const server = await createApp({ dbUrl: dbPath });
await server.listen({ port: 0, host: '127.0.0.1' });
const addr = server.server.address();
const port = (addr as { port: number }).port;
const baseUrl = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true });

interface RunResult {
  label: string;
  prompt: string;
  loopId: string;
  finalStatus: string;
  elapsedSec: number;
  costUsd: number;
  cycles: number;
  outputShape: string;
  documentText: string;
  activityEventsObserved: number;
  canon: string[];
}

async function runQuery(label: string, prompt: string, envelope: { cycles: number; cost: number }): Promise<RunResult> {
  console.log(`\n=== ${label} ===\n  ${prompt}\n`);
  const page = await browser.newPage();
  const t0 = Date.now();

  const startRes = await page.request.post(`${baseUrl}/api/loops/start`, {
    headers: { 'content-type': 'application/json' },
    data: {
      template_id: 'research',
      prompt,
      mode: 'default',
      envelope: { cycles: { count: envelope.cycles }, cost: { usd: envelope.cost } },
    },
  });
  const { id: loopId } = await startRes.json() as { id: string };
  console.log(`  loopId: ${loopId}`);

  await page.goto(`${baseUrl}/research/${loopId}`);
  await page.waitForSelector('[data-testid="page-research-detail"]', { timeout: 20_000 });
  // Switch to Activity tab so we can count events the user would see live.
  await page.locator('text=Activity').first().click().catch(() => {});

  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="loop-status"]');
      return el && (el.textContent === 'completed' || el.textContent === 'failed');
    },
    null,
    { timeout: 600_000 },
  );

  const finalStatus = (await page.locator('[data-testid="loop-status"]').textContent()) ?? 'unknown';

  // Count Activity events visible to the user.
  let eventsObserved = 0;
  try {
    eventsObserved = await page.locator('[data-testid="activity-event-list"] li').count();
  } catch { /* ignore */ }

  // Regenerate document if missing (transient 504s).
  let body = await fetchBody(page, loopId);
  for (let i = 0; i < 3; i++) {
    if (body.artifacts.some(a => a.kind === 'document')) break;
    try {
      await page.request.post(`${baseUrl}/api/loops/${loopId}/regenerate-document`, { timeout: 90_000 });
    } catch (err) {
      console.log(`  [regen ${i + 1}/3] failed: ${(err as Error).message.slice(0, 100)}`);
    }
    await new Promise(r => setTimeout(r, 3000));
    body = await fetchBody(page, loopId);
  }

  const doc = body.artifacts.find(a => a.kind === 'document');
  const docText = (doc?.payload as { text?: string } | undefined)?.text ?? '';

  const schedule = body.artifacts.find(a => a.kind === 'schedule');
  const schedulePayload = schedule?.payload as
    | { output_shape?: { kind?: string }; plan?: { canon?: string[] } }
    | undefined;
  const outputShape = schedulePayload?.output_shape?.kind ?? 'unknown';
  const canon = schedulePayload?.plan?.canon ?? [];

  const result: RunResult = {
    label,
    prompt,
    loopId,
    finalStatus,
    elapsedSec: (Date.now() - t0) / 1000,
    costUsd: body.loop.envelope_consumed?.cost_usd ?? 0,
    cycles: body.loop.envelope_consumed?.cycles_count ?? 0,
    outputShape,
    documentText: docText,
    activityEventsObserved: eventsObserved,
    canon,
  };
  console.log(`  status=${result.finalStatus} cycles=${result.cycles} cost=$${result.costUsd.toFixed(4)} shape=${result.outputShape} events=${result.activityEventsObserved} canon=${canon.length} elapsed=${result.elapsedSec.toFixed(1)}s`);
  await page.close();
  return result;
}

async function fetchBody(page: import('playwright').Page, loopId: string) {
  const r = await page.request.get(`${baseUrl}/api/loops/${loopId}`);
  return await r.json() as {
    loop: { envelope_consumed?: { cycles_count?: number; cost_usd?: number } };
    artifacts: Array<{ kind: string; payload: Record<string, unknown> }>;
  };
}

// Awesome-LLM is used as a stand-in for "Awesome-Deep-Research" — the
// criterion is whether URL grounding kicks in, not the specific repo. The
// planner's canon should reflect projects listed in the README (TinyZero,
// open-r1, DeepSeek-R1, Qwen, etc.), not generic LLM canon (GPT-4, BERT).
const AWESOME_DR_PROMPT =
  'Survey notable open-source LLM projects listed at ' +
  'https://github.com/Hannibal046/Awesome-LLM . Pick the top 3 trending ' +
  'projects from that list and summarize what each does.';

const BURGERS_PROMPT =
  'Tell me the history of smashed burgers (origin, how the style evolved). ' +
  'Then list at least 5 highly-rated smashed-burger restaurants in the United States, ' +
  'one per line with city and a short note on what makes each notable.';

const results: RunResult[] = [];
const skipAwesomeDR = process.env.SKIP_AWESOME_DR === '1';
async function safeRun(label: string, prompt: string, envelope: { cycles: number; cost: number }) {
  try {
    results.push(await runQuery(label, prompt, envelope));
  } catch (err) {
    console.error(`[corpus] ${label} threw:`, (err as Error).message.slice(0, 200));
  }
}
if (!skipAwesomeDR) await safeRun('Awesome-Deep-Research (URL grounding)', AWESOME_DR_PROMPT, { cycles: 3, cost: 0.20 });
await safeRun('Smashed-Burgers (mixed shape)', BURGERS_PROMPT, { cycles: 3, cost: 0.20 });

await browser.close();
await server.close();
fake.stop();

// Acceptance assessment.
const md: string[] = [];
md.push('# Phase 8 corpus walk — results');
md.push('');
md.push(`Generated: ${new Date().toISOString()}`);
md.push('');
for (const r of results) {
  md.push(`## ${r.label}`);
  md.push('');
  md.push(`- Loop: \`${r.loopId}\` · status=**${r.finalStatus}** · ${r.cycles} cycles · $${r.costUsd.toFixed(4)} · ${r.elapsedSec.toFixed(1)}s`);
  md.push(`- Output shape detected: \`${r.outputShape}\``);
  md.push(`- Activity events visible in UI: ${r.activityEventsObserved}`);
  md.push(`- Planner canon (${r.canon.length}): ${r.canon.map(c => '`' + c + '`').join(', ')}`);
  md.push('');
  md.push('**Prompt:**');
  md.push('');
  md.push('> ' + r.prompt);
  md.push('');
  // Tally bullet/numbered list items for the Smashed-Burgers list criterion.
  const bulletCount = (r.documentText.match(/^\s*[-*]\s+/gm) ?? []).length;
  const numberedCount = (r.documentText.match(/^\s*\d+\.\s+/gm) ?? []).length;
  md.push(`- Bullet list items: ${bulletCount}; numbered list items: ${numberedCount}`);
  md.push(`- Document length: ${r.documentText.length} chars`);
  md.push('');
  md.push('**Document output (full):**');
  md.push('');
  md.push('```markdown');
  md.push(r.documentText);
  md.push('```');
  md.push('');
}

const outPath = resolve(import.meta.dirname, '../../../tmp/phase8-corpus-results.md');
const { mkdirSync } = await import('fs');
mkdirSync(resolve(outPath, '..'), { recursive: true });
writeFileSync(outPath, md.join('\n'));
console.log(`\n[corpus] Results: ${outPath}`);
process.exit(0);
