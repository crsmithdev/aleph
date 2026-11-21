// What the Now view keeps across a refresh about Asks: open diffs, typed reasons and the decisions the server accepted.

/** UI state that survives the Now view's refresh: job name to its open diff text, and to its last action message. */
export const openDiffs = new Map();
export const actMessages = new Map();
/** The reason typed in a Decide row, by issue ref `<repo>-<n>`, so a refresh keeps it. */
const reasons = new Map();
/** Keep the reason typed for issue `n` of `repo`; an empty one drops it. */
export const keepReason = (repo, n, text) => { if (text) reasons.set(`${repo}-${n}`, text); else reasons.delete(`${repo}-${n}`); };
/** The reason kept for the issue `ref`, `<repo>-<n>`. */
export const reasonOf = (ref) => reasons.get(ref);
/** The time the server accepted a decision on an Ask, by its id: no card draws for it until a state loaded after then stops listing it. */
const decided = new Map();
/** Record that the server accepted a decision on the Ask `id` at `at`. */
export const record = (id, at = Date.now()) => { decided.set(id, at); };
const covered = new Set(), listed = new Set();
/** The asks of a state that have no decision. `ids` are the asks the state could list (an issue page lists only its own); a decided one among `asks` is marked as listed by this draw. */
export const undecided = (asks, ids = decided.keys()) => {
  for (const id of ids) covered.add(id);
  return asks.filter((i) => !decided.has(i.id) || !listed.add(i.id));
};
/** The result of `draw`, a draw of a state loaded at `at`. A decided ask it could list and did not is gone from the server, so it may show again if it comes back. */
export const drawAt = (at, draw) => {
  covered.clear(); listed.clear();
  const out = draw();
  for (const id of covered) if (!listed.has(id) && decided.get(id) < at) decided.delete(id);
  return out;
};
