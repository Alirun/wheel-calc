// Pure TypeScript — no framework imports.

export interface MarketPresetValues {
  startPrice: number;
  days: number;
  annualVol: number;
  annualDrift: number;
  numSimulations: number;
  model: string;
  kappa: number;
  theta: number;
  sigma: number;
  rho: number;
  lambda: number;
  muJ: number;
  sigmaJ: number;
  riskFreeRate: number;
  bidAskSpreadPct: number;
  feePerTrade: number;
  ivMeanReversion: number;
  ivVolOfVol: number;
  vrpPremiumPct: number;
}

export interface StrategyPresetValues {
  targetDelta: number;
  cycleLengthDays: number;
  contracts: number;
  adaptiveCalls: boolean;
  minCallDelta: number;
  maxCallDelta: number;
  skipThresholdPct: number;
  minStrikeAtCost: boolean;
  ivRvSpread: boolean;
  ivRvLookback: number;
  ivRvMinMult: number;
  ivRvMaxMult: number;
  ivRvSkipBelow: number;
  ivRvSkipSide: "both" | "put";
  rollCall: boolean;
  rollITMThreshold: number;
  rollRequireCredit: boolean;
  rollPut: boolean;
  rollPutInitialDTE: number;
  rollPutWhenBelow: number;
  rollPutRequireCredit: boolean;
  stopLoss: boolean;
  stopLossDrawdown: number;
  stopLossCooldown: number;
  sizingMode: "none" | "volScaled";
  sizingVolTarget: number;
  sizingVolLookback: number;
  sizingMinSize: number;
  sizingColdStartDays: number;
  sizingColdStartSize: number;
}

export interface Preset<T> {
  name: string;
  values: T;
  builtIn: boolean;
  createdAt: string;
}

export interface PresetStore<T> {
  presets: Preset<T>[];
  defaultPresetName: string | null;
}

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const MARKET_KEY = "wheel-calc:market-presets";
export const STRATEGY_KEY = "wheel-calc:strategy-presets";

const FALLBACK_STORAGE: StorageBackend = {
  getItem: () => null,
  setItem: () => {}
};

