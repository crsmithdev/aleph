import { describe, test, expect } from 'bun:test';
import { createPreDispatchHandler } from './pre-dispatch.js';

function mockFetch(response: unknown, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => response,
  })) as unknown as typeof fetch;
}

function llmReply(content: string) {
  return { choices: [{ message: { content } }] };
}

describe('pre_dispatch handler', () => {
  test('parses valid JSON into InterpretedPrompt', async () => {
    const handler = createPreDispatchHandler({
      apiKey: 'test-key',
      fetchImpl: mockFetch(llmReply(JSON.stringify({
        intent: 'find out how LLMs work',
        shape: 'answer',
        depth: 'normal',
        scope: 'broad',
      }))),
    });

    const invocation = await handler({
      query_id: 'q1', prompt: 'how do LLMs work', hints: {},
    });

    expect(invocation?.interpretation).toBeDefined();
    expect(invocation?.interpretation?.intent).toBe('find out how LLMs work');
    expect(invocation?.interpretation?.shape).toBe('answer');
    expect(invocation?.interpretation?.depth).toBe('normal');
    expect(invocation?.interpretation?.scope).toBe('broad');
  });

  test('surfaces clarifying_question when returned', async () => {
    const handler = createPreDispatchHandler({
      apiKey: 'test',
      fetchImpl: mockFetch(llmReply(JSON.stringify({
        intent: 'ambiguous',
        shape: 'answer',
        depth: 'normal',
        scope: 'x',
        clarifying_question: 'do you mean A or B?',
      }))),
    });

    const result = await handler({ query_id: 'q1', prompt: 'x', hints: {} });
    expect(result?.clarifying_question).toBe('do you mean A or B?');
  });

  test('rejects response with invalid shape value', async () => {
    const handler = createPreDispatchHandler({
      apiKey: 'test',
      fetchImpl: mockFetch(llmReply(JSON.stringify({
        intent: 'x', shape: 'essay', depth: 'normal', scope: 'y',
      }))),
    });

    const result = await handler({ query_id: 'q1', prompt: 'x', hints: {} });
    expect(result).toBeNull();
  });

  test('rejects response with missing required field', async () => {
    const handler = createPreDispatchHandler({
      apiKey: 'test',
      fetchImpl: mockFetch(llmReply(JSON.stringify({
        intent: 'x', shape: 'answer', depth: 'normal',
        // scope missing
      }))),
    });

    const result = await handler({ query_id: 'q1', prompt: 'x', hints: {} });
    expect(result).toBeNull();
  });

  test('returns null when LLM returns empty content', async () => {
    const handler = createPreDispatchHandler({
      apiKey: 'test',
      fetchImpl: mockFetch(llmReply('')),
    });

    const result = await handler({ query_id: 'q1', prompt: 'x', hints: {} });
    expect(result).toBeNull();
  });

  test('returns null when LLM returns non-JSON', async () => {
    const handler = createPreDispatchHandler({
      apiKey: 'test',
      fetchImpl: mockFetch(llmReply('sorry I cannot help')),
    });

    const result = await handler({ query_id: 'q1', prompt: 'x', hints: {} });
    expect(result).toBeNull();
  });

  test('throws on HTTP error (lets hook registry record as error)', async () => {
    const handler = createPreDispatchHandler({
      apiKey: 'test',
      fetchImpl: mockFetch({}, 500),
    });

    await expect(
      handler({ query_id: 'q1', prompt: 'x', hints: {} })
    ).rejects.toThrow();
  });

  test('forwards hints into user content', async () => {
    let seenBody: string | null = null;
    const captureFetch: typeof fetch = (async (_url: string, init?: RequestInit) => {
      seenBody = init?.body as string;
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => llmReply(JSON.stringify({
          intent: 'x', shape: 'list', depth: 'deep', scope: 'y',
        })),
      };
    }) as unknown as typeof fetch;

    const handler = createPreDispatchHandler({ apiKey: 'test', fetchImpl: captureFetch });
    await handler({
      query_id: 'q1', prompt: 'tell me about X',
      hints: { shape: 'list', depth: 'deep' },
    });

    expect(seenBody).toBeTruthy();
    const parsed = JSON.parse(seenBody!) as { messages: Array<{ role: string; content: string }> };
    const userMsg = parsed.messages.find(m => m.role === 'user');
    expect(userMsg?.content).toContain('tell me about X');
    expect(userMsg?.content).toContain('shape: list');
    expect(userMsg?.content).toContain('depth: deep');
  });
});
