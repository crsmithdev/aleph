import { useParams, Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { useResearchPlan, useResearchSession, useModifyPlan } from '../../api/research-hooks';
import { Button } from '../../components/ui/Button';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';

const originColors: Record<string, string> = {
  seed: 'bg-blue-900/50 text-blue-300',
  follow_up: 'bg-purple-900/50 text-purple-300',
  perturbation: 'bg-orange-900/50 text-orange-300',
  user_injected: 'bg-green-900/50 text-green-300',
};

export function ResearchPlanPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useResearchSession(id!);
  const { data: plan, isLoading, isError } = useResearchPlan(id!);
  const modifyPlan = useModifyPlan();

  if (isLoading) return <PageLoading />;
  if (isError || !plan) return (
    <div className="flex flex-col gap-5">
      <Link to={`/research/${id}`} className="text-xs text-accent hover:underline">&larr; Back to session</Link>
      <ErrorState message="No research plan available yet. Run at least one iteration to generate a plan." />
    </div>
  );

  function handleVeto(rank: number, threadId: string) {
    modifyPlan.mutate({ sessionId: id!, action: 'veto', target_item_rank: rank, target_thread_id: threadId });
  }

  function handleBoost(rank: number, threadId: string) {
    modifyPlan.mutate({ sessionId: id!, action: 'boost', target_item_rank: rank, target_thread_id: threadId });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link to={`/research/${id}`} className="text-xs text-accent hover:underline">&larr; Back to session</Link>
        <h1 className="font-heading text-2xl font-bold text-text-primary mt-2">Research Plan</h1>
        <p className="text-sm text-text-muted mt-0.5">
          {session?.title} — {plan.items.length} upcoming items
        </p>
      </div>

      <div className="space-y-2">
        {plan.items.map(item => (
          <div key={item.rank} className="bg-bg-secondary border border-border-primary rounded-lg p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <span className="text-lg font-bold text-text-muted w-6 text-right shrink-0">{item.rank}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary">{item.thread_query}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className={clsx('px-1.5 py-0.5 rounded text-xs font-medium', originColors[item.origin])}>
                      {item.origin.replace('_', ' ')}
                    </span>
                    {item.perturbation_strategy && (
                      <span className="px-1.5 py-0.5 bg-orange-900/30 text-orange-300 rounded text-xs">
                        {item.perturbation_strategy.replace('_', ' ')}
                      </span>
                    )}
                    {item.parent_thread_title && (
                      <span className="text-xs text-text-muted truncate">from: {item.parent_thread_title}</span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted mt-1">{item.rationale}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleBoost(item.rank, item.thread_id)}
                  title="Boost — increase priority"
                >
                  ^
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleVeto(item.rank, item.thread_id)}
                  title="Veto — prune this thread"
                >
                  x
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {plan.items.length === 0 && (
        <p className="text-sm text-text-muted text-center py-8">
          No items in the plan. All threads may be exhausted or pruned.
        </p>
      )}
    </div>
  );
}
