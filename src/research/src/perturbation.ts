import type { PerturbationStrategy, PerturbationConfig } from './types.js';

// All 21 strategies organized by category
export const STRATEGY_CATEGORIES: Record<string, PerturbationStrategy[]> = {
  perspective_shifts: ['analogical', 'contrarian', 'persona_injection', 'negation'],
  dimensional_shifts: ['geographic', 'temporal_shift', 'scale_shift', 'economics'],
  network_walking: ['citation_chain', 'social_graph', 'adjacent_community', 'supply_chain'],
  knowledge_injection: ['news_injection', 'cross_session', 'user_interest', 'metaphor'],
  deepening: ['people_deep_dive', 'failure_post_mortem', 'second_order', 'regulatory', 'academic'],
};

export const ALL_STRATEGIES: PerturbationStrategy[] = Object.values(STRATEGY_CATEGORIES).flat();

// Breadth strategies favored early, depth strategies favored later
const EARLY_STRATEGIES: PerturbationStrategy[] = [
  'geographic', 'temporal_shift', 'scale_shift', 'analogical', 'contrarian',
  'persona_injection', 'negation', 'economics',
];
const LATE_STRATEGIES: PerturbationStrategy[] = [
  'citation_chain', 'social_graph', 'adjacent_community', 'supply_chain',
  'people_deep_dive', 'second_order', 'regulatory', 'academic',
];

export interface PerturbationState {
  recentStrategies: PerturbationStrategy[];
  strategyUseCounts: Record<string, number>;
  strategySuccessCounts: Record<string, number>;
  lastDomains: string[];
  iterationCount: number;
}

export function createPerturbationState(): PerturbationState {
  return {
    recentStrategies: [],
    strategyUseCounts: {},
    strategySuccessCounts: {},
    lastDomains: [],
    iterationCount: 0,
  };
}

export function shouldPerturbate(
  config: PerturbationConfig,
  pSerendipity: number,
  maxP: number,
  depth: number,
  maxDepth: number,
  state: PerturbationState
): boolean {
  // Depth-scaled probability
  let p = pSerendipity;
  if (config.depth_scaling) {
    p += (depth / maxDepth) * 0.15;
  }
  p = Math.min(p, maxP);

  // Forced diversity: if last N findings are from same domain, force perturbation
  if (state.lastDomains.length >= config.forced_diversity_threshold) {
    const unique = new Set(state.lastDomains.slice(-config.forced_diversity_threshold));
    if (unique.size === 1) return true;
  }

  return Math.random() < p;
}

export function selectStrategy(
  config: PerturbationConfig,
  state: PerturbationState
): PerturbationStrategy {
  // Filter out recently used strategies (cooldown)
  const cooldownSet = new Set(state.recentStrategies.slice(-config.strategy_cooldown));

  // Phase awareness: early iterations favor breadth, late favor depth
  const earlyPhase = state.iterationCount < 20;
  const phaseStrategies = earlyPhase ? EARLY_STRATEGIES : LATE_STRATEGIES;

  // Build weighted candidate list
  const candidates: Array<{ strategy: PerturbationStrategy; weight: number }> = [];

  for (const strategy of ALL_STRATEGIES) {
    if (cooldownSet.has(strategy)) continue;

    let weight = config.strategy_weights[strategy] ?? 0.5;

    // Phase bias
    if (phaseStrategies.includes(strategy)) weight *= 1.3;

    // Fruitfulness tracking: boost strategies that have produced high-novelty findings
    const uses = state.strategyUseCounts[strategy] ?? 0;
    const successes = state.strategySuccessCounts[strategy] ?? 0;
    if (uses > 0) {
      const successRate = successes / uses;
      weight *= (0.7 + 0.6 * successRate); // 0.7 to 1.3 multiplier
    }

    candidates.push({ strategy, weight });
  }

  // If no candidates (all on cooldown), use any strategy
  if (candidates.length === 0) {
    return ALL_STRATEGIES[Math.floor(Math.random() * ALL_STRATEGIES.length)];
  }

  // Weighted random selection
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const candidate of candidates) {
    rand -= candidate.weight;
    if (rand <= 0) return candidate.strategy;
  }

  return candidates[candidates.length - 1].strategy;
}

export function recordStrategyUse(state: PerturbationState, strategy: PerturbationStrategy): void {
  state.recentStrategies.push(strategy);
  state.strategyUseCounts[strategy] = (state.strategyUseCounts[strategy] ?? 0) + 1;
}

export function recordStrategySuccess(state: PerturbationState, strategy: PerturbationStrategy): void {
  state.strategySuccessCounts[strategy] = (state.strategySuccessCounts[strategy] ?? 0) + 1;
}

export function updateDomainTracker(state: PerturbationState, domain: string): void {
  state.lastDomains.push(domain);
  if (state.lastDomains.length > 10) state.lastDomains.shift();
}

