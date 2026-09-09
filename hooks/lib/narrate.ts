/**
 * Turns a tool call into one short spoken phrase, so a long turn does not
 * sound like a dropped call.
 *
 * The phrase never carries an argument. A file path, a diff, a command line
 * and a secret are all things the voice instruction forbids reading aloud
 * (voice bridge spec 6.6), and this text goes to a speaker. A category is
 * read out of an argument, but the argument itself is never returned.
 */

/** A Bash command's first real word, past `VAR=x` assignments and `sudo`. */
function head(command: string): string {
  for (const word of command.trim().split(/\s+/)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || word === "sudo" || word === "command") continue;
    return word.split("/").pop() ?? word;
  }
  return "";
}

const TEST = /^(pytest|vitest|jest|phpunit|rspec)$/;
const RUNNER = /^(bun|npm|pnpm|yarn|deno|cargo|go|make|uv|poetry)$/;

function bashPhrase(command: string): string {
  const first = head(command);
  const rest = command.slice(command.indexOf(first) + first.length).trim().split(/\s+/);
  const verb = rest[0] === "run" ? rest[1] : rest[0];
  if (TEST.test(first)) return "running the tests";
  if (first === "git") return verb === "commit" ? "making a commit" : "running a git command";
  if (RUNNER.test(first)) {
    if (verb === "test") return "running the tests";
    if (verb === "build" || first === "make") return "building the project";
    if (verb === "install" || verb === "add" || verb === "sync") return "installing packages";
  }
  if (first === "tsc" || first === "typecheck") return "checking the types";
  if (first === "pip" || first === "brew" || first === "apt") return "installing packages";
  if (first === "docker" || first === "kubectl") return "working with containers";
  return "running a command";
}

/** `mcp__voice_bridge__draw` -> `voice bridge`. */
function mcpServer(toolName: string): string | null {
  const parts = toolName.split("__");
  return parts.length >= 3 && parts[0] === "mcp" ? parts[1].replace(/[_-]+/g, " ") : null;
}

/** `WebFetch` -> `web fetch`, for a tool with no phrase of its own. */
function spellOut(toolName: string): string {
  return toolName.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
}

const FIXED: Record<string, string> = {
  Read: "reading a file",
  Edit: "editing a file",
  Write: "writing a file",
  NotebookEdit: "editing a notebook",
  Glob: "looking for files",
  Grep: "searching the project",
  WebFetch: "reading a page",
  WebSearch: "searching the web",
  TodoWrite: "updating the plan",
  ExitPlanMode: "finishing the plan",
  AskUserQuestion: "asking a question",
};

export function phraseFor(toolName: string, toolInput?: unknown): string {
  const input = (toolInput ?? {}) as Record<string, unknown>;
  if (toolName === "Bash") return typeof input.command === "string" ? bashPhrase(input.command) : "running a command";
  if (toolName === "Task" || toolName === "Agent") {
    const type = input.subagent_type;
    // a subagent type is a fixed name, not user text, so it is safe to say
    return typeof type === "string" && /^[a-z0-9][a-z0-9 -]{0,30}$/i.test(type)
      ? `starting the ${type.replace(/-+/g, " ")} subagent`
      : "starting a subagent";
  }
  const fixed = FIXED[toolName];
  if (fixed) return fixed;
  const server = mcpServer(toolName);
  if (server) return `using the ${server} tool`;
  return `using ${spellOut(toolName)}`;
}

export interface Narration {
  ts: number;
  session_id: string;
  tool: string;
  phrase: string;
}

/**
 * The record the bridge reads. Deliberately four fields: with no argument in
 * the shape at all, no path, diff or secret can reach the speaker by mistake.
 * The bridge speaks `phrase` and decides the cadence itself, because every
 * voice decision belongs to the bridge (voice bridge spec 3.4).
 */
export function narrationFor(input: Record<string, unknown>, now = Date.now()): Narration | null {
  const tool = input.tool_name;
  if (typeof tool !== "string" || !tool) return null;
  return {
    ts: now,
    session_id: typeof input.session_id === "string" ? input.session_id : "unknown",
    tool,
    phrase: phraseFor(tool, input.tool_input),
  };
}
