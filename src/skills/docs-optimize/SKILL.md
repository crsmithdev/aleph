---
name: docs-optimize
description: Optimize documentation for AI coding assistants and LLMs. Improves docs for Claude, Copilot, and other AI tools through c7score optimization, llms.txt generation, question-driven restructuring, and automated quality scoring. Use when asked to improve, optimize, or enhance documentation for AI assistants, LLMs, c7score, Context7, or when creating llms.txt files. Also use for documentation quality analysis, README optimization, or ensuring docs follow best practices for LLM retrieval systems.
---

# LLM Docs Optimizer

This skill optimizes project documentation and README files for AI coding assistants and LLMs. It improves documentation quality through c7score optimization, llms.txt file generation, question-driven restructuring, and automated quality scoring.

## Understanding C7Score

C7score evaluates documentation using 5 metrics:

**LLM Analysis (85% of score):**
1. **Question-Snippet Comparison (80%)**: How well snippets answer common developer questions
2. **LLM Evaluation (5%)**: Relevancy, clarity, correctness, uniqueness

**Text Analysis (15% of score):**
3. **Formatting (5%)**: Proper structure and language tags
4. **Project Metadata (5%)**: Absence of irrelevant content
5. **Initialization (5%)**: Not just imports/installations

For detailed metric information, read `references/c7score_metrics.md`.

## Core Workflow

### Step 0: Ask About llms.txt Generation (C7Score Optimization Only)

When the user requests c7score optimization, ask if they also want an llms.txt file. If they explicitly request only llms.txt, skip to the llms.txt workflow.

### Step 1: Analyze Current Documentation

1. Read the documentation files (README.md, docs/*.md, etc.)
2. Optionally run the analysis script: `python scripts/analyze_docs.py <path-to-readme.md>`
3. Review the analysis report for issues

### Step 2: Generate Developer Questions

Create 15-20 "How do I..." questions covering setup, configuration, usage, common operations, auth, error handling, and advanced features.

### Step 3: Map Questions to Snippets

- ✅ Questions with complete, working code examples
- ⚠️ Questions with partial or theoretical answers
- ❌ Questions with no answers

### Step 4: Optimize Documentation

Apply optimizations by priority:

1. **Question Coverage (80% of score)** — Add complete code examples for unanswered questions, make examples self-contained and runnable
2. **Remove Duplicates** — Consolidate similar snippets
3. **Fix Formatting** — Proper language tags, TITLE/DESCRIPTION/CODE structure
4. **Remove Metadata** — No licensing, directory listings, citations
5. **Enhance Initialization** — Combine import-only snippets with usage

For detailed transformation patterns, read `references/optimization_patterns.md`.

### Step 5: Validate Optimizations

Each optimized snippet must: run standalone, answer a specific question, provide unique information, use proper formatting, include necessary imports, and be syntactically correct.

### Step 6: Evaluate C7Score Impact

For the complete scoring methodology and evaluation template, read `REFERENCE.md` section "C7Score Evaluation".

Final score formula: (Q×0.8) + (L×0.1) + (F×0.05) + (M×0.025) + (I×0.025)

## Tips for High Scores

1. Lead with usage, not theory
2. Make examples copy-paste ready with all imports
3. Show solutions, not just API signatures
4. One snippet, one lesson — no duplicate information
5. Use proper language tags consistently
6. Remove noise — no licensing, directory trees, or pure imports
7. Ensure code is syntactically correct and runnable
8. Question-answering dominates the score (80%)

## llms.txt Generation

**llms.txt** is a standardized markdown file providing LLM-friendly content summaries and documentation navigation. Official specification: https://llmstxt.org/

For the complete llms.txt generation workflow — structure, format, templates by project type, and validation — read `REFERENCE.md` section "llms.txt Generation".

### Quick Structure

```markdown
# Project Name

> Brief description (1-3 sentences)

## Documentation
- [Link Title](https://full-url): Brief description

## API Reference
- [Core API](https://full-url): Main API docs

## Examples
- [Basic Usage](https://full-url): Getting started

## Optional
- [Blog](https://full-url): Updates (LLMs can skip this section)
```

## Output Format

When optimizing documentation, provide:
1. Analysis summary
2. Optimized documentation files
3. Change summary with rationale
4. Score impact estimate by metric
5. Recommendations for further improvement
