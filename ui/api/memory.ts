/** `GET /api/memory`, `/api/memory/search?q=`, `/api/memory/note?title=`: the Memory view, read-only over the vault. `?project=<key>` keeps the notes whose scope is that key. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Routes } from "../server.ts";
import { KINDS, linkTargets, links, lintVault, loadVault, vaultDir, wikiNotes, type Note } from "../../vault/lib/vault.ts";

const CLI = join(import.meta.dir, "..", "..", "vault", "cli.ts");
const scopeOf = (n: Note) => String(n.fm.scope ?? "");
const inScope = (project: string | null) => (n: Note) => !project || scopeOf(n) === project;
const count = (xs: string[]) => Object.fromEntries([...new Set(xs)].sort().map((x) => [x, xs.filter((y) => y === x).length]));
const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Home's `## Section` headings, each with its `- [[Title]] — hook` lines. Entries outside the project's scope are dropped. */
function homeSections(notes: Note[], keep: (n: Note) => boolean, project: string | null) {
  const home = notes.find((n) => n.rel === "Home.md");
  if (!home) return [];
  const targets = linkTargets(notes);
  const sections: { heading: string; entries: { title: string; hook: string }[] }[] = [];
  for (const line of home.body.split("\n")) {
    const h = /^##\s+(.*?)\s*$/.exec(line);
    if (h) { sections.push({ heading: h[1], entries: [] }); continue; }
    const m = /^\s*-\s*\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]\s*(?:[—–-]+\s*)?(.*)$/.exec(line);
    if (!m || !sections.length) continue;
    const hit = targets.get(m[1].trim().toLowerCase());
    if (project && !(hit && keep(hit))) continue;
    sections.at(-1)!.entries.push({ title: hit?.title ?? m[1].trim(), hook: m[2].trim() });
  }
  return project ? sections.filter((s) => s.entries.length) : sections;
}

/** The last 20 lines the vault's CLI appended to its daily notes, newest first. */
function recentWrites(root: string, notes: Note[], keep: (n: Note) => boolean, project: string | null) {
  const dir = join(root, "daily");
  if (!existsSync(dir)) return [];
  const targets = linkTargets(notes);
  const out: { date: string; time: string; text: string }[] = [];
  for (const f of readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse()) {
    const lines = readFileSync(join(dir, f), "utf8").split("\n").reverse();
    for (const l of lines) {
      const m = /^- (\d{2}:\d{2}) (.*)$/.exec(l);
      if (!m) continue;
      if (project) {
        const t = links(m[2])[0];
        const hit = t ? targets.get(t.toLowerCase()) : undefined;
        if (!hit || !keep(hit)) continue;
      }
      out.push({ date: f.slice(0, 10), time: m[1], text: m[2] });
      if (out.length === 20) return out;
    }
  }
  return out;
}

/** `vault misses --days 7`'s JSON, or null when it fails (no Langfuse keys, offline). */
async function misses(): Promise<unknown | null> {
  try {
    const p = Bun.spawn(["bun", CLI, "misses", "--days", "7"], { env: process.env, stdout: "pipe", stderr: "ignore", timeout: 15_000 });
    const text = await new Response(p.stdout).text();
    if ((await p.exited) !== 0) return null;
    return JSON.parse(text);
  } catch { return null; }
}

async function overview(url: URL): Promise<Response> {
  const project = url.searchParams.get("project") || null;
  const root = vaultDir();
  const all = existsSync(join(root, "Home.md")) ? loadVault(root) : [];
  const keep = inScope(project);
  const wiki = wikiNotes(all).filter(keep);
  const names = new Set(wiki.map((n) => n.title));
  const lint = lintVault(all);
  const mine = (f: { note: string }) => !project || names.has(f.note);
  const body: Record<string, unknown> = {
    project,
    exists: all.length > 0,
    total: wiki.length,
    byKind: { ...Object.fromEntries(KINDS.map((k) => [k, 0])), ...count(wiki.map((n) => String(n.fm.kind ?? "none"))) },
    byScope: count(wiki.map(scopeOf)),
    home: homeSections(all, keep, project),
    lint: { refuse: lint.refuse.filter(mine), warn: lint.warn.filter(mine) },
    writes: recentWrites(root, all, keep, project),
  };
  const m = await misses();
  if (m) body.misses = m;
  return json(body);
}

async function search(url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").trim();
  const project = url.searchParams.get("project") || null;
  if (!q) return json({ q, results: [] });
  // `vault recall` ranks, so the page shows the order the agent sees.
  const args = ["bun", CLI, "recall", q, ...(project ? ["--scope", project] : [])];
  const p = Bun.spawn(args, { env: process.env, stdout: "pipe", stderr: "ignore" });
  const text = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) return json({ q, results: [], error: "vault recall failed" });
  try {
    const hits = JSON.parse(text) as { title: string; path: string; rank: number; scope: string; frontmatter: Record<string, unknown> }[];
    return json({ q, results: hits.map((h) => ({ title: h.title, path: h.path, rank: h.rank, scope: h.scope, kind: String(h.frontmatter?.kind ?? "") })) });
  } catch { return json({ q, results: [], error: "vault recall failed" }); }
}

function note(url: URL): Response {
  const title = (url.searchParams.get("title") ?? "").trim();
  const project = url.searchParams.get("project") || null;
  const root = vaultDir();
  const all = existsSync(join(root, "Home.md")) ? loadVault(root) : [];
  const targets = linkTargets(all);
  const hit = title ? targets.get(title.toLowerCase()) : undefined;
  // Under a project filter, a note outside the project does not exist.
  if (!hit || (project && scopeOf(hit) !== project)) return json({ error: `no note titled ${title || "(none)"}` }, 404);
  const keep = inScope(project);
  const to = [...new Set(links(hit.body))].map((t) => targets.get(t.toLowerCase())).filter((n): n is Note => !!n && keep(n) && n !== hit);
  const from = all.filter((n) => n !== hit && keep(n) && !n.archived && links(n.body).some((t) => targets.get(t.toLowerCase()) === hit));
  const ref = (n: Note) => ({ title: n.title, kind: String(n.fm.kind ?? ""), scope: scopeOf(n) });
  return json({ title: hit.title, path: hit.rel, archived: hit.archived, frontmatter: hit.fm, body: hit.body, links: [...new Map(to.map((n) => [n.title, ref(n)])).values()], backlinks: from.map(ref).sort((a, b) => a.title.localeCompare(b.title)) });
}

export const routes: Routes = {
  "GET /api/memory": (_req, _p, url) => overview(url),
  "GET /api/memory/search": (_req, _p, url) => search(url),
  "GET /api/memory/note": (_req, _p, url) => note(url),
};
