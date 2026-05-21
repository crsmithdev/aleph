/**
 * Keyword matcher — mirrors the routing hook's logic
 * (src/core/hooks/routing-classify-submit.ts) so per-keyword stats computed
 * here match what the live router would fire. Kept self-contained because
 * @construct/telemetry can't reach across to the hook's package. If the hook's
 * stemmer/matcher changes, update this in lockstep (aggregator.test.ts pins it).
 */

// Lightweight Porter-style stemmer: "failing"→"fail", "fonts"→"font", etc.
export function stem(word: string): string {
  const w = word.toLowerCase();
  const suffixes = ["izing", "ising", "ating", "tion", "sion", "ment", "ness", "ence", "ance", "ible", "able", "ful", "ous", "ive", "ity", "ally", "edly", "ing", "ly", "ed", "es", "er", "s"];
  let best = w;
  for (const suffix of suffixes) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      const candidate = w.slice(0, -suffix.length);
      if (candidate.length > best.length || best === w) best = candidate;
    }
  }
  return best;
}

export function stemPhrase(text: string): string {
  return text.split(/\s+/).map(stem).join(" ");
}

/**
 * True if keyword matches the prompt. Plain keywords match as stemmed
 * substrings; `/pattern/flags` keywords match as regex against the raw prompt.
 */
export function matchesKeyword(keyword: string, lowerPrompt: string, stemmedPrompt: string): boolean {
  const rx = keyword.match(/^\/(.+)\/([gimsuy]*)$/);
  if (rx) {
    try { return new RegExp(rx[1], rx[2] || "i").test(lowerPrompt); }
    catch { return false; }
  }
  return stemmedPrompt.includes(stemPhrase(keyword.toLowerCase()));
}
