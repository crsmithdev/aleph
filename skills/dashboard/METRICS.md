# Starting metric sets

Each set is a start, not a checklist. Keep the metrics that answer the page's decision (SKILL.md, step 1), and check each with step 2. A page about two situations takes from two sets.

## A service (requests in, responses out)

**RED**, per route or per service, in the order of the request flow:

| Metric | Definition | Kind |
|---|---|---|
| Rate | requests per second | flow |
| Errors | failed requests / all requests | rate |
| Duration | latency at p50, p95 and p99; never the mean alone | distribution |

These are symptoms: alert on them. Google's four golden signals add **saturation** (how full the service is) to the same three. With an SLO, add the **error budget left** and its **burn rate**, so the reader sees the trend to the limit, not only the limit.

## A resource (CPU, memory, disk, a queue, a pool)

**USE**, per resource:

| Metric | Definition | Kind |
|---|---|---|
| Utilization | share of time or capacity in use | level |
| Saturation | work waiting: queue length, wait time | level |
| Errors | error events of the resource | flow |

These are causes. Put them one level below the service symptoms.

## A delivery pipeline or a team

**DORA**, for the pipeline from commit to production:

| Metric | Counter to |
|---|---|
| Deploy frequency | change failure rate |
| Lead time for changes, commit to production | change failure rate |
| Change failure rate | deploy frequency |
| Time to restore service | |

**Flow**, for a board of work items:

| Metric | Definition |
|---|---|
| Work in progress | items started and not finished, as a level |
| Throughput | items finished per week, as a flow |
| Cycle time | start to finish, per item, at p50 and p85 |
| Item age | age of each item in progress; the oldest first |

Item age is leading: an old item is stuck before cycle time shows it. Do not compare people by these numbers. They measure the system.

## An agent or LLM system

| Metric | Definition | Counter to |
|---|---|---|
| Landed changes | changes merged, per day | first-pass rate |
| First-pass rate | changes landed with no rerun / landed changes | landed changes |
| Cost per landed change | spend / landed changes, not spend / runs | first-pass rate |
| Time to land | issue picked up to merged, p50 and p85 | failure rate |
| Failure rate | runs that end failed or dropped / all runs | time to land |
| Human interventions | asks, denials and manual fixes per landed change | |
| Stuck work | runs with no progress past a threshold; the oldest first | |

Spend per run is a trap: a cheap run that fails and reruns costs more per change. Divide by the outcome, not by the attempt.

## A product

- **North Star**: one metric that counts the value users get (for example, weekly active teams that finish a task), with 3 to 5 **input metrics** that the team can move and that drive it.
- **Funnel** (AARRR: acquisition, activation, retention, revenue, referral): each step as a conversion rate from the step before. Activation and retention lead revenue.
- **Retention**: by cohort of start week, as a curve. A flat total hides a cohort that drops.
- **HEART** for one feature's experience: happiness, engagement, adoption, retention, task success. For each, write the goal, then the signal, then the metric.

Count active users with a stated action and window ("ran one job in 7 days"), not with a login.

## A business

| Metric | Definition | Counter to |
|---|---|---|
| Recurring revenue (MRR, ARR) | sum of active subscriptions at month end, as a level | net revenue retention |
| Net revenue retention | revenue this month from last year's customers / their revenue then | new revenue |
| Churn | customers or revenue lost in the period / at its start | |
| CAC payback | acquisition cost / monthly gross margin per new customer, in months | |
| Gross margin | (revenue - cost of service) / revenue | |

Use the finance team's formula and name its source. A business metric that differs from finance's number is a bug on the page, not a second view.
