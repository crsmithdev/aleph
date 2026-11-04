// The pieces every sandboxed agent call shares: the shell quote, the model id and the git prelude.
import { NO_SUBMODULES } from "./git.ts";

export const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

export const OPUS_MODEL = "claude-opus-5-5";
/** The director's model (director.ts). */
export const FABLE_MODEL = "claude-fable-5-1";

/**
 * The script lines that start a repo in the sandbox and fetch `refs` from `bundle`. Lines, not a `&&` chain:
 * `set -e` does not stop a script on a failure inside a `&&` list. Callers that want a chain join with " && ".
 */
export function gitPrelude(bundle: string, refs: string[]): string[] {
  return ["git init -q .", ...NO_SUBMODULES, `git fetch -q ${bundle} ${refs.map(q).join(" ")}`];
}
