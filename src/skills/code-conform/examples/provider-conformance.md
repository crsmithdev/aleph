---
title: Search-provider error-handling shape
dimension: Behavioral + Surface
---

# Provider conformance — three peers, one outlier

The lesson: when a module has N parallel "provider" implementations of the same interface (search backends, LLM backends, storage backends), they should fail in the same shape. One outlier silently returning `[]` while the others throw means the orchestrator can't tell *which* provider failed and *why*.

## The reference

`src/research/src/providers/websearch.ts` defines three search providers wired into one `fetchSearchResults` orchestrator that walks them in priority order. The two well-shaped peers throw on `!res.ok` — the orchestrator's `try { ... } catch` catches and falls through:

```ts
async function tavilySearch(query: string, apiKey: string): Promise<SearchResult[]> {
  const base = process.env.TAVILY_BASE_URL ?? 'https://api.tavily.com';
  const res = await fetch(`${base}/search`, { ... });
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${await res.text()}`);
  const data = await res.json() as { results: Array<{ title: string; url: string; content: string }> };
  return (data.results ?? []).map(r => ({ title: r.title, url: r.url, snippet: r.content }));
}

async function braveSearch(query: string, apiKey: string): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  const res = await fetch(url, { ... });
  if (!res.ok) throw new Error(`Brave ${res.status}: ${await res.text()}`);
  const data = await res.json() as { web?: { results: Array<{ title: string; url: string; description: string }> } };
  return (data.web?.results ?? []).map(r => ({ title: r.title, url: r.url, snippet: r.description }));
}
```

Pattern: throw on HTTP failure, parse on success, return mapped `SearchResult[]`.

## The peer (drift)

`duckduckgoSearch` in the same file is the outlier. Where the other two throw, it silently returns `[]`:

```ts
async function duckduckgoSearch(query: string): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research-agent/1.0)' },
  });
  if (!res.ok) return [];   // ⚠ outlier — peers throw here
  const html = await res.text();
  // ... extract results from HTML ...
  return results;
}
```

The orchestrator (`fetchSearchResults`) is built around the throwing shape:

```ts
if (tavily) {
  try { return await tavilySearch(query, tavily); }
  catch { /* fall through to next provider */ }
}
if (brave) {
  try { return await braveSearch(query, brave); }
  catch { /* fall through to DDG */ }
}
return duckduckgoSearch(query);
```

Because DDG silently returns `[]`, callers can't distinguish "DDG was rate-limited" from "DDG returned no results for this query." Telemetry and rate-limit backoff lose visibility.

## The diff (proposal)

Bring DuckDuckGo into the same throw-on-failure shape as its peers:

```diff
 async function duckduckgoSearch(query: string): Promise<SearchResult[]> {
   const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
   const res = await fetch(url, {
     headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research-agent/1.0)' },
   });
-  if (!res.ok) return [];
+  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}: ${await res.text()}`);
   const html = await res.text();
   ...
   return results;
 }
```

The orchestrator already has a `try { ... } catch` around the *first two* providers but calls DDG bare (because DDG is the terminal fallback). Update the orchestrator to handle DDG the same way and return an empty array only when *all three* providers failed:

```diff
 export async function fetchSearchResults(query: string): Promise<SearchResult[]> {
   const tavily = process.env.TAVILY_API_KEY;
   const brave = process.env.BRAVE_SEARCH_API_KEY;

   if (tavily) {
     try { return await tavilySearch(query, tavily); }
     catch { /* fall through to next provider */ }
   }
   if (brave) {
     try { return await braveSearch(query, brave); }
     catch { /* fall through to DDG */ }
   }
-  return duckduckgoSearch(query);
+  try { return await duckduckgoSearch(query); }
+  catch { return []; }
 }
```

Now the three providers share one error contract; the orchestrator owns the "all providers exhausted" decision.

## After + verification

`bun test.ts` — runs `src/research/src/research.test.ts` and `research-integration.test.ts`. If a test specifically asserts on DDG's silent-empty behavior, it will fail and you'll need to update the test (it was asserting on the bug, not the contract). If no test covers this path, note in the summary that the change is behavior-only and add a follow-up TODO to backfill.

## Why this is instructive

This is the cleanest "one outlier among N peers" case: three functions with the same signature and the same job, two agreeing and one drifting. The fix is a one-line behavioral edit, but the *value* of conformance here is making future failure modes legible — every provider now reports its failure to the orchestrator the same way, and telemetry / backoff logic can treat them uniformly. Whenever you find a `Provider` interface with `N` implementations, run `/code-conform` against the cleanest one to surface this kind of drift.
