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

const bullets = (items: string[], empty = "_(none)_") =>
  items.length ? items.map((i) => `- ${i}`).join("\n") : empty;

export function renderBrief(b: Brief): string {
  return `---
topic: ${b.topic}
session_id: ${b.session_id}
updated: ${b.updated}
turns: ${b.turns}
state: ${b.state}
---

# Brief — ${b.title}

## Where this stands

${b.stands.trim() || "_(no summary yet)_"}

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
  const section = (name: string): string => {
    const re = new RegExp(`## ${name}\\n+([\\s\\S]*?)(?=\\n## |$)`);
    return re.exec(text)?.[1]?.trim() ?? "";
  };
  const list = (name: string): string[] => {
    const body = section(name);
    if (!body || body.startsWith("_(none)")) return [];
    return body.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
  };
  const title = /^# Brief — (.*)$/m.exec(text)?.[1] ?? meta.topic ?? "";
  const stands = section("Where this stands");
  return {
    topic: meta.topic ?? "",
    session_id: meta.session_id ?? "",
    updated: meta.updated ?? "",
    turns: Number(meta.turns ?? 0),
    state: meta.state ?? "active",
    title,
    stands: stands.startsWith("_(no summary") ? "" : stands,
    decisions: list("Decisions made"),
    questions: list("Open questions"),
    actions: list("Next actions"),
    artifacts: list("Artifacts"),
  };
}
