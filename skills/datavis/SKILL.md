---
name: datavis
description: >
  Datavis: choose which numbers a page, chart, card or table column shows,
  how each is defined and what it is compared to, before anything is drawn.
  Use when adding a metric, chart, KPI or numeric column to any page,
  designing a dashboard, or reviewing numbers that nobody acts on.
---

# Datavis

A metric is good when its reader can **act** on it: they know what it means, whether it is good or bad, and what to do when it moves. This holds for every number in the UI: a dashboard headline, a chart on a detail page, a fact in a KPI strip, a column in a table. This skill decides which numbers to show, how each is defined, what each is compared to and where it sits. The repo's design language decides how it looks (step 6).

Do the steps in order, for the whole view you change: a page, or one panel on it. Write the result of each step into the spec or the conversation before the next step.

## 1. Name the reader and the decision

Write one line each:

- **Reader**: who looks at the view, and how often.
- **Decision**: the question they answer from it, as a sentence they would say: "Is anything stuck that needs me?", "Is this agent role worth its cost?", "Why did this job take an hour?". One view holds one or two decisions. If readers with different decisions share a view, make two views.

If the view is a whole page of metrics, also name its **kind**:

| Kind | Answers | Data age | Shape |
|---|---|---|---|
| Status | Is anything wrong now, and where? | seconds to minutes | few numbers, each against a threshold; problems first |
| Analysis | Why did it change? Which segment? | hours to days | sections of breakdowns, filters, drill-down |
| Review | Are we on course for the goal? | days to a quarter | 3 to 7 trends against a target |

Test for status: if the refresh went from 5 minutes to an hour, would a decision change? If not, the page is not a status page. Keep status and analysis on separate pages.

A detail page (one job, one issue, one session) answers "what happened to this one, and is it normal?". Its metrics are the item's own values, each next to the typical value for its kind.

Done when the reader and each decision are written down, and the kind for a page of metrics.

## 2. Pick candidates

Start from the set for the situation in [METRICS.md](METRICS.md): a service, a resource, a delivery pipeline, an agent system, a product, a business. Add the metrics the decision needs that no set lists. Take more candidates than you will keep; step 3 cuts them.

Done when each decision has at least one candidate that answers it.

## 3. Keep the good ones

Check each candidate. Drop it, or fix it, when it fails a check.

- **Action**: name what the reader does when it goes up, and when it goes down. If nothing, drop it. A number with no action is a vanity metric, however interesting.
- **Definition**: write the formula, the source and the unit. Two views that show the same name show the same formula.
- **Denominator**: divide by the outcome, not the attempt. "Cost per landed change", not "cost per run"; "failed jobs / finished jobs", not "failed jobs". A count alone grows with volume and hides the rate.
- **Flow or level**: a flow (cost, jobs landed) adds up over time, so its total is a sum. A level (agents live, queue depth) is a state at an instant, so its total is a peak or the latest value. Never sum a level.
- **Distribution**: for a duration or a size, show p50 and p95 (or p85). A mean hides the long tail, and the tail is usually the problem.
- **Sample size**: show the count next to a rate or a percentile. A rate of 3 of 4 is not a rate of 75 of 100. Below about 20 events, show the counts, not the rate.
- **Leading or lagging**, relative to the decision: a leading metric moves before the outcome, so the reader can still act. Give each lagging outcome at least one leading metric that drives it.
- **Symptom or cause**: a symptom is what the user feels (errors, latency, a stuck job). A cause is inside the system (CPU, a full queue). Lead and alert with symptoms. Put causes one level down, where the reader goes to find out why.
- **Counter-metric**: a metric that people will try to raise gets a counter-metric that shows what raising it costs, in the same view: speed with failure rate, cost with first-pass rate, throughput with the age of the oldest item. A counter-metric is a guardrail. It does not need to improve. It must not get worse.
- **Segment**: a total over different kinds of work hides which kind moved. Split by the dimension the reader can act on (role, repo, model tier, route), not by every dimension there is.

Keep at most 7 headline metrics on a page. Put the rest one level down, or drop them.

Done when each kept metric has its action, definition, flow or level, and counter-metric if it is a target, and each dropped one has a reason.

## 4. Give each number its comparison

A number alone does not tell the reader whether to act. Give each kept metric one comparison:

- **Threshold or target**: the line where the reader must act, or the goal. Use a threshold for a guardrail, and a target for a goal.
- **Earlier window**: the same window before. Compare like with like: a Monday with a Monday, a full day with a full day.
- **Peers**: one segment against the others, or one item against the typical item of its kind.

State the window in the view.

Done when each kept metric names its comparison and its window.

## 5. Place them

- **Page**: the headline metrics at the top, problems first. Then the breakdowns that answer "where", ordered by the flow of the work, upstream first. Then the rows behind each number, one click away.
- **Panel**: a counter-metric sits beside its metric, not in another section. Panels that answer one question sit in one section, named by that question.
- **Table**: a numeric column earns its place when the reader sorts or scans by it to decide. Put the column the decision turns on first among the numbers.
- **Link**: each headline number links to the rows that make it.
- **Refresh**: match the data age of the kind (step 1). A faster refresh adds load and no information.

Done when each metric has a place, and each headline links to its rows.

## 6. Hand off the look

The repo's design language owns how each metric looks: `docs/design.md` in aleph, through each component's Use and Not for lines. If the repo has none, use the `dataviz` skill. If a metric needs a form or a rule the design language does not have, add it to the design language, not to the view.

Done when each metric names the design-language component that shows it.

## 7. Review

Read the view as the reader from step 1, with real data:

1. Find the answer to each decision. Count the seconds and the clicks. A status page answers in under 10 seconds with no click.
2. For each metric, say what you would do if it moved. Remove a metric with no answer.
3. Look for a target metric with no counter-metric beside it, a rate with no count, and a mean of a duration.
4. When the view is live, check which panels people open, if the tool records it. Remove a panel nobody opens, after asking its owner.

Done when each decision has an answer path, and each metric has its action or is gone.
