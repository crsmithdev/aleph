#!/usr/bin/env bun
/**
 * Doc references against the code, both ways. No standard tool diffs what docs name with what code has.
 *
 *   broken        a link, anchor or path a doc names that does not resolve; an env var, or a flag of the repo's
 *                 own CLI, that a doc names and no source file holds
 *   undocumented  an env var the code reads that no doc names
 *   orphans       a doc no markdown file links to (agent files count as linkers)
 *
 *   bun refs.ts [root]   JSON
 *
 * Docs are the repo's markdown minus agent files (CLAUDE.md, AGENTS.md, skills, identity/) and records (specs, findings, ADRs):
 * a record describes its day, not main. Source is every other tracked file.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { git } from "../../lib/git.ts";
import { isTestFile } from "../../jobs/lib/gates/test-files.ts";

export type Ref = { doc: string; line: number; kind: "link" | "anchor" | "path" | "env" | "flag"; ref: string };

const SKIP = /(^|\/)(node_modules|\.git|\.worktrees|dist|build|vendor)\//;
const AGENT = /(^|\/)(CLAUDE\.md|CLAUDE\.local\.md|AGENTS\.md|SKILL\.md)$|(^|\/)(skills|\.claude|identity)\//;
const RECORD = /(^|\/)(specs|findings|archive|adr|decisions|rfcs|history)\//;
/** A test file, or a fixture: neither is a page or a live reference. */
const isTest = (f: string): boolean => isTestFile(f) || f.includes("fixture");
/** Pages people land on: nothing has to link to them. */
const ROOTS = /(^|\/)(README|CHANGELOG|CONTRIBUTING|LICENSE|SECURITY|CODE_OF_CONDUCT)\.md$|^llms\.txt$/i;
const READS = [
  /process\.env\.([A-Z][A-Z0-9_]+)/g, /process\.env\[["']([A-Z][A-Z0-9_]+)["']\]/g, /Bun\.env\.([A-Z][A-Z0-9_]+)/g,
  /os\.environ(?:\.get)?[[(]["']([A-Z][A-Z0-9_]+)["']/g, /os\.getenv\(["']([A-Z][A-Z0-9_]+)["']/g,
  /env::var\("([A-Z][A-Z0-9_]+)"/g, /os\.Getenv\("([A-Z][A-Z0-9_]+)"/g,
];

/** The repo's files: git's list in a checkout, else a scan. */
function files(root: string): string[] {
  const ls = git(root, "ls-files", "-co", "--exclude-standard");
  const all = ls.ok ? ls.out.split("\n") : [...new Bun.Glob("**/*").scanSync({ cwd: root, dot: true })];
  return all.filter((f) => f && !SKIP.test(f) && existsSync(join(root, f)) && statSync(join(root, f)).isFile());
}

/** The CLI names a package manifest declares (`bin` of package.json, `scripts` of pyproject.toml). */
function manifest(root: string): Record<string, string> {
  const pkg = join(root, "package.json");
  if (!existsSync(pkg)) return {};
  const bin = JSON.parse(readFileSync(pkg, "utf8")).bin;
  return typeof bin === "string" ? { [JSON.parse(readFileSync(pkg, "utf8")).name]: bin } : bin ?? {};
}

/** GitHub's heading anchor. */
export const slug = (h: string) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");

/** The anchors of a markdown file: its headings, numbered as GitHub numbers repeats. */
function anchors(text: string): Set<string> {
  const seen = new Map<string, number>();
  return new Set(prose(text).flatMap((l) => {
    const m = l.match(/^#{1,6}\s+(.*)$/);
    if (!m) return [];
    const s = slug(m[1].replace(/`/g, ""));
    const n = seen.get(s) ?? 0;
    seen.set(s, n + 1);
    return [n ? `${s}-${n}` : s];
  }));
}

/** Lines outside fenced blocks, fences blanked so line numbers hold. */
function prose(text: string): string[] {
  let fence = false;
  return text.split("\n").map((l) => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return ""; }
    return fence ? "" : l;
  });
}

/** What one doc names: links, code-span paths, env vars and flags, with their line. */
function named(text: string, clis: Set<string> = new Set()): { line: number; kind: Ref["kind"]; ref: string }[] {
  const lines = text.split("\n");
  const out: { line: number; kind: Ref["kind"]; ref: string }[] = [];
  prose(text).forEach((l, i) => {
    const bare = l.replace(/`[^`]*`/g, "");
    for (const m of bare.matchAll(/\]\(([^)\s]+)\)/g)) if (!/^[a-z]+:|^mailto:/i.test(m[1])) out.push({ line: i + 1, kind: "link", ref: m[1] });
    for (const m of l.matchAll(/`([^`]+)`/g)) {
      const s = m[1].trim();
      if (/^\.{0,2}\/?[\w.-]+(\/[\w.-]+)+\/?$/.test(s)) out.push({ line: i + 1, kind: "path", ref: s });
      else if (/^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(s)) out.push({ line: i + 1, kind: "env", ref: s });
      else flags(s, i);
    }
  });
  const fenced = prose(text);
  lines.forEach((l, i) => { if (fenced[i] === "") flags(l, i); });
  return out;

  /** The flags of a command line whose program is the repo's own CLI. */
  function flags(cmd: string, i: number) {
    const words = cmd.trim().replace(/^\$\s*/, "").split(/\s+/);
    const prog = words[0] === "bun" || words[0] === "node" || words[0] === "python" ? words[1] : words[0];
    if (!prog || !clis.has(prog)) return;
    for (const w of words) if (/^--[a-z][\w-]+$/.test(w.split("=")[0])) out.push({ line: i + 1, kind: "flag", ref: w.split("=")[0] });
  }
}

export function refs(root: string) {
  const all = files(root);
  const md = all.filter((f) => /\.md$/.test(f) && !isTest(f));
  const docs = md.filter((f) => !AGENT.test(f) && !RECORD.test(f));
  const clis = new Set([...all.filter((f) => /^bin\/[^/]+$/.test(f)).map((f) => f.slice(4)), ...all, ...Object.keys(manifest(root))]);
  const top = new Set(all.map((f) => f.split("/")[0]));
  const source = all.filter((f) => !/\.(md|txt|lock|svg|png|jpg|gif|ico)$/.test(f) && !f.endsWith("lock.json"));
  const code = source.map((f) => ({ f, text: readFileSync(join(root, f), "utf8") }));
  const has = (s: string) => code.some((c) => c.text.includes(s));
  const docText = new Map(docs.map((d) => [d, readFileSync(join(root, d), "utf8")]));
  const linked = new Set<string>();
  const broken: Ref[] = [];

  for (const f of md) for (const n of named(readFileSync(join(root, f), "utf8"))) if (n.kind === "link") linked.add(normalize(join(dirname(f), decodeURI(n.ref.split("#")[0] || f))));
  for (const [doc, text] of docText) {
    for (const n of named(text, clis)) {
      if (n.kind === "link") {
        const [path, frag] = n.ref.split("#");
        const target = path ? normalize(join(dirname(doc), decodeURI(path))) : doc;
        if (path && !existsSync(join(root, target))) { broken.push({ doc, ...n }); continue; }
        if (frag && /\.md$/.test(target) && !anchors(readFileSync(join(root, target), "utf8")).has(frag.toLowerCase())) broken.push({ doc, ...n, kind: "anchor" });
      }
      const rel = n.ref.startsWith("..") ? normalize(join(dirname(doc), n.ref)) : n.ref.replace(/^\.\//, "");
      const repoPath = top.has(rel.split("/")[0]);
      if (n.kind === "path" && repoPath && ![join(root, n.ref), join(root, dirname(doc), n.ref)].some((p) => existsSync(p))) broken.push({ doc, ...n });
      if ((n.kind === "env" || n.kind === "flag") && !has(n.ref)) broken.push({ doc, ...n });
    }
  }

  const allDocs = [...docText.values()].join("\n");
  const live = code.filter((c) => !isTest(c.f));
  const env = [...new Set(live.flatMap((c) => READS.flatMap((re) => [...c.text.matchAll(re)].map((m) => m[1]))))];
  return {
    docs,
    broken: broken.sort((a, b) => a.doc.localeCompare(b.doc) || a.line - b.line),
    undocumented: { env: env.filter((e) => !allDocs.includes(e)).sort() },
    orphans: docs.filter((d) => !ROOTS.test(d) && !linked.has(d)),
  };
}

if (import.meta.main) console.log(JSON.stringify(refs(resolve(process.argv[2] ?? process.cwd())), null, 2));
