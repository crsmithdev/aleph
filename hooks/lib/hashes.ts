/**
 * The commit hashes a final message cites that no command or output in the
 * turn shows. A hash is 7 to 40 lowercase hex digits with at least one a-f
 * letter and one digit, as a whole token; a prefix of a full hash counts as
 * shown when the turn contains it. docs/verify-gate.md, decision 9.
 */

type Entry = Record<string, any>;

const HASH = /(?<![\w./-])(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}(?![\w-])/g;

/** The text a turn shows for backing: the user's entries (prompt, tool results) and the inputs of its tool calls. Assistant prose is left out: a message cannot back its own hash. */
export function backing(entries: Entry[]): string {
  return entries.map((e) => {
    if (e.type === "user") return JSON.stringify(e);
    const content: Entry[] = Array.isArray(e.message?.content) ? e.message.content : [];
    return JSON.stringify(content.filter((b) => b.type === "tool_use").map((b) => b.input ?? {}));
  }).join("\n");
}

/** The distinct hashes in `message` that `shown` (from `backing`) does not contain. */
export function unbackedHashes(message: string, shown: string): string[] {
  const seen = shown.toLowerCase();
  return [...new Set(message.match(HASH) ?? [])].filter((h) => !seen.includes(h));
}
