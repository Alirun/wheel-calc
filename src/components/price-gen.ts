// Seeded pseudo-random price series generator using geometric Brownian motion.
// Pure TypeScript — no framework dependencies.

export interface PriceGenConfig {
  startPrice: number;
  days: number;
  annualVol: number; // e.g. 0.80 = 80%
  annualDrift: number; // e.g. 0.0 = neutral
  seed: number;
}

// Simple splitmix32 PRNG — fast, deterministic, good enough for simulation
function splitmix32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s |= 0;
    s = (s + 0x9e3779b9) | 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return (t >>> 0) / 4294967296; // [0, 1)
  };
}

// Box-Muller transform: two uniform randoms → one standard normal
function boxMuller(rand: () => number): number {
  const u1 = rand();
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
}

export function generatePrices(config: PriceGenConfig): number[] {
  const { startPrice, days, annualVol, annualDrift, seed } = config;
  const rand = splitmix32(seed);
  const dt = 1 / 365;
  const driftTerm = (annualDrift - (annualVol * annualVol) / 2) * dt;
  const volTerm = annualVol * Math.sqrt(dt);

  const prices: number[] = [startPrice];
  for (let i = 1; i < days; i++) {
    const z = boxMuller(rand);
    const prev = prices[i - 1];
    prices.push(prev * Math.exp(driftTerm + volTerm * z));
  }
  return prices;
}
