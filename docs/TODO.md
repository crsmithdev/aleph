With all of these, think about how the telemetry system could help a) log data useful for you in optimizing and deubgging the system, and / or b) surface more and more interesting data in the ui that we don't have / can't get today.

Do each individually, then pause.  Think, show a plan, answer questions, update if needed, proceed with approval, /verify-completion.  also code-reviewer agent, /git-workflow

- Token optmization: adopt this.  
- Parallel agents: compare their handoff pattern with ours; don't care about the tmux parts
- Eval-Driven Development:  adopt this.  How is this used in their codebase, i.e. what do they optimize / fix with this and how?
- Pre-Compacting Capture - adopt.  How long does it take / would it take to save all that, and what guarantees are there that this will fire before the session ends (somehow).  some kind of continuous saving processs perhaps?  how does the hook do all that, specifically?
- Repo-aware auto-installation:  pass, though curious what the benefits of being 'adaptive per repo' are
- 6-phase gate: adopt.  what is part our process that isn't in theirs?
- Agent debug loop: adopt
- PostToolUse hooks: adopt
- Plugin manifest: what is that format, how is it used?
- Hook Chain: adopt


# Observability

- go through every individual table in every observability page, make sure the font sizes are uniform across the table. Opt to bump smaller ones up rather than reduce bigger ones.  Ensure alignment at baseline for each is the same
- in those tables, if there's a column like 'conversation' in the session list that contains a lot of text, potentially, make sure it gets the majority of the width available for columns.  Size the rest of the columns at about 2x what they strictly need, all values in those all columns, and all column headers, should display on a single line.
- in cases where there's a donut and line / bar chart on the same line, give the donut chart panel about 1/5 of the total width, the remaining going to the other chart.  Go through every chart on every page in observability and check.
  - Make the 'Construct' text on the sidebar an appropriate size and weight compared to headers at the top of individual pages, it is the top-level item in the page, effectively
 
# Observability -> Tools Session
- change the 'Daily Sessions' chart title to be 'Sessions & Messages'till
# Observability -> Tools Session Trace


# Observability -> Tools Scripts
- change executions-by-script to a stacked bar / area line chart
- change 'hook' → 'script' in the table; give that column more room so script filenames fit on one line

# Observability -> Tools
- separate the two charts into different panels
- suggest a different dimension for the donut chart

ess
- make full-text fetching optional and disabled by default; always fetch and save LLM-generated summaries
- add ui support in settings and in the live view for toggling full-text fetch question-wide or per-thread respectively, allow completed threads to be toggled back on as well, which should queue them up again to do ONLY a fetch of the full text of things they already suceeded at getting summaries for.
- Also allow 'redoing' a thread entirely, which does all the searches, fetches, etc. again and creates (possibly) new follow-up questions
- Increase the font size in the live view threads events, it should be the same as the font size of the questions.
- In the thread view, instead of badges, just list fetched / queried / summarized pages as events, in a list grouped under the web_search.  Ensure any errors are visible in detail when hovered over.
- If full-text is fetched, make that a separate event each time it happens
- only show the first line at most of the question text as a header, the full text can be below.  Elide it appropriately
- When taking in questions, fix any obvious spelling errors, clean up formatting, and ensure that the first word of a question is capitalized.


Executions by script needs to be a toggle-able area / stacked bar chart like otther in observability, check the Sessions page.  default 'installed only' to on, give
  it a # in parantheses next to it, similar to other filterasngchjs.bnasugge