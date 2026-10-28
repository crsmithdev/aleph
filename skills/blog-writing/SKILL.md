---
name: blog-writing
description: >
  Blog posts and essays, including posts that mix technical and non-technical
  content. Use when the user asks to write, draft, edit or review one. Runs a
  structure pass, a sentence pass and an AI-pattern pass, then aleph:humanizer.
  NOT for: docs (use /aleph:docs-writing), skills or CLAUDE.md (use
  /aleph:writing-for-agents).
---

Write or edit a blog post in four passes: structure, sentences, AI patterns, voice. Each pass looks at one level of the draft. Do them in order, because a later pass undoes damage an earlier pass can do: Strunk's "omit needless words" can flatten a voice, and `aleph:humanizer` restores it.

**The bar:** a post is something a reader would send to a friend, or cite when they make a decision. If it isn't, it needs more depth or more original material.

## 0. Name the reader

Before you write, name who the post is for: technical readers, general readers, or both. Most posts here are both. For a mixed post:

- **Define a term the first time it appears**, in one plain sentence, then use it. Do not define it twice, and do not rename it.
- **Give the concrete example before the abstraction.** Show the one case, then the rule it shows.
- **Let the general reader skip the depth.** Put code, proofs and long numbers where a reader can pass over them and still follow the argument: a code block, a footnote, an aside, a widget.
- **Don't simplify past the truth.** A general reader gets the short version; an expert must not cringe at it.

## 1. Structure pass

**The opening (first 2–3 sentences)** states the problem or states the conclusion. It never starts with background, history or hype.

- Good: "Two weeks before launch, we killed our entire metrics product. Here's why pre-aggregating time-series metrics breaks down for debugging, and how we rebuilt the system from scratch."
- Bad: "We're always looking for ways to improve the developer experience. Today, we're thrilled to share some exciting updates that we think you'll love."

**Follow the reader's questions**, not the writer's chronology:

1. What problem does this solve, or what question does it answer? (1–2 paragraphs)
2. How does it actually work? (the bulk; be specific)
3. What were the trade-offs or alternatives?
4. What can the reader do with it?

For a deep dive, also: what did not work, and what are the known limits.

**Headings convey information.**
- Weak: "Background", "Architecture", "Results", "Conclusion"
- Strong: "Why pre-aggregation destroys debugging context", "Where this breaks down: the cardinality wall"

**Paragraphs.** One idea per paragraph. Break at a contrast point: when a sentence turns on "but", "however" or a new view, start a new paragraph. One-sentence paragraphs are fine for emphasis.

**Numbers over adjectives.** A claim of size or speed carries the number.
- Bad: "This significantly reduced our processing time."
- Good: "This reduced p99 processing time from 340 ms to 45 ms."

**Honesty over hype.** Don't overstate what something does. Say what is unfinished. If someone else does it well, say so.

**Code must work.** Test it. Include imports and context. Comments explain why, not what.

**A system with more than two parts gets a diagram**, labelled with real names, not generic boxes.

**The title** makes a specific claim, tells a story or promises a payoff.
- Strong: "The metrics product we built worked. But we killed it and started over anyway"; "Your JavaScript bundle has 47% dead code. Here's how to find it."
- Weak: "Introducing our new metrics product"; "Performance improvements"

**The closing** gives the reader something useful: a link, the source, a next step, or a return to the opening story. Never a recap, generic hype ("can't wait to see what you build!") or a sales line.

## 2. Sentence pass

Apply Strunk's principles of composition:

- One paragraph per topic; begin with the topic sentence.
- Use the active voice.
- Put statements in positive form ("forgot", not "did not remember").
- Use definite, specific, concrete language.
- Omit needless words.
- Avoid a run of loose sentences.
- Express co-ordinate ideas in similar form.
- Keep related words together.
- Put the emphatic words at the end of the sentence.

For the full rules with Strunk's examples, read [`elements-of-style/03-elementary-principles-of-composition.md`](elements-of-style/03-elementary-principles-of-composition.md). For a word-choice question ("data is" or "data are", "less" or "fewer"), read [`elements-of-style/05-words-and-expressions-commonly-misused.md`](elements-of-style/05-words-and-expressions-commonly-misused.md).

## 3. AI-pattern pass

Flag and rewrite each of these.

**Banned language:**
- "We're excited/thrilled to announce": just announce it.
- "Best-in-class", "industry-leading", "cutting-edge": show it.
- "Seamless", "robust", "empower", "leverage", "unlock", "streamline": say what it actually does.
- "At [X], we believe...": state the belief.
- Filler transitions: "That being said", "It's worth noting that", "At the end of the day", "Without further ado", "As you might know".

**Stock AI words and moves:**
- Puffery: pivotal, crucial, vital, testament, enduring legacy.
- Empty "-ing" phrases: ensuring reliability, showcasing features, highlighting capabilities.
- Overused vocabulary: delve, multifaceted, foster, realm, tapestry.
- Formatting overuse: excessive bullets, emoji, bold on every other word.

**Rhythm tells:**
- Staccato fragments. Bad: "No errors. No warnings. Everything green." Good: "There were no errors, no warnings, everything looked fine."
- Bumper-sticker aphorisms. Bad: "You can't fix what you can't see." Good: "Without visibility into the full request lifecycle, you're guessing."
- Three-beat reveals. Bad: "Not a config issue. Not a code bug. The deploy was stale." Good: "It wasn't a config issue or a code bug. The deploy was stale."
- Smug simplicity. Bad: [code block] "That's it. That's all you need." Good: [code block] then say what the code does, or move on.
- Parallel ad copy. Bad: "Metrics tell you what's broken. Traces tell you why." Good: "Metrics show what's broken, but traces are where you'll actually figure out why."
- Personality only in the bookends: a personal opening, a clinical middle, a call to action at the end. The writer's voice runs through the whole post, with asides such as "this is the part that tripped me up".

When a draft still reads as machine-written and you can't say why, search [`signs-of-ai-writing.md`](signs-of-ai-writing.md) (Wikipedia's field guide, about 25,000 tokens) for the pattern instead of reading it whole.

## 4. Voice pass

Invoke `aleph:humanizer` on the draft. It finds a voice sample and rewrites the post in the writer's voice. Where humanizer's voice sample and a rule above disagree, the sample wins.

## Reviewing a draft

Run the four passes as checks, and also:

**Technical:** claims are accurate; descriptions of systems match the systems; numbers are correct.

**Editorial:** the opening holds the reader within two sentences; length fits the material, neither padded nor thin.

For each problem, quote the weak passage, say why it is weak, and rewrite it.
