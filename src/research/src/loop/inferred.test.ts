/**
 * detectQuestionShape + detectRole — Phase 6 InferredPanel detectors. Both
 * are one-shot LLM calls with tolerant JSON parsing and safe fallbacks.
 */
import { describe, test, expect } from 'bun:test';
import { FakeLLMProvider } from './llm';
import { detectQuestionShape, detectRole } from './shape';

describe('detectQuestionShape', () => {
  test.each([
    ['survey', '{"shape":"survey"}'],
    ['timeline', '{"shape":"timeline"}'],
    ['list', '{"shape":"list"}'],
    ['dynamics', '{"shape":"dynamics"}'],
    ['comparison', '{"shape":"comparison"}'],
    ['lookup', '{"shape":"lookup"}'],
    ['audit', '{"shape":"audit"}'],
  ])('valid response → %s', async (expected, response) => {
    const llm = new FakeLLMProvider({ complete: () => response });
    const shape = await detectQuestionShape('q', llm);
    expect(shape).toBe(expected);
  });

  test('strips markdown fences', async () => {
    const llm = new FakeLLMProvider({ complete: () => '```json\n{"shape":"comparison"}\n```' });
    expect(await detectQuestionShape('q', llm)).toBe('comparison');
  });

  test('unknown shape value → survey fallback', async () => {
    const llm = new FakeLLMProvider({ complete: () => '{"shape":"garbage"}' });
    expect(await detectQuestionShape('q', llm)).toBe('survey');
  });

  test('malformed JSON → survey fallback', async () => {
    const llm = new FakeLLMProvider({ complete: () => 'not json at all' });
    expect(await detectQuestionShape('q', llm)).toBe('survey');
  });

  test('LLM error → survey fallback', async () => {
    const llm = new FakeLLMProvider({
      complete: () => { throw new Error('upstream unavailable'); },
    });
    expect(await detectQuestionShape('q', llm)).toBe('survey');
  });
});

describe('detectRole', () => {
  test('valid response → role label', async () => {
    const llm = new FakeLLMProvider({ complete: () => '{"role":"Music historian"}' });
    expect(await detectRole('q', llm)).toBe('Music historian');
  });

  test('trims whitespace', async () => {
    const llm = new FakeLLMProvider({ complete: () => '{"role":"  Software engineer  "}' });
    expect(await detectRole('q', llm)).toBe('Software engineer');
  });

  test('strips markdown fences', async () => {
    const llm = new FakeLLMProvider({ complete: () => '```\n{"role":"Data scientist"}\n```' });
    expect(await detectRole('q', llm)).toBe('Data scientist');
  });

  test('empty role → empty string', async () => {
    const llm = new FakeLLMProvider({ complete: () => '{"role":""}' });
    expect(await detectRole('q', llm)).toBe('');
  });

  test('over-long role → empty string', async () => {
    const llm = new FakeLLMProvider({ complete: () => `{"role":"${'x'.repeat(80)}"}` });
    expect(await detectRole('q', llm)).toBe('');
  });

  test('malformed JSON → empty string', async () => {
    const llm = new FakeLLMProvider({ complete: () => 'just prose' });
    expect(await detectRole('q', llm)).toBe('');
  });

  test('LLM error → empty string', async () => {
    const llm = new FakeLLMProvider({
      complete: () => { throw new Error('boom'); },
    });
    expect(await detectRole('q', llm)).toBe('');
  });
});
