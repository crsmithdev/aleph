---
name: search
description: Quick web research — search the internet, synthesize findings, and report back with sources. Use when the user wants to look something up, find out how something works, compare options, evaluate libraries/tools, or answer a question that requires current information. Completes in minutes, not hours.
---

# Search

Produce research that supports decisions, not research theater.

## When to Activate

- Looking up how something works, what exists, or what's current
- Comparing libraries, tools, services, or approaches
- Evaluating options before building (search-first)
- Answering questions that require information beyond training data
- Finding documentation, examples, or best practices

## Before Searching

If the query is vague or under 10 words, refine it first:
- Ask 1-2 clarifying questions about scope, constraints, or what decision the research supports
- Skip this if the intent is already clear

If the answer might be in the codebase, check there first. Don't search the web for what `grep` can find.

## Process

1. **Define** — convert the request into 2-5 concrete questions
2. **Search** — fire parallel searches with different angles (use WebSearch, WebFetch). Search broadly first, then drill into promising sources.
3. **Evaluate** — prefer primary sources (official docs, repos, RFCs) over aggregators. Flag stale data. Fetch full pages when snippets aren't enough.
4. **Synthesize** — answer the original questions. Separate fact from inference.

## Search-First Principle

When evaluating whether to build vs. adopt:

1. Search for existing solutions (packages, MCP servers, libraries, prior art)
2. Score candidates on: functionality fit, maintenance activity, community, docs quality, license, dependency weight
3. Decide: adopt as-is / extend with wrapper / compose multiple / build custom
4. Only build custom when search confirms nothing suitable exists

## Output

Structure by default:

1. **Summary** — 2-3 sentences answering the core question
2. **Key findings** — organized by the concrete questions defined in step 1
3. **Recommendation** — what to do, if the research was decision-oriented
4. **Sources** — inline links throughout, collected list at end

Adjust structure to fit the request. A simple lookup doesn't need five sections.

## Quality Gate

Before delivering:
- Claims are sourced or labeled as inference
- Stale or undated data is flagged
- Conflicting evidence is included, not hidden
- The response makes a decision easier, not harder

## Done When

- Original questions answered or explicitly marked as gaps
- Sources cited for every factual claim
- Output is concise — no padding, no restating the question
