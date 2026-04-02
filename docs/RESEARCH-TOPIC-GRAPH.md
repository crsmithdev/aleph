# Research Topic Graph: Spec

## Problem

The engine treats every thread as a question to be answered. This causes two related problems:

1. **Topic inputs are penalized in scoring.** `relevanceScore` uses Jaccard similarity between follow-ups and the parent query. Short topic strings ("machine learning") have less vocabulary overlap with full follow-up questions, so Jaccard is systematically lower — even when the follow-up is clearly on-topic.

2. **Follow-ups are always questions.** `detectGaps` is prompted to return "unanswered questions." This means the thread graph is always a question tree — you can never build a graph of topics, each covered in depth.

The user wants to research both: "What are the limitations of transformers?" (question) and "transformer architectures" (topic). Both should produce high-quality graphs of children.

---

## Design

### Core concept: `node_type`

Add `node_type: 'question' | 'topic'` to `ResearchThread`. Each thread knows whether it is:

- **question** — has a specific answer. Children explore aspects of the answer or verify claims.
- **topic** — has a domain to cover. Children are subtopics or focused aspects of the domain.

The node type affects:
- how `detectGaps` generates children (questions vs subtopic phrases)
- how children are scored (`answerabilityScore` vs `focusScore`)
- how relevance to the parent is measured
- what filters apply (pronoun filter is question-specific)

Node type is **inferred at thread creation** from the string shape, but can be set explicitly. It is stored on the thread so every downstream step can branch on it without re-inferring.

### Inference rule

```
classify(s: string): 'question' | 'topic'
  if s ends with '?'                              → question
  if s contains a question word (what/how/why/when/where/who/which) → question
  if s starts with a verb (is/are/does/can/should/will/would/has)   → question
  otherwise                                        → topic
```

---

## Changes

### 1. `types.ts`

- Add `node_type: 'question' | 'topic'` to `ResearchThread`
- Rename `ResearchFinding.follow_up_questions: string[]` → `follow_ups: string[]`  
  (field stores both questions and topic phrases now)
- Rename `FollowUpCandidate.question: string` → `FollowUpCandidate.text: string`  
  (same reason)
- Update `FollowUpCandidate` docstring: `quality_score` description updated to reflect dual scoring

### 2. `ddl.ts`

- Add `node_type TEXT NOT NULL DEFAULT 'question'` to the threads table
- Rename `follow_up_questions` column to `follow_ups` in the findings table
- Add migration guard (ALTER TABLE IF NOT column exists)

### 3. `engine.ts` — `detectGaps`

Branch the prompt on `thread.node_type`:

**question thread:**  
> "Given the research question and what was found, what specific questions remain unanswered or need verification?"  
> Returns: array of question strings (current behavior)

**topic thread:**  
> "Given the research topic and what was found, what specific subtopics or aspects need detailed coverage?"  
> "Return focused noun phrases or named concepts — not full questions."  
> Returns: array of topic phrases

The return type is still `string[]` — no structural change. The caller infers node_type for each child from the returned strings using the same `classify()` rule.

### 4. `engine.ts` — `scoreAndRankFollowUps`

Replace the three quality subscores with type-aware variants:

#### `relevanceScore` (currently Jaccard × 2, same for all)

**question follow-up, question parent (current case):**  
`Math.min(1, jaccardSimilarity(text, thread.query) * 2)` — unchanged

**topic follow-up, topic parent:**  
Use keyword containment: what fraction of the parent's words appear in the child?  
`parentWords.filter(w => childLower.includes(w)).length / parentWords.length`  
This correctly scores "transformer attention mechanisms" as highly relevant to "transformers."

**question follow-up, topic parent (mixed):**  
Use containment of the parent's key terms in the question, capped at 1.0:  
`Math.min(1, containmentRatio * 1.5)`

**topic follow-up, question parent (mixed):**  
Use Jaccard but with a lower multiplier (× 1.5 instead of × 2) since topic phrases are shorter.

#### `answerabilityScore` → `focusScore`

Rename to reflect its actual purpose: how well-defined / searchable is this string?

**For questions** (existing logic, unchanged):
- ends with `?` → 1.0  
- has question words → 0.7  
- else → 0.4

**For topics** (new):
- 3–6 words with at least one capitalized or technical term → 1.0  
- 2–6 words, no special terms → 0.7  
- 1 word or > 10 words (too vague or too verbose) → 0.4

#### `specificityScore` (unchanged formula, adjusted intent)

Current formula already rewards length and named entities. For topics this still works: "Rust async runtime" (3 words, 2 capitalized) scores 1.0. No change needed.

#### Pronoun filter (line 408–409 of engine.ts)

Currently rejects any follow-up containing `they/it/this/these/those/such`. This is correct for questions ("What are their limitations?" can't stand alone) but wrong for topic phrases that legitimately use these words in context.

**Change:** only apply the pronoun filter when `node_type === 'question'`. Topic phrases pass through.

### 5. `engine.ts` — thread creation for follow-ups (line 413)

When spawning a follow-up thread, set `node_type: classify(question)` using the inference rule above.

### 6. `engine.ts` — `startSession` / seed thread

Pass `node_type: classify(seedQuery)` when creating the seed thread.

### 7. `services/threads.ts` and `services/findings.ts`

- `createThread` / `updateThread` accept and store `node_type`
- `createFinding` / `updateFinding` use `follow_ups` instead of `follow_up_questions`

---

## Constraint: don't regress question quality

The existing scoring works well for question-based sessions. Changes should not degrade that. Two code paths are fine if that's the cleanest design — but there's no strict requirement that question threads produce byte-identical scores. The goal is: question sessions continue to produce high-quality, diverse follow-ups at the same rate they do now.

---

## What does NOT change

- `formulateQueries` — the "Topic: ..." prompt works for both node types; no change needed
- `synthesizeFinding` — synthesis is identical regardless of whether the thread is a question or topic
- `isCovered` — confidence/novelty thresholds are already model-agnostic
- `ThreadOrigin` — `seed`, `follow_up`, `perturbation`, etc. remain valid for both types
- `distance_from_parent` formula — still `1 - jaccardSimilarity(text, thread.query)`; this measures how far the child has drifted, which is correct for both types

---

## Result

After these changes:

- `"machine learning"` → topic thread → children are subtopic phrases ("neural network architectures", "training data requirements", "inference optimization") → each spawns further subtopics or questions
- `"What are the limitations of transformers?"` → question thread → children are follow-up questions (current behavior, unchanged)
- Mixed: a topic thread can spawn a question child if the LLM returns a question-form string; a question thread can spawn a topic child if the LLM returns a noun phrase — `classify()` handles both
- Scoring is no longer biased against either form

---

## Files to change

| File | Nature of change |
|---|---|
| `src/research/src/types.ts` | Add `node_type`; rename `follow_up_questions` → `follow_ups`; rename `FollowUpCandidate.question` → `.text` |
| `src/research/src/ddl.ts` | Add `node_type` column; rename findings column; migration guard |
| `src/research/src/engine.ts` | `detectGaps` branch; `scoreAndRankFollowUps` type-aware scoring; pronoun filter gate; seed + follow-up thread creation pass `node_type` |
| `src/research/src/services/threads.ts` | Accept/store `node_type` |
| `src/research/src/services/findings.ts` | Use renamed `follow_ups` field |

No UI changes needed for the core behavior change. The UI already renders thread `query` as a string — showing whether it's a topic or question is additive and can be done later.
