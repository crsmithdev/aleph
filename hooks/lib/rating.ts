/**
 * A prompt that carries "N/10" rates the previous reply. The score is N;
 * the prompt is the comment. "9/10/2026" and "3/100" are not ratings.
 */
export function parseRating(prompt: string): number | null {
  const m = prompt.match(/(?<![\d/.])(10|\d)\s*\/\s*10(?![\d/])/);
  return m ? Number(m[1]) : null;
}
