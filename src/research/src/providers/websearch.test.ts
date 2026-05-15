import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { fetchSearchResults } from './websearch.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type MockResponse = {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

function mockFetch(response: MockResponse | (() => Promise<Response>)) {
  if (typeof response === 'function') {
    globalThis.fetch = response as typeof fetch;
  } else {
    globalThis.fetch = async () => response as unknown as Response;
  }
}

// Save and restore env vars per test
let savedEnv: Record<string, string | undefined> = {};

function saveEnv(...keys: string[]) {
  for (const k of keys) savedEnv[k] = process.env[k];
}

function restoreEnv() {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  savedEnv = {};
}

const ENV_KEYS = ['TAVILY_API_KEY', 'BRAVE_SEARCH_API_KEY', 'TAVILY_BASE_URL'];

// Minimal DDG HTML with two results (matches the blockRe in websearch.ts)
function ddgHtml(results: Array<{ title: string; url: string; snippet: string }>) {
  return results
    .map(
      r =>
        `<a class="result__a" href="https://duckduckgo.com/?uddg=${encodeURIComponent(r.url)}">${r.title}</a>` +
        `<a class="result__snippet">${r.snippet}</a>`,
    )
    .join('\n');
}

// ─── Tavily path ──────────────────────────────────────────────────────────────

describe('Tavily path', () => {
  beforeEach(() => {
    saveEnv(...ENV_KEYS);
    delete process.env.BRAVE_SEARCH_API_KEY;
    process.env.TAVILY_API_KEY = 'test-tavily-key';
    process.env.TAVILY_BASE_URL = 'https://mock.tavily.local';
  });

  afterEach(() => {
    restoreEnv();
  });

  it('successful response → normalized SearchResult[]', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { title: 'Page One', url: 'https://example.com/1', content: 'First snippet.' },
          { title: 'Page Two', url: 'https://example.com/2', content: 'Second snippet.' },
        ],
      }),
      text: async () => '',
    });

    const results = await fetchSearchResults('test query');

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: 'Page One', url: 'https://example.com/1', snippet: 'First snippet.' });
    expect(results[1]).toEqual({ title: 'Page Two', url: 'https://example.com/2', snippet: 'Second snippet.' });
  });

  it('Tavily 4xx → falls through to DuckDuckGo', async () => {
    let callCount = 0;
    globalThis.fetch = async (url: string | URL | Request) => {
      callCount++;
      const urlStr = String(url);
      if (urlStr.includes('mock.tavily.local')) {
        return { ok: false, status: 429, text: async () => 'quota exceeded' } as unknown as Response;
      }
      // DDG fallback
      return { ok: true, status: 200, text: async () => '' } as unknown as Response;
    };

    const results = await fetchSearchResults('test query');

    expect(callCount).toBe(2);
    expect(results).toEqual([]);
  });

  it('Tavily network error → falls through to DuckDuckGo', async () => {
    let callCount = 0;
    globalThis.fetch = async (url: string | URL | Request) => {
      callCount++;
      const urlStr = String(url);
      if (urlStr.includes('mock.tavily.local')) {
        throw new Error('ECONNREFUSED');
      }
      return { ok: true, status: 200, text: async () => ddgHtml([]) } as unknown as Response;
    };

    const results = await fetchSearchResults('test query');

    expect(callCount).toBe(2);
    expect(results).toEqual([]);
  });
});

// ─── Brave path ───────────────────────────────────────────────────────────────

describe('Brave path', () => {
  beforeEach(() => {
    saveEnv(...ENV_KEYS);
    delete process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_BASE_URL;
    process.env.BRAVE_SEARCH_API_KEY = 'test-brave-key';
  });

  afterEach(() => {
    restoreEnv();
  });

  it('successful response → normalized SearchResult[]', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        web: {
          results: [
            { title: 'Brave Result A', url: 'https://brave.com/a', description: 'Snippet A.' },
            { title: 'Brave Result B', url: 'https://brave.com/b', description: 'Snippet B.' },
          ],
        },
      }),
      text: async () => '',
    });

    const results = await fetchSearchResults('brave query');

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: 'Brave Result A', url: 'https://brave.com/a', snippet: 'Snippet A.' });
    expect(results[1]).toEqual({ title: 'Brave Result B', url: 'https://brave.com/b', snippet: 'Snippet B.' });
  });

  it('Brave 4xx → falls through to DuckDuckGo', async () => {
    let callCount = 0;
    globalThis.fetch = async (url: string | URL | Request) => {
      callCount++;
      const urlStr = String(url);
      if (urlStr.includes('search.brave.com')) {
        return { ok: false, status: 403, text: async () => 'forbidden' } as unknown as Response;
      }
      return { ok: true, status: 200, text: async () => '' } as unknown as Response;
    };

    const results = await fetchSearchResults('brave query');

    expect(callCount).toBe(2);
    expect(results).toEqual([]);
  });
});

// ─── DuckDuckGo path ──────────────────────────────────────────────────────────

describe('DuckDuckGo path', () => {
  beforeEach(() => {
    saveEnv(...ENV_KEYS);
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.TAVILY_BASE_URL;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('no API keys → calls DDG HTML endpoint and returns results', async () => {
    let capturedUrl = '';
    globalThis.fetch = async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return {
        ok: true,
        status: 200,
        text: async () =>
          ddgHtml([{ title: 'DDG Result', url: 'https://example.org/ddg', snippet: 'DDG snippet.' }]),
      } as unknown as Response;
    };

    const results = await fetchSearchResults('ddg query');

    expect(capturedUrl).toContain('html.duckduckgo.com');
    expect(capturedUrl).toContain(encodeURIComponent('ddg query'));
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ title: 'DDG Result', url: 'https://example.org/ddg', snippet: 'DDG snippet.' });
  });

  it('DDG 4xx → returns [] and logs to stderr', async () => {
    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    };

    mockFetch({ ok: false, status: 403, text: async () => 'blocked' });

    try {
      const results = await fetchSearchResults('blocked query');
      expect(results).toEqual([]);
      expect(stderrChunks.some(s => s.includes('DDG HTTP 403'))).toBe(true);
    } finally {
      process.stderr.write = origWrite;
    }
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {
  beforeEach(() => {
    saveEnv(...ENV_KEYS);
  });

  afterEach(() => {
    restoreEnv();
  });

  it('empty results from Tavily → returns []', async () => {
    delete process.env.BRAVE_SEARCH_API_KEY;
    process.env.TAVILY_API_KEY = 'test-tavily-key';
    process.env.TAVILY_BASE_URL = 'https://mock.tavily.local';

    mockFetch({ ok: true, status: 200, json: async () => ({ results: [] }), text: async () => '' });

    const results = await fetchSearchResults('empty');
    expect(results).toEqual([]);
  });

  it('all providers fail → Tavily+Brave are swallowed, DDG error propagates', async () => {
    process.env.TAVILY_API_KEY = 'test-tavily-key';
    process.env.TAVILY_BASE_URL = 'https://mock.tavily.local';
    process.env.BRAVE_SEARCH_API_KEY = 'test-brave-key';

    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      throw new Error('network failure');
    };

    // Tavily and Brave errors are caught and logged; DDG is not wrapped so its
    // error propagates out of fetchSearchResults.
    await expect(fetchSearchResults('all fail')).rejects.toThrow('network failure');
    expect(callCount).toBe(3);
  });
});
