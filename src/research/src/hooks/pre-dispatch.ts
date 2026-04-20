import type { HookHandler, HookResult } from './types.js';
import type { InterpretedPrompt, PromptShape, PromptDepth } from '../types.js';

export interface PreDispatchHandlerOptions {
  apiKey: string;
  model?: string;
  // Allows tests to stub the LLM without reaching the network.
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL = 'deepseek/deepseek-chat';
const SHAPES: PromptShape[] = ['answer', 'list', 'table', 'brief', 'dataset'];
const DEPTHS: PromptDepth[] = ['shallow', 'normal', 'deep'];

const SYSTEM_INSTRUCTIONS = `You interpret research prompts for an autonomous research system.

Given a user's prompt and optional hints, produce a structured interpretation that the dispatcher will use to plan thread spawning, source selection, and output formatting.

Return ONLY valid JSON matching this exact schema, no prose before or after:

{
  "intent": "one sentence summarizing what the user is trying to find out",
  "shape": "answer" | "list" | "table" | "brief" | "dataset",
  "depth": "shallow" | "normal" | "deep",
  "scope": "one short phrase describing how broad or narrow the search should be",
  "clarifying_question": "<optional — only if the prompt is genuinely ambiguous between two distinct interpretations; otherwise omit>",
  "notes": "<optional — one sentence of anything the dispatcher should know>"
}

Rules:
- If the user provided a "shape" / "depth" hint, prefer it. If they didn't, infer.
- "shape" defaults: one concrete answer → "answer"; enumerated items → "list"; structured rows → "table"; quick summary → "brief"; downloadable machine-readable → "dataset".
- "depth": "shallow" for simple lookups, "deep" for multi-step investigation, "normal" for most.
- Clarifying questions are expensive — only ask if the prompt truly has two plausible meanings. Default to best-guess.`;

export function createPreDispatchHandler(opts: PreDispatchHandlerOptions): HookHandler<'pre_dispatch'> {
  const model = opts.model ?? DEFAULT_MODEL;
  const fetchImpl = opts.fetchImpl ?? fetch;

  return async (payload) => {
    const userContent = buildUserContent(payload.prompt, payload.hints as Record<string, unknown>);

    const resp = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTIONS },
          { role: 'user', content: userContent },
        ],
        max_tokens: 400,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });

    if (!resp.ok) {
      throw new Error(`pre_dispatch LLM call failed: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;

    return parseResponse(raw);
  };
}

function buildUserContent(prompt: string, hints: Record<string, unknown>): string {
  const hintLines = Object.entries(hints)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `- ${k}: ${v}`);
  const hintBlock = hintLines.length > 0 ? `\n\nHints:\n${hintLines.join('\n')}` : '';
  return `Prompt:\n${prompt}${hintBlock}`;
}

function parseResponse(raw: string): HookResult<'pre_dispatch'> | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const intent = typeof obj.intent === 'string' ? obj.intent : null;
  const shape = SHAPES.includes(obj.shape as PromptShape) ? obj.shape as PromptShape : null;
  const depth = DEPTHS.includes(obj.depth as PromptDepth) ? obj.depth as PromptDepth : null;
  const scope = typeof obj.scope === 'string' ? obj.scope : null;

  if (!intent || !shape || !depth || !scope) return null;

  const interpretation: InterpretedPrompt = { intent, shape, depth, scope };
  const dispatch = obj.dispatch_params;
  if (dispatch && typeof dispatch === 'object' && !Array.isArray(dispatch)) {
    interpretation.dispatch_params = dispatch as Record<string, unknown>;
  }

  const result: HookResult<'pre_dispatch'> = { interpretation };
  if (typeof obj.clarifying_question === 'string' && obj.clarifying_question.trim()) {
    result.clarifying_question = obj.clarifying_question.trim();
  }
  if (typeof obj.notes === 'string' && obj.notes.trim()) {
    result.notes = obj.notes.trim();
  }
  return result;
}
