/**
 * `aleph memory <op>`: parse argv, call the op of ops.ts or maintain.ts, print its result. stdout gets the JSON,
 * stderr the warnings and refusals. The exit code is 1 for a refusal, 2 for an unknown op.
 */
import { resolve } from "node:path";
import { today } from "../../lib/day.ts";
import { vaultDir } from "../../lib/paths.ts";
import { maintain } from "./maintain.ts";
import { adopt, archive, compile, del, init, lint, misses, recall, renameScopeOp, write, type Result } from "./ops.ts";

export interface Io { log: (s: string) => void; err: (s: string) => void }

const USAGE = "usage: aleph memory <init|write <file> --why <text>|recall [--episodes] <query> [--scope <name>]|lint [--fix] [--overlap] [--template]|adopt <path> --why <text>|rename-scope <old> <new> [--apply]|archive <title> --why <text>|delete <title> --why <text>|compile [date]|misses [--days N]|maintain [--dry]>";

/** Print `r` and return the exit code: `code` of the value on success, 1 on a refusal. */
function print(io: Io, r: Result<unknown>, code: (v: any) => number = () => 0, text = false): number {
  r.warnings.forEach(io.err);
  if (r.ok) { io.log(text ? String(r.value) : JSON.stringify(r.value, null, 2)); return code(r.value); }
  if (r.error) { io.err(r.error); return 1; }
  r.findings.forEach((f) => io.err(`refuse ${f.rule} ${f.note}: ${f.detail}`));
  if (r.hint) io.err(r.hint);
  io.log(JSON.stringify({ findings: r.findings }, null, 2));
  return 1;
}

/** One `aleph memory` command under the vault that $ALEPH_VAULT names now. The exit code. */
export async function cli(argv: string[], io: Io): Promise<number> {
  const [cmd, ...rest] = argv;
  const root = resolve(vaultDir());
  const flag = (name: string): string | undefined => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
  const has = (name: string): boolean => rest.includes(`--${name}`);
  const positional = rest.filter((a, i) => !a.startsWith("--") && rest[i - 1]?.startsWith("--") !== true);
  const why = flag("why");
  const usage = (text: string): number => { io.err(text); return 1; };
  const title = positional.join(" ").trim();
  switch (cmd) {
    case "init": return print(io, await init(root));
    case "write":
      return positional[0] && why ? print(io, await write(root, positional[0], why)) : usage('usage: aleph memory write <file.md> --why "<one line>"');
    case "recall": {
      // Only `--scope` takes a value, so only the word after it leaves the query: a bare flag such as
      // `--episodes` or `--unlogged` leaves the word after it in, wherever the flag stands.
      const query = rest.filter((a, i) => !a.startsWith("--") && rest[i - 1] !== "--scope").join(" ").trim().toLowerCase();
      const scope = flag("scope");
      if (!query && !scope) return usage("usage: aleph memory recall [--episodes] <query> [--scope <name>]  |  aleph memory recall [--episodes] --scope <name>");
      return print(io, await recall(root, { query, scope, episodes: has("episodes"), unlogged: has("unlogged") }));
    }
    case "lint": return print(io, await lint(root, { fix: has("fix"), overlap: has("overlap"), template: has("template") }), (v) => (v.refuse.length ? 1 : 0));
    case "adopt":
      return positional[0] && why ? print(io, await adopt(root, positional[0], why)) : usage('usage: aleph memory adopt <path-inside-the-vault> --why "<one line>"');
    case "rename-scope": {
      const [from, to] = positional;
      return from && to ? print(io, await renameScopeOp(root, from, to, has("apply"))) : usage("usage: aleph memory rename-scope <old> <new> [--apply]");
    }
    case "archive": return title && why ? print(io, await archive(root, title, why)) : usage('usage: aleph memory archive "<title>" --why "<one line>"');
    case "delete": return title && why ? print(io, await del(root, title, why)) : usage('usage: aleph memory delete "<title>" --why "<one line>"');
    case "compile": {
      const date = positional[0] ?? today();
      return /^\d{4}-\d{2}-\d{2}$/.test(date) ? print(io, await compile(root, date), () => 0, true) : usage("usage: aleph memory compile [YYYY-MM-DD]");
    }
    case "misses": {
      const raw = flag("days");
      const days = raw === undefined ? undefined : Number(raw);
      return days === undefined || days > 0 ? print(io, await misses(days)) : usage("usage: aleph memory misses [--days N]");
    }
    case "maintain": return print(io, await maintain(root, has("dry")), (v) => (v.ok ? 0 : 1));
    default: io.err(USAGE); return 2;
  }
}
