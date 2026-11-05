/**
 * The one title writer: generated text that is not yet an issue title (a worker's
 * `FOLLOWUP:` line, a lesson, a landing's manual check) becomes a title that
 * `titleProblem` accepts. The source text goes into the request, not the title.
 */
import { NO_SKILLS } from "./role-skill.ts";
import { titleProblem, TITLE_RULE } from "../../todo/lib/todo.ts";
import { ruleCmd } from "./settings.ts";
import { LOCAL, LOCAL_ENV, readModels } from "./models.ts";

const TITLE = 60;

/**
 * One line of text from a nested Haiku `claude -p` given a system prompt and an input.
 * "" when it fails or finds nothing.
 */
export async function writeLine(system: string, input: string, max: number): Promise<string> {
  const cmd = ruleCmd();
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.ANTHROPIC_API_KEY;
  env.MAX_THINKING_TOKENS = "0";
  const local = readModels().title === "local";
  if (local) Object.assign(env, LOCAL_ENV);
  try {
    const proc = Bun.spawn([cmd, "-p", "--strict-mcp-config", NO_SKILLS, "--model", local ? LOCAL.model : "haiku", "--setting-sources", "", "--max-turns", "1", "--tools", "", "--output-format", "json", "--system-prompt", system, input], { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const timer = setTimeout(() => proc.kill(), 30_000);
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    clearTimeout(timer);
    if (code !== 0) return "";
    let result = stdout;
    try { result = JSON.parse(stdout).result ?? stdout; } catch { /* plain text */ }
    return String(result).trim().split("\n")[0].trim().slice(0, max);
  } catch {
    return "";
  }
}

const system = (room: number) => `You turn one piece of text into an issue title. Reply with exactly one title: ${TITLE_RULE}.${room < TITLE ? ` It must fit in ${room} characters.` : ""} No quotes, no preamble.`;

/** The source with each leading `<words>: ` removed, cut to `max` characters at a word boundary, with no final period. */
export function cutTitle(source: string, max = TITLE): string {
  let t = source.trim();
  for (let m = /^[^:]*: /.exec(t); m; m = /^[^:]*: /.exec(t)) t = t.slice(m[0].length).trim();
  t = t.replace(/: /g, " ");
  if (t.length > max) {
    const head = t.slice(0, max + 1);
    const i = head.lastIndexOf(" ");
    t = (i > 0 ? head.slice(0, i) : head.slice(0, max)).trim();
  }
  return t.replace(/[.\s]+$/, "");
}

/** `group` and the model's title for `rest` in the room `group` leaves, when `titleProblem` accepts it, else `group` and `cutTitle(rest)`. */
async function fit(group: string, rest: string): Promise<string> {
  const room = TITLE - group.length;
  const t = (await writeLine(system(room), rest, 200)).trim().replace(/\.$/, "");
  return t && !titleProblem(group + t, { part: group !== "" }) ? group + t : group + cutTitle(rest, room);
}

/** The model's title for `source`, less a final period, when `titleProblem` accepts it, else `cutTitle(source)`. It never throws. */
export const writeTitle = (source: string): Promise<string> => fit("", source);
