# 2. A detail word has one writer and one reader

- Status: accepted
- Date: 2026-11-16

## Context

An event has six fields: `seq`, `time`, `subject`, `action`, `object` and `detail`. Four kinds of event put a word first in `detail`, a colon, and then the facts: a hold (`after: issue.2985`), a setting change (`pause: on`, `credit: on: claude: API credit error`), a housekeeper change (`retitle: New title`) and a build start (`model: haiku`). Each writer built the string by hand, and each reader split it by hand: the dispatch, the timeline, the Status page and the terminal panel each had their own regular expression or `split(":")`. A word that no reader knew drew no error. The Status page also read the model of a build from a note that began with `model `, so the page parsed text that the factory wrote.

## Decision

The word is part of the detail, and `lib/naming.ts` is its only writer and reader.

- `detailOf(action, word, facts)` writes `<word>: <facts>`, or the bare word with no facts. It checks the word against the set of the action, as `event()` checks the action, and throws on a word outside it. `wordOf(e)` and `factsOf(e)` read it.
- Each writer of a hold, a setting change, a housekeeper change and a build start goes through `detailOf`. Each reader that took the word or the facts goes through `wordOf` or `factsOf`.
- No `word` column is added. The helpers hide the storage, so a later column changes only them.

## Consequences

- A new word needs one line in `WORDS` in `lib/naming.ts`. A writer with a word nobody listed fails in its first test.
- A column is the next step only when a SQL query must filter on the word. Until then a reader gets the word from the detail.
- The `question` events of an Ask (`no-commit: 3 / 3 jobs with no commit`) still write their reason by hand: the reasons of `ASK_REASONS` in `jobs/lib/asks/ask.ts` include a `proposal-*` family, and a fixed set in `lib/naming.ts` cannot hold it. `askReason` reads through `wordOf`.
- A build start written before this change has the detail `model haiku`, with no colon. The Herald reads it as a note, not as the model.
- The model of a build start stays in the detail. The `event_rows` join takes its model from the object's job, and the object of a start is the issue, which has no job yet.
