/**
 * The skills of the agent roles. No role loads a skill of the user, a plugin or Claude Code itself
 * (`NO_SKILLS` on every `claude -p`); the one skill a role uses reaches it as text in its prompt.
 * Reviewer: code-review. Build worker: code-change, only in a repo with `sandbox` set. Maintainer: the `## write` section of vault.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The flag on every agent role's `claude -p`: no skills and no slash commands. */
export const NO_SKILLS = "--disable-slash-commands";

/** The body of `skills/<name>/SKILL.md`, without its frontmatter, as a prompt section. */
export function skillSection(name: string, title: string): string {
  const text = readFileSync(join(import.meta.dir, "..", "..", "..", "skills", name, "SKILL.md"), "utf8");
  return `## ${title}\n\n${text.replace(/^---\n[\s\S]*?\n---\n/, "").trim()}`;
}
