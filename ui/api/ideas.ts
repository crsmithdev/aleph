/**
 * The ideas routes (docs/specs/2026-11-10-ideas.md): the list, one idea with its lens results and running lens runs,
 * one result file under a CSP with no network, and the POST that starts a lens run detached.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cliOverride } from "../../jobs/lib/infra/settings.ts";
import { allRuns } from "../../jobs/lib/records/ledger.ts";
import { LENSES, ideasDir, lenses, list, read } from "../../ideas/ideas.ts";
import { refuse } from "../../lib/refusal.ts";
import { post } from "../action.ts";
import type { Routes } from "../server.ts";

const SLUG = /^[a-z0-9-]+$/;
const missing = (what: string) => Response.json({ error: `no ${what}` }, { status: 404 });

/** The idea, or null when the slug names none. */
const find = (slug: string) => { try { return SLUG.test(slug) ? read(slug) : null; } catch { return null; } };

const lensRuns = (slug: string) => allRuns().filter((e) => e.run.kind === "lens" && LENSES.some((l) => e.run.name === `${slug}-${l}`));

export const routes: Routes = {
  "GET /api/ideas": (_req, _params, url) => {
    const runs = allRuns().filter((e) => e.run.kind === "lens");
    return Response.json(list(url.searchParams.get("status") ?? undefined).map(({ idea, lenses, last }) => ({
      slug: idea.slug, title: idea.fm.title, target: idea.fm.target, status: idea.fm.status, lenses, last,
      questions: idea.log.filter((l) => /^- \S+ \S+ \?/.test(l)).length,
      spent: runs.filter((e) => LENSES.some((l) => e.run.name === `${idea.slug}-${l}`)).reduce((s, e) => s + (e.run.cost ?? 0), 0),
    })));
  },
  "GET /api/ideas/:slug": (_req, { slug }) => {
    const idea = find(slug);
    if (!idea) return missing(`idea ${slug}`);
    return Response.json({ ...idea.fm, slug, writeup: idea.writeup, log: idea.log, lenses: lenses(slug).reverse(), running: lensRuns(slug).filter((e) => e.run.condition === "running").map((e) => e.run.name) });
  },
  "GET /api/ideas/:slug/lenses/:file": (_req, { slug, file }) => {
    if (!find(slug) || !lenses(slug).some((l) => l.file === `lenses/${file}`)) return missing(`result ${slug}/${file}`);
    return new Response(readFileSync(join(ideasDir(), slug, "lenses", file)), {
      headers: { "content-type": file.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:" },
    });
  },
  "POST /api/ideas/:slug/lenses/:lens": post((_body, { slug, lens }) => {
    if (!LENSES.includes(lens)) refuse(`no lens named ${lens}: use ${LENSES.join(", ")}`);
    if (!find(slug)) refuse(`no idea named ${slug}`);
    const argv = cliOverride() ? [cliOverride()!] : [process.execPath, join(import.meta.dir, "..", "..", "jobs", "cli.ts")];
    Bun.spawn([...argv, "idea", "lens", slug, lens], { stdin: "ignore", stdout: "ignore", stderr: "ignore", env: process.env }).unref();
    return { started: `${slug}-${lens}` };
  }),
};
