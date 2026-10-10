// Seeded RNG (mulberry32). All simulation randomness flows through one of these.
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** integer in [a, b] inclusive */
  int(a: number, b: number): number {
    if (b < a) return a;
    return a + Math.floor(this.next() * (b - a + 1));
  }
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 4294967296));
  }
}

export function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const WORDS_A = ['amber', 'hollow', 'silent', 'pale', 'crooked', 'velvet', 'ashen', 'gilded', 'bitter', 'drowsy', 'feral', 'quiet'];
const WORDS_B = ['lantern', 'raven', 'cellar', 'thimble', 'harbor', 'mirror', 'candle', 'orchard', 'ledger', 'spindle', 'gable', 'tide'];

/** Friendly, shareable seed text for when the player leaves the seed blank. */
export function randomSeedText(): string {
  const r = () => Math.floor(Math.random() * 1e9);
  return `${WORDS_A[r() % WORDS_A.length]}-${WORDS_B[r() % WORDS_B.length]}-${(r() % 900) + 100}`;
}