function getStorage(storage?: StorageBackend): StorageBackend {
  if (storage) return storage;
  if (typeof localStorage !== "undefined") return localStorage;
  return FALLBACK_STORAGE;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function num(val: unknown, def: number, min: number, max: number): number {
  const v = typeof val === "number" && isFinite(val) ? val : def;
  return clamp(v, min, max);
}

function bool(val: unknown, def: boolean): boolean {
  return typeof val === "boolean" ? val : def;
}

function oneOf<T extends string>(val: unknown, def: T, allowed: T[]): T {
  return typeof val === "string" && allowed.includes(val as T) ? (val as T) : def;
}

export function defaultMarketValues(): MarketPresetValues {
  return {
    startPrice: 2500,
    days: 365,
    annualVol: 80,
    annualDrift: 0,
    numSimulations: 1000,
    model: "gbm",
    kappa: 2.0,
    theta: 0.64,
    sigma: 0.5,
    rho: -0.7,
    lambda: 10,
    muJ: 0,
    sigmaJ: 0.05,
    riskFreeRate: 5,
    bidAskSpreadPct: 5,
    feePerTrade: 0.50,
    ivMeanReversion: 5.0,
    ivVolOfVol: 0.5,
    vrpPremiumPct: 15
  };
}

export function defaultStrategyValues(): StrategyPresetValues {
  return {
    targetDelta: 0.30,
    cycleLengthDays: 7,
    contracts: 1,
    adaptiveCalls: true,
    minCallDelta: 0.10,
    maxCallDelta: 0.50,
    skipThresholdPct: 0.1,
    minStrikeAtCost: true,
    ivRvSpread: true,
    ivRvLookback: 20,
    ivRvMinMult: 0.8,
    ivRvMaxMult: 1.3,
    ivRvSkipBelow: 0,
    ivRvSkipSide: "put",
    rollCall: false,
    rollITMThreshold: 5,
    rollRequireCredit: true,
    rollPut: false,
    rollPutInitialDTE: 30,
    rollPutWhenBelow: 14,
    rollPutRequireCredit: true,
    stopLoss: false,
    stopLossDrawdown: 30,
    stopLossCooldown: 7,
    sizingMode: "none",
    sizingVolTarget: 40,
    sizingVolLookback: 45,
    sizingMinSize: 0.10,
    sizingColdStartDays: 0,
    sizingColdStartSize: 1.0
  };
}

export function validateMarketValues(raw: unknown): MarketPresetValues {
  const d = defaultMarketValues();
  const r = (typeof raw === "object" && raw !== null) ? raw as Record<string, unknown> : {};
  return {
    startPrice: num(r.startPrice, d.startPrice, 500, 8000),
    days: num(r.days, d.days, 30, 3650),
    annualVol: num(r.annualVol, d.annualVol, 10, 200),
    annualDrift: num(r.annualDrift, d.annualDrift, -200, 200),
    numSimulations: num(r.numSimulations, d.numSimulations, 10, 10000),
    model: oneOf(r.model, d.model, ["gbm", "heston", "jump", "heston-jump"]),
    kappa: num(r.kappa, d.kappa, 0.5, 10),
    theta: num(r.theta, d.theta, 0.04, 2.0),
    sigma: num(r.sigma, d.sigma, 0.1, 2.0),
    rho: num(r.rho, d.rho, -0.99, 0.99),
    lambda: num(r.lambda, d.lambda, 0, 50),
    muJ: num(r.muJ, d.muJ, -0.2, 0.2),
    sigmaJ: num(r.sigmaJ, d.sigmaJ, 0.01, 0.3),
    riskFreeRate: num(r.riskFreeRate, d.riskFreeRate, 0, 10),
    bidAskSpreadPct: num(r.bidAskSpreadPct, d.bidAskSpreadPct, 0, 20),
    feePerTrade: num(r.feePerTrade, d.feePerTrade, 0, 10),
    ivMeanReversion: num(r.ivMeanReversion, d.ivMeanReversion, 0.5, 20),
    ivVolOfVol: num(r.ivVolOfVol, d.ivVolOfVol, 0.05, 3.0),
    vrpPremiumPct: num(r.vrpPremiumPct, d.vrpPremiumPct, 0, 50)
  };
}

export function validateStrategyValues(raw: unknown): StrategyPresetValues {
  const d = defaultStrategyValues();
  const r = (typeof raw === "object" && raw !== null) ? raw as Record<string, unknown> : {};
  return {
    targetDelta: num(r.targetDelta, d.targetDelta, 0.05, 0.50),
    cycleLengthDays: num(r.cycleLengthDays, d.cycleLengthDays, 1, 30),
    contracts: num(r.contracts, d.contracts, 1, 20),
    adaptiveCalls: bool(r.adaptiveCalls, d.adaptiveCalls),
    minCallDelta: num(r.minCallDelta, d.minCallDelta, 0.05, 0.40),
    maxCallDelta: num(r.maxCallDelta, d.maxCallDelta, 0.20, 0.70),
    skipThresholdPct: num(r.skipThresholdPct, d.skipThresholdPct, 0, 2),
    minStrikeAtCost: bool(r.minStrikeAtCost, d.minStrikeAtCost),
    ivRvSpread: bool(r.ivRvSpread, d.ivRvSpread),
    ivRvLookback: num(r.ivRvLookback, d.ivRvLookback, 5, 60),
    ivRvMinMult: num(r.ivRvMinMult, d.ivRvMinMult, 0.5, 1.0),
    ivRvMaxMult: num(r.ivRvMaxMult, d.ivRvMaxMult, 1.0, 2.0),
    ivRvSkipBelow: num(r.ivRvSkipBelow, d.ivRvSkipBelow, 0, 2.0),
    ivRvSkipSide: oneOf(r.ivRvSkipSide, d.ivRvSkipSide, ["both", "put"]),
    rollCall: bool(r.rollCall, d.rollCall),
    rollITMThreshold: num(r.rollITMThreshold, d.rollITMThreshold, 1, 20),
    rollRequireCredit: bool(r.rollRequireCredit, d.rollRequireCredit),
    rollPut: bool(r.rollPut, d.rollPut),
    rollPutInitialDTE: num(r.rollPutInitialDTE, d.rollPutInitialDTE, 14, 60),
    rollPutWhenBelow: num(r.rollPutWhenBelow, d.rollPutWhenBelow, 7, 30),
    rollPutRequireCredit: bool(r.rollPutRequireCredit, d.rollPutRequireCredit),
    stopLoss: bool(r.stopLoss, d.stopLoss),
    stopLossDrawdown: num(r.stopLossDrawdown, d.stopLossDrawdown, 5, 50),
    stopLossCooldown: num(r.stopLossCooldown, d.stopLossCooldown, 0, 30),
    sizingMode: oneOf(r.sizingMode, d.sizingMode, ["none", "volScaled"]),
    sizingVolTarget: num(r.sizingVolTarget, d.sizingVolTarget, 10, 100),
    sizingVolLookback: num(r.sizingVolLookback, d.sizingVolLookback, 10, 120),
    sizingMinSize: num(r.sizingMinSize, d.sizingMinSize, 0.01, 1.0),
    sizingColdStartDays: num(r.sizingColdStartDays, d.sizingColdStartDays, 0, 120),
    sizingColdStartSize: num(r.sizingColdStartSize, d.sizingColdStartSize, 0.01, 1.0)
  };
}

export const MARKET_BUILT_INS: Preset<MarketPresetValues>[] = [
  {
    name: "Default",
    values: defaultMarketValues(),
    builtIn: true,
    createdAt: "2024-01-01T00:00:00.000Z"
  },
  {
    name: "Bull Run",
    values: {
      ...defaultMarketValues(),
      annualDrift: 120,
      annualVol: 60,
      model: "gbm"
    },
    builtIn: true,
    createdAt: "2024-01-01T00:00:00.000Z"
  },
  {
    name: "Bear Market",
    values: {
      ...defaultMarketValues(),
      annualDrift: -70,
      annualVol: 110,
      model: "heston-jump",
      rho: -0.8,
      lambda: 15,
      muJ: -0.15,
      sigmaJ: 0.10
    },
    builtIn: true,
    createdAt: "2024-01-01T00:00:00.000Z"
  },
  {
    name: "High-Vol Sideways",
    values: {
      ...defaultMarketValues(),
      annualDrift: 0,
      annualVol: 150,
      model: "heston",
      rho: -0.6
    },
    builtIn: true,
    createdAt: "2024-01-01T00:00:00.000Z"
  },
  {
    name: "Calm Market",
    values: {
      ...defaultMarketValues(),
      annualDrift: 5,
      annualVol: 30,
      model: "gbm"
    },
    builtIn: true,
    createdAt: "2024-01-01T00:00:00.000Z"
  },
  {
    name: "Crash Scenario",
    values: {
      ...defaultMarketValues(),
      model: "heston-jump",
      annualDrift: -30,
      annualVol: 100,
      lambda: 20,
      muJ: -0.20,
      sigmaJ: 0.15,
      rho: -0.9
    },
    builtIn: true,
    createdAt: "2024-01-01T00:00:00.000Z"
  }
];

export const STRATEGY_BUILT_INS: Preset<StrategyPresetValues>[] = [
  {
    name: "Default",
    values: defaultStrategyValues(),
    builtIn: true,
    createdAt: "2024-01-01T00:00:00.000Z"
  },
  {
    name: "Conservative",
    values: {
      ...defaultStrategyValues(),
      targetDelta: 0.10,
      cycleLengthDays: 30,
      adaptiveCalls: true,
      minCallDelta: 0.10,
      maxCallDelta: 0.50,
      skipThresholdPct: 0,
      minStrikeAtCost: true,
      ivRvSpread: true,
      ivRvLookback: 45,
      ivRvSkipBelow: 1.1,
      ivRvSkipSide: "put",
      rollPut: true,
      rollPutInitialDTE: 30,
      rollPutWhenBelow: 14,
      rollPutRequireCredit: true,
      stopLoss: false,
      rollCall: false,
      sizingMode: "volScaled",
      sizingVolTarget: 40,
      sizingVolLookback: 45,
      sizingMinSize: 0.10,
      sizingColdStartDays: 45,
      sizingColdStartSize: 0.50
    },
    builtIn: true,
    createdAt: "2024-01-01T00:00:00.000Z"
  },
  {
    name: "Aggressive",
    values: {
      ...defaultStrategyValues(),
      targetDelta: 0.20,
      cycleLengthDays: 3,
      adaptiveCalls: false,
      ivRvSpread: true,
      ivRvSkipBelow: 1.2,
      ivRvSkipSide: "put",
      rollPut: false,
      rollCall: false,
      stopLoss: false,
      sizingMode: "volScaled",
      sizingVolTarget: 40,
      sizingVolLookback: 45,
      sizingMinSize: 0.10
    },
    builtIn: true,
    createdAt: "2024-01-01T00:00:00.000Z"
  }
];

function readRawStore(
  key: string,
  storage: StorageBackend
): { rawPresets: Array<Record<string, unknown>>; defaultPresetName: string | null } {
  try {
    const raw = storage.getItem(key);
    if (!raw) return { rawPresets: [], defaultPresetName: null };
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return { rawPresets: [], defaultPresetName: null };
    const p = parsed as Record<string, unknown>;
    const rawPresets = Array.isArray(p.presets)
      ? (p.presets as unknown[]).filter(x => typeof x === "object" && x !== null) as Array<Record<string, unknown>>
      : [];
    const defaultPresetName = typeof p.defaultPresetName === "string" ? p.defaultPresetName : null;
    return { rawPresets, defaultPresetName };
  } catch {
    return { rawPresets: [], defaultPresetName: null };
  }
}

export function loadPresetStore<T>(
  key: string,
  builtIns: Preset<T>[],
  validate: (raw: unknown) => T,
  storage?: StorageBackend
): PresetStore<T> {
  const store = getStorage(storage);
  const { rawPresets, defaultPresetName } = readRawStore(key, store);
  const userPresets: Preset<T>[] = rawPresets
    .filter(p => typeof p.name === "string")
    .map(p => ({
      name: p.name as string,
      values: validate(p.values),
      builtIn: false,
      createdAt: typeof p.createdAt === "string" ? p.createdAt : new Date().toISOString()
    }));
  const userNames = new Set(userPresets.map(p => p.name));
  const merged = [
    ...builtIns.filter(b => !userNames.has(b.name)),
    ...userPresets
  ];
  return { presets: merged, defaultPresetName };
}

export function savePreset<T>(
  key: string,
  name: string,
  values: T,
  storage?: StorageBackend
): void {
  const store = getStorage(storage);
  const { rawPresets, defaultPresetName } = readRawStore(key, store);
  const idx = rawPresets.findIndex(p => p.name === name);
  const preset = { name, values, builtIn: false, createdAt: new Date().toISOString() };
  if (idx >= 0) {
    rawPresets[idx] = preset;
  } else {
    rawPresets.push(preset);
  }
  store.setItem(key, JSON.stringify({ presets: rawPresets, defaultPresetName }));
}

export function deletePreset(key: string, name: string, storage?: StorageBackend): void {
  const store = getStorage(storage);
  const { rawPresets, defaultPresetName } = readRawStore(key, store);
  const filtered = rawPresets.filter(p => p.name !== name);
  const newDefault = defaultPresetName === name ? null : defaultPresetName;
  store.setItem(key, JSON.stringify({ presets: filtered, defaultPresetName: newDefault }));
}

export function setDefaultPreset(key: string, name: string | null, storage?: StorageBackend): void {
  const store = getStorage(storage);
  const { rawPresets } = readRawStore(key, store);
  store.setItem(key, JSON.stringify({ presets: rawPresets, defaultPresetName: name }));
}

export function getMarketDefaults(storage?: StorageBackend): MarketPresetValues {
  const s = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
  if (s.defaultPresetName) {
    const preset = s.presets.find(p => p.name === s.defaultPresetName);
    if (preset) return preset.values;
  }
  return defaultMarketValues();
}

export function getStrategyDefaults(storage?: StorageBackend): StrategyPresetValues {
  const s = loadPresetStore(STRATEGY_KEY, STRATEGY_BUILT_INS, validateStrategyValues, storage);
  if (s.defaultPresetName) {
    const preset = s.presets.find(p => p.name === s.defaultPresetName);
    if (preset) return preset.values;
  }
  return defaultStrategyValues();
}
