# Observability

- handling of subagents in sessions
- learning / feedback loop
- [~] easy eval system ~
- hook metrics
- tests audit / rebuild
- docs audit / rebuild / optimization / codebase skill
- agents / subagents page?
- minor session fixes / search

# Research

- There are also queries made about a topic, not directly as a question.  We should probably aim for those kind of queries to have 'follow-up questions' that are presented at least as topics themselves.  e.g. "topic A -> topic B" instead of "topic A -> long text of a question about topic B

# Research
- create a 'companion' document to the RESEARCH spec in docs/spec1.  whereas the spec is a behaviorally-focused document, this should be technically-focused, and include in complete detail how key workflows work.  So, what does the job and worker system look like, what are the steps involved, constraints, checks, etc., and walk through the whole flow with a single job for illustration.  Spec out other key workflows as needed.

# Workers
- add a Queued Jobs table, that shows the current qeued jobs, above the job history chart.
- where workers displayh "idle -- waiting for jobs", that should be a display of either the thread / mode / job id, or should just have some simple placeholder
- can we add expansion to both the job history and queue table that shows more details about the job and its params (or its outcome)?
- Limit each table to a reasonable number of rows and add pagination.
- durations are wrong and often negative
- some jobs do not have a thread listed, what are they doing?

# Document view
- Add links to bottom-of-the-page citations
- add to each document section a display that includes the full links of sources used for a document section, the tags that were applied to it, and also highlights the questions taht were involved in producing it.  It should be collapsible and take up minimal space whewn collapsed.

# Thread / live view
- instead of a hierarchy or list for the main view, display threads in three sections:  active (a worker is working on it), finished (a worker is done working on it) and queued (hasn't been picked up yet). 
- move things from place to place in realtime as their states change, perhaps for things a user is activelyh looking at we could have a way to delay that ui action so theyh can finish reading, but also see while that's the state has changed.
- The sidebar can keep the heirarchical view and list view,  