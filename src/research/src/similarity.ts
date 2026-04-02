// Stopwords for English
const STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'is','are','was','were','be','been','being','have','has','had','do','does',
  'did','will','would','could','should','may','might','that','this','these',
  'those','what','which','who','how','when','where','why','it','its','they',
  'them','their',
]);

// Normalize: lowercase, remove punctuation, remove stopwords, apply basic suffix stemming
export function normalizeText(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0 && !STOPWORDS.has(t));

  return tokens.map(stem);
}

function stem(word: string): string {
  if (word.length <= 3) return word;

  // ies → y (before other s rules)
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  // tions → tion (plural of tion)
  if (word.endsWith('tions') && word.length > 6) return word.slice(0, -1);
  // tion
  if (word.endsWith('tion') && word.length > 5) return word.slice(0, -4);
  // ments
  if (word.endsWith('ments') && word.length > 6) return word.slice(0, -5);
  // ment
  if (word.endsWith('ment') && word.length > 5) return word.slice(0, -4);
  // ness
  if (word.endsWith('ness') && word.length > 5) return word.slice(0, -4);
  // ing
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  // ers
  if (word.endsWith('ers') && word.length > 5) return word.slice(0, -2);
  // er
  if (word.endsWith('er') && word.length > 4) return word.slice(0, -2);
  // ly
  if (word.endsWith('ly') && word.length > 4) return word.slice(0, -2);
  // ed
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  // es → (if word > 3 chars after removal)
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
  // s → (if word > 3 chars)
  if (word.endsWith('s') && word.length > 4) return word.slice(0, -1);

  return word;
}

// Jaccard similarity on normalized token sets (0–1)
export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeText(a));
  const setB = new Set(normalizeText(b));

  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

// Cosine similarity between two float vectors (0–1)
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  // Clamp to [0, 1] since cosine can return negative for embeddings
  return Math.max(0, Math.min(1, dot / denom));
}

export interface SimilarityResult {
  score: number; // 0–1, higher = more similar
  method: 'jaccard' | 'embedding' | 'llm';
  jaccard: number;
  embedding: number | null;
  llm: number | null;
}

// Multi-method pipeline:
// 1. Compute jaccard
// 2. If |jaccard - threshold| > 0.15 → use jaccard (decisive)
// 3. Else → call embed(a), embed(b), compute cosine
// 4. If |embedding - threshold| > 0.10 → use embedding (decisive)
// 5. Else → call llmJudge(a, b) → 0 or 1
export async function computeSimilarity(
  a: string,
  b: string,
  threshold: number,
  embed: ((text: string) => Promise<number[]>) | null,
  llmJudge: ((a: string, b: string) => Promise<number>) | null
): Promise<SimilarityResult> {
  const jaccard = jaccardSimilarity(a, b);

  // Step 2: jaccard decisive if far from threshold
  if (Math.abs(jaccard - threshold) > 0.15) {
    return { score: jaccard, method: 'jaccard', jaccard, embedding: null, llm: null };
  }

  // Step 3: try embedding
  if (embed !== null) {
    try {
      const [embA, embB] = await Promise.all([embed(a), embed(b)]);
      const embeddingSim = cosineSimilarity(embA, embB);

      // Step 4: embedding decisive if far from threshold
      if (Math.abs(embeddingSim - threshold) > 0.10) {
        return { score: embeddingSim, method: 'embedding', jaccard, embedding: embeddingSim, llm: null };
      }

      // Step 5: LLM judge
      if (llmJudge !== null) {
        try {
          const llmScore = await llmJudge(a, b);
          return { score: llmScore, method: 'llm', jaccard, embedding: embeddingSim, llm: llmScore };
        } catch {
          // fall back to embedding
        }
      }

      return { score: embeddingSim, method: 'embedding', jaccard, embedding: embeddingSim, llm: null };
    } catch {
      // fall through to LLM judge or jaccard
    }
  }

  // No embed: if jaccard is ambiguous and we have an LLM judge, use it
  if (llmJudge !== null) {
    try {
      const llmScore = await llmJudge(a, b);
      return { score: llmScore, method: 'llm', jaccard, embedding: null, llm: llmScore };
    } catch {
      // fall back to jaccard
    }
  }

  // Final fallback: use jaccard
  return { score: jaccard, method: 'jaccard', jaccard, embedding: null, llm: null };
}
