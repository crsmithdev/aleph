import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  useObsEvals,
  useObsEvalScenarios,
  useObsEvalRuns,
  useObsEvalScenarioDetail,
  useRunEvalScenario,
  useCreateEvalScenario,
  type EvalResult,
  type EvalScenario,
  type EvalRun,
} from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { Modal } from '../../../components/ui/Modal';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter, xAxisDateProps } from '../../../components/charts/chartTheme';
import { relativeTime, shortRelativeTime, dateTime } from '../../../utils/format';
import { PageHeader } from '../../../components/layout/PageHeader';
import { clsx } from 'clsx';

// ─── Shared helpers ──────────────────────────────────────────────────────────

function TrendBadge({ trend }: { trend: EvalResult['trend'] }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs',
      trend === 'improving' && 'bg-green-500/10 text-green-500',
      trend === 'regressing' && 'bg-red-500/10 text-red-500',
      trend === 'stable' && 'bg-bg-tertiary text-text-muted',
    )}>
      {trend === 'improving' ? '↑' : trend === 'regressing' ? '↓' : '→'} {trend}
    </span>
  );
}

function PassRateBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full', value >= 90 ? 'bg-green-500' : value >= 70 ? 'bg-yellow-500' : 'bg-red-500')}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs font-mono text-text-secondary w-10 text-right">{label}</span>
    </div>
  );
}

function DecisionBadge({ decision }: { decision?: string }) {
  if (!decision) return <span className="text-text-disabled">—</span>;
  const colors =
    decision === 'block' ? 'bg-red-500/10 text-red-400' :
    decision === 'advisory' ? 'bg-yellow-500/10 text-yellow-400' :
    'bg-green-500/10 text-green-400';
  return (
    <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium', colors)}>
      {decision}
    </span>
  );
}

function DepthBadge({ depth }: { depth?: string }) {
  if (!depth) return null;
  return (
    <span className={clsx(
      'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono',
      depth === 'full' ? 'bg-accent/10 text-accent' : 'bg-bg-tertiary text-text-muted',
    )}>
      {depth.toUpperCase()}
    </span>
  );
}

function PassAt1Badge({ passed }: { passed: boolean }) {
  return (
    <span className={clsx(
      'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
      passed ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400',
    )}>
      {passed ? 'pass' : 'fail'}
    </span>
  );
}

// ─── Tab 1: Results ──────────────────────────────────────────────────────────

