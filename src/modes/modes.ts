/**
 * Mode loading + parsing for the composable behavioral-mode system.
 *
 * Each mode is a standalone MODE_<slug>.md file with frontmatter:
 *
 *   ---
 *   slug: brainstorming
 *   whenToUse: |
 *     multi-line natural-language activation hint (read by the model)
 *   triggers:
 *     - \bshould we\b        # regex, tested case-insensitively against the prompt
 *   ---
 *   <body — inlined into hook stdout when the mode activates>
 *
 * Shared by routing-classify-submit.ts (regex activation + body inlining),
 * INDEX.md generation (whenToUse index), and the test suite.
 */
import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";

export interface Mode {
  slug: string;
  whenToUse: string;
  triggers: string[];
  body: string;
  file: string;
}

/** Parse one MODE file's raw contents. Throws on malformed structure — never silent. */
export function parseModeFile(raw: string, file = "<memory>"): Mode {
  const lines = raw.split("\n");
  if (lines[0].trim() !== "---") throw new Error(`${file}: missing opening frontmatter '---'`);
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { end = i; break; }
  }
  if (end === -1) throw new Error(`${file}: missing closing frontmatter '---'`);

  const fm = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n").trim();

  let slug = "";
  let whenToUse = "";
  const triggers: string[] = [];
  let section: "none" | "whenToUse" | "triggers" = "none";
  const whenLines: string[] = [];

  for (const line of fm) {
    const slugMatch = line.match(/^slug:\s*(\S+)\s*$/);
    if (slugMatch) { slug = slugMatch[1]; section = "none"; continue; }
    if (/^whenToUse:\s*\|\s*$/.test(line)) { section = "whenToUse"; continue; }
    if (/^triggers:\s*$/.test(line)) { section = "triggers"; continue; }

    if (section === "whenToUse") {
      // Block scalar: indented continuation lines, or blank lines inside the block.
      if (line.trim() === "" || /^\s+/.test(line)) { whenLines.push(line.trim()); continue; }
      section = "none"; // de-dented → block ended; fall through to re-evaluate
    }
    if (section === "triggers") {
      const item = line.match(/^\s*-\s*(.+?)\s*$/);
      if (item) { triggers.push(item[1]); continue; }
      if (line.trim() === "") continue;
      section = "none";
    }
  }
  whenToUse = whenLines.join(" ").replace(/\s+/g, " ").trim();

  if (!slug) throw new Error(`${file}: missing 'slug'`);
  if (!whenToUse) throw new Error(`${file}: missing 'whenToUse'`);
  if (triggers.length === 0) throw new Error(`${file}: no 'triggers' defined`);
  if (!body) throw new Error(`${file}: empty body`);

  return { slug, whenToUse, triggers, body, file };
}

/** Load and parse every MODE_*.md in a directory, sorted by slug for stable order. */
export function loadModes(dir: string): Mode[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter(f => /^MODE_.+\.md$/.test(f));
  } catch {
    return [];
  }
  return files
    .map(f => parseModeFile(readFileSync(resolve(dir, f), "utf8"), f))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Return slugs of modes whose any trigger regex matches the prompt (case-insensitive). */
export function activeModes(prompt: string, modes: Mode[]): string[] {
  return modes
    .filter(m => m.triggers.some(t => {
      try { return new RegExp(t, "i").test(prompt); }
      catch { return false; }
    }))
    .map(m => m.slug);
}

/** Build the always-loaded whenToUse index (@-included from core/CLAUDE.md). Generated, not hand-edited. */
export function buildIndex(modes: Mode[]): string {
  const rows = modes.map(m => `- **${m.slug}** — ${m.whenToUse}`).join("\n");
  return `# Behavioral Modes

Composable posture overlays. Any subset can be active at once; absence is the
common case. The router activates modes by keyword; when none fire, read the
\`whenToUse\` hints below and self-select if one clearly applies — then say so in
one short line (e.g. "Activating brainstorming because the request is exploring
options"). Mode bodies live in \`MODE_<slug>.md\` and are inlined by the router
when a mode activates.

${rows}

<!-- generated from MODE_*.md frontmatter by buildIndex() in modes.ts — do not edit by hand -->
`;
}
