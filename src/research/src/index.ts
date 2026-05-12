export { applyResearchDDL } from './ddl.js';
export * from './types.js';
export { ResearchEngine, AnthropicProvider, pickAgentRole, detectQuestionShape, detectTopicCluster, enumerateCanon } from './engine.js';
export type { CanonItem } from './engine.js';
export { getStrategyStats } from './services/perturbation-state.js';
export type { PerturbationStrategyStat } from './services/perturbation-state.js';
export { TrackedLLM } from './services/llm.js';
export type { CallContext } from './services/llm.js';
export type { EngineOptions, LLMProvider, LLMResult, WebSearchResult } from './engine.js';
export * from './services/queries.js';
export { getDefaults, updateDefaults, resetDefaults } from './services/defaults.js';
export * from './services/threads.js';
export * from './services/findings.js';
export * from './services/steps.js';
export * from './services/plans.js';
export * from './services/monitors.js';
export * from './services/jobs.js';
export { classifyError, isTransientError } from './engine.js';
export type { ErrorKind } from './engine.js';
export {
  upsertConcept, linkFindingToConcept, linkConcepts,
  getConcept, findConceptByName, listConcepts, listConceptLinks,
  listFindingsForConcept, listConceptIdsForFinding, getSourcesForConcept,
  findingsMissingConcepts, sessionsMissingConcepts,
} from './services/concepts.js';
export {
  registerSource, registerSources, listSources, getSource,
  countSourcesByStatus, claimPendingSources,
  completeExtraction, failExtraction, retrySource, skipSource,
  findingsCitingSource,
} from './services/sources.js';
export { onResearchEvent, emitResearchEvent, clearResearchListeners } from './services/events.js';
export type { ResearchEvent, ResearchEventType } from './services/events.js';
export {
  computeJobMetrics, computeSourceHealth, computeThreadStateMetrics,
  computeJobTrace, computeSessionCostTrajectory, computeErrorStatus,
} from './services/metrics.js';
export type {
  JobLifecycleMetrics, SourceHealthMetrics, ThreadStateMetrics,
  JobTrace, JobTraceStep, JobTracePhase, SessionCostTrajectory,
  SessionErrorStatus, ErrorStatusReport,
} from './services/metrics.js';
export { MonitorEngine } from './monitor-engine.js';
export type { MonitorEngineOptions } from './monitor-engine.js';
export { OpenRouterProvider, getOpenRouterPricing } from './providers/openrouter.js';
export type { OpenRouterConfig } from './providers/openrouter.js';
export { ModelRouter } from './providers/router.js';
export type { TaskType, ModelConfig, ProviderConfig } from './providers/router.js';
export * from './perturbation.js';
export * from './scheduler.js';
export { fetchPageText, JS_RENDERED_FLAG } from './providers/websearch.js';
export { drainPendingSources } from './extractor.js';
export type { DrainOptions, DrainResult } from './extractor.js';
export * from './hooks/index.js';
export {
  recordIterationCheck, getIterationCheck, listIterationChecks,
} from './services/iteration-checks.js';
export type { IterationCheckRecord, AppliedAction } from './services/iteration-checks.js';
export {
  recordPostMortem, getPostMortem, listPostMortems,
} from './services/post-mortems.js';
export type { PostMortemRecord } from './services/post-mortems.js';

// v1 loop engine — public surface for the new dispatcher (Phase 1+).
export * from './loop/index.js';
