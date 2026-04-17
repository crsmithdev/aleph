import { PageLoading } from '../../components/ui/Spinner';
import {
  useResearchDefaults,
  useUpdateResearchDefaults,
  useResetResearchDefaults,
  type ResearchDefaults,
} from '../../api/research-hooks';
import { ConfigForm, patchByPath } from './config-schema';

export function ResearchDefaultsPanel() {
  const { data, isLoading } = useResearchDefaults();
  const update = useUpdateResearchDefaults();
  const reset = useResetResearchDefaults();

  if (isLoading || !data) return <PageLoading />;

  return (
    <ConfigForm
      title="Defaults"
      subtitle="Shipped defaults for new research queries. In-flight sessions keep their frozen config; changes apply to new queries."
      value={data as unknown as Record<string, unknown>}
      onSave={(path, value) => update.mutate(patchByPath(path, value) as Partial<ResearchDefaults>)}
      onResetAll={() => reset.mutate()}
      resetAllLabel="Reset to built-in"
    />
  );
}