function ResultsTab() {
  const { data, isLoading, error, refetch } = useObsEvals();

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load evals data" retry={refetch} />;

  const columns: Column<EvalResult>[] = [
    {
      key: 'name',
      label: 'Eval',
      render: (row) => <span className="text-text-primary">{row.name}</span>,
    },
    {
      key: 'totalRuns',
      label: 'Runs',
      align: 'right',
      sortable: true,
      width: '70px',
      render: (row) => <span className="font-mono text-text-secondary">{row.totalRuns}</span>,
    },
    {
      key: 'passAt1Rate',
      label: 'pass@1',
      align: 'right',
      sortable: true,
      width: '130px',
      render: (row) => <PassRateBar value={row.passAt1Rate} label={`${row.passAt1Rate}%`} />,
    },
    {
      key: 'passAt3Rate',
      label: 'pass@3',
      align: 'right',
      sortable: true,
      width: '130px',
      render: (row) => <PassRateBar value={row.passAt3Rate} label={`${row.passAt3Rate}%`} />,
    },
    {
      key: 'trend',
      label: 'Trend',
      width: '120px',
      render: (row) => <TrendBadge trend={row.trend} />,
    },
    {
      key: 'lastRun',
      label: 'Last Run',
      sortable: true,
      width: '130px',
      render: (row) => <span className="font-mono text-text-muted">{relativeTime(row.lastRun)}</span>,
    },
  ];

  const hasData = data.evals.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Runs" value={String(data.totalRuns)} />
        <StatCard label="Evals Defined" value={String(data.evals.length)} />
        <StatCard
          label="Overall pass@3"
          value={`${data.overallPassAt3Rate}%`}
          accent={data.overallPassAt3Rate >= 90 ? 'success' : data.overallPassAt3Rate >= 70 ? 'warning' : 'error'}
        />
      </div>

      {hasData && data.byDay.length > 1 && (
        <ChartContainer title="Pass Rate Over Time">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data.byDay} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...xAxisDateProps} />
              <YAxis {...axisProps} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => [`${v}%`, 'Pass rate']}
                labelFormatter={labelFormatter}
              />
              <Line isAnimationActive={false} type="monotone" dataKey="passRate" stroke={CHART_PALETTE[0]} strokeWidth={2} dot={false} name="Pass %" />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
      )}

      {hasData ? (
        <DataTable<EvalResult>
          data={data.evals}
          columns={columns}
          keyField="name"
          rowKeyFn={(row) => row.name}
        />
      ) : (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <p className="text-text-secondary text-sm max-w-sm">
            No evals defined yet. Use the Scenarios tab to create your first eval, then run it.
          </p>
          <p className="text-text-muted text-xs max-w-sm">
            Results are stored in <code className="font-mono bg-bg-tertiary px-1 rounded">~/.construct/evals/results.jsonl</code>
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Scenario detail panel ───────────────────────────────────────────────────

function ScenarioDetail({ dirName, onClose }: { dirName: string; onClose: () => void }) {
  const { data, isLoading } = useObsEvalScenarioDetail(dirName);
  const runMutation = useRunEvalScenario();

  return (
    <div className="mt-3 rounded-lg border border-border-primary bg-bg-tertiary p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted uppercase tracking-wide">Detail</span>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary text-sm">✕</button>
      </div>

      {isLoading && <p className="text-text-muted text-sm">Loading…</p>}
      {data && (
        <>
          <div>
            <div className="text-xs text-text-muted mb-1">Prompt</div>
            <pre className="text-xs text-text-secondary whitespace-pre-wrap font-mono bg-bg-secondary rounded p-3 max-h-48 overflow-auto">
              {data.prompt || '—'}
            </pre>
          </div>

          {data.constraints && data.constraints.length > 0 && (
            <div>
              <div className="text-xs text-text-muted mb-1">Constraints</div>
              <ul className="space-y-1">
                {data.constraints.map((c, i) => (
                  <li key={i} className="text-xs text-text-secondary flex gap-2">
                    <span className="text-text-disabled">•</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.runs && data.runs.length > 0 && (
            <div>
              <div className="text-xs text-text-muted mb-2">Recent Runs</div>
              <div className="space-y-1.5">
                {data.runs.slice(0, 10).map((run, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs">
                    <span className="text-text-muted font-mono">{shortRelativeTime(run.ts)}</span>
                    <PassAt1Badge passed={run.passAt1} />
                    {run.expectedDecision && <DecisionBadge decision={run.expectedDecision} />}
                    {run.actualDecision && run.actualDecision !== run.expectedDecision && (
                      <>
                        <span className="text-text-disabled">→</span>
                        <DecisionBadge decision={run.actualDecision} />
                      </>
                    )}
                    <span className="text-text-muted">
                      {run.passed}/{run.passed + run.failed} passed
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => runMutation.mutate(dirName)}
            disabled={runMutation.isPending}
            className="mt-2 px-3 py-1.5 text-xs rounded bg-accent text-bg-primary font-medium hover:bg-accent/80 disabled:opacity-50 transition-colors"
          >
            {runMutation.isPending ? 'Running…' : 'Run Again'}
          </button>
          {runMutation.isSuccess && (
            <span className="ml-2 text-xs text-green-400">Queued!</span>
          )}
          {runMutation.isError && (
            <span className="ml-2 text-xs text-red-400">Failed to start run</span>
          )}
        </>
      )}
    </div>
  );
}

// ─── Scenario card ────────────────────────────────────────────────────────────

function ScenarioCard({ scenario }: { scenario: EvalScenario }) {
  const [expanded, setExpanded] = useState(false);
  const runMutation = useRunEvalScenario();

  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary hover:border-border-secondary transition-colors">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setExpanded(!expanded)}
                className="font-medium text-text-primary hover:text-accent transition-colors text-left"
              >
                {scenario.name}
              </button>
              <DepthBadge depth={scenario.depth} />
              <DecisionBadge decision={scenario.expect} />
            </div>
            {scenario.description && (
              <p className="text-xs text-text-muted mt-1">{scenario.description}</p>
            )}
            <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
              {scenario.hook && (
                <span className="font-mono bg-bg-tertiary px-1.5 py-0.5 rounded">{scenario.hook}</span>
              )}
              {scenario.event && (
                <span>{scenario.event}</span>
              )}
              <span>{scenario.trials} trial{scenario.trials !== 1 ? 's' : ''}</span>
            </div>
            {scenario.prompt && (
              <p className="text-xs text-text-disabled mt-2 font-mono truncate max-w-md">
                {scenario.prompt.slice(0, 120)}{scenario.prompt.length > 120 ? '…' : ''}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                runMutation.mutate(scenario.dirName);
              }}
              disabled={runMutation.isPending}
              className="px-3 py-1.5 text-xs rounded bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 disabled:opacity-50 transition-colors font-medium"
            >
              {runMutation.isPending ? '…' : '▶ Run'}
            </button>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-text-muted hover:text-text-primary text-sm transition-colors px-1"
            >
              {expanded ? '▲' : '▼'}
            </button>
          </div>
        </div>

        {runMutation.isSuccess && (
          <p className="text-xs text-green-400 mt-2">Run queued successfully.</p>
        )}
        {runMutation.isError && (
          <p className="text-xs text-red-400 mt-2">Failed to start run.</p>
        )}
      </div>

      {expanded && (
        <ScenarioDetail dirName={scenario.dirName} onClose={() => setExpanded(false)} />
      )}
    </div>
  );
}

// ─── Create scenario form ─────────────────────────────────────────────────────

type SuccessCriterion = { type: string; expected: string; description: string };

function CreateScenarioModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createMutation = useCreateEvalScenario();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hook, setHook] = useState('quality-stop-check-e2e');
  const [event, setEvent] = useState('Stop');
  const [expect, setExpect] = useState<'block' | 'advisory' | 'pass'>('pass');
  const [depth, setDepth] = useState<'full' | 'quick'>('quick');
  const [prompt, setPrompt] = useState('');
  const [trials, setTrials] = useState(3);
  const [constraints, setConstraints] = useState<string[]>(['']);
  const [criteria, setCriteria] = useState<SuccessCriterion[]>([{ type: 'contains', expected: '', description: '' }]);

  function reset() {
    setName(''); setDescription(''); setHook('quality-stop-check-e2e');
    setEvent('Stop'); setExpect('pass'); setDepth('quick');
    setPrompt(''); setTrials(3);
    setConstraints(['']); setCriteria([{ type: 'contains', expected: '', description: '' }]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({
      name: name.trim(),
      description: description.trim(),
      hook: hook.trim(),
      event,
      expect,
      depth,
      prompt: prompt.trim(),
      trials,
      constraints: constraints.filter(c => c.trim()),
      successCriteria: criteria.filter(c => c.expected.trim() || c.description.trim()),
    }, {
      onSuccess: () => {
        reset();
        onClose();
      },
    });
  }

  const inputCls = 'w-full rounded border border-border-primary bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder-text-disabled focus:outline-none focus:border-accent transition-colors';
  const labelCls = 'block text-xs text-text-muted mb-1';

  return (
    <Modal open={open} onClose={onClose} title="New Eval Scenario">
      <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        <div>
          <label className={labelCls}>Name *</label>
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. block-risky-rm-rf" />
        </div>

        <div>
          <label className={labelCls}>Description</label>
          <textarea className={inputCls} rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this scenario test?" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Hook</label>
            <input className={inputCls} value={hook} onChange={e => setHook(e.target.value)} placeholder="quality-stop-check-e2e" />
          </div>
          <div>
            <label className={labelCls}>Event</label>
            <select className={inputCls} value={event} onChange={e => setEvent(e.target.value)}>
              <option>Stop</option>
              <option>PreToolUse</option>
              <option>PostToolUse</option>
              <option>PreCompact</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Expected decision</label>
            <div className="flex gap-2">
              {(['pass', 'advisory', 'block'] as const).map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setExpect(d)}
                  className={clsx(
                    'flex-1 py-1.5 text-xs rounded border font-medium transition-colors',
                    expect === d
                      ? d === 'block' ? 'bg-red-500/20 border-red-500/40 text-red-400'
                        : d === 'advisory' ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-400'
                        : 'bg-green-500/20 border-green-500/40 text-green-400'
                      : 'bg-bg-tertiary border-border-primary text-text-muted hover:border-accent/50'
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>Depth</label>
            <div className="flex gap-2">
              {(['quick', 'full'] as const).map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDepth(d)}
                  className={clsx(
                    'flex-1 py-1.5 text-xs rounded border font-medium transition-colors',
                    depth === d
                      ? 'bg-accent/20 border-accent/40 text-accent'
                      : 'bg-bg-tertiary border-border-primary text-text-muted hover:border-accent/50'
                  )}
                >
                  {d.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className={labelCls}>Trials</label>
          <input className={inputCls} type="number" min={1} max={10} value={trials} onChange={e => setTrials(Number(e.target.value))} />
        </div>

        <div>
          <label className={labelCls}>Prompt *</label>
          <textarea className={inputCls} rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} required placeholder="The prompt/task to evaluate" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={labelCls + ' mb-0'}>Constraints</label>
            <button type="button" onClick={() => setConstraints([...constraints, ''])} className="text-xs text-accent hover:text-accent/80">+ Add</button>
          </div>
          <div className="space-y-2">
            {constraints.map((c, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={inputCls}
                  value={c}
                  onChange={e => { const a = [...constraints]; a[i] = e.target.value; setConstraints(a); }}
                  placeholder="e.g. Must not delete files without confirmation"
                />
                {constraints.length > 1 && (
                  <button type="button" onClick={() => setConstraints(constraints.filter((_, j) => j !== i))} className="text-text-muted hover:text-error px-1 text-sm">✕</button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={labelCls + ' mb-0'}>Success Criteria</label>
            <button type="button" onClick={() => setCriteria([...criteria, { type: 'contains', expected: '', description: '' }])} className="text-xs text-accent hover:text-accent/80">+ Add</button>
          </div>
          <div className="space-y-2">
            {criteria.map((c, i) => (
              <div key={i} className="flex gap-2 items-start">
                <select
                  className="rounded border border-border-primary bg-bg-tertiary px-2 py-2 text-xs text-text-primary focus:outline-none focus:border-accent w-28 shrink-0"
                  value={c.type}
                  onChange={e => { const a = [...criteria]; a[i] = { ...a[i], type: e.target.value }; setCriteria(a); }}
                >
                  <option value="contains">contains</option>
                  <option value="not_contains">not contains</option>
                  <option value="regex">regex</option>
                  <option value="llm_judge">llm_judge</option>
                </select>
                <input
                  className={inputCls}
                  value={c.expected}
                  onChange={e => { const a = [...criteria]; a[i] = { ...a[i], expected: e.target.value }; setCriteria(a); }}
                  placeholder="Expected value"
                />
                {criteria.length > 1 && (
                  <button type="button" onClick={() => setCriteria(criteria.filter((_, j) => j !== i))} className="text-text-muted hover:text-error px-1 text-sm">✕</button>
                )}
              </div>
            ))}
          </div>
        </div>

        {createMutation.isError && (
          <p className="text-xs text-red-400">Failed to create scenario. Check the form and try again.</p>
        )}

        <div className="flex justify-end gap-3 pt-2 border-t border-border-primary">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending || !name.trim() || !prompt.trim()}
            className="px-4 py-2 text-sm rounded bg-accent text-bg-primary font-medium hover:bg-accent/80 disabled:opacity-50 transition-colors"
          >
            {createMutation.isPending ? 'Creating…' : 'Create Scenario'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Tab 2: Scenarios ─────────────────────────────────────────────────────────

function ScenariosTab() {
  const { data, isLoading, error, refetch } = useObsEvalScenarios();
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState('');

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load scenarios" retry={refetch} />;

  const scenarios = data.scenarios ?? [];
  const filtered = filter
    ? scenarios.filter(s =>
        s.name.toLowerCase().includes(filter.toLowerCase()) ||
        s.description?.toLowerCase().includes(filter.toLowerCase())
      )
    : scenarios;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <input
          className="flex-1 rounded border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder-text-disabled focus:outline-none focus:border-accent transition-colors"
          placeholder="Filter scenarios…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm rounded bg-accent text-bg-primary font-medium hover:bg-accent/80 transition-colors shrink-0"
        >
          + New Scenario
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-12 text-center">
          {scenarios.length === 0 ? (
            <>
              <p className="text-text-secondary text-sm">No scenarios defined yet.</p>
              <p className="text-text-muted text-xs mt-2">Create a scenario to start measuring eval reliability.</p>
            </>
          ) : (
            <p className="text-text-secondary text-sm">No scenarios match "{filter}"</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => (
            <ScenarioCard key={s.dirName || s.name} scenario={s} />
          ))}
        </div>
      )}

      <CreateScenarioModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}

// ─── Tab 3: Runs ─────────────────────────────────────────────────────────────

function RunsTab() {
  const [scenarioFilter, setScenarioFilter] = useState('');
  const { data, isLoading, error, refetch } = useObsEvalRuns(scenarioFilter || undefined);

  const columns: Column<EvalRun>[] = [
    {
      key: 'ts',
      label: 'Time',
      width: '150px',
      render: (row) => <span className="font-mono text-text-muted text-xs">{dateTime(row.ts)}</span>,
    },
    {
      key: 'scenarioName',
      label: 'Scenario',
      render: (row) => (
        <button
          onClick={() => setScenarioFilter(row.scenarioName ?? row.evalName)}
          className="text-text-primary hover:text-accent transition-colors text-left"
        >
          {row.scenarioName ?? row.evalName}
        </button>
      ),
    },
    {
      key: 'expectedDecision',
      label: 'Expected',
      width: '100px',
      render: (row) => <DecisionBadge decision={row.expectedDecision} />,
    },
    {
      key: 'actualDecision',
      label: 'Actual',
      width: '100px',
      render: (row) => row.actualDecision ? (
        <span className={clsx(
          row.actualDecision === row.expectedDecision ? 'text-green-400' : 'text-red-400'
        )}>
          <DecisionBadge decision={row.actualDecision} />
        </span>
      ) : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'tier',
      label: 'Tier',
      width: '60px',
      render: (row) => row.tier != null ? (
        <span className="font-mono text-text-muted text-xs">{row.tier}</span>
      ) : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'passAt1',
      label: 'pass@1',
      width: '80px',
      render: (row) => <PassAt1Badge passed={row.passAt1} />,
    },
    {
      key: 'passed',
      label: 'Trials',
      width: '80px',
      render: (row) => (
        <span className="font-mono text-xs text-text-secondary">
          {row.passed}/{row.passed + row.failed}
        </span>
      ),
    },
    {
      key: 'graders',
      label: 'Graders',
      render: (row) => row.graders && row.graders.length > 0 ? (
        <div className="flex gap-1 flex-wrap">
          {row.graders.map((g, i) => (
            <span key={i} className={clsx(
              'text-xs px-1.5 py-0.5 rounded font-mono',
              g.result === 'pass' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400',
            )}>
              {g.type}
            </span>
          ))}
        </div>
      ) : <span className="text-text-disabled">—</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <input
          className="flex-1 rounded border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder-text-disabled focus:outline-none focus:border-accent transition-colors"
          placeholder="Filter by scenario name…"
          value={scenarioFilter}
          onChange={e => setScenarioFilter(e.target.value)}
        />
        {scenarioFilter && (
          <button
            onClick={() => setScenarioFilter('')}
            className="text-xs text-text-muted hover:text-text-primary transition-colors shrink-0"
          >
            clear
          </button>
        )}
      </div>

      {isLoading && <PageLoading />}
      {error && <ErrorState message="Failed to load runs" retry={refetch} />}
      {data && (
        data.runs.length > 0 ? (
          <>
            <div className="text-xs text-text-muted">
              {data.total} run{data.total !== 1 ? 's' : ''}
              {scenarioFilter ? ` for "${scenarioFilter}"` : ''}
            </div>
            <DataTable<EvalRun>
              data={data.runs}
              columns={columns}
              keyField="ts"
              rowKeyFn={(row) => `${row.ts}-${row.evalName}`}
            />
          </>
        ) : (
          <div className="rounded-lg border border-border-primary bg-bg-secondary p-12 text-center">
            <p className="text-text-secondary text-sm">
              {scenarioFilter ? `No runs found for "${scenarioFilter}"` : 'No runs recorded yet.'}
            </p>
          </div>
        )
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = 'results' | 'scenarios' | 'runs';

const TABS: { key: Tab; label: string }[] = [
  { key: 'results', label: 'Results' },
  { key: 'scenarios', label: 'Scenarios' },
  { key: 'runs', label: 'Runs' },
];

export function EvalsPage() {
  const [tab, setTab] = useState<Tab>('results');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Evals" subtitle="Eval-driven reliability — pass@k metrics over time" />

      <div className="flex gap-1 border-b border-border-primary">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === t.key
                ? 'border-accent text-accent'
                : 'border-transparent text-text-muted hover:text-text-secondary'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'results' && <ResultsTab />}
      {tab === 'scenarios' && <ScenariosTab />}
      {tab === 'runs' && <RunsTab />}
    </div>
  );
}
