/**
 * Tests for document and summary pipeline: updateDocument, updateSummary.
 * Both methods are called periodically after iterations and can be called directly.
 * No API calls needed — mock provider used throughout.
 */
import { Database } from 'bun:sqlite';
import { describe, test, expect, beforeEach } from 'bun:test';
import { applyResearchDDL } from './ddl';
import { ResearchEngine, type LLMProvider, type LLMResult, type WebSearchResult } from './engine';
import * as queries from './services/queries';
import * as threads from './services/threads';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(db);
  return db;
}

class MockProvider implements LLMProvider {
  private completeQ: string[] = [];
  private ci = 0;

  push(...texts: string[]): this { this.completeQ.push(...texts); return this; }

  async complete(model: string, _prompt: string): Promise<LLMResult> {
    const text = this.completeQ.length > 0
      ? this.completeQ[this.ci++ % this.completeQ.length]
      : 'Generated content for the document.';
    return { text, promptTokens: 500, completionTokens: 300, model };
  }

  async searchWeb(model: string, query: string): Promise<WebSearchResult> {
    return { text: `Results for ${query}`, sourceUrls: ['https://example.com'], promptTokens: 500, completionTokens: 200, model };
  }
}

function seedFinding(db: Database, sessionId: string, threadId: string, i: number) {
  db.prepare(`
    INSERT INTO research_findings
      (id, thread_id, session_id, content, summary, source_urls, source_texts, source_url_meta,
       source_quality, tags, confidence, novelty, actionability, follow_ups, created_at)
    VALUES (?, ?, ?, ?, ?, '[]', '[]', '[]', 0.8, '["test"]', 0.85, 0.7, 0.6, '[]', datetime('now'))
  `).run(
    `finding-${i}`,
    threadId,
    sessionId,
    `Full content of finding ${i} with several sentences of detail about the research topic.`,
    `Summary of finding ${i}`
  );
}

// ========== updateDocument ==========

describe('updateDocument', () => {
  let db: Database;
  let sessionId: string;
  let threadId: string;

  beforeEach(() => {
    db = createTestDb();
    const session = queries.createQuery(db, 'Test', 'test topic');
    sessionId = session.id;
    const thread = threads.createThread(db, { session_id: sessionId, query: 'test topic', origin: 'seed' });
    threadId = thread.id;
  });

  test('no-op when fewer than 3 findings — document stays empty', async () => {
    seedFinding(db, sessionId, threadId, 1);
    seedFinding(db, sessionId, threadId, 2);

    const provider = new MockProvider().push('Should not be called');
    const engine = new ResearchEngine({ sqlite: db, provider });
    await engine.updateDocument(sessionId);

    expect(queries.getQuery(db, sessionId)!.document).toBe('');
  });

  test('writes article text to session.document with 3+ findings', async () => {
    for (let i = 0; i < 3; i++) seedFinding(db, sessionId, threadId, i);

    const articleText = '# Test Topic\n\nThis is the generated article.';
    const provider = new MockProvider().push(articleText);
    const engine = new ResearchEngine({ sqlite: db, provider });
    await engine.updateDocument(sessionId);

    const updated = queries.getQuery(db, sessionId)!;
    expect(updated.document).toBe(articleText);
  });

  test('overwrites previous document on repeated calls', async () => {
    for (let i = 0; i < 3; i++) seedFinding(db, sessionId, threadId, i);

    const provider = new MockProvider().push('First version').push('Second version');
    const engine = new ResearchEngine({ sqlite: db, provider });

    await engine.updateDocument(sessionId);
    expect(queries.getQuery(db, sessionId)!.document).toBe('First version');

    await engine.updateDocument(sessionId);
    expect(queries.getQuery(db, sessionId)!.document).toBe('Second version');
  });

  test('invokes LLM exactly once with 3+ findings', async () => {
    for (let i = 0; i < 3; i++) seedFinding(db, sessionId, threadId, i);

    let callCount = 0;
    const provider: LLMProvider = {
      async complete(model, _prompt) {
        callCount++;
        return { text: 'Article.', promptTokens: 100, completionTokens: 50, model };
      },
      async searchWeb(model, query) {
        return { text: '', sourceUrls: [], promptTokens: 0, completionTokens: 0, model };
      },
    };

    const engine = new ResearchEngine({ sqlite: db, provider });
    await engine.updateDocument(sessionId);
    expect(callCount).toBe(1);
  });

  test('document contains prompt in context (mock sees prompts)', async () => {
    for (let i = 0; i < 3; i++) seedFinding(db, sessionId, threadId, i);

    const seenPrompts: string[] = [];
    const provider: LLMProvider = {
      async complete(model, prompt) {
        seenPrompts.push(prompt);
        return { text: 'Article.', promptTokens: 100, completionTokens: 50, model };
      },
      async searchWeb(model, query) {
        return { text: '', sourceUrls: [], promptTokens: 0, completionTokens: 0, model };
      },
    };

    const engine = new ResearchEngine({ sqlite: db, provider });
    await engine.updateDocument(sessionId);

    expect(seenPrompts.some(p => p.includes('test topic'))).toBe(true);
  });
});

