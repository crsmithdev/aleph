/** Dollars as "$1.25", "<$0.01" under half a cent; none counts as 0. */
export const money = (n: number | null | undefined): string => {
  const x = n ?? 0;
  return x > 0 && x < 0.005 ? "<$0.01" : `$${x.toFixed(2)}`;
};
