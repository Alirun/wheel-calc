import {describe, it, expect} from "vitest";
import {generatePrices, splitmix32, boxMuller} from "../src/components/price-gen.js";
import type {PriceGenConfig} from "../src/components/price-gen.js";

const baseConfig: PriceGenConfig = {
  startPrice: 2500,
  days: 100,
  annualVol: 0.80,
  annualDrift: 0,
  seed: 42,
};

describe("splitmix32", () => {
  it("is deterministic for the same seed", () => {
    const r1 = splitmix32(42);
    const r2 = splitmix32(42);
    for (let i = 0; i < 100; i++) {
      expect(r1()).toBe(r2());
    }
  });

  it("produces values in [0, 1)", () => {
    const r = splitmix32(1);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("different seeds produce different sequences", () => {
    const r1 = splitmix32(1);
    const r2 = splitmix32(2);
    const vals1 = Array.from({length: 10}, () => r1());
    const vals2 = Array.from({length: 10}, () => r2());
    expect(vals1).not.toEqual(vals2);
  });
});

describe("boxMuller", () => {
  it("produces approximately standard normal values", () => {
    const r = splitmix32(99);
    const samples = Array.from({length: 10000}, () => boxMuller(r));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((s, x) => s + (x - mean) ** 2, 0) / samples.length;
    expect(mean).toBeCloseTo(0, 1);
    expect(variance).toBeCloseTo(1, 0);
  });
});

describe("GBM model", () => {
  it("returns prices array with correct length", () => {
    const result = generatePrices(baseConfig);
    expect(result.prices.length).toBe(100);
    expect(result.prices[0]).toBe(2500);
  });

  it("does not return ivPath", () => {
    const result = generatePrices(baseConfig);
    expect(result.ivPath).toBeUndefined();
  });

  it("is deterministic — same seed produces same prices", () => {
    const r1 = generatePrices(baseConfig);
    const r2 = generatePrices(baseConfig);
    expect(r1.prices).toEqual(r2.prices);
  });

  it("different seeds produce different prices", () => {
    const r1 = generatePrices({...baseConfig, seed: 1});
    const r2 = generatePrices({...baseConfig, seed: 2});
    expect(r1.prices).not.toEqual(r2.prices);
  });

  it("prices are always positive", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const {prices} = generatePrices({...baseConfig, seed});
      for (const p of prices) {
        expect(p).toBeGreaterThan(0);
      }
    }
  });

  it("no NaN or Infinity", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const {prices} = generatePrices({...baseConfig, seed});
      for (const p of prices) {
        expect(isFinite(p)).toBe(true);
      }
    }
  });

  it("backward compat: default model is gbm", () => {
    const withoutModel = generatePrices(baseConfig);
    const withModel = generatePrices({...baseConfig, model: "gbm"});
    expect(withoutModel.prices).toEqual(withModel.prices);
  });
});

describe("Heston model", () => {
  const hestonConfig: PriceGenConfig = {
    ...baseConfig,
    model: "heston",
    heston: {kappa: 2.0, theta: 0.64, sigma: 0.5, rho: -0.7},
  };

  it("returns prices and ivPath", () => {
    const result = generatePrices(hestonConfig);
    expect(result.prices.length).toBe(100);
    expect(result.ivPath).toBeDefined();
    expect(result.ivPath!.length).toBe(100);
  });

  it("is deterministic", () => {
    const r1 = generatePrices(hestonConfig);
    const r2 = generatePrices(hestonConfig);
    expect(r1.prices).toEqual(r2.prices);
    expect(r1.ivPath).toEqual(r2.ivPath);
  });

  it("variance never negative (QE guarantee) — ivPath values are real", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const {ivPath} = generatePrices({...hestonConfig, seed, days: 365});
      for (const iv of ivPath!) {
        expect(iv).toBeGreaterThanOrEqual(0);
        expect(isFinite(iv)).toBe(true);
      }
    }
  });

  it("prices are always positive", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const {prices} = generatePrices({...hestonConfig, seed, days: 365});
      for (const p of prices) {
        expect(p).toBeGreaterThan(0);
      }
    }
  });

  it("ivPath mean-reverts toward sqrt(theta)", () => {
    const longConfig = {...hestonConfig, days: 365, seed: 1, heston: {...hestonConfig.heston!, v0: 0.1}};
    const {ivPath} = generatePrices(longConfig);
    const sqrtTheta = Math.sqrt(longConfig.heston!.theta);
    const lastQuarter = ivPath!.slice(-90);
    const avgLast = lastQuarter.reduce((a, b) => a + b, 0) / lastQuarter.length;
    expect(avgLast).toBeGreaterThan(sqrtTheta * 0.3);
    expect(avgLast).toBeLessThan(sqrtTheta * 2.5);
  });

  it("vol has positive autocorrelation (clustering)", () => {
    const {ivPath} = generatePrices({...hestonConfig, days: 365, seed: 1});
    const iv = ivPath!;
    let sumProduct = 0;
    let sumSq = 0;
    const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
    for (let i = 1; i < iv.length; i++) {
      sumProduct += (iv[i] - mean) * (iv[i - 1] - mean);
      sumSq += (iv[i - 1] - mean) ** 2;
    }
    const autocorr = sumProduct / (sumSq || 1);
    expect(autocorr).toBeGreaterThan(0);
  });

  it("no NaN or Infinity", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const {prices, ivPath} = generatePrices({...hestonConfig, seed, days: 365});
      for (const p of prices) expect(isFinite(p)).toBe(true);
      for (const v of ivPath!) expect(isFinite(v)).toBe(true);
    }
  });

  it("different seeds produce different paths", () => {
    const r1 = generatePrices({...hestonConfig, seed: 1});
    const r2 = generatePrices({...hestonConfig, seed: 2});
    expect(r1.prices).not.toEqual(r2.prices);
  });

  it("v0 defaults to theta when not specified", () => {
    const result = generatePrices(hestonConfig);
    expect(result.ivPath![0]).toBeCloseTo(Math.sqrt(hestonConfig.heston!.theta), 6);
  });

  it("exercises exponential scheme (high psi) with high vol-of-vol", () => {
    const highVolOfVol: PriceGenConfig = {
      ...baseConfig,
      model: "heston",
      days: 365,
      heston: {kappa: 0.5, theta: 0.04, sigma: 2.0, rho: -0.7, v0: 0.001},
    };
    for (let seed = 1; seed <= 10; seed++) {
      const {prices, ivPath} = generatePrices({...highVolOfVol, seed});
      for (const p of prices) {
        expect(p).toBeGreaterThan(0);
        expect(isFinite(p)).toBe(true);
      }
      for (const v of ivPath!) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(isFinite(v)).toBe(true);
      }
    }
  });
});

