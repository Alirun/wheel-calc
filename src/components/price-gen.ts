// Seeded pseudo-random price series generators.
// Pure TypeScript — no framework dependencies.

export type PriceModel = "gbm" | "heston" | "jump" | "heston-jump";

export interface HestonParams {
  kappa: number;   // mean-reversion speed
  theta: number;   // long-run variance (σ²)
  sigma: number;   // vol-of-vol
  rho: number;     // correlation between price and variance Brownian motions
  v0?: number;     // initial variance (defaults to theta)
}

export interface JumpParams {
  lambda: number;  // expected jumps per year
  muJ: number;     // mean of log-jump size
  sigmaJ: number;  // std dev of log-jump size
}

export interface PriceGenResult {
  prices: number[];
  ivPath?: number[];
}

export interface PriceGenConfig {
  startPrice: number;
  days: number;
  annualVol: number;
  annualDrift: number;
  seed: number;
  model?: PriceModel;
  heston?: HestonParams;
  jump?: JumpParams;
}

export function splitmix32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s |= 0;
    s = (s + 0x9e3779b9) | 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return (t >>> 0) / 4294967296;
  };
}

export function boxMuller(rand: () => number): number {
  const u1 = rand();
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
}

function generatePricesGBM(config: PriceGenConfig, rand: () => number): PriceGenResult {
  const {startPrice, days, annualVol, annualDrift} = config;
  const dt = 1 / 365;
  const driftTerm = (annualDrift - (annualVol * annualVol) / 2) * dt;
  const volTerm = annualVol * Math.sqrt(dt);

  const prices: number[] = [startPrice];
  for (let i = 1; i < days; i++) {
    const z = boxMuller(rand);
    const prev = prices[i - 1];
    prices.push(prev * Math.exp(driftTerm + volTerm * z));
  }
  return {prices};
}

function generatePricesHeston(config: PriceGenConfig, rand: () => number): PriceGenResult {
  const {startPrice, days, annualDrift} = config;
  const h = config.heston!;
  const {kappa, theta, sigma, rho} = h;
  const v0 = h.v0 ?? theta;
  const dt = 1 / 365;

  const prices: number[] = [startPrice];
  const ivPath: number[] = [Math.sqrt(Math.max(v0, 0))];
  let v = v0;

  // Andersen QE scheme precomputed constants
  const emdt = Math.exp(-kappa * dt);
  const k1 = sigma * sigma * emdt * (1 - emdt) / kappa;

  for (let i = 1; i < days; i++) {
    // QE discretization of variance process
    const m = theta + (v - theta) * emdt;
    const s2 = v * k1 + theta * (sigma * sigma / (2 * kappa)) * (1 - emdt) * (1 - emdt);
    const psi = s2 / (m * m + 1e-20);

    let vNext: number;
    if (psi <= 1.5) {
      // Quadratic scheme
      const b2 = 2 / psi - 1 + Math.sqrt(2 / psi) * Math.sqrt(Math.max(2 / psi - 1, 0));
      const a = m / (1 + b2);
      const b = Math.sqrt(Math.max(b2, 0));
      const zV = boxMuller(rand);
      vNext = a * (b + zV) * (b + zV);
    } else {
      // Exponential scheme
      const p = (psi - 1) / (psi + 1);
      const beta = (1 - p) / (m + 1e-20);
      const u = rand();
      if (u <= p) {
        vNext = 0;
      } else {
        vNext = Math.log((1 - p) / (1 - u + 1e-20)) / (beta + 1e-20);
      }
    }
    vNext = Math.max(vNext, 0);

    // Correlated Brownian for price
    const z1 = boxMuller(rand);
    const z2 = boxMuller(rand);
    const zS = rho * z1 + Math.sqrt(1 - rho * rho) * z2;

    const volAvg = Math.sqrt(Math.max((v + vNext) / 2, 0));
    const driftTerm = (annualDrift - volAvg * volAvg / 2) * dt;
    const prev = prices[i - 1];
    prices.push(prev * Math.exp(driftTerm + volAvg * Math.sqrt(dt) * zS));

    v = vNext;
    ivPath.push(Math.sqrt(Math.max(v, 0)));
  }

  return {prices, ivPath};
}

