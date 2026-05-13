#!/usr/bin/env bun
/**
 * Unit tests for url-grounding helpers.
 *
 * Tests pure-function behavior. The integration with ensureScheduleArtifact
 * lives in shape.test.ts where the LLM dispatcher can inspect the augmented
 * prompt.
 */
import { extractUrls, fetchUrlContents, buildGroundedPrompt, type UrlContent } from './url-grounding.js';

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); failed++; }
}

console.log('\n--- extractUrls ---');
check('no URLs', extractUrls('plain text question').length === 0);
check('one https URL', JSON.stringify(extractUrls('see https://example.com/foo')) === JSON.stringify(['https://example.com/foo']));
check('one http URL', extractUrls('http://x.test/y').includes('http://x.test/y'));
check('strips trailing period',
  extractUrls('check https://github.com/0xnirmal/awesome-deep-research . pick top 3').includes('https://github.com/0xnirmal/awesome-deep-research'));
check('strips trailing comma',
  extractUrls('see https://example.com/foo, then').includes('https://example.com/foo'));
check('dedupes duplicates',
  extractUrls('a https://x.test b https://x.test c').length === 1);
check('caps at 3 URLs', extractUrls(
  'https://1.test https://2.test https://3.test https://4.test https://5.test',
).length === 3);
check('ignores www without scheme', extractUrls('see www.example.com').length === 0);

console.log('\n--- fetchUrlContents ---');
// Inject a deterministic fetcher so we never hit the network in unit tests.
const stubFetcher = async (url: string) => {
  if (url.includes('good')) return 'a'.repeat(500);
  if (url.includes('short')) return 'too brief';
  if (url.includes('throws')) throw new Error('synthetic fetch failure');
  return '';
};

const results = await fetchUrlContents(
  ['https://good.test', 'https://short.test', 'https://empty.test', 'https://throws.test'],
  stubFetcher,
);
check('fetcher invoked per URL', results.length === 4);
check('successful fetch returns text', results[0].text.length === 500);
check('short fetch survives — filtering is buildGroundedPrompt\'s job',
  results[1].text.length > 0 && results[1].text.length < 100);
check('empty fetch returns empty', results[2].text === '');
check('thrown fetcher swallowed → empty', results[3].text === '');

// Verify per-URL cap is honored.
const big = await fetchUrlContents(['https://big.test'], async () => 'x'.repeat(10_000));
check('per-URL text capped to 4000 chars', big[0].text.length === 4000);

console.log('\n--- buildGroundedPrompt ---');
const promptOnly = buildGroundedPrompt('original question', []);
check('no fetched content → prompt unchanged', promptOnly === 'original question');

const allShort = buildGroundedPrompt('q', [
  { url: 'a', text: 'tiny' },
  { url: 'b', text: '' },
]);
check('all useless → prompt unchanged', allShort === 'q');

const mixed: UrlContent[] = [
  { url: 'https://useful.test', text: 'real content '.repeat(20) },
  { url: 'https://short.test', text: 'brief' },
  { url: 'https://empty.test', text: '' },
];
const grounded = buildGroundedPrompt('original question', mixed);
check('useful content gets appended', grounded.includes('Referenced URL contents'));
check('useful URL included', grounded.includes('https://useful.test'));
check('short URL filtered out', !grounded.includes('https://short.test'));
check('empty URL filtered out', !grounded.includes('https://empty.test'));
check('original prompt preserved verbatim at the top', grounded.startsWith('original question'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
