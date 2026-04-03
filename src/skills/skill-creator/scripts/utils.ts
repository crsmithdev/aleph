#!/usr/bin/env bun
/**
 * Shared utilities for skill-creator scripts.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export function parseSkillMd(skillPath: string): [string, string, string] {
  /**
   * Parse a SKILL.md file, returning [name, description, fullContent].
   */
  const content = fs.readFileSync(path.join(skillPath, "SKILL.md"), "utf8");
  const lines = content.split("\n");

  if (lines[0].trim() !== "---") {
    throw new Error("SKILL.md missing frontmatter (no opening ---)");
  }

  let endIdx: number | null = null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }

  if (endIdx === null) {
    throw new Error("SKILL.md missing frontmatter (no closing ---)");
  }

  let name = "";
  let description = "";
  const frontmatterLines = lines.slice(1, endIdx);
  let i = 0;
  while (i < frontmatterLines.length) {
    const line = frontmatterLines[i];
    if (line.startsWith("name:")) {
      name = line.slice("name:".length).trim().replace(/^['"]|['"]$/g, "");
    } else if (line.startsWith("description:")) {
      const value = line.slice("description:".length).trim();
      // Handle YAML multiline indicators (>, |, >-, |-)
      if (value === ">" || value === "|" || value === ">-" || value === "|-") {
        const continuationLines: string[] = [];
        i += 1;
        while (
          i < frontmatterLines.length &&
          (frontmatterLines[i].startsWith("  ") || frontmatterLines[i].startsWith("\t"))
        ) {
          continuationLines.push(frontmatterLines[i].trim());
          i += 1;
        }
        description = continuationLines.join(" ");
        continue;
      } else {
        description = value.replace(/^['"]|['"]$/g, "");
      }
    }
    i += 1;
  }

  return [name, description, content];
}