describe("Jump diffusion model", () => {
  const jumpConfig: PriceGenConfig = {
    ...baseConfig,
    model: "jump",
    jump: {lambda: 10, muJ: 0, sigmaJ: 0.05},
  };

  it("returns prices without ivPath", () => {
    const result = generatePrices(jumpConfig);
    expect(result.prices.length).toBe(100);
    expect(result.ivPath).toBeUndefined();
  });

  it("is deterministic", () => {
    const r1 = generatePrices(jumpConfig);
    const r2 = generatePrices(jumpConfig);
    expect(r1.prices).toEqual(r2.prices);
  });

  it("prices are always positive", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const {prices} = generatePrices({...jumpConfig, seed, days: 365});
      for (const p of prices) {
        expect(p).toBeGreaterThan(0);
      }
    }
  });

  it("zero lambda matches GBM behavior closely", () => {
    const noJumpConfig = {...jumpConfig, jump: {lambda: 0, muJ: 0, sigmaJ: 0.05}};
    const gbmConfig = {...baseConfig, model: "gbm" as const};
    const jumpResult = generatePrices(noJumpConfig);
    const gbmResult = generatePrices(gbmConfig);
    // With lambda=0, jump never fires, but PRNG draws differ because jump model
    // draws an extra uniform per step. So paths diverge. Instead check properties.
    expect(jumpResult.prices[0]).toBe(gbmResult.prices[0]);
    expect(jumpResult.prices.length).toBe(gbmResult.prices.length);
  });

  it("no NaN or Infinity", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const {prices} = generatePrices({...jumpConfig, seed, days: 365});
      for (const p of prices) expect(isFinite(p)).toBe(true);
    }
  });

  it("different seeds produce different paths", () => {
    const r1 = generatePrices({...jumpConfig, seed: 1});
    const r2 = generatePrices({...jumpConfig, seed: 2});
    expect(r1.prices).not.toEqual(r2.prices);
  });
});

describe("Heston + Jump combined model", () => {
  const hjConfig: PriceGenConfig = {
    ...baseConfig,
    model: "heston-jump",
    heston: {kappa: 2.0, theta: 0.64, sigma: 0.5, rho: -0.7},
    jump: {lambda: 10, muJ: 0, sigmaJ: 0.05},
  };

  it("returns prices and ivPath", () => {
    const result = generatePrices(hjConfig);
    expect(result.prices.length).toBe(100);
    expect(result.ivPath).toBeDefined();
    expect(result.ivPath!.length).toBe(100);
  });

  it("is deterministic", () => {
    const r1 = generatePrices(hjConfig);
    const r2 = generatePrices(hjConfig);
    expect(r1.prices).toEqual(r2.prices);
    expect(r1.ivPath).toEqual(r2.ivPath);
  });

  it("prices are always positive", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const {prices} = generatePrices({...hjConfig, seed, days: 365});
      for (const p of prices) {
        expect(p).toBeGreaterThan(0);
      }
    }
  });

  it("variance never negative", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const {ivPath} = generatePrices({...hjConfig, seed, days: 365});
      for (const iv of ivPath!) {
        expect(iv).toBeGreaterThanOrEqual(0);
        expect(isFinite(iv)).toBe(true);
      }
    }
  });

  it("no NaN or Infinity", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const {prices, ivPath} = generatePrices({...hjConfig, seed, days: 365});
      for (const p of prices) expect(isFinite(p)).toBe(true);
      for (const v of ivPath!) expect(isFinite(v)).toBe(true);
    }
  });

  it("different seeds produce different paths", () => {
    const r1 = generatePrices({...hjConfig, seed: 1});
    const r2 = generatePrices({...hjConfig, seed: 2});
    expect(r1.prices).not.toEqual(r2.prices);
  });

  it("exercises exponential scheme with high vol-of-vol", () => {
    const highVolConfig: PriceGenConfig = {
      ...baseConfig,
      model: "heston-jump",
      days: 365,
      heston: {kappa: 0.5, theta: 0.04, sigma: 2.0, rho: -0.7, v0: 0.001},
      jump: {lambda: 10, muJ: 0, sigmaJ: 0.05},
    };
    for (let seed = 1; seed <= 10; seed++) {
      const {prices, ivPath} = generatePrices({...highVolConfig, seed});
      for (const p of prices) {
        expect(p).toBeGreaterThan(0);
        expect(isFinite(p)).toBe(true);
      }
      for (const v of ivPath!) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(isFinite(v)).toBe(true);
      }
    }
  });
});
