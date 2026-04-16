# Observability

- representation of subagents in sessions
- agents / subagents page?
- design standards / rules / examples
- minor session fixes / search
- adjust hook logging to separate out error in the hook vs caught and return nonzero
- fix mismatch between many list  / detail page headers
- 

- add more detail to errors as they are reported.  At least to disambiguate blocking hooks that return nonzero -- it is expected if they exit(2), it's actually an ERROR if they crash for another reason.
- Highlight scripts that are part of a group of scripts, e.g. I want to know which ones are related.
- I want to know more about logically how the hooks are working, e.g. we know if they failed or not, and the timing, but I'd like to see the patterns that were caught, if they failed a few times and Claude had some issues following them, etc.
- surfaced ratings, consolidation / context state saved / restored, and make available the compacted summaries of whatever else is saved as part of any of that.  - 

# Research

- There are also queries made about a topic, not directly as a question.  We should probably aim for those kind of queries to have 'follow-up questions' that are presented at least as topics themselves.  e.g. "topic A -> topic B" instead of "topic A -> long text of a question about topic B
- it may make sense to build the graph not from questions themselves, but topics or tags.  Eventually, we'll be trying to connect things across sessions, and that likely won't be done by question.  It would probably solve the problem with the current map where it becomes basicaly unusable after even one layer of follow-ups.    


# Observability Sessions'
- In the trace view (e.g.  http://localhost:3001/observability/sessions/e64caa15-47a5-4504-a774-766cd8cc0067), the first message shown differs from what's shown on the list that linked to that page (http://localhost:3001/observability/sessions).  On the list 'unknown task' is shown as the starting message, b8ut in the trace, the first message is "in the research ui, in the live view tab of a query:", that seems wrong.
- also, hook output is being attributed to the user, e.g.  in http://localhost:3001/observability/sessions/ea0f37f5-8653-4a1f-b884-0a714f8931df, it has me saying "Stop hook feedback: Git hygiene: 1 uncommitted file in working tree — commit before ending."  I want to keep that available but perhaps surfaced in a different way.
- Pick 5 sessions, find the source transcripts for them, and other telemetry data if needed, and verif we are at least dropping user / agent messages and that the total messages / turn #s match.
- Similar to the above, hook output shows as a user message.  Consider a different way to display that, without dropping it entirely.

# Research 

Update how queries are displayed on all research pages and in all tables:
- when a question is input, store with it:
- the original input text
- a short version, a brief single sentence
- a super short version, maybe 3-5 words
- all outer quotes removed and some formatting stripped / cleaned up (e.g. it probably shouldn't be one word connected with underscores, remove them)
- font color

This should only happen at that time and in that place in the code, and is usable wherever after that; remove any existing ad-hoc handling of this.

When displayed, these question texts should never be wrapped in quotes, and things like underscores, etc. should be gone.
Look at every occurrence you find, and decide which to show.  For example, the short version is probably fine for the live view, but the map view it should be super-short.  In most tables, short is probably fine, in tables with many columns and little space, the super short is better.  Suggest / choose based on available space and context.

In the research events log:

- why are some event types displayed in gray?
- I still see occasional "formulate queries", what is writing / serving that?
- I still see 'formulate queries', not 'formulate', displayed as an event type periodically
- Make better use of the right side / more space on an ultrawide monitor.  move the model and cost into to the right side of the row (parts like "deepseek-chat-v3 469 $0.00001"), and move any numbers  / type-specific data in front of any question text, coloring appropriately.  