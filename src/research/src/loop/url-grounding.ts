/**
 * URL grounding for the adaptive planner — Phase 4 acceptance closer.
 *
 * Per the build plan: "URL detection in the prompt feeds the planner as a
 * grounding signal (contents fetched, supplied as canon seed) rather than
 * as a separate code path."
 *
 * The planner's prompt already instructs the LLM to seed canon from URL
 * contents (planner.ts:70), but the planner doesn't fetch — that's the
 * caller's job. This module fills that gap: extract URLs, fetch via the
 * existing readability path, splice the page text back into the prompt
 * that `planLoop` receives. Output-shape / question-shape / role
 * detectors keep the original prompt; they classify the question itself,
 * not the URL contents.
 */

import { fetchViaReadability } from '../providers/websearch.js';

const URL_REGEX = /\bhttps?:\/\/[^\s<>()'"]+/g;
const MAX_URLS = 3;
const MAX_TEXT_PER_URL = 4000;
const MIN_USEFUL_LENGTH = 100;
const GITHUB_REPO_REGEX = /^https?:\/\/github\.com\/([^/?#]+)\/([^/?#]+)(?:[/?#]|$)/;
const RAW_FETCH_TIMEOUT_MS = 8_000;

export interface UrlContent {
  url: string;
  text: string;
}

export type UrlFetcher = (url: string) => Promise<string>;

/**
 * Extract distinct URLs from free-form prompt text. Strips trailing
 * sentence punctuation that often follows a URL in natural prose
 * ("see https://example.com/foo." → "https://example.com/foo"). Caps at
 * 3 URLs so a prompt full of links doesn't blow the planner's input
 * budget.
 */
export function extractUrls(text: string): string[] {
  const raw = text.match(URL_REGEX) ?? [];
  const cleaned = raw.map(u => u.replace(/[.,;:!?]+$/, ''));
  return Array.from(new Set(cleaned)).slice(0, MAX_URLS);
}

/**
 * Fetch each URL in parallel. Default path tries a GitHub raw-README
 * shortcut first (GitHub repo pages are JS-rendered and don't survive
 * Readability extraction), then falls back to readability on the
 * original URL. Failures come back as empty text — the caller filters
 * those out. Per-URL text is capped so one huge README can't dominate
 * the planner input.
 */
export async function fetchUrlContents(
  urls: string[],
  fetcher: UrlFetcher = defaultFetcher,
): Promise<UrlContent[]> {
  return Promise.all(
    urls.map(async url => {
      const text = await fetcher(url).catch(() => '');
      return { url, text: text.slice(0, MAX_TEXT_PER_URL) };
    }),
  );
}

async function defaultFetcher(url: string): Promise<string> {
  const raw = await tryGithubRawReadme(url);
  if (raw.length >= MIN_USEFUL_LENGTH) return raw;
  return fetchViaReadability(url);
}

/**
 * If the URL points at a github.com repo, attempt to fetch its README
 * directly from raw.githubusercontent.com — Readability extraction on
 * the rendered repo page fails (the README is JS-rendered into a
 * non-article container).
 */
async function tryGithubRawReadme(url: string): Promise<string> {
  const match = url.match(GITHUB_REPO_REGEX);
  if (!match) return '';
  const [, owner, repo] = match;
  const cleanedRepo = repo.replace(/\.git$/, '');
  // HEAD resolves to the default branch on raw.githubusercontent.com for
  // public repos — one fetch covers main/master/anything else. README.md
  // is the GitHub-normalized casing.
  return rawFetch(`https://raw.githubusercontent.com/${owner}/${cleanedRepo}/HEAD/README.md`);
}

async function rawFetch(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(RAW_FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research-agent/1.0)' },
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * Build the prompt the planner sees: original prompt verbatim, then a
 * delimited block of fetched URL contents. URLs that returned empty or
 * short text are dropped (no value passing 30 chars of cookie-banner
 * text). When nothing useful was fetched, returns the original prompt
 * unchanged — the planner stays on the existing code path.
 */
export function buildGroundedPrompt(prompt: string, fetched: UrlContent[]): string {
  const useful = fetched.filter(f => f.text.length >= MIN_USEFUL_LENGTH);
  if (useful.length === 0) return prompt;
  const block = useful.map(f => `### ${f.url}\n${f.text}`).join('\n\n');
  return `${prompt}\n\nReferenced URL contents (use to seed canon):\n${block}`;
}
