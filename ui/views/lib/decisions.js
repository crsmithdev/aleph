// What the Now view keeps across a refresh about Asks: open diffs, typed reasons and the decisions the server accepted.

/** UI state that survives the Now view's refresh: job name to its open diff text, and to its last action message. */
export const openDiffs = new Map();
export const actMessages = new Map();
/** The reason typed in a Decide row, by issue id, so a refresh keeps it. */
export const denyReasons = new Map();
/** The time the server accepted a decision on an Ask, by its id: no card draws for it until a state loaded after then stops listing it. */
export const decided = new Map();
const covered = new Set(), listed = new Set();
/** The asks of a state that have no decision. `ids` are the asks the state could list (an issue page lists only its own); a decided one among `asks` is marked as listed by this draw. */
export const undecided = (asks, ids = decided.keys()) => {
  for (const id of ids) covered.add(id);
  return asks.filter((i) => !decided.has(i.id) || !listed.add(i.id));
};
/** Start a draw: it has covered and listed no decided ask yet. */
export const startDraw = () => { covered.clear(); listed.clear(); };
/** End a draw of a state loaded at `at`: a decided ask it could list and did not is gone from the server, so it may show again if it comes back. */
export const endDraw = (at) => { for (const id of covered) if (!listed.has(id) && decided.get(id) < at) decided.delete(id); };
