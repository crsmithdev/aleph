// A note written as prose (no fields on the issue): its paragraphs and the recommendation
// sentence. Plain JS, shared by the page and the server.

/** The note without its timestamp and its "triage: for Chris:" lead. */
const body = (note) => String(note ?? "").replace(/^\s*-\s*/, "").replace(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\s*/, "").replace(/^triage:\s*(?:for Chris:\s*)?/i, "").trim();

const RECOMMENDATION = /(^|[.!?]["')\]`]*\s+)(My recommendation\b[^]*?(?:[.!?](?=\s|$)|$))/i;

/** `{ paragraphs, recommendation }`: the paragraphs of the note (the recommendation sentence is its own, last paragraph) and that sentence or null. */
export function proseDecision(note) {
  let text = body(note);
  let recommendation = null;
  const m = RECOMMENDATION.exec(text);
  if (m) {
    recommendation = m[2].trim();
    text = (text.slice(0, m.index + m[1].length) + text.slice(m.index + m[0].length)).trim();
  }
  const paragraphs = text.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);
  if (recommendation) paragraphs.push(recommendation);
  return { paragraphs, recommendation };
}
