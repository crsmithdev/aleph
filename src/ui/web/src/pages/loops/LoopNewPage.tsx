/**
 * Loop submit page — minimal Phase 1 surface. The v1 schedule view + 8-mode
 * row land at Phase 6; for now this is just enough to drive a loop from a
 * browser so the Playwright e2e has something to click on.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';

export function LoopNewPage() {
  const navigate = useNavigate();
  const [templateId, setTemplateId] = useState('noop');
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/loops/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ template_id: templateId, prompt }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { id } = await res.json() as { id: string };
      navigate(`/loops/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="New Loop" subtitle="Start a loop with the v1 engine. Phase 1: noop. Phase 2: research." />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-2xl" data-testid="loop-new-form">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-text-muted">Template</span>
          <select
            value={templateId}
            onChange={e => setTemplateId(e.target.value)}
            className="bg-bg-secondary border border-border-primary rounded px-3 py-2 text-sm text-text-primary"
            data-testid="loop-new-template"
          >
            <option value="noop">noop (5 cycles, canned outputs — Phase 1 smoke)</option>
            <option value="research">research (search + extract — Phase 2)</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-text-muted">Prompt</span>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={4}
            placeholder="Ignored by the noop template; required for research."
            className="bg-bg-secondary border border-border-primary rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50"
            data-testid="loop-new-prompt"
          />
        </label>

        {error && (
          <div className="text-sm text-error border border-error/40 bg-error/10 rounded px-3 py-2" data-testid="loop-new-error">
            {error}
          </div>
        )}

        <div>
          <Button type="submit" disabled={submitting} data-testid="loop-new-submit">
            {submitting ? 'Starting…' : 'Start loop'}
          </Button>
        </div>
      </form>
    </div>
  );
}
