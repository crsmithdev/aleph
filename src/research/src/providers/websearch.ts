/**
 * Lightweight web search backends for use with local LLM providers.
 * Priority: Tavily → Brave → DuckDuckGo (no key, limited).
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function fetchSearchResults(query: string): Promise<SearchResult[]> {
  const tavily = process.env.TAVILY_API_KEY;
  const brave = process.env.BRAVE_SEARCH_API_KEY;

  if (tavily) return tavilySearch(query, tavily);
  if (brave) return braveSearch(query, brave);
  return duckduckgoSearch(query);
}

async function tavilySearch(query: string, apiKey: string): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
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
  // DuckDuckGo HTML search — no key required
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research-agent/1.0)' },
  });
  if (!res.ok) return [];
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
