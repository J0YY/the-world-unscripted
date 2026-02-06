export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

export function clamp100(n: number): number {
  return clamp(n, 0, 100);
}

