/**
 * Research routes — config + defaults only.
 *
 *   - GET / PATCH /api/research/config        → provider config (file-backed
 *                                               at ~/.construct/research-config.json,
 *                                               plus mirrored API keys on env
 *                                               vars so the loops engine and
 *                                               provider modules pick them up
 *                                               at boot).
 *   - GET / PUT   /api/research/defaults      → persisted SessionConfig defaults.
 *   - POST        /api/research/defaults/reset
 *
 * Run / step / finding / thread / job / concept / source / monitor endpoints
 * live on `/api/loops/*` — see `routes/loops.ts`.
 */
import type { FastifyPluginAsync } from 'fastify';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { getDefaults, updateDefaults, resetDefaults, type SessionConfig } from '@construct/research';

export const researchRoutes: FastifyPluginAsync = async (app) => {
  const configPath = resolve(process.env.HOME ?? '', '.construct', 'research-config.json');

  function loadProviderConfig(): Record<string, unknown> {
    try { return JSON.parse(readFileSync(configPath, 'utf-8')); } catch { return {}; }
  }

  /** Persist a patch + mirror API keys to process.env so the loop engine's
   *  providers see them. Returns the merged config. */
  function saveProviderConfig(patch: Record<string, unknown>): Record<string, unknown> {
    const existing = loadProviderConfig();
    const merged = { ...existing, ...patch };
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(merged, null, 2));
    for (const [configKey, envKey] of Object.entries(KEY_MAP)) {
      if (typeof merged[configKey] === 'string' && merged[configKey]) {
        process.env[envKey] = merged[configKey] as string;
      }
    }
    return merged;
  }

  const KEY_MAP: Record<string, string> = {
    anthropic_api_key: 'ANTHROPIC_API_KEY',
    openrouter_api_key: 'OPENROUTER_API_KEY',
    tavily_api_key: 'TAVILY_API_KEY',
    brave_api_key: 'BRAVE_SEARCH_API_KEY',
    jina_api_key: 'JINA_API_KEY',
  };

  // Apply stored keys to env on plugin registration (server boot path).
  (() => {
    const cfg = loadProviderConfig();
    for (const [configKey, envKey] of Object.entries(KEY_MAP)) {
      if (typeof cfg[configKey] === 'string' && cfg[configKey] && !process.env[envKey]) {
        process.env[envKey] = cfg[configKey] as string;
      }
    }
  })();

  function maskKey(key: string | undefined): string {
    if (!key) return '';
    if (key.length <= 8) return '*'.repeat(key.length);
    return key.slice(0, 4) + '····' + key.slice(-4);
  }

  app.get('/config', async () => {
    const cfg = loadProviderConfig();
    return {
      llm_provider: cfg.llm_provider ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openrouter'),
      // Autocomplete suggestions on the Providers page. Empty until we
      // surface a model column on `cycle_ledger` or similar; the UI handles
      // [] fine (manual entry).
      recent_models: [],
      search_provider: cfg.search_provider ?? (process.env.TAVILY_API_KEY ? 'tavily' : process.env.BRAVE_SEARCH_API_KEY ? 'brave' : 'duckduckgo'),
      fulltext_provider: cfg.fulltext_provider ?? (process.env.JINA_API_KEY ? 'jina' : 'local'),
      keys: {
        anthropic: { set: !!process.env.ANTHROPIC_API_KEY, masked: maskKey(process.env.ANTHROPIC_API_KEY) },
        openrouter: { set: !!process.env.OPENROUTER_API_KEY, masked: maskKey(process.env.OPENROUTER_API_KEY) },
        tavily: { set: !!process.env.TAVILY_API_KEY, masked: maskKey(process.env.TAVILY_API_KEY) },
        brave: { set: !!process.env.BRAVE_SEARCH_API_KEY, masked: maskKey(process.env.BRAVE_SEARCH_API_KEY) },
        jina: { set: !!process.env.JINA_API_KEY, masked: maskKey(process.env.JINA_API_KEY) },
      },
    };
  });

  app.patch<{ Body: Record<string, unknown> }>('/config', async (req) => {
    saveProviderConfig(req.body ?? {});
    return { status: 'saved' };
  });

  app.get('/defaults', async () => getDefaults(app.sqlite));
  app.put<{ Body: Partial<SessionConfig> }>('/defaults', async (req) => updateDefaults(app.sqlite, req.body ?? {}));
  app.post('/defaults/reset', async () => resetDefaults(app.sqlite));
};
