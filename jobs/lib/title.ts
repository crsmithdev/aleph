/**
 * The one title writer: generated text that is not yet an issue title (a worker's
 * `FOLLOWUP:` line, a lesson, a landing's manual check) becomes a title that
 * `titleProblem` accepts. The source text goes into the request, not the title.
 */
import { titleProblem, TITLE_RULE } from "../../todo/lib/todo.ts";
import { ruleCmd } from "./settings.ts";

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
  try {
    const proc = Bun.spawn([cmd, "-p", "--strict-mcp-config", "--model", "haiku", "--setting-sources", "", "--max-turns", "1", "--tools", "", "--output-format", "json", "--system-prompt", system, input], { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
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

const SYSTEM = `You turn one piece of text into an issue title. Reply with exactly one title: ${TITLE_RULE}. No quotes, no preamble.`;

/** The source with each leading `<words>: ` removed, cut to 60 characters at a word boundary, with no final period. */
export function cutTitle(source: string): string {
  let t = source.trim();
  for (let m = /^[^:]*: /.exec(t); m; m = /^[^:]*: /.exec(t)) t = t.slice(m[0].length).trim();
  t = t.replace(/: /g, " ");
  if (t.length > TITLE) {
    const head = t.slice(0, TITLE + 1);
    const i = head.lastIndexOf(" ");
    t = (i > 0 ? head.slice(0, i) : head.slice(0, TITLE)).trim();
  }
  return t.replace(/[.\s]+$/, "");
}

/** The model's title for `source`, less a final period, when `titleProblem` accepts it, else `cutTitle(source)`. It never throws. */
export async function writeTitle(source: string): Promise<string> {
  const t = (await writeLine(SYSTEM, source, 200)).trim().replace(/\.$/, "");
  return t && !titleProblem(t) ? t : cutTitle(source);
}