// ========== updateSummary ==========

describe('updateSummary', () => {
  let db: Database;
  let sessionId: string;
  let threadId: string;

  beforeEach(() => {
    db = createTestDb();
    const session = queries.createQuery(db, 'Test', 'organic farming practices');
    sessionId = session.id;
    const thread = threads.createThread(db, { session_id: sessionId, query: 'organic farming practices', origin: 'seed' });
    threadId = thread.id;
  });

  test('no-op when session has no findings — summary stays empty', async () => {
    const provider = new MockProvider().push('Should not be called');
    const engine = new ResearchEngine({ sqlite: db, provider });
    await (engine as any).updateSummary(sessionId);

    expect(queries.getQuery(db, sessionId)!.summary).toBe('');
  });

  test('writes summary text to session.summary with findings present', async () => {
    seedFinding(db, sessionId, threadId, 0);
    const summaryText = 'Research has revealed several key insights about organic farming.';
    const provider = new MockProvider().push(summaryText);
    const engine = new ResearchEngine({ sqlite: db, provider });
    await (engine as any).updateSummary(sessionId);

    expect(queries.getQuery(db, sessionId)!.summary).toBe(summaryText);
  });

  test('invokes LLM exactly once when findings are present', async () => {
    seedFinding(db, sessionId, threadId, 0);
    let callCount = 0;
    const provider: LLMProvider = {
      async complete(model, _prompt) {
        callCount++;
        return { text: 'Summary.', promptTokens: 100, completionTokens: 50, model };
      },
      async searchWeb(model, query) {
        return { text: '', sourceUrls: [], promptTokens: 0, completionTokens: 0, model };
      },
    };
    const engine = new ResearchEngine({ sqlite: db, provider });
    await (engine as any).updateSummary(sessionId);
    expect(callCount).toBe(1);
  });

  test('summary LLM prompt includes prompt and finding summaries', async () => {
    seedFinding(db, sessionId, threadId, 0);

    const seenPrompts: string[] = [];
    const provider: LLMProvider = {
      async complete(model, prompt) {
        seenPrompts.push(prompt);
        return { text: 'Summary text.', promptTokens: 100, completionTokens: 50, model };
      },
      async searchWeb(model, query) {
        return { text: '', sourceUrls: [], promptTokens: 0, completionTokens: 0, model };
      },
    };

    const engine = new ResearchEngine({ sqlite: db, provider });
    await (engine as any).updateSummary(sessionId);

    const prompt = seenPrompts[0] ?? '';
    expect(prompt).toContain('organic farming practices');
    expect(prompt).toContain('Summary of finding 0');
  });

  test('includes previous summary in prompt when one already exists', async () => {
    seedFinding(db, sessionId, threadId, 0);
    queries.updateQuery(db, sessionId, { summary: 'Prior summary text.' });

    const seenPrompts: string[] = [];
    const provider: LLMProvider = {
      async complete(model, prompt) {
        seenPrompts.push(prompt);
        return { text: 'Updated summary.', promptTokens: 100, completionTokens: 50, model };
      },
      async searchWeb(model, query) {
        return { text: '', sourceUrls: [], promptTokens: 0, completionTokens: 0, model };
      },
    };

    const engine = new ResearchEngine({ sqlite: db, provider });
    await (engine as any).updateSummary(sessionId);

    expect(seenPrompts[0]).toContain('Prior summary text.');
  });

  test('summary and document both written after first exhausted thread', async () => {
    // Pre-seed 3 findings so document generation succeeds
    for (let i = 0; i < 3; i++) seedFinding(db, sessionId, threadId, i);

    const summaryText = 'Comprehensive research summary.';
    const docText = '# Organic Farming\n\nDetailed article.';
    const provider = new MockProvider().push(summaryText).push(docText);

    const engine = new ResearchEngine({ sqlite: db, provider });
    await (engine as any).updateSummary(sessionId);
    await engine.updateDocument(sessionId);

    const updated = queries.getQuery(db, sessionId)!;
    expect(updated.summary).toBe(summaryText);
    expect(updated.document).toBe(docText);
  });
});
