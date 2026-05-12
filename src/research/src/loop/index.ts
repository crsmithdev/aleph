/**
 * Loop engine — v1 rewrite. Public surface for the @construct/research package.
 *
 * Importers should reach for this barrel (or its re-export from the package
 * root) rather than internal files, so we can refactor module layout without
 * breaking downstream code.
 */
export type {
  LoopId, CycleId, ArtifactId, MilestoneId,
  Envelope, EnvelopeUsage,
  Loop, LoopStatus,
  Cycle, CycleStatus,
  Artifact, ArtifactKind,
  CycleLedgerEntry, LedgerStep,
  Milestone,
  LoopState, StopDecision, Template,
  OutputShape, SchedulePayload,
  Branch, LoopSchedule,
} from './types.js';

export { detectOutputShape, ensureScheduleArtifact, readScheduleFromArtifacts } from './shape.js';
export { planLoop } from './planner.js';

export {
  createLoop, getLoop, listLoops, updateLoopStatus, updateLoopChildPid,
  bumpUsage, readState,
  createCycle, getCycle, listCycles, findInProgressCycle,
  markCycleRunning, markCycleFinalized,
  createArtifact, getArtifact, listArtifacts,
  createMilestone, listMilestones,
} from './db.js';

export { runLoop } from './engine.js';
export type { LoopRunResult } from './engine.js';

export {
  inputHash, lookupOutput, recordEntry, listEntries, runOnce,
} from './ledger.js';

export {
  exhaustedLimit, envelopePercent, consume, crossedThresholds,
} from './envelope.js';

export { makeNoopTemplate } from './templates/noop.js';
export { makeResearchTemplate } from './templates/research.js';
export type { ResearchTemplateOptions, ResearchTemplateDeps } from './templates/research.js';
export { makeMonitorTemplate } from './templates/monitor.js';
export type { MonitorTemplateOptions, MonitorTemplateDeps } from './templates/monitor.js';
export { buildTemplate, listTemplateIds } from './templates/registry.js';
export type { TemplateOverrides, TemplateDeps } from './templates/registry.js';

export { FakeLLMProvider } from './llm.js';
export type { LLMProvider, LLMResult, WebSearchResult, SearchOptions, SourceMeta } from './llm.js';
