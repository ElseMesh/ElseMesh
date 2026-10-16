// Nearest-rank sample percentile. For a short run, p99 intentionally reports
// the slowest observed request rather than the second-slowest observation.
export function nearestRank(sorted, fraction) {
  if (!Array.isArray(sorted) || !sorted.length ||
      !Number.isFinite(fraction) || fraction <= 0 || fraction > 1)
    throw new Error('Nonempty sorted sample and percentile in (0, 1] required');
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}
