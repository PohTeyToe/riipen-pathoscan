// Seeded random numbers, so a run id always draws the same run.

export interface Rng {
  (): number
  uniform(lo: number, hi: number): number
  shuffle<T>(xs: T[]): T[]
}

export function rng(seed: number): Rng {
  let a = seed >>> 0 || 0x9e3779b9
  const next = (() => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }) as Rng
  next.uniform = (lo, hi) => lo + (hi - lo) * next()
  next.shuffle = (xs) => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1))
      ;[xs[i], xs[j]] = [xs[j], xs[i]]
    }
    return xs
  }
  return next
}
