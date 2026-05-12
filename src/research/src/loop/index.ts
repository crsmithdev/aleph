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
} from './types.js';

export {
  createLoop, getLoop, updateLoopStatus, updateLoopChildPid,
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
