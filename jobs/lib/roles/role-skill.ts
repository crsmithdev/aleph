/**
 * The skills of the agent roles. No role loads a skill of the user, a plugin or Claude Code itself
 * (`NO_SKILLS` on every `claude -p`); the one skill a role uses reaches it as text in its prompt.
 * Reviewer: code-review. Build worker: write-code, only in a repo with `sandbox` set. Maintainer: the `## write` section of vault.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitFrontmatter } from "../../../lib/frontmatter.ts";

/** The flag on every agent role's `claude -p`: no skills and no slash commands. */
export const NO_SKILLS = "--disable-slash-commands";

/** The body of `skills/<name>/SKILL.md`, without its frontmatter, as a prompt section. A relative link becomes an absolute path, so the agent can Read the file it names. */
export function skillSection(name: string, title: string): string {
  const dir = join(import.meta.dir, "..", "..", "..", "skills", name);
  const body = splitFrontmatter(readFileSync(join(dir, "SKILL.md"), "utf8")).body.trim().replace(/\]\((\.\.?\/[^)]+)\)/g, (_, rel) => `](${join(dir, rel)})`);
  return `## ${title}\n\n${body}`;
}
