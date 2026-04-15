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


# Observability Sessions
- In the trace view (e.g.  http://localhost:3001/observability/sessions/e64caa15-47a5-4504-a774-766cd8cc0067), the first message shown differs from what's shown on the list.  On the list 'request interrupted by user' is shown as the starting message, here it's not, it's a message that was interrupted and then replaced with a slight variation.  Rather than just fix this, go through transcripts and compare them to data served to his page, make sure we are displaying all of them, getting the turn #s right, showing messages that are actual user input as user input, and same for the agent, but also surfacing clearly the other things that happen.  Only attribute things to a user or agent as a message if they said it, if it  was part of the conversation otherwise, don't hide it, display it and make it clear it's not conversational text.
- Similar to the above, hook output shows as a user message.  Consider a different way to display that, without dropping it entirely.

- error list tab
 are we using the 'topic coherenced' / jaccard similarity measures that we have an input for on the settings page?