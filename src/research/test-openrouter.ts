import { Database } from 'bun:sqlite';
import { applyResearchDDL } from './src/ddl.js';
import { ResearchEngine } from './src/engine.js';
import { OpenRouterProvider } from './src/providers/openrouter.js';
import * as sessions from './src/services/sessions.js';
import * as findings from './src/services/findings.js';

const apiKey = await Bun.file(Bun.env.HOME + '/.openrouter_key').text().then(s => s.trim());

const sqlite = new Database(':memory:');
sqlite.exec('PRAGMA journal_mode = WAL');
sqlite.exec('PRAGMA foreign_keys = ON');
applyResearchDDL(sqlite);

const provider = new OpenRouterProvider({
  apiKey,
  models: ['deepseek/deepseek-chat'],
});

const ac = new AbortController();
setTimeout(() => ac.abort(), 90_000);

const engine = new ResearchEngine({
  sqlite,
  provider,
  maxIterations: 4,
  signal: ac.signal,
  onIteration: (iter, thread, finding) => {
    console.log(`  iter ${iter} | "${thread.query.slice(0, 60)}" | ${finding ? `conf=${finding.confidence.toFixed(2)} novelty=${finding.novelty.toFixed(2)}` : 'no finding'}`);
  },
  onError: (err, thread) => {
    console.error(`  error: ${err.message.slice(0, 100)}`);
  },
});

const session = await engine.startSession(
  'OpenRouter test',
  'What are the main tradeoffs between RAG and fine-tuning for LLMs?',
  {
    max_thread_depth: 2,
    model: 'deepseek/deepseek-chat',
    models: { cheap: 'deepseek/deepseek-chat', mid: 'deepseek/deepseek-chat', deep: 'deepseek/deepseek-chat' },
  }
);

console.log(`Session: ${session.id}`);
console.log(`Query: "${session.seed_query}"\n`);

try {
  const result = await engine.runIterations(session.id);
  console.log(`\nCompleted: ${result.iterations} iterations, ${result.findings} findings, $${result.cost.toFixed(6)}`);
} catch (e: any) {
  if (e?.name !== 'AbortError') throw e;
  console.log('\n(timed out after 90s)');
}

const cost = sessions.getSessionCost(sqlite, session.id);
console.log(`Total cost: $${cost.total_cost.toFixed(6)} across ${cost.step_count} steps`);

const allFindings = findings.getFindings(sqlite, session.id);
console.log(`\nTop findings (${allFindings.length} total):`);
for (const f of allFindings.slice(0, 5)) {
  console.log(`  [conf=${f.confidence.toFixed(2)} novelty=${f.novelty.toFixed(2)}] ${f.content.slice(0, 150)}`);
}
