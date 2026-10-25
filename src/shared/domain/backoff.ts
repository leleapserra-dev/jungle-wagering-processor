export function exponentialBackoffMs(attempt: number, baseMs: number, maxMs: number, seed: string): number {
  const exponent = Math.max(0, attempt - 1);
  const raw = Math.min(baseMs * 2 ** exponent, maxMs);
  const jitter = 0.8 + hashToUnit(seed) * 0.4;
  return Math.max(1, Math.round(raw * jitter));
}

function hashToUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}
