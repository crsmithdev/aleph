/** The text of a tool_result block's content: the string itself, or its parts' text joined with "\n". */
export function resultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p: any) => p?.text ?? "").join("\n");
  return "";
}

/** Each tool_use id mapped to the user entry that holds its tool_result. */
export function resultEntries<T extends { type?: string; message?: { content?: unknown } }>(entries: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const e of entries) {
    if (e.type !== "user" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) if (b?.type === "tool_result") out.set(b.tool_use_id, e);
  }
  return out;
}
