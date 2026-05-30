/**
 * @aleph/research — public surface.
 *
 *   - DDL (loops tables + research_defaults)
 *   - SessionConfig + loop types (`./types`, `./loop/types`)
 *   - Defaults service (read/write `research_defaults`)
 *   - Event bus (`onResearchEvent` / `emitResearchEvent`)
 *   - Provider modules (OpenRouter + websearch)
 *   - The full loop engine surface (re-exported from `./loop`)
 */
export { applyResearchDDL } from './ddl.js';
export * from './types.js';

export { getDefaults, updateDefaults, resetDefaults } from './services/defaults.js';
export { onResearchEvent, emitResearchEvent, clearResearchListeners } from './services/events.js';
export type { ResearchEvent, ResearchEventType } from './services/events.js';

export { OpenRouterProvider, getOpenRouterPricing } from './providers/openrouter.js';
export type { OpenRouterConfig } from './providers/openrouter.js';
export { fetchPageText, JS_RENDERED_FLAG } from './providers/websearch.js';

// v1 loop engine — the public dispatcher surface.
export * from './loop/index.js';
