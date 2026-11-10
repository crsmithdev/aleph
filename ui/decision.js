// A note written as prose (no fields on the issue): its paragraphs and the recommendation
// sentence. Plain JS, shared by the page and the server.

/** The note without its timestamp and its "intake: for Chris:" (or "triage: for Chris:") lead. */
const body = (note) => String(note ?? "").replace(/^\s*-\s*/, "").replace(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z:\s*/, "").replace(/^(?:intake|triage):\s*(?:for Chris:\s*)?/i, "").trim();

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

/** One plain sentence from a note: code spans, file paths and line numbers dropped, the first sentence, cut at 160 characters. */
export function oneSentence(text) {
  const t = String(text ?? "")
    .replace(/`([^`]*)`/g, (_, c) => (/[\/]|\.\w{1,5}$/.test(c) ? "" : c))
    .replace(/[\w.-]*\/[\w./-]+/g, "")
    .replace(/[\w-]+\.(?:js|ts|tsx|md|json|html|css|py|sh|ya?ml)\b(?::\d+(?:-\d+)?)?/g, "")
    .replace(/\(?\blines? \d+(?:-\d+)?\)?/gi, "")
    .replace(/\s+/g, " ").replace(/\s+([,.;:?!])/g, "$1").replace(/\(\s*\)/g, "").trim();
  const first = (/^.*?[.?!](?=\s|$)/.exec(t)?.[0] ?? t);
  if (/:$/.test(first)) return ""; // only a lead-in was left once the path went
  return first.length > 160 ? `${first.slice(0, 159).trimEnd()}\u2026` : first;
}
