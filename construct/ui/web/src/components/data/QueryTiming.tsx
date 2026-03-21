export function QueryTiming({ ms }: { ms?: number }) {
  if (ms === undefined || ms === null) return null;
  return (
    <span className="text-[11px] text-text-muted">
      Loaded in {ms < 1 ? '<1' : ms.toFixed(1)}ms
    </span>
  );
}
