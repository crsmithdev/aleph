#!/usr/bin/env bun
/**
 * Quick validation script for skills - minimal version
 */

import * as fs from "node:fs";
import * as path from "node:path";

export function validateSkill(skillPath: string): [boolean, string] {
  /** Basic validation of a skill */

  // Check SKILL.md exists
  const skillMd = path.join(skillPath, "SKILL.md");
  if (!fs.existsSync(skillMd)) {
    return [false, "SKILL.md not found"];
  }

  // Read and validate frontmatter
  const content = fs.readFileSync(skillMd, "utf8");
  if (!content.startsWith("---")) {
    return [false, "No YAML frontmatter found"];
  }

  // Extract frontmatter
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return [false, "Invalid frontmatter format"];
  }

  const frontmatterText = match[1];

  // Parse frontmatter manually (simple key:value YAML, with metadata as nested object)
  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = parseFrontmatter(frontmatterText);
  } catch (e) {
    return [false, `Invalid YAML in frontmatter: ${e}`];
  }

  if (typeof frontmatter !== "object" || frontmatter === null || Array.isArray(frontmatter)) {
    return [false, "Frontmatter must be a YAML dictionary"];
  }

  // Define allowed properties
  const ALLOWED_PROPERTIES = new Set(["name", "description", "license", "allowed-tools", "metadata", "compatibility"]);

  // Check for unexpected properties
  const unexpectedKeys = Object.keys(frontmatter).filter((k) => !ALLOWED_PROPERTIES.has(k));
  if (unexpectedKeys.length > 0) {
    const sortedUnexpected = unexpectedKeys.sort().join(", ");
    const sortedAllowed = [...ALLOWED_PROPERTIES].sort().join(", ");
    return [
      false,
      `Unexpected key(s) in SKILL.md frontmatter: ${sortedUnexpected}. Allowed properties are: ${sortedAllowed}`,
    ];
  }

  // Check required fields
  if (!("name" in frontmatter)) {
    return [false, "Missing 'name' in frontmatter"];
  }
  if (!("description" in frontmatter)) {
    return [false, "Missing 'description' in frontmatter"];
  }

  // Validate name
  let name = frontmatter["name"];
  if (typeof name !== "string") {
    return [false, `Name must be a string, got ${typeof name}`];
  }
  name = name.trim();
  if (name) {
    if (!/^[a-z0-9-]+$/.test(name)) {
      return [false, `Name '${name}' should be kebab-case (lowercase letters, digits, and hyphens only)`];
    }
    if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
      return [false, `Name '${name}' cannot start/end with hyphen or contain consecutive hyphens`];
    }
    if (name.length > 64) {
      return [false, `Name is too long (${name.length} characters). Maximum is 64 characters.`];
    }
  }

  // Validate description
  let description = frontmatter["description"];
  if (typeof description !== "string") {
    return [false, `Description must be a string, got ${typeof description}`];
  }
  description = description.trim();
  if (description) {
    if (description.includes("<") || description.includes(">")) {
      return [false, "Description cannot contain angle brackets (< or >)"];
    }
    if (description.length > 1024) {
      return [false, `Description is too long (${description.length} characters). Maximum is 1024 characters.`];
    }
  }

  // Validate compatibility field if present
  const compatibility = frontmatter["compatibility"];
  if (compatibility !== undefined && compatibility !== "") {
    if (typeof compatibility !== "string") {
      return [false, `Compatibility must be a string, got ${typeof compatibility}`];
    }
    if (compatibility.length > 500) {
      return [false, `Compatibility is too long (${compatibility.length} characters). Maximum is 500 characters.`];
    }
  }

  return [true, "Skill is valid!"];
}

function parseFrontmatter(text: string): Record<string, unknown> {
  /**
   * Parse simple key:value YAML frontmatter.
   * Handles string values (quoted or unquoted), multiline block scalars,
   * and one level of nested objects (like metadata:).
   */
  const result: Record<string, unknown> = {};
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // Skip blank lines
    if (line.trim() === "") {
      i++;
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();

    if (rest === ">" || rest === "|" || rest === ">-" || rest === "|-") {
      // Block scalar — collect indented continuation lines
      const parts: string[] = [];
      i++;
      while (i < lines.length && (lines[i].startsWith("  ") || lines[i].startsWith("\t"))) {
        parts.push(lines[i].trim());
        i++;
      }
      result[key] = parts.join(" ");
      continue;
    }

    if (rest === "") {
      // Possible nested object — collect indented key:value pairs
      const nested: Record<string, string> = {};
      i++;
      while (i < lines.length && (lines[i].startsWith("  ") || lines[i].startsWith("\t"))) {
        const nestedLine = lines[i].trim();
        const nc = nestedLine.indexOf(":");
        if (nc !== -1) {
          const nk = nestedLine.slice(0, nc).trim();
          const nv = nestedLine.slice(nc + 1).trim().replace(/^['"]|['"]$/g, "");
          nested[nk] = nv;
        }
        i++;
      }
      result[key] = Object.keys(nested).length > 0 ? nested : "";
      continue;
    }

    // Plain scalar (strip quotes)
    result[key] = rest.replace(/^['"]|['"]$/g, "");
    i++;
  }

  return result;
}

if (import.meta.main) {
  if (process.argv.length !== 3) {
    process.stdout.write("Usage: bun scripts/quick-validate.ts <skill_directory>\n");
    process.exit(1);
  }

  const [valid, message] = validateSkill(process.argv[2]);
  process.stdout.write(message + "\n");
  process.exit(valid ? 0 : 1);
}
