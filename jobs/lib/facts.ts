import { tagged } from "./gate.ts";

export interface Fact { fact: string; source: string }

const PATH = /^(?![a-z][a-z0-9+.-]*:\/\/)[\w.@\-]+(?:\/[\w.@\-]+)*(?::\d+)?$/i;
const SHA = /^[0-9a-f]{7,40}$/i;
const URL_ = /^https?:\/\/\S+$/i;
const valid = (s: string): boolean => URL_.test(s) || SHA.test(s) || PATH.test(s);

/**
 * The `FACT: <sentence> [source: <source>]` lines of a worker's result. A line
 * with no valid source goes to `unsourced`, whole; the caller logs those.
 */
export function parseFacts(result: string): { facts: Fact[]; unsourced: string[] } {
  const facts: Fact[] = [];
  const unsourced: string[] = [];
  for (const line of tagged(result, "FACT")) {
    const m = /^(.*?)\s*\[source:\s*([^\]]*?)\s*\]$/.exec(line);
    if (m && m[1] && valid(m[2])) facts.push({ fact: m[1], source: m[2] });
    else unsourced.push(line);
  }
  return { facts, unsourced };
}
