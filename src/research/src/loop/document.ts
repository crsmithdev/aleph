/**
 * Document-polish pass for the v1 loop engine.
 *
 * The research template's renderer hook produces a `render` artifact every
 * cycle — a concatenation of per-cycle synthesized text. Useful as the
 * "current answer" while a loop is running, but reads as raw research notes
 * rather than a finished article: branch-by-branch sections with no
 * connective prose, no unified citation scheme, no introductory framing.
 *
 * `generateDocument` is the optional polish pass that fills that gap. It
 * takes the latest `render` artifact and asks one cheap LLM call to
 * restructure the material into a Wikipedia-style article — lead section,
 * topical headings, numbered `[1]`-style citations, References section.
 * The output lands as a separate `kind: 'document'` artifact so the UI can
 * surface it while keeping the raw `render` available as a fallback for
 * loops that haven't been polished yet.
 *
 * Two entry points:
 *   - `runLoop` fires this once on natural completion (engine.ts), so the
 *     user gets a finished article without clicking anything.
 *   - The API exposes a regenerate endpoint (routes/loops.ts) so the user
 *     can re-fire the polish on demand — useful after a milestone re-plan
 *     adds new branches, or just to retry with a different model later.
 *
 * The polish prompt reads from the latest `render` artifact's findings +
 * sources — the single source of truth for what got synthesised this run.
 */
import type { Sqlite } from '@construct/data';
import { bumpUsage, createArtifact, listArtifacts } from './db.js';
import type { LLMProvider } from './llm.js';
import type { Artifact, LoopId } from './types.js';

const DEFAULT_DOCUMENT_MODEL = 'google/gemini-2.0-flash-001';
const DOCUMENT_MAX_TOKENS = 8000;

/** Payload of a `kind: 'document'` artifact. The text is the polished
 *  Markdown article; the rest is metadata for the UI surface. */
export interface DocumentPayload {
  text: string;
  source_count: number;
  generated_at: string;
  model: string;
  /** Source ids of the cycles whose render artifact fed this document — lets
   *  the UI flag a document as "stale relative to the latest render". */
  rendered_cycles: number;
}

interface RenderFinding {
  cycle: number;
  query: string;
  text: string;
}
interface RenderSource {
  url: string;
  title: string;
  /** Per-source extraction status — populated by the research template's
   *  renderer (see `RenderSourceEntry` in templates/research.ts). Optional
   *  here because the polish pass only reads `url` + `title`; the field
   *  ships so future polish-side filtering (e.g. skip `failed` sources
   *  from the references list) doesn't need a schema change. */
  extraction_status?: 'extracted' | 'snippet_only' | 'failed';
  attempts?: number;
  error?: string;
}
interface RenderPayload {
  kind: 'render';
  findings: RenderFinding[];
  sources: RenderSource[];
  cycles_rendered: number;
}

/**
 * Find the latest `render` artifact for a loop. Templates may write the
 * render either as a top-level artifact (renderer hook output) or as the
 * `render` field of a `cycle_output` payload — the research template does
 * the latter. We scan both kinds and pick the freshest.
 *
 * SQLite `created_at` is second-precision; cycles that finalize within the
 * same second share a timestamp. `listArtifacts` returns rows in insertion
 * order (ORDER BY created_at, with ROWID tie-break), so the LAST eligible
 * entry in the array is authoritative — overwrite `best` unconditionally
 * as we walk forward, NOT by strict-greater timestamp (which would freeze
 * `best` on the first match when ties occur, surfacing cycle 0's empty
 * render instead of the final cycle's accumulated one).
 */
function findLatestRender(artifacts: Artifact[]): RenderPayload | null {
  let best: RenderPayload | null = null;
  for (const a of artifacts) {
    if (a.kind === 'render') {
      best = a.payload as unknown as RenderPayload;
      continue;
    }
    if (a.kind === 'cycle_output') {
      const render = (a.payload as { render?: RenderPayload }).render;
      if (render && Array.isArray(render.findings)) best = render;
    }
  }
  return best;
}

/**
 * Build the encyclopedia-editor prompt. Source material is laid out as
 * `[Cycle N: <query>]\n<text>` blocks — one per cycle, separated by
 * dividers, followed by a numbered source list for citations.
 */
