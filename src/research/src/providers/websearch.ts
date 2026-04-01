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
  // DuckDuckGo instant answers — limited but no key required
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'research-agent/1.0' } });
  if (!res.ok) return [];
  const data = await res.json() as {
    AbstractText?: string;
    AbstractURL?: string;
    AbstractSource?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
  };

  const results: SearchResult[] = [];
  if (data.AbstractText) {
    results.push({ title: data.AbstractSource ?? query, url: data.AbstractURL ?? '', snippet: data.AbstractText });
  }
  for (const t of (data.RelatedTopics ?? []).slice(0, 4)) {
    if (t.Text && t.FirstURL) {
      results.push({ title: t.Text.slice(0, 80), url: t.FirstURL, snippet: t.Text });
    }
  }
  return results;
}
