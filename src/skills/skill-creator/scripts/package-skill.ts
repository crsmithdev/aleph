#!/usr/bin/env bun
/**
 * Skill Packager - Creates a distributable .skill file of a skill folder
 *
 * Usage:
 *     bun scripts/package-skill.ts <path/to/skill-folder> [output-directory]
 *
 * Example:
 *     bun scripts/package-skill.ts skills/public/my-skill
 *     bun scripts/package-skill.ts skills/public/my-skill ./dist
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { validateSkill } from "./quick-validate.js";

// Patterns to exclude when packaging skills.
const EXCLUDE_DIRS = new Set(["__pycache__", "node_modules"]);
const EXCLUDE_GLOBS = ["*.pyc"];
const EXCLUDE_FILES = new Set([".DS_Store"]);
// Directories excluded only at the skill root (not when nested deeper).
const ROOT_EXCLUDE_DIRS = new Set(["evals"]);

function matchesGlob(name: string, pattern: string): boolean {
  // Simple glob matching: only supports * wildcard
  const regexStr = pattern
    .split("*")
    .map((s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${regexStr}$`).test(name);
}

function shouldExclude(relPath: string): boolean {
  /** Check if a path should be excluded from packaging. */
  const parts = relPath.split(path.sep);

  if (parts.some((part) => EXCLUDE_DIRS.has(part))) {
    return true;
  }

  // relPath is relative to skill_path.parent, so parts[0] is the skill
  // folder name and parts[1] (if present) is the first subdir.
  if (parts.length > 1 && ROOT_EXCLUDE_DIRS.has(parts[1])) {
    return true;
  }

  const name = parts[parts.length - 1];
  if (EXCLUDE_FILES.has(name)) {
    return true;
  }

  return EXCLUDE_GLOBS.some((pat) => matchesGlob(name, pat));
}

function collectFiles(dir: string, baseDir: string): string[] {
  /** Recursively collect all files under dir, returning absolute paths. */
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

export function packageSkill(skillPath: string, outputDir?: string): string | null {
  /**
   * Package a skill folder into a .skill file.
   *
   * Returns path to the created .skill file, or null if error.
   */
  skillPath = path.resolve(skillPath);

  // Validate skill folder exists
  if (!fs.existsSync(skillPath)) {
    process.stdout.write(`Error: Skill folder not found: ${skillPath}\n`);
    return null;
  }

  if (!fs.statSync(skillPath).isDirectory()) {
    process.stdout.write(`Error: Path is not a directory: ${skillPath}\n`);
    return null;
  }

  // Validate SKILL.md exists
  const skillMd = path.join(skillPath, "SKILL.md");
  if (!fs.existsSync(skillMd)) {
    process.stdout.write(`Error: SKILL.md not found in ${skillPath}\n`);
    return null;
  }

  // Run validation before packaging
  process.stdout.write("Validating skill...\n");
  const [valid, message] = validateSkill(skillPath);
  if (!valid) {
    process.stdout.write(`Validation failed: ${message}\n`);
    process.stdout.write("   Please fix the validation errors before packaging.\n");
    return null;
  }
  process.stdout.write(`${message}\n\n`);

  // Determine output location
  const skillName = path.basename(skillPath);
  const outputPath = outputDir ? path.resolve(outputDir) : process.cwd();
  if (outputDir) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  const skillFilename = path.join(outputPath, `${skillName}.skill`);
  const skillParent = path.dirname(skillPath);

  // Collect files to include
  const allFiles = collectFiles(skillPath, skillParent);
  const filesToInclude: string[] = [];
  const filesToSkip: string[] = [];

  for (const filePath of allFiles) {
    const arcname = path.relative(skillParent, filePath);
    if (shouldExclude(arcname)) {
      filesToSkip.push(arcname);
    } else {
      filesToInclude.push(arcname);
    }
  }

  for (const arcname of filesToSkip) {
    process.stdout.write(`  Skipped: ${arcname}\n`);
  }

  // Use system zip to create the .skill file
  // Build zip from skill parent so arcnames are relative to skillParent
  try {
    // Write a temp file list to avoid command line length limits
    const fileListArg = filesToInclude.map((f) => f).join("\n");

    // Create zip using zip command from skillParent directory
    const zipArgs = ["-r", skillFilename, skillName];

    // Use exclusion flags for zip command
    const excludeArgs: string[] = [];
    for (const dir of EXCLUDE_DIRS) {
      excludeArgs.push("-x", `*/${dir}/*`);
      excludeArgs.push("-x", `${skillName}/${dir}/*`);
    }
    for (const dir of ROOT_EXCLUDE_DIRS) {
      excludeArgs.push("-x", `${skillName}/${dir}/*`);
    }
    for (const glob of EXCLUDE_GLOBS) {
      excludeArgs.push("-x", `*/${glob}`);
    }
    for (const file of EXCLUDE_FILES) {
      excludeArgs.push("-x", `*/${file}`);
    }

    execSync(`zip -r "${skillFilename}" "${skillName}" ${excludeArgs.join(" ")}`, {
      cwd: skillParent,
      stdio: "pipe",
    });

    for (const arcname of filesToInclude) {
      process.stdout.write(`  Added: ${arcname}\n`);
    }
    process.stdout.write(`\nSuccessfully packaged skill to: ${skillFilename}\n`);
    return skillFilename;
  } catch (e) {
    process.stdout.write(`Error creating .skill file: ${e}\n`);
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    process.stdout.write("Usage: bun scripts/package-skill.ts <path/to/skill-folder> [output-directory]\n");
    process.stdout.write("\nExample:\n");
    process.stdout.write("  bun scripts/package-skill.ts skills/public/my-skill\n");
    process.stdout.write("  bun scripts/package-skill.ts skills/public/my-skill ./dist\n");
    process.exit(1);
  }

  const skillPath = args[0];
  const outputDir = args[1];

  process.stdout.write(`Packaging skill: ${skillPath}\n`);
  if (outputDir) {
    process.stdout.write(`   Output directory: ${outputDir}\n`);
  }
  process.stdout.write("\n");

  const result = packageSkill(skillPath, outputDir);
  process.exit(result ? 0 : 1);
}

if (import.meta.main) {
  main();
}