// Prompt generators for all 21 strategies
export function generatePerturbationPrompt(
  strategy: PerturbationStrategy,
  seedQuery: string,
  context: string,
  personas?: string[],
  seedWords?: string[]
): string {
  const base = `Given this research topic: "${seedQuery}"\nAnd these recent findings:\n${context}\n\n`;

  const prompts: Record<PerturbationStrategy, string> = {
    analogical: `${base}Think of a completely different field or domain that has solved a similar problem or faced analogous challenges. Generate ONE specific search query to explore that analogy.`,

    contrarian: `${base}Generate ONE specific search query that explores the strongest counterargument, opposing viewpoint, or reason why the premise might be wrong. Be concrete, not just "criticism of X."`,

    persona_injection: (() => {
      const persona = personas?.length
        ? personas[Math.floor(Math.random() * personas.length)]
        : 'emergency room nurse';
      return `${base}You are a ${persona}. From your professional perspective, what would be the most important aspect of this topic to investigate? Generate ONE specific search query from this viewpoint.`;
    })(),

    negation: `${base}Who deliberately chose NOT to do this, and why? Generate ONE specific search query to find examples of deliberate rejection or alternative paths.`,

    geographic: (() => {
      const regions = ['Japan', 'Scandinavia', 'Sub-Saharan Africa', 'Southeast Asia', 'Eastern Europe', 'South America', 'Middle East', 'Australia', 'India', 'Canada'];
      const region = regions[Math.floor(Math.random() * regions.length)];
      return `${base}How is this topic approached in ${region}? Generate ONE specific search query exploring this topic from that geographic/cultural perspective.`;
    })(),

    temporal_shift: `${base}Generate ONE specific search query that shifts the temporal frame — either how this was understood 20-50 years ago, or projecting forward 10-20 years.`,

    scale_shift: `${base}What happens if you make this 10x bigger, 10x smaller, 10x cheaper, or 10x more expensive? Generate ONE specific search query exploring an extreme scale shift.`,

    economics: `${base}What makes this economically unviable, or what would make it 10x more accessible? Generate ONE specific search query exploring the economic extremes.`,

    citation_chain: `${base}Follow the reference chain: what seminal paper, book, or study is most cited in this area? Generate ONE search query to find foundational work 2 hops away from the original topic.`,

    social_graph: `${base}Who are the key people mentioned in these findings? What ELSE do they work on? Generate ONE search query to explore the adjacent work of a key figure.`,

    adjacent_community: `${base}What else do communities discussing this topic also discuss? Generate ONE search query to discover adjacent interests and overlapping communities.`,

    supply_chain: `${base}Trace the dependency graph — what inputs does this depend on, and what depends on it downstream? Generate ONE search query exploring the supply chain in either direction.`,

    news_injection: `${base}What recent news (last 30 days) might connect to this topic in unexpected ways? Generate ONE search query combining this topic with current events.`,

    cross_session: `${base}Generate ONE search query that bridges this topic with a seemingly unrelated domain, looking for unexpected connections.`,

    user_interest: `${base}Generate ONE search query that bridges this topic with music production, DJ equipment, or audio engineering — exploring unexpected connections.`,

    metaphor: `${base}Generate a vivid metaphor for this topic, then create ONE search query to research the metaphorical domain itself (not the original topic).`,

    people_deep_dive: `${base}Find contrarian or deeply experienced voices on this topic. Generate ONE search query to find specific individuals who have unusual or strong perspectives.`,

    failure_post_mortem: `${base}Generate ONE search query to find stories of failure, post-mortems, or things that went wrong. Look for specific incidents and cautionary tales.`,

    second_order: `${base}What are the consequences of the consequences? Generate ONE search query exploring second-order effects that aren't immediately obvious.`,

    regulatory: `${base}What regulations, laws, zoning rules, or legal frameworks affect this? Generate ONE search query for regulatory/legal considerations.`,

    academic: `${base}Generate ONE search query targeting academic papers, patent filings, or peer-reviewed research on this topic or closely adjacent areas.`,
  };

  const prompt = prompts[strategy];

  // Inject seed word for variety if provided
  const seedWord = seedWords?.length
    ? seedWords[Math.floor(Math.random() * seedWords.length)]
    : null;

  const suffix = seedWord
    ? `\n\nLet the word "${seedWord}" subtly influence your thinking as you generate the query.`
    : '';

  return `${prompt}${suffix}\n\nReturn ONLY the search query text, nothing else.`;
}

// Mechanism perturbations
export interface MechanismPerturbation {
  temperatureOverride?: number;
  modelOverride?: string;
  seedWordInjection?: string;
  sourceTypeForcing?: string;
  recencyInversion?: boolean;
}

export function getMechanismPerturbation(
  seedWords?: string[],
  openrouterModels?: string[]
): MechanismPerturbation | null {
  const roll = Math.random();

  if (roll < 0.2) {
    // Temperature jitter
    return { temperatureOverride: 0.8 + Math.random() * 0.4 }; // 0.8-1.2
  }

  if (roll < 0.4 && openrouterModels?.length) {
    // Model rotation
    return { modelOverride: openrouterModels[Math.floor(Math.random() * openrouterModels.length)] };
  }

  if (roll < 0.6 && seedWords?.length) {
    // Random seed word injection
    return { seedWordInjection: seedWords[Math.floor(Math.random() * seedWords.length)] };
  }

  if (roll < 0.8) {
    // Source type forcing
    const sources = ['reddit', 'academic papers', 'YouTube transcripts', 'government reports', 'forum discussions', 'news articles'];
    return { sourceTypeForcing: sources[Math.floor(Math.random() * sources.length)] };
  }

  if (roll < 0.95) {
    // Recency inversion
    return { recencyInversion: true };
  }

  return null;
}
