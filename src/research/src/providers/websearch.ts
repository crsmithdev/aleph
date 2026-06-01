/**
 * Lightweight web search backends for use with local LLM providers.
 * Priority: Tavily → Brave → DuckDuckGo (no key, limited).
 */
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function fetchSearchResults(query: string): Promise<SearchResult[]> {
  const tavily = process.env.TAVILY_API_KEY;
  const brave = process.env.BRAVE_SEARCH_API_KEY;

  // Each provider failure logs to stderr so the supervisor's stderr capture
  // surfaces *why* search came back empty. Silent fallback through the chain
  // violates "nothing may fail silently" — and produced the dogfood F4 case
  // where all three providers failed (Tavily 432 quota, no Brave key, DDG
  // 403) but the engine got back `[]` and the LLM hallucinated an answer.
  if (tavily) {
    try { return await tavilySearch(query, tavily); }
    catch (err) {
      process.stderr.write(`[websearch] Tavily failed: ${(err as Error).message}\n`);
    }
  }
  if (brave) {
    try { return await braveSearch(query, brave); }
    catch (err) {
      process.stderr.write(`[websearch] Brave failed: ${(err as Error).message}\n`);
    }
  }
  const ddg = await duckduckgoSearch(query);
  if (ddg.length === 0) {
    process.stderr.write(
      `[websearch] all providers returned 0 results for query: ${query.slice(0, 80)}\n`,
    );
  }
  return ddg;
}

async function tavilySearch(query: string, apiKey: string): Promise<SearchResult[]> {
  // Override via TAVILY_BASE_URL for integration tests.
  const base = process.env.TAVILY_BASE_URL ?? 'https://api.tavily.com';
  const res = await fetch(`${base}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: 5,
      include_answer: false,
    }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${await res.text()}`);
  const data = await res.json() as { results: Array<{ title: string; url: string; content: string }> };
  return (data.results ?? []).map(r => ({ title: r.title, url: r.url, snippet: r.content }));
}

async function braveSearch(query: string, apiKey: string): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
  });
  if (!res.ok) throw new Error(`Brave ${res.status}: ${await res.text()}`);
  const data = await res.json() as { web?: { results: Array<{ title: string; url: string; description: string }> } };
  return (data.web?.results ?? []).map(r => ({ title: r.title, url: r.url, snippet: r.description }));
}

async function duckduckgoSearch(query: string): Promise<SearchResult[]> {
  // DuckDuckGo HTML search — no key required (but currently blocked, see below).
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research-agent/1.0)' },
  });
  if (!res.ok) {
    process.stderr.write(`[websearch] DDG HTTP ${res.status} (rate-limit or block); returning []\n`);
    return [];
  }
  const html = await res.text();

  const results: SearchResult[] = [];

  // Extract result blocks: title, URL, snippet
  const blockRe = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null && results.length < 5) {
    const ddgUrl = match[1];
    const title = match[2].replace(/<[^>]+>/g, '').trim();
    const snippet = match[3].replace(/<[^>]+>/g, '').trim();

    // Decode the DDG redirect URL to get the actual URL
    const uddgMatch = ddgUrl.match(/uddg=([^&]+)/);
    const actualUrl = uddgMatch ? decodeURIComponent(uddgMatch[1]) : ddgUrl;

    if (title && snippet) {
      results.push({ title, url: actualUrl, snippet });
    }
  }

  return results;
}

export const JS_RENDERED_FLAG = '[source: js-rendered, text unavailable]';

export interface PageContent {
  title: string;
  url: string;
  publishedTime?: string;
  content: string;
}

export interface FetchResult {
  page: PageContent | null;
  ok: boolean;
  content_length: number;
  error?: string;
}

// Circuit breaker: disabled after first 402 (balance exhausted)
let jinaDisabledReason: string | null = null;

export async function fetchPageContent(url: string): Promise<FetchResult> {
  const jinaKey = process.env.JINA_API_KEY;
  if (!jinaKey) throw new Error('JINA_API_KEY is not set — page content fetch requires Jina');
  if (jinaDisabledReason) return { page: null, ok: false, content_length: 0, error: jinaDisabledReason };
  const result = await fetchViaJina(url, jinaKey);
  if (result.error?.includes('402')) jinaDisabledReason = result.error;
  return { page: result.page, ok: result.page !== null, content_length: result.page?.content.length ?? 0, error: result.error };
}

