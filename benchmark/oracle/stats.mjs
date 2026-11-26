// Wilson intervals and the two-sided UNSURE policy for oracle precision.

export function wilson95(successes, trials) {
  if (trials <= 0) return { low: 0, high: 0, center: 0 };
  const z = 1.959963984540054;
  const phat = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = (phat + z2 / (2 * trials)) / denom;
  const margin = (z / denom) * Math.sqrt((phat * (1 - phat)) / trials + z2 / (4 * trials * trials));
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin), center: phat };
}

export function aggregate(rows) {
  const confirmed = rows.filter((r) => r.verdict === 'CONFIRMED').length;
  const contradicted = rows.filter((r) => r.verdict === 'CONTRADICTED').length;
  const unsure = rows.filter((r) => r.verdict === 'UNSURE').length;
  const total = rows.length;
  const low = wilson95(confirmed, total);
  const high = wilson95(confirmed + unsure, total);
  const confirmedOnly = wilson95(confirmed, confirmed + contradicted);
  return {
    confirmed,
    contradicted,
    unsure,
    total,
    precisionLower: total ? confirmed / total : null,
    precisionUpper: total ? (confirmed + unsure) / total : null,
    precisionConfirmedOnly: confirmed + contradicted ? confirmed / (confirmed + contradicted) : null,
    wilson95: {
      lowerBoundLow: low.low,
      upperBoundHigh: high.high,
      confirmedOnlyLow: confirmedOnly.low,
      confirmedOnlyHigh: confirmedOnly.high,
    },
  };
}
