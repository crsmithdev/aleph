/**
 * Mode presets — named starting templates for the schedule artifact.
 *
 * Per `docs/plans/research-system-design.md` §1: picking a mode at submit time
 * selects which template constructs the initial schedule. After construction
 * the mode label has no runtime presence — the schedule is what runs, and the
 * mode survives only as `created_with_mode` metadata on the schedule artifact.
 *
 * Each profile contributes an envelope baseline (which `createLoop` merges
 * with any explicit envelope on the start request — request fields win).
 * The plan also calls for per-mode model selection and perturbation profile;
 * those land alongside Phase 5 once the schedule payload owns models + a
 * working perturbation system exists. For now the engine reads only the
 * envelope; the other profile fields are plumbed onto `created_with_mode`
 * metadata so the UI can surface what the user picked without affecting
 * engine behaviour.
 *
 * The eight modes match the compose-box chips in
 * `src/ui/web/src/components/research/ComposeBox.tsx`. Adding or renaming
 * a mode must be done in both places — the `Mode` union here is the source
 * of truth for what the API accepts.
 */

import type { Envelope } from './types.js';

export type Mode =
  | 'quick' | 'default' | 'deep' | 'roam' | 'bonkers'
  | 'dev' | 'eval' | 'custom';

export const MODES: readonly Mode[] = [
  'quick', 'default', 'deep', 'roam', 'bonkers', 'dev', 'eval', 'custom',
] as const;

export const DEFAULT_MODE: Mode = 'default';

export function isMode(s: string): s is Mode {
  return (MODES as readonly string[]).includes(s);
}

/**
 * Per-mode preset. `envelope` seeds the loop's envelope (overridable by the
 * explicit `envelope` on the start request). `description` is for surfacing
 * in tooltips; `flags` are forward-looking opt-ins consumed at Phase 5+ (e.g.
 * `fake_llm` for Dev mode, `cached_planner` for Eval). None of `flags` is
 * read by the v1 engine yet — recording them on the schedule artifact's
 * `created_with_mode` metadata so the UI can show them and future phases can
 * pick them up without an API migration.
 */
export interface ModeProfile {
  envelope: Envelope;
  description: string;
  flags?: Record<string, boolean>;
}

/**
 * Envelope numbers are starting points calibrated against the existing
 * cycles_target=3 baseline; expect them to be tuned once Phase 5 lands.
 *
 * `cycles` and `cost` are both set on each preset so the loop stops at
 * whichever cap trips first — see `runLoop` in `engine.ts`.
 */
export const MODE_PROFILES: Record<Mode, ModeProfile> = {
  quick: {
    envelope: { cycles: { count: 5 }, cost: { usd: 0.10 } },
    description: '5-minute answer. Small envelope, cheap models, perturbation suppressed.',
  },
  default: {
    envelope: { cycles: { count: 12 }, cost: { usd: 0.50 } },
    description: 'Balanced envelope and models — sensible tangents enabled.',
  },
  deep: {
    envelope: { cycles: { count: 30 }, cost: { usd: 2.00 } },
    description: 'High effort. Large envelope, premium models.',
  },
  roam: {
    envelope: { cycles: { count: 15 }, cost: { usd: 0.75 } },
    description: 'Exploratory. Heavy perturbation, medium- and large-magnitude leaps.',
  },
  bonkers: {
    envelope: { cycles: { count: 20 }, cost: { usd: 1.00 } },
    description: 'Entertainment-grade variance. Fully unhinged perturbation.',
  },
  dev: {
    envelope: { cycles: { count: 3 }, cost: { usd: 0.05 } },
    description: 'Tiny envelope, fake LLM. For CI and UI testing.',
    flags: { fake_llm: true },
  },
  eval: {
    envelope: { cycles: { count: 12 }, cost: { usd: 0.50 } },
    description: 'Cached planner, intent-alignment introspection on. Runs against the acceptance corpus.',
    flags: { cached_planner: true, intent_alignment: true },
  },
  custom: {
    envelope: { cycles: { count: 12 }, cost: { usd: 0.50 } },
    description: 'Default template — opens the Schedule view pre-Start for editing.',
  },
};

/**
 * Resolve the effective envelope for a start request.
 *
 *   - mode undefined → preset is not applied; the requested envelope passes
 *     through verbatim (callers that want an unconstrained loop, e.g. unit
 *     tests, get one).
 *   - mode supplied → the explicit request envelope wins per field; missing
 *     fields fall through to the mode's preset.
 *
 * The mode label itself lands on the schedule artifact via
 * `ensureScheduleArtifact`, not on the loops row beyond the separate `mode`
 * column.
 */
export function applyModeEnvelope(mode: Mode | undefined, requested: Envelope | undefined): Envelope {
  const req = requested ?? {};
  if (!mode) return req;
  const preset = MODE_PROFILES[isMode(mode) ? mode : DEFAULT_MODE].envelope;
  return {
    time: req.time ?? preset.time,
    cost: req.cost ?? preset.cost,
    cycles: req.cycles ?? preset.cycles,
    sources: req.sources ?? preset.sources,
  };
}
