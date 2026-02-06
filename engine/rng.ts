export type RngState = {
  /** xorshift32 internal state */
  s: number;
};

function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // h *= 16777619 (with uint32 overflow)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

export function createRngState(seed: string): RngState {
  // Avoid the all-zero forbidden state for xorshift32.
  const hashed = fnv1a32(seed);
  return { s: (hashed === 0 ? 0x6d2b79f5 : hashed) >>> 0 };
}

export function rngNextUint32(rng: RngState): number {
  // xorshift32
  let x = rng.s >>> 0;
  x ^= (x << 13) >>> 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0;
  rng.s = x >>> 0;
  return rng.s;
}

export function rngFloat01(rng: RngState): number {
  // [0, 1)
  return rngNextUint32(rng) / 0x100000000;
}

export function rngInt(rng: RngState, minInclusive: number, maxInclusive: number): number {
  if (maxInclusive < minInclusive) throw new Error("rngInt: invalid range");
  const span = maxInclusive - minInclusive + 1;
  return minInclusive + Math.floor(rngFloat01(rng) * span);
}

export function rngPick<T>(rng: RngState, items: readonly T[]): T {
  if (items.length === 0) throw new Error("rngPick: empty array");
  return items[rngInt(rng, 0, items.length - 1)];
}

export function rngChance(rng: RngState, p: number): boolean {
  if (p <= 0) return false;
  if (p >= 1) return true;
  return rngFloat01(rng) < p;
}

export function rngNormalApprox(rng: RngState): number {
  // Approx standard normal using CLT: sum(12 uniforms) - 6
  let s = 0;
  for (let i = 0; i < 12; i++) s += rngFloat01(rng);
  return s - 6;
}

