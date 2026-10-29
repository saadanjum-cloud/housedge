// Copied from server/stats.js: an interval around a percentage, and whether a change is bigger than noise.
// Wilson score interval for k successes out of n. Returns percentages. Better than ±1.96·SE at small n and near 0/100.
export function wilson(k, n, z = 1.96) {
  if (!n) return { p: null, lo: null, hi: null, n: 0 };
  const p = k / n, z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  const pct = x => Math.round(1000 * Math.max(0, Math.min(1, x))) / 10;
  return { p: pct(p), lo: pct(centre - half), hi: pct(centre + half), n };
}

// Two Wilson intervals that do not overlap = a change worth telling a client about. Conservative on purpose.
export const changeIsReal = (a, b) => a.n > 0 && b.n > 0 && (a.lo > b.hi || b.lo > a.hi);

