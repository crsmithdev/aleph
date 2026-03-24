export function QueryTiming({ ms, rows }: { ms?: number; rows?: number }) {
  if (ms === undefined || ms === null) return null;
  const timing = ms < 1 ? '<1' : ms.toFixed(1);
  return (
    <span className="text-[11px] text-text-muted">
      {rows !== undefined
        ? `${rows.toLocaleString()} rows in ${timing}ms`
        : `Loaded in ${timing}ms`}
    </span>
  );
}
