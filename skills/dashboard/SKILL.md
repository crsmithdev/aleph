---
name: dashboard
description: >
  Dashboard: decide what a dashboard is for, which metrics it shows, what
  each is compared to and how the page is ordered, before anything is drawn.
  Use when designing a dashboard or a status or metrics page, choosing metrics
  or KPIs for a situation, or reviewing a dashboard that nobody uses or acts on.
---

# Dashboard

A dashboard is good when its reader sees the **decision** they came for in a few seconds and knows what to do next. Every metric on it serves a named decision. This skill decides what the page shows and in what order. The repo's design language decides how it looks (step 5).

Do the steps in order. Write the result of each step into the page's spec or the conversation before the next step.

## 1. Name the reader, the decision and the kind

Write one line each:

- **Reader**: who opens the page, and how often.
- **Decision**: the question they answer from it, as a sentence they would say: "Is anything stuck that needs me?", "Did the change make agents cheaper?". One page holds one or two decisions. If readers with different decisions share a page, make two pages.
- **Kind**: one of three, from the decision.

| Kind | Answers | Data age | Shape |
|---|---|---|---|
| Status | Is anything wrong now, and where? | seconds to minutes | few large numbers, each against a threshold; problems first |
| Analysis | Why did it change? Which segment? | hours to days | 8 to 20 panels in sections, filters, drill-down |
| Review | Are we on course for the goal? | days to a quarter | 3 to 7 trends against a target |

Test for status: if the refresh went from 5 minutes to an hour, would a decision change? If not, the page is not a status page. Do not mix a status page and an analysis page. The reader of one is in the wrong frame of mind for the other.

Done when the reader, each decision and the kind are written down.

## 2. Pick the metrics

Start from the framework for the situation in [METRICS.md](METRICS.md). It lists starting sets for a service, a resource, a delivery pipeline, an agent system, a product and a business. Take the metrics that answer the decision, and drop the rest.

Check each metric you keep:

- **Action**: name what the reader does when it goes up, and when it goes down. If nothing, drop it. A metric with no action is a vanity metric.
- **Definition**: write the formula, its source and its unit. A rate gives its denominator ("failed jobs / finished jobs", not "failed jobs"). Two pages that show the same name show the same formula.
- **Flow or level**: a flow (cost, jobs landed) adds up over time, so its total is a sum. A level (agents live, queue depth) is a state at an instant, so its total is a peak or the latest value.
- **Leading or lagging**, relative to the decision: a leading metric moves before the outcome, so the reader can still act. A review page with only lagging metrics shows the result too late to change it.
- **Symptom or cause**: a symptom is what the user feels (errors, latency). A cause is inside the system (CPU, a full queue). Alert and lead with symptoms. Put causes one level down, where the reader goes to find out why.
- **Counter-metric**: a target metric gets a counter-metric that shows what it costs, on the same page, at the same level: speed with failure rate, cost with first-pass rate, throughput with the age of the oldest item. A counter-metric is a guardrail: it does not need to improve, it must not get worse.

At most 7 metrics go in the headline. Put the rest one level down or drop them.

Done when each kept metric has its action, definition, flow or level, and counter-metric written, and each dropped one has a reason.

## 3. Give each number its comparison

A number alone does not tell the reader whether to act. Give each headline metric one comparison:

- **Target or threshold**: for a status page, the line where the reader must act. Use a threshold for a guardrail, and a target for a goal.
- **Earlier window**: the same window before (this week against last week). Compare like with like: a Monday with a Monday, a full day with a full day.
- **Peers**: one segment against the others (this agent role against all roles).

State the window on the page.

Done when each headline metric names its comparison and its window.

## 4. Order the page

- **Top**: the headline metrics, problems first. A status page leads with what needs action; a page with nothing wrong says so in one line.
- **Middle**: the breakdowns that answer "where": by segment, by stage, by role. Order sections by the flow of the work, upstream first.
- **Bottom or one click away**: the rows behind each number. Each headline number links to the rows that make it.

Group panels that answer the same question. Put the counter-metric next to its metric, not in another section. Set the refresh to the data age of the kind (step 1). A faster refresh adds load and no information.

Done when each panel sits in a section that names its question, and each headline links to its rows.

## 5. Hand off the look

The repo's design language owns how each metric looks: `docs/design.md` in aleph, through its Use and Not for lines. If the repo has none, use the `dataviz` skill. If a metric needs a form the design language does not have, add it to the design language, not to this page.

Done when each panel names the design-language component that builds it.

## 6. Review

Read the page as the reader from step 1, with a real data set:

1. Find the answer to each decision. Count the seconds and the clicks. A status page answers in under 10 seconds with no click.
2. For each panel, say what you would do if it moved. Remove a panel with no answer.
3. Look for a target metric with no counter-metric beside it.
4. After the page ships, check which panels people open, if the tool records it. Remove a panel nobody opens, after asking its owner.

Done when each decision has an answer path, and each panel has its action or is gone.
