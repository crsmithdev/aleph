/**
 * In-process HTTP mock for OpenRouter chat completions + Tavily search,
 * used by research-full-pipeline.test.ts to drive a real engine run end to
 * end without touching the network or burning real API spend.
 *
 * The mock dispatches by detecting prompt shape — it doesn't try to be smart
 * about what the engine "really" asked for. Each prompt-shape returns a
 * deterministic canned response that the engine can parse cleanly.
 */

export interface FakeServerHandle {
  port: number;
  baseUrl: string;
  stop: () => void;
  /** Total chat-completion calls served. */
  completeCount: () => number;
  /** Total search calls served. */
  searchCount: () => number;
}

export function startFakeProviderServer(): FakeServerHandle {
  let completeCalls = 0;
  let searchCalls = 0;

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);

      // ---------------- Tavily search ----------------
      if (url.pathname === '/search') {
        searchCalls++;
        return Response.json({
          results: [
            {
              title: 'Sourdough Starter — A Beginner Guide',
              url: 'https://example.com/starter-guide',
              content: 'A sourdough starter is a live culture of flour and water that captures wild yeast. Bakers traditionally feed it once or twice daily depending on temperature and intended use.',
            },
            {
              title: 'Wild yeast and lactobacilli in starter',
              url: 'https://example.com/microbiology',
              content: 'The microbial ecosystem of a sourdough starter combines wild yeasts and lactic acid bacteria. The balance shifts with hydration, temperature, and feeding ratio.',
            },
          ],
        });
      }

      // ---------------- OpenRouter chat completions ----------------
      if (url.pathname === '/chat/completions') {
        completeCalls++;
        const body = await req.json() as {
          messages: Array<{ role: string; content: string }>;
          model: string;
        };
        const userMsg = body.messages.find(m => m.role === 'user')?.content ?? '';
        const text = pickResponse(userMsg);
        return Response.json({
          id: 'fake-' + completeCalls,
          model: body.model,
          choices: [
            { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
        });
      }

      return new Response('not found', { status: 404 });
    },
  });

  return {
    port: server.port,
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
    completeCount: () => completeCalls,
    searchCount: () => searchCalls,
  };
}

// Decide what to return based on what the engine asked for. Order matters:
// more specific shapes first.
function pickResponse(prompt: string): string {
  const p = prompt.toLowerCase();

  // pickAgentRole — JSON {label, prompt}
  if (p.includes('picking a domain expert')) {
    return JSON.stringify({
      label: 'Sourdough Researcher',
      prompt: 'You are a sourdough researcher. You cite microbiology and milling sources.',
    });
  }
  // generateQueryTitle — short title
  if (p.includes('short title (5-8 words)')) return 'Sourdough Starter Microbiology Basics';
  // generatePromptShort — restated sentence
  if (p.includes('restate this research question')) return 'How does a sourdough starter develop?';
  // generateShortQuery — 1-5 word section heading
  if (p.includes('short conceptual section title')) return 'Sourdough Starter';

  // Concept extraction — JSON object
  if (p.includes('concepts') && p.includes('relations') && p.includes('return json')) {
    return JSON.stringify({
      concepts: [
        { name: 'Sourdough starter', aliases: ['starter', 'levain'], summary: 'Live wild-yeast culture.', key_facts: ['Fed regularly.'] },
        { name: 'Wild yeast', aliases: [], summary: 'Naturally occurring yeast.', key_facts: ['Captured from environment.'] },
      ],
      relations: [
        { source: 'Sourdough starter', target: 'Wild yeast', type: 'contains' },
      ],
    });
  }

  // Dedup judge — yes/no
  if (p.includes('duplicate') && p.includes('respond')) return 'no';

  // Synthesize finding — JSON object with all the fields
  if (p.includes('synthesize') || p.includes('"content"')) {
    return JSON.stringify({
      content: 'A sourdough starter is built by mixing flour and water and feeding it daily until a stable wild-yeast and lactobacilli culture establishes. Feeding ratio and temperature determine how active the starter becomes between feedings. Citation: [^1].',
      summary: 'Daily feedings establish a stable wild-yeast and lactobacilli culture in a sourdough starter.',
      source_urls: ['https://example.com/starter-guide', 'https://example.com/microbiology'],
      source_quality: 0.8,
      tags: ['bread', 'fermentation', 'microbiology'],
      confidence: 0.85,
      novelty: 0.7,
      actionability: 0.55,
      follow_ups: [
        'How does temperature change the feeding interval?',
        'What ratio of flour to water keeps the starter stable?',
      ],
    });
  }

  // formulate / search-queries / follow-up generation — JSON array of strings
  if (p.includes('formulate') || p.includes('search queries') || p.includes('follow-up') || p.includes('json array')) {
    return JSON.stringify(['how do sourdough starters develop wild yeast', 'sourdough starter feeding ratio']);
  }

  // Document section / lead generation — markdown
  if (p.includes('section') || p.includes('lead') || p.includes('article') || p.includes('document')) {
    return '## Sourdough Starter\n\nA sourdough starter is a live culture of wild yeasts and lactic acid bacteria, established by feeding flour and water on a regular schedule. The balance of these organisms shifts with hydration, temperature, and feeding ratio.';
  }

  // gap analysis — JSON
  if (p.includes('gap') && p.includes('json')) {
    return JSON.stringify({ has_gaps: false, gaps: [] });
  }

  // perturbation strategies — short text
  if (p.includes('contrarian') || p.includes('perturbation') || p.includes('analogical')) {
    return 'A short alternative angle on the topic.';
  }

  // Catch-all — return an empty JSON array so anything expecting JSON.parse
  // doesn't throw. Generic prompts that aren't recognized usually want a list.
  return '[]';
}