function generatePricesJump(config: PriceGenConfig, rand: () => number): PriceGenResult {
  const {startPrice, days, annualVol, annualDrift} = config;
  const j = config.jump!;
  const {lambda, muJ, sigmaJ} = j;
  const dt = 1 / 365;
  const jumpCompensator = lambda * (Math.exp(muJ + (sigmaJ * sigmaJ) / 2) - 1);
  const driftTerm = (annualDrift - (annualVol * annualVol) / 2 - jumpCompensator) * dt;
  const volTerm = annualVol * Math.sqrt(dt);

  const prices: number[] = [startPrice];
  for (let i = 1; i < days; i++) {
    const z = boxMuller(rand);
    let logJump = 0;
    const jumpProb = lambda * dt;
    const u = rand();
    if (u < jumpProb) {
      const zJ = boxMuller(rand);
      logJump = muJ + sigmaJ * zJ;
    }
    const prev = prices[i - 1];
    prices.push(prev * Math.exp(driftTerm + volTerm * z + logJump));
  }
  return {prices};
}

function generatePricesHestonJump(config: PriceGenConfig, rand: () => number): PriceGenResult {
  const {startPrice, days, annualDrift} = config;
  const h = config.heston!;
  const j = config.jump!;
  const {kappa, theta, sigma, rho} = h;
  const v0 = h.v0 ?? theta;
  const {lambda, muJ, sigmaJ} = j;
  const dt = 1 / 365;
  const jumpCompensator = lambda * (Math.exp(muJ + (sigmaJ * sigmaJ) / 2) - 1);

  const prices: number[] = [startPrice];
  const ivPath: number[] = [Math.sqrt(Math.max(v0, 0))];
  let v = v0;

  const emdt = Math.exp(-kappa * dt);
  const k1 = sigma * sigma * emdt * (1 - emdt) / kappa;

  for (let i = 1; i < days; i++) {
    const m = theta + (v - theta) * emdt;
    const s2 = v * k1 + theta * (sigma * sigma / (2 * kappa)) * (1 - emdt) * (1 - emdt);
    const psi = s2 / (m * m + 1e-20);

    let vNext: number;
    if (psi <= 1.5) {
      const b2 = 2 / psi - 1 + Math.sqrt(2 / psi) * Math.sqrt(Math.max(2 / psi - 1, 0));
      const a = m / (1 + b2);
      const b = Math.sqrt(Math.max(b2, 0));
      const zV = boxMuller(rand);
      vNext = a * (b + zV) * (b + zV);
    } else {
      const p = (psi - 1) / (psi + 1);
      const beta = (1 - p) / (m + 1e-20);
      const u = rand();
      if (u <= p) {
        vNext = 0;
      } else {
        vNext = Math.log((1 - p) / (1 - u + 1e-20)) / (beta + 1e-20);
      }
    }
    vNext = Math.max(vNext, 0);

    const z1 = boxMuller(rand);
    const z2 = boxMuller(rand);
    const zS = rho * z1 + Math.sqrt(1 - rho * rho) * z2;

    let logJump = 0;
    const jumpProb = lambda * dt;
    const uJump = rand();
    if (uJump < jumpProb) {
      const zJ = boxMuller(rand);
      logJump = muJ + sigmaJ * zJ;
    }

    const volAvg = Math.sqrt(Math.max((v + vNext) / 2, 0));
    const driftTerm = (annualDrift - volAvg * volAvg / 2 - jumpCompensator) * dt;
    const prev = prices[i - 1];
    prices.push(prev * Math.exp(driftTerm + volAvg * Math.sqrt(dt) * zS + logJump));

    v = vNext;
    ivPath.push(Math.sqrt(Math.max(v, 0)));
  }

  return {prices, ivPath};
}

export function generatePrices(config: PriceGenConfig): PriceGenResult {
  const rand = splitmix32(config.seed);
  const model = config.model ?? "gbm";
  switch (model) {
    case "gbm": return generatePricesGBM(config, rand);
    case "heston": return generatePricesHeston(config, rand);
    case "jump": return generatePricesJump(config, rand);
    case "heston-jump": return generatePricesHestonJump(config, rand);
  }
}
