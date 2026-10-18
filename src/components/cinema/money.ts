/**
 * Money spent or allowed (project spend, cost caps): "$0.00", "<$0.01", "$1.25". formatCost's
 * "Free" is for prices, not for what was spent. Kept apart from the catalog so the projects list
 * doesn't load it.
 */
export function formatUsd(usd: number | null | undefined): string {
  const v = usd ?? 0;
  if (v <= 0) return "$0.00";
  if (v < 0.01) return "<$0.01";
  return `$${v.toFixed(2)}`;
}
