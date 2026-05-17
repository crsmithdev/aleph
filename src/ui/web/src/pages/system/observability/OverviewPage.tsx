import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AreaChart, Area, BarChart, Bar, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useObsOverview, useObsSessions, useObsTokens, useObsCost, useObsHooks, useObsTools } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { ChartControlChip } from '../../../components/data/ChartControlChip';
import { PageHeader } from '../../../components/layout/PageHeader';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, CHART_OTHER, chartColor, labelFormatter, legendProps, xAxisDateProps } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtCurrency, fmtPct, fmtLegendLabel, formatModelName } from '../../../utils/format';
import { GRAN_LABEL, RANGE_PHRASE } from '../../../utils/chart-helpers';

export function OverviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const range = (searchParams.get('range') as TimeRange) ?? '30d';
  const granularity = (searchParams.get('granularity') as Granularity) ?? 'day';
  function setRange(r: TimeRange) { setSearchParams(p => { const n = new URLSearchParams(p); n.set('range', r); return n; }, { replace: true }); }
  function setGranularity(g: Granularity) { setSearchParams(p => { const n = new URLSearchParams(p); n.set('granularity', g); return n; }, { replace: true }); }
  const { data, isLoading, error, refetch } = useObsOverview(range, granularity);
  const sessions = useObsSessions(range, granularity);
  const tokens = useObsTokens(range, granularity);
  const cost = useObsCost(range, granularity);
  const hooks = useObsHooks(range, granularity);
  const tools = useObsTools(range, granularity);
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');
  const [tokensChartType, setTokensChartType] = useState<'bar' | 'line'>('line');
  const [costChartType, setCostChartType] = useState<'bar' | 'line'>('line');

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load overview" retry={refetch} />;

  const toolSuccessPct = data.toolCalls > 0
    ? ((data.toolCalls - data.toolErrors) / data.toolCalls) * 100
    : 100;

  const chartChip = (
    <ChartControlChip
      range={range}
      onRangeChange={setRange}
      granularity={granularity}
      onGranularityChange={setGranularity}
    />
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Observability" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5 !mt-0">
        <StatCard label="Sessions" value={fmtNumber(data.sessions)} />
        <StatCard label="Messages" value={fmtNumber(data.messages)} />
        <StatCard label="Tool Calls" value={fmtNumber(data.toolCalls)} />
        <StatCard
          label="Tool Success"
          value={fmtPct(toolSuccessPct)}
          accent={toolSuccessPct >= 99 ? 'success' : toolSuccessPct >= 95 ? 'warning' : 'error'}
          detail={`${fmtNumber(data.toolErrors)} errors`}
        />
        <StatCard label="Total Cost" value={fmtCurrency(data.totalCost)} accent="success" />
      </div>

      {sessions.data && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Lines Changed" value={<><span className="text-success">+{fmtNumber(sessions.data.totalLinesAdded)}</span><span className="text-text-muted">/</span><span className="text-error">-{fmtNumber(sessions.data.totalLinesRemoved)}</span></>} />
          <StatCard label="Commits" value={fmtNumber(sessions.data.totalCommits)} />
          {tokens.data && (
            <StatCard
              label="Cache Efficiency"
              value={fmtPct(tokens.data.cacheEfficiency)}
              accent={tokens.data.cacheEfficiency >= 80 ? 'success' : tokens.data.cacheEfficiency >= 50 ? 'warning' : 'error'}
              detailContent={<><span className="text-success font-medium">{fmtNumber(tokens.data.totalCacheRead)}</span><span className="text-text-muted"> read / </span><span className="text-warning font-medium">{fmtNumber(tokens.data.totalCacheCreation)}</span><span className="text-text-muted"> created</span></>}
            />
          )}
          {tokens.data && (
            <StatCard
              label="Total Tokens"
              value={fmtNumber(tokens.data.totalInput + tokens.data.totalOutput)}
              detailContent={<><span className="text-text-secondary font-medium">{fmtNumber(tokens.data.totalInput)}</span><span className="text-text-muted"> in / </span><span className="text-text-secondary font-medium">{fmtNumber(tokens.data.totalOutput)}</span><span className="text-text-muted"> out</span></>}
            />
          )}
        </div>
      )}

      <ChartContainer
        title="Activity"
        crumb={`${GRAN_LABEL[granularity]} · ${RANGE_PHRASE[range]} · ${fmtNumber(data.messages)} messages · ${fmtNumber(data.sessions)} sessions`}
        chip={chartChip}
        chartType={chartType}
        onChartTypeChange={setChartType}
      >
        {chartType === 'bar' ? (
          <BarChart data={data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...xAxisDateProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
            <Bar isAnimationActive={false} dataKey="messages" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Messages" />
            <Bar isAnimationActive={false} dataKey="sessions" fill={CHART_PALETTE[1]} radius={[2, 2, 0, 0]} name="Sessions" />
          </BarChart>
        ) : (
          <AreaChart data={data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...xAxisDateProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
            <Area isAnimationActive={false} type="monotone" dataKey="messages" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.15} name="Messages" />
            <Area isAnimationActive={false} type="monotone" dataKey="sessions" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.15} name="Sessions" />
          </AreaChart>
        )}
      </ChartContainer>

      {tokens.data && (
        <ChartContainer
          title="Tokens"
          crumb={`${GRAN_LABEL[granularity]} · ${RANGE_PHRASE[range]} · ${fmtNumber(tokens.data.totalInput + tokens.data.totalOutput)} tokens`}
          chartType={tokensChartType}
          onChartTypeChange={setTokensChartType}
        >
          {tokensChartType === 'bar' ? (
            <BarChart data={tokens.data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...xAxisDateProps} />
              <YAxis {...axisProps} tickFormatter={fmtNumber} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
              <Legend {...legendProps} />
              <Bar isAnimationActive={false} dataKey="input" stackId="tokens" fill={CHART_PALETTE[0]} name="Input" />
              <Bar isAnimationActive={false} dataKey="output" stackId="tokens" fill={CHART_PALETTE[1]} name="Output" />
              <Bar isAnimationActive={false} dataKey="cacheRead" stackId="tokens" fill={CHART_PALETTE[2]} name="Cache Read" />
            </BarChart>
          ) : (
            <AreaChart data={tokens.data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...xAxisDateProps} />
              <YAxis {...axisProps} tickFormatter={fmtNumber} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
              <Legend {...legendProps} />
              <Area isAnimationActive={false} type="monotone" dataKey="input" stackId="tokens" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.3} name="Input" />
              <Area isAnimationActive={false} type="monotone" dataKey="output" stackId="tokens" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.3} name="Output" />
              <Area isAnimationActive={false} type="monotone" dataKey="cacheRead" stackId="tokens" stroke={CHART_PALETTE[2]} fill={CHART_PALETTE[2]} fillOpacity={0.3} name="Cache Read" />
            </AreaChart>
          )}
        </ChartContainer>
      )}

      {cost.data && (
        <ChartContainer
          title="Cost"
          crumb={`${GRAN_LABEL[granularity]} · ${RANGE_PHRASE[range]} · ${fmtCurrency(cost.data.totalUsd)} total`}
          chartType={costChartType}
          onChartTypeChange={setCostChartType}
        >
          {costChartType === 'bar' ? (
            <BarChart data={cost.data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...xAxisDateProps} />
              <YAxis {...axisProps} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(value) => [fmtCurrency(Number(value ?? 0)), 'Cost']} />
              <Bar isAnimationActive={false} dataKey="usd" fill={CHART_PALETTE[3]} radius={[2, 2, 0, 0]} name="Cost" />
            </BarChart>
          ) : (
            <AreaChart data={cost.data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...xAxisDateProps} />
              <YAxis {...axisProps} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(value) => [fmtCurrency(Number(value ?? 0)), 'Cost']} />
              <Area isAnimationActive={false} type="monotone" dataKey="usd" stroke={CHART_PALETTE[3]} fill={CHART_PALETTE[3]} fillOpacity={0.3} name="Cost" />
            </AreaChart>
          )}
        </ChartContainer>
      )}

      {cost.data && cost.data.byModel.length > 0 && (() => {
        const top5 = cost.data.byModel.slice(0, 5);
        const otherUsd = cost.data.byModel.slice(5).reduce((s, r) => s + r.usd, 0);
        const donut = otherUsd > 0 ? [...top5, { model: 'Other', usd: otherUsd, pct: 0 }] : top5;
        return (
          <ChartContainer
            title="Cost by Model"
            crumb={`${RANGE_PHRASE[range]} · ${cost.data.byModel.length} models`}
            raw
          >
            <div className="flex gap-3 h-[180px]">
              <div className="flex-1 min-w-0 flex items-center">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie isAnimationActive={false} data={donut} dataKey="usd" nameKey="model" cx="50%" cy="50%" innerRadius="38%" outerRadius="90%">
                      {donut.map((entry, i) => <Cell key={i} fill={entry.model === 'Other' ? CHART_OTHER : CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtCurrency(Number(v)), formatModelName(String(n))]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1.5 justify-center shrink-0 w-36">
                {donut.map((row, i) => (
                  <div key={row.model} className="flex items-center gap-1.5 text-xs min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: row.model === 'Other' ? CHART_OTHER : CHART_PALETTE[i % CHART_PALETTE.length] }} />
                    <span className="font-mono text-text-secondary truncate flex-1">{formatModelName(row.model)}</span>
                    <span className="text-text-muted font-mono shrink-0 w-10 text-right">{fmtCurrency(row.usd)}</span>
                  </div>
                ))}
              </div>
            </div>
          </ChartContainer>
        );
      })()}

      {/* Cross-page charts */}
      {sessions.data && sessions.data.sessions.some(s => (s.linesAdded + s.linesRemoved) > 0 && s.cost > 0) && (() => {
        const scatterData = sessions.data!.sessions
          .filter(s => s.cost > 0 || (s.linesAdded + s.linesRemoved) > 0)
          .map(s => ({ churn: s.linesAdded + s.linesRemoved, cost: s.cost, name: s.sessionId.slice(0, 8) }));
        return (
          <ChartContainer
            title="Cost vs Code Output"
            crumb={`${RANGE_PHRASE[range]} · ${scatterData.length} sessions`}
            height={200}
          >
              <ScatterChart>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="churn" type="number" {...axisProps} name="Lines Changed" tickFormatter={(v) => fmtNumber(Number(v))} label={{ value: 'Lines Changed', position: 'insideBottom', offset: -4, style: { fontSize: 10, fill: 'var(--color-text-muted)' } }} />
                <YAxis dataKey="cost" type="number" {...axisProps} name="Cost" tickFormatter={(v) => `$${Number(v).toFixed(3)}`} />
                <ZAxis range={[30, 30]} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => name === 'cost' ? [`$${Number(v).toFixed(4)}`, 'Cost'] : [fmtNumber(Number(v)), 'Lines Changed']} />
                <Scatter data={scatterData} fill={CHART_PALETTE[0]} fillOpacity={0.7} />
              </ScatterChart>
          </ChartContainer>
        );
      })()}

      {hooks.data && hooks.data.ranked.filter(r => r.count > 0).length > 0 && (() => {
        const topHooks = [...hooks.data!.ranked].filter(r => r.count > 0).sort((a, b) => b.p50Ms - a.p50Ms).slice(0, 10);
        return (
          <ChartContainer
            title="Hook Latency (p50)"
            crumb={`${RANGE_PHRASE[range]} · top ${topHooks.length} hooks`}
            height={Math.max(160, topHooks.length * 24)}
          >
              <BarChart layout="vertical" data={topHooks}>
                <CartesianGrid {...gridProps} horizontal={false} />
                <XAxis type="number" {...axisProps} tickFormatter={(v) => `${v}ms`} />
                <YAxis type="category" dataKey="command" {...axisProps} width={140} tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}ms`, 'p50 Latency']} />
                <Bar isAnimationActive={false} dataKey="p50Ms" fill={CHART_PALETTE[1]} name="p50 Latency" radius={[0, 2, 2, 0]} />
              </BarChart>
          </ChartContainer>
        );
      })()}

      {tools.data && tools.data.skillToolMatrix && tools.data.skillToolMatrix.length > 0 && (() => {
        const matrix = tools.data!.skillToolMatrix;
        const topSkills = [...matrix].sort((a, b) => b.tools.reduce((s, t) => s + t.count, 0) - a.tools.reduce((s, t) => s + t.count, 0)).slice(0, 10);
        const allTools = Array.from(new Set(topSkills.flatMap(s => s.tools.map(t => t.tool)))).slice(0, 8);
        const barData = topSkills.map(({ skill, tools: toolCounts }) => {
          const row: Record<string, unknown> = { skill: skill.length > 20 ? skill.slice(0, 18) + '…' : skill };
          for (const tool of allTools) row[tool] = toolCounts.find(t => t.tool === tool)?.count ?? 0;
          return row;
        });
        return (
          <ChartContainer
            title="Skill → Tool Usage"
            crumb={`${RANGE_PHRASE[range]} · top ${topSkills.length} skills × ${allTools.length} tools`}
            height={Math.max(160, topSkills.length * 28)}
          >
              <BarChart layout="vertical" data={barData}>
                <CartesianGrid {...gridProps} horizontal={false} />
                <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtNumber(Number(v))} />
                <YAxis type="category" dataKey="skill" {...axisProps} width={120} tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                {allTools.map((tool, i) => (
                  <Bar isAnimationActive={false} key={tool} dataKey={tool} name={fmtLegendLabel(tool)} stackId="a" fill={chartColor(tool, i)} radius={i === allTools.length - 1 ? [0, 2, 2, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
          </ChartContainer>
        );
      })()}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
