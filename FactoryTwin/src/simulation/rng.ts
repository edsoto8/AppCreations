/**
 * Seeded pseudo-random numbers. mulberry32 per stream; streams are derived from
 * hash(seed, name) so draws in one concern never shift another.
 */

export function hashString(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // final avalanche
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lanczos approximation of the gamma function (x > 0). */
export function gamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

export class RandomStream {
  private readonly next01: () => number;
  draws = 0;

  constructor(readonly name: string, seed: number) {
    this.next01 = mulberry32(seed);
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.draws++;
    return this.next01();
  }

  /** Uniform in (0, 1] — safe for logarithms. */
  private open01(): number {
    return 1 - this.next();
  }

  uniform(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  exp(mean: number): number {
    return -mean * Math.log(this.open01());
  }

  tri(min: number, mode: number, max: number): number {
    if (max <= min) return min;
    const u = this.next();
    const f = (mode - min) / (max - min);
    if (u < f) return min + Math.sqrt(u * (max - min) * (mode - min));
    return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
  }

  /** Symmetric triangular around `mean` with +/- `spread` fraction. */
  around(mean: number, spread = 0.25): number {
    return this.tri(mean * (1 - spread), mean, mean * (1 + spread));
  }

  normal(): number {
    const u1 = this.open01();
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** Lognormal with the given mean and coefficient of variation. */
  lognormal(mean: number, cv = 0.5): number {
    if (mean <= 0) return 0;
    const s2 = Math.log(1 + cv * cv);
    const mu = Math.log(mean) - s2 / 2;
    return Math.exp(mu + Math.sqrt(s2) * this.normal());
  }

  /** Weibull sample with given mean and shape k. */
  weibull(mean: number, k: number): number {
    const scale = mean / gamma(1 + 1 / k);
    return scale * Math.pow(-Math.log(this.open01()), 1 / k);
  }

  /** Index chosen with probability proportional to weights. */
  pick(weights: number[]): number {
    const total = weights.reduce((s, w) => s + w, 0);
    let u = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      u -= weights[i];
      if (u < 0) return i;
    }
    return weights.length - 1;
  }
}

export class RngStreams {
  private readonly streams = new Map<string, RandomStream>();

  constructor(readonly seed: number) {}

  stream(name: string): RandomStream {
    let s = this.streams.get(name);
    if (!s) {
      s = new RandomStream(name, hashString(name, hashString(String(this.seed >>> 0))));
      this.streams.set(name, s);
    }
    return s;
  }
}
