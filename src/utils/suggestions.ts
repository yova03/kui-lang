export function closestMatch(value: string, candidates: string[]): string | undefined {
  const normalizedValue = normalizeForSuggestion(value);
  if (!normalizedValue || candidates.length === 0) return undefined;

  let best: { candidate: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeForSuggestion(candidate);
    if (!normalizedCandidate) continue;
    const distance = levenshteinDistance(normalizedValue, normalizedCandidate);
    if (!best || distance < best.distance) best = { candidate, distance };
  }

  if (!best) return undefined;
  const normalizedBest = normalizeForSuggestion(best.candidate);
  const threshold = Math.max(1, Math.ceil(Math.max(normalizedValue.length, normalizedBest.length) * 0.35));
  return best.distance <= threshold ? best.candidate : undefined;
}

function normalizeForSuggestion(value: string): string {
  return value.trim().toLowerCase();
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}
