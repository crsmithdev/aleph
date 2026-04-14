# Observability

- handling of subagents in sessions
- learning / feedback loop
- [~] easy eval system ~
- hook metrics
- tests audit / rebuild
- docs audit / rebuild / optimization / codebase skill
- agents / subagents page?
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

# Research 

- make 'queries' a page of its own under 'Research' (/research/queries), it should show what's currently on the /research.  /research should now point to a dashboard similar to the /observability and be purely stats / charts / data.
- On /research/queries, fix the difference in sizing between 'run all' and '+ new query', change 'run all' to 'resume all', 'stop all' to 'pause all'.  


# Thread / live view
- Do a /design-standards /design-type pass over this page, make sure fonts are correct in both size and kind relative to the rest of the ui pages.
- Clicking on a thread should show something; can we expand rows to show more detail?
- similarly, clicking on finding shows nothing, there are details we should be able to expand to show
- Fix alignment of the green dot in the header for "Threads" 
- add a compact display of workers and their state somewhere on that page.

# Thread / live view events log.
- Write a log as you go
- fix the container / sizing of this section, it has a slight scroll but shouldn't ever.  It shouldn't have a second set of margins or look like it's wrapped in an extra container.
- The top-row A-G display of thread names doesn't work functionally, it gets cut off way too easily.  suggest alternatives.
- fix alignment of borders and fonts across the "Threads / Findings / Event Log" top row, they are uneven vertically C:\Users\crsmi\OneDrive\Desktop\2026-04-13 19_34_04-Phone Link.png
- timestamps get cut off every time, need a compact representation or a different approach.
- data displayed is incomplete.  for example, many events just say "web_search" for type and "web_search" for detail. What URL was being searched for, what model is searching for it?  Similar issues:  "summarize thread" -> what thread?  synthesize finding -> what source / thread?  gao analysis -> what was the gap found to be, etc.?   Many steps just say 'step' as a type and have '...' as detail, this shouldn't be that ambiguous.   
/search for interesting ways of doing a page like the Threads / Live view in a research session.  It needs to be totally rethought and I'd like to see an original design that's functional and not too based on the current version as well as stands out from other approaches.  Give me a bunch of mockups, at least 5, of creative variations on that page. 
- why does it say '500 events' here when only a tiny % are visible?


1 - agreed.  this should be configurable and surfaced in the ui.  
2 - ultimately we want this thing to be able to make unusual leaps, and it's OK if some don't really work out and are thrown away.  Are we just doing distance vs. the original question, or can we detect a situation where the similarity drops significantly going from seed -> perturbed follow-up -> follow-up -> follow-up?  I don't want to lose the potential for wild tangents, but I do want to keep them from taking over.
3 - agreed
4 - agreed

Before implementing, look at the ui controls in the main research page revealed by clicking 'new query', and any other places where settings can be adjusted; make sure that all the controls we have or would add to the backend are surfaced, and it's clear what they are, add tooltips if needed. 