function buildPolishPrompt(prompt: string, render: RenderPayload): string {
  const material = render.findings
    .map(f => `[Cycle ${f.cycle}: ${f.query}]\n${f.text}`)
    .join('\n\n---\n\n');
  const sourceList = render.sources
    .map((s, i) => `[${i + 1}] ${s.title || s.url} — ${s.url}`)
    .join('\n');

  return [
    'You are a skilled encyclopedia editor. Using the research findings below as source material, write a comprehensive, well-structured article about: "' + prompt + '"',
    '',
    'Write it like a Wikipedia article:',
    '- Start with a concise lead section (2-3 paragraphs) that summarizes the entire topic',
    '- Organize the body into logical sections with short heading titles (1-5 words each, ## level)',
    '- Use subsections (### level) where appropriate',
    '- Write in flowing, connected prose — not bullet points or lists',
    '- Weave findings together into a coherent narrative; do not just list them sequentially',
    '- Use transitional phrases between paragraphs and sections',
    '- Where appropriate, cite sources using numbered references like [1], [2] etc.',
    '- End with a "## References" section listing all cited sources as numbered items',
    '- Do NOT include confidence scores, tags, metadata, or any research-process artifacts',
    '- The tone should be encyclopedic: neutral, informative, authoritative',
    '',
    `Source material (${render.findings.length} cycles):`,
    '',
    material,
    '',
    `Available sources for citation (${render.sources.length}):`,
    sourceList,
    '',
    'Output the article body as raw Markdown — do NOT wrap your response in ```markdown ... ``` or any other code fence. Start with the lead section directly.',
  ].join('\n');
}

/** Strip a single leading + trailing markdown code fence if the model
 *  wrapped its response despite the prompt asking it not to. Mirrors the
 *  tolerant-parse helpers in shape.ts and planner.ts. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  // Match an opening fence with optional language tag.
  const openMatch = /^```(?:[a-z]+)?\s*\n/i.exec(trimmed);
  if (!openMatch) return trimmed;
  const body = trimmed.slice(openMatch[0].length);
  // Find the matching closing fence, or strip-and-keep-content if absent
  // (the response may have been truncated before the close).
  const closeIdx = body.lastIndexOf('```');
  return closeIdx === -1 ? body : body.slice(0, closeIdx).trim();
}

/**
 * Run the polish pass and persist a new `kind: 'document'` artifact.
 * Returns the artifact, or `null` if there's no render to polish yet
 * (e.g. the loop ended with zero cycles of usable output — degenerate
 * case the caller can surface as a warning).
 *
 * On LLM failure the function rethrows; callers decide whether to log
 * + continue (the auto-fire path) or surface as a 500 (the regenerate
 * endpoint, where the user is explicitly asking and wants the error).
 */
export async function generateDocument(
  sqlite: Sqlite,
  loop_id: LoopId,
  prompt: string,
  llm: LLMProvider,
  model: string = DEFAULT_DOCUMENT_MODEL,
): Promise<Artifact | null> {
  const artifacts = listArtifacts(sqlite, loop_id);
  const render = findLatestRender(artifacts);
  if (!render || render.findings.length === 0) return null;

  const result = await llm.complete(model, buildPolishPrompt(prompt, render), DOCUMENT_MAX_TOKENS);
  if (result.cost_usd > 0) bumpUsage(sqlite, loop_id, { cost_usd: result.cost_usd });

  const payload: DocumentPayload = {
    text: stripCodeFence(result.text),
    source_count: render.sources.length,
    generated_at: new Date().toISOString(),
    model: result.model || model,
    rendered_cycles: render.cycles_rendered,
  };
  return createArtifact(sqlite, {
    loop_id,
    cycle_id: null,
    kind: 'document',
    payload: payload as unknown as Record<string, unknown>,
  });
}

/**
 * Pull the latest `document` artifact off a loop's artifact list. Templates
 * + UI components call this from inside their render path so they don't
 * need a separate DB read — the engine already loads artifacts into state.
 */
export function readLatestDocument(artifacts: Artifact[]): { artifact: Artifact; payload: DocumentPayload } | null {
  const docs = artifacts
    .filter(a => a.kind === 'document')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (docs.length === 0) return null;
  return { artifact: docs[0], payload: docs[0].payload as unknown as DocumentPayload };
}
