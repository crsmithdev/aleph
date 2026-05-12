import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';

const TEMPLATES: { label: string; prompt: string }[] = [
  { label: 'timeline', prompt: 'Timeline of ' },
  { label: 'comparison', prompt: 'Compare ' },
  { label: 'survey', prompt: 'Overview of ' },
  { label: 'dynamics', prompt: 'How does ' },
  { label: 'audit', prompt: 'Is ' },
];

// Rotated on every page load (not on every render — see useState init below).
const PLACEHOLDER_SAMPLES = [
  // Software engineering
  'How did Git win out over Mercurial and Bazaar — what was the inflection point?',
  'Compare React Server Components, the Next.js App Router, and Remix loaders — same problem, different bets',
  'Audit: is monorepo tooling (Turborepo, Nx, Bazel) actually faster, or just better at hiding builds?',
  'Timeline of how SQLite ate the embedded-database world — Berkeley DB to today',
  'Why did REST beat SOAP, and what is GraphQL actually replacing?',
  // AI
  'Overview of post-training techniques in 2024–25 — RLHF, DPO, PRO, and what stuck',
  'How do mixture-of-experts models actually route tokens, and where does the routing break?',
  'Compare retrieval strategies for code-aware LLMs: BM25, embeddings, AST chunking, hybrid',
  'Timeline of agent frameworks — AutoGPT, BabyAGI, LangGraph, OpenAI Agents SDK',
  'Audit: are "reasoning" models actually reasoning, or just spending more tokens?',
  // Internet
  'How did the protocol war between IPv4 and IPv6 stall — and who is still funding the migration?',
  'Timeline of the open-web decline: RSS, the Twitter API, the Reddit API, the Stack Exchange dumps',
  'Compare the architectures of Cloudflare, Fastly, and AWS CloudFront edge networks',
  'Survey of how email authentication actually works in 2026 — SPF, DKIM, DMARC, BIMI',
  'How does BGP still hold the internet together when one bad route can take it down?',
  // EDM
  'Timeline of how Detroit techno crossed the Atlantic — labels, DJs, pivotal venues 1986–94',
  'Compare the Berlin and Frankfurt feedback loops in early-90s techno',
  'Survey of jungle’s transition into drum and bass — Metalheadz vs Reinforced vs Moving Shadow',
  'How did Daft Punk reshape French house, and who actually came before Homework?',
  'Audit: is microhouse a coherent genre, or a 2002 marketing label that stuck?',
];

function pickPlaceholder(): string {
  return PLACEHOLDER_SAMPLES[Math.floor(Math.random() * PLACEHOLDER_SAMPLES.length)];
}

/** Hero compose box on the research landing page. Submits the prompt to the
 *  loops engine (`POST /api/loops/start`, research template) and navigates to
 *  `/research/{slug}` on success — the detail page picks up shape/output_shape
 *  detection + the planner's schedule artifact, surfaces them there. */
export function ComposeBox() {
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Frozen on mount so the placeholder doesn't shuffle on every keystroke.
  const [placeholder] = useState(pickPlaceholder);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent | undefined) {
    if (e) e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/loops/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ template_id: 'research', prompt: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { id } = await res.json() as { id: string };
      navigate(`/research/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(undefined);
    }
  }

  function applyTemplate(t: { label: string; prompt: string }) {
    setPrompt(p => (p ? p : t.prompt));
  }

  return (
    <section
      className={clsx(
        'rounded-xl border border-accent/30 px-6 pt-5 pb-4',
        'bg-gradient-to-b from-accent/[0.08] to-bg-secondary',
      )}
    >
      <form onSubmit={handleSubmit}>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full min-h-[120px] bg-bg-primary border border-border-primary rounded-lg px-4 py-3.5 text-base text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y leading-relaxed"
          disabled={submitting}
        />

        {error && (
          <div
            className="mt-3 text-sm text-error border border-error/40 bg-error/10 rounded px-3 py-2"
            data-testid="compose-error"
          >
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 mt-3.5 flex-wrap">
          <button
            type="submit"
            className="bg-accent text-bg-primary border-0 px-5 py-2 text-sm font-semibold rounded-md hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!prompt.trim() || submitting}
          >
            {submitting ? 'Starting…' : 'Start research →'}
          </button>
          <span className="text-xs text-text-muted">↵ start</span>
          <span className="ml-auto flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted self-center">
              Shape:
            </span>
            {TEMPLATES.map(t => (
              <button
                key={t.label}
                type="button"
                onClick={() => applyTemplate(t)}
                className="text-xs px-2.5 py-1 border border-dashed border-border-secondary rounded text-text-secondary hover:text-text-primary hover:border-accent capitalize"
              >
                {t.label}
              </button>
            ))}
          </span>
        </div>
      </form>
    </section>
  );
}
