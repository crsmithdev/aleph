/**
 * session-brief.md — the handoff artifact (design v1.0 §3.2, phase-1 §7.4).
 *
 * Rewritten, never appended. It is what a rehydrated session reads first and
 * what Phase 2b hands to Claude Code over MCP. Written in Phase 1 before
 * anything consumes it, on purpose: the artifact must already be accurate when
 * the consumer arrives.
 */
export interface Brief {
  topic: string;
  session_id: string;
  updated: string;
  turns: number;
  state: string;
  title: string;
  stands: string;
  decisions: string[];
  questions: string[];
  actions: string[];
  artifacts: string[];
}

/**
 * Agent-authored text becomes document structure unless something stops it.
 * `checkpoint()` copies the model's own reply into `stands`, and the brief is
 * read back into the next system prompt — so a reply containing "## Decisions
 * made" used to parse into a decision the user never made, and one containing
 * "</brief>" closed the prompt section early.
 *
 * Escaping is at the render boundary and reversed at the parse boundary, so the
 * text a human reads in Obsidian is the text the agent wrote, and the parser
 * cannot see structure in it.
 */
export function escapeAgentText(text: string): string {
  return text
    .replace(/&/g, "&amp;")           // first, so no other escape can be forged
    .replace(/</g, "&lt;")            // no raw "<" survives, so no tag can be closed
    .replace(/^#/gm, "&#35;")         // a line no longer STARTS with #, so it is not a heading
    .replace(/^---/gm, "&#45;--");    // ...nor a frontmatter fence
}

export function unescapeAgentText(text: string): string {
  return text
    .replace(/^&#35;/gm, "#")
    .replace(/^&#45;/gm, "-")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");          // last, mirroring escape order
}

const bullets = (items: string[], empty = "_(none)_") =>
  items.length ? items.map((i) => `- ${escapeAgentText(i)}`).join("\n") : empty;

export function renderBrief(b: Brief): string {
  return `---
topic: ${b.topic}
session_id: ${b.session_id}
updated: ${b.updated}
turns: ${b.turns}
state: ${b.state}
---

# Brief — ${escapeAgentText(b.title)}

## Where this stands

${escapeAgentText(b.stands.trim()) || "_(no summary yet)_"}

## Decisions made

${bullets(b.decisions)}

## Open questions

${bullets(b.questions)}

## Next actions

${bullets(b.actions.map((a) => (a.startsWith("[") ? a : `[ ] ${a}`)))}

## Artifacts

${bullets(b.artifacts)}
`;
}

export function parseBrief(text: string): Brief {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const meta: Record<string, string> = {};
  if (fm) for (const line of fm[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  // Structural, not regular. A section starts at a line that IS "## <name>" and
  // ends at the next line that starts a section — no lookahead whose meaning
  // changes with a flag, and no way for escaped text to look like a heading.
  const lines = text.split("\n");
  const isHeading = (l: string) => /^## \S/.test(l);
  const section = (name: string): string => {
    const start = lines.findIndex((l) => l === `## ${name}`);
    if (start === -1) return "";
    let end = start + 1;
    while (end < lines.length && !isHeading(lines[end]!)) end++;
    return lines.slice(start + 1, end).join("\n").trim();
  };
  const list = (name: string): string[] => {
    const body = section(name);
    if (!body || body.startsWith("_(none)")) return [];
    return body.split("\n").filter((l) => l.startsWith("- ")).map((l) => unescapeAgentText(l.slice(2).trim()));
  };
  const title = unescapeAgentText(/^# Brief — (.*)$/m.exec(text)?.[1] ?? meta.topic ?? "");
  const stands = section("Where this stands");
  return {
    topic: meta.topic ?? "",
    session_id: meta.session_id ?? "",
    updated: meta.updated ?? "",
    turns: Number(meta.turns ?? 0),
    state: meta.state ?? "active",
    title,
    stands: stands.startsWith("_(no summary") ? "" : unescapeAgentText(stands),
    decisions: list("Decisions made"),
    questions: list("Open questions"),
    actions: list("Next actions"),
    artifacts: list("Artifacts"),
  };
}