/** @deprecated Use fetchPageContent */
export async function fetchPageText(url: string): Promise<string> {
  const { page } = await fetchPageContent(url);
  return page?.content ?? '';
}

function isGarbageContent(text: string): boolean {
  const sample = text.slice(0, 1500).toLowerCase();
  // Cookie consent walls
  if (/\b(accept|deny)\b.{0,80}\b(cookie|consent|non-essential)\b/s.test(sample)) return true;
  if (/this (website|site) (utilizes|uses).{0,60}cookie/s.test(sample)) return true;
  if (/error.{0,30}cookie.{0,30}(off|disabled|required)/s.test(sample)) return true;
  // JS-rendered artifacts
  if (/loading \[mathjax\]/.test(sample)) return true;
  if (/\[object object\]/.test(sample)) return true;
  // UI component debris (icon names, search widgets)
  if (/_add_circle_outline_|_remove_circle_outline_|logical operator operator/i.test(sample)) return true;
  // Navigation debris: high density of empty markdown links [](url)
  const emptyLinks = (text.match(/\[\]\(https?:/g) ?? []).length;
  if (emptyLinks >= 4) return true;
  // Paywalled/nav artifact: "opens in a new window" with external link language
  const opensInWindow = (text.match(/opens in a new window/gi) ?? []).length;
  const opensExternal = (text.match(/opens an external (website|link)/gi) ?? []).length;
  if (opensInWindow >= 2 || (opensInWindow >= 1 && opensExternal >= 1)) return true;
  return false;
}

function parseJinaResponse(raw: string, url: string): PageContent | null {
  const titleMatch = raw.match(/^Title:\s*(.+)$/m);
  const urlMatch = raw.match(/^URL Source:\s*(.+)$/m);
  const timeMatch = raw.match(/^Published Time:\s*(.+)$/m);
  const contentStart = raw.indexOf('Markdown Content:');
  const content = contentStart !== -1
    ? raw.slice(contentStart + 'Markdown Content:'.length).trim()
    : raw;
  if (!content || content.length < 200 || isGarbageContent(content)) return null;
  const truncated = content.length > 6000
    ? content.slice(0, content.lastIndexOf('\n', 6000) || 6000)
    : content;
  return {
    title: titleMatch?.[1]?.trim() ?? '',
    url: urlMatch?.[1]?.trim() ?? url,
    publishedTime: timeMatch?.[1]?.trim(),
    content: truncated,
  };
}

async function fetchViaJina(url: string, apiKey: string): Promise<{ page: PageContent | null; error?: string }> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'text/plain',
        'X-Remove-Selector': 'nav, header, footer, aside, [role=navigation], [role=banner], [role=complementary], .nav, .header, .footer, .sidebar, .menu, .breadcrumb',
        'X-Retain-Images': 'none',
        'X-With-Links-Summary': 'false',
      },
    });
    if (!res.ok) return { page: null, error: `HTTP ${res.status} ${res.statusText}` };
    const text = (await res.text()).trim();
    if (!text) return { page: null, error: 'empty response' };
    const page = parseJinaResponse(text, url);
    if (!page) return { page: null, error: 'content filtered (too short, garbage, or paywall)' };
    return { page };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { page: null, error: msg.includes('timed out') || msg.includes('TimeoutError') ? 'timeout' : msg };
  }
}

export async function fetchViaReadability(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research-agent/1.0)' },
    });
    if (!res.ok) {
      process.stderr.write(`[websearch] readability HTTP ${res.status} for ${url}; returning empty\n`);
      return '';
    }
    const html = await res.text();
    const { document } = parseHTML(html);
    const article = new Readability(document as unknown as Document).parse();
    if (!article?.textContent) return JS_RENDERED_FLAG;
    const text = article.textContent
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (text.length < 200 || isGarbageContent(text)) return JS_RENDERED_FLAG;
    if (text.length > 6000) {
      const cut = text.lastIndexOf('\n', 6000);
      return text.slice(0, cut > 3000 ? cut : 6000);
    }
    return text;
  } catch (err) {
    process.stderr.write(`[websearch] readability failed for ${url}: ${(err as Error).message}\n`);
    return '';
  }
}
