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
- surfaced ratings, consolidation / context state saved / restored, and make available the compacted summaries of whatever else is saved as part of any of that.  
- 


# Research

- There are also queries made about a topic, not directly as a question.  We should probably aim for those kind of queries to have 'follow-up questions' that are presented at least as topics themselves.  e.g. "topic A -> topic B" instead of "topic A -> long text of a question about topic B
- it may make sense to build the graph not from questions themselves, but topics or tags.  Eventually, we'll be trying to connect things across sessions, and that likely won't be done by question.  It would probably solve the problem with the current map where it becomes basicaly unusable after even one layer of follow-ups.    



# Thread / live view events log.
- there's an 'export' button to export data about the query / threads in at the top, in md and json.  Rather than reconstruct this on-demand when that gets clicked, build up a log file of that information over time, so that when clicking on it, only a minimum amount of work (summarization, updating the document etc.) has to be done.  You might even be able to use this as the source for events data on the page.
- fix the container / sizing of this section, it has a slight scroll but shouldn't ever.  It shouldn't have a second set of margins or look like it's wrapped in an extra container.
- The top-row A-G display of thread names doesn't work functionally, it gets cut off way too easily.  suggest alternatives.
- fix alignment of borders and fonts across the "Threads / Findings / Event Log" top row, they are uneven vertically C:\Users\crsmi\OneDrive\Desktop\2026-04-13 19_34_04-Phone Link.png
- timestamps get cut off every time, need a compact representation or a different approach.
- data displayed is incomplete.  for example, many events just say "web_search" for type and "web_search" for detail. What URL was being searched for, what model is searching for it?  Similar issues:  "summarize thread" -> what thread?  synthesize finding -> what source / thread?  gao analysis -> what was the gap found to be, etc.?   Many steps just say 'step' as a type and have '...' as detail, this shouldn't be that ambiguous.   
/search for interesting ways of doing a page like the Threads / Live view in a research session.  It needs to be totally rethought and I'd like to see an original design that's functional and not too based on the current version as well as stands out from other approaches.  Give me a bunch of mockups, at least 5, of creative variations on that page. 
- why does it say '500 events' here when only a tiny % are visible?
