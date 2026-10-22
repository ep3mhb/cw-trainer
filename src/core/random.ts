/**
 * Seedable random source.
 *
 * The generators take one of these so that a lesson can be reproduced
 * exactly — needed for the unit tests, and for a instructor to hand out the
 * same drill twice.
 */
export interface Random {
  next(): number;
  pick<T>(items: readonly T[]): T;
  int(maxExclusive: number): number;
}

/** mulberry32 — small, fast, good enough for drill content. */
export function seeded(seed: number): Random {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive);
  return {
    next,
    int,
    pick: <T,>(items: readonly T[]): T => {
      if (items.length === 0) throw new RangeError('pick() from an empty list');
      return items[int(items.length)] as T;
    },
  };
}

export const systemRandom = (): Random => seeded((Math.random() * 2 ** 32) >>> 0);
