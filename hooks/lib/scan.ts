/**
 * Secrets and debug leftovers in lines about to be committed. Patterns are
 * prefix-shaped where a vendor has one; the generic assignment rule needs a
 * quoted literal of 16+ characters that is not an obvious placeholder.
 */
export interface Finding { file: string; line: number; label: string }

const RULES: [string, RegExp][] = [
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["Langfuse secret key", /\bsk-lf-[0-9a-f-]{20,}/],
  ["secret key token", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}/],
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["debugger statement", /^\s*debugger\s*;?\s*$/],
  ["breakpoint", /\b(?:breakpoint\(\)|pdb\.set_trace\(|import\s+pdb\b|binding\.pry\b)/],
  ["focused test", /\b(?:test|it|describe)\.only\(/],
];
const ASSIGNMENT = /\b(?:api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*["'`]([^"'`\s]{16,})["'`]/i;
const PLACEHOLDER = /<|…|\.\.\.|xxx|example|placeholder|changeme|your[_-]|\$\{/i;

export function scanLine(text: string): string | null {
  for (const [label, re] of RULES) if (re.test(text)) return label;
  const m = text.match(ASSIGNMENT);
  if (m && !PLACEHOLDER.test(m[1])) return "credential assignment";
  return null;
}

/** Added lines of a unified diff, with the new-file line numbers from the hunk headers. */
export function scanDiff(diff: string): Finding[] {
  const out: Finding[] = [];
  let file = "";
  let line = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) { file = raw.slice(4).replace(/^b\//, ""); continue; }
    if (raw.startsWith("---") || raw.startsWith("diff ")) continue;
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (raw.startsWith("+")) {
      const label = scanLine(raw.slice(1));
      if (label) out.push({ file, line, label });
      line++;
    } else if (!raw.startsWith("-") && !raw.startsWith("\\")) {
      line++;
    }
  }
  return out;
}

/** A whole file, for untracked files a `git add` in the same command would bring in. */
export function scanFile(file: string, text: string): Finding[] {
  const out: Finding[] = [];
  text.split("\n").forEach((row, i) => {
    const label = scanLine(row);
    if (label) out.push({ file, line: i + 1, label });
  });
  return out;
}
