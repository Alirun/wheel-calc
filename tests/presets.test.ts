import {describe, it, expect, beforeEach} from "vitest";
import {
  defaultMarketValues,
  defaultStrategyValues,
  validateMarketValues,
  validateStrategyValues,
  loadPresetStore,
  savePreset,
  deletePreset,
  setDefaultPreset,
  getMarketDefaults,
  getStrategyDefaults,
  MARKET_KEY,
  STRATEGY_KEY,
  MARKET_BUILT_INS,
  STRATEGY_BUILT_INS
} from "../src/components/presets.js";
import type {StorageBackend, MarketPresetValues, StrategyPresetValues} from "../src/components/presets.js";

function makeStorage(): StorageBackend & {store: Record<string, string>} {
  const store: Record<string, string> = {};
  return {
    store,
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = value; }
  };
}

describe("defaultMarketValues", () => {
  it("returns correct shape", () => {
    const v = defaultMarketValues();
    expect(v.startPrice).toBe(2500);
    expect(v.days).toBe(30);
    expect(v.annualVol).toBe(80);
    expect(v.annualDrift).toBe(0);
    expect(v.numSimulations).toBe(200);
    expect(v.model).toBe("gbm");
    expect(v.kappa).toBe(2.0);
    expect(v.theta).toBe(0.64);
    expect(v.sigma).toBe(0.5);
    expect(v.rho).toBe(-0.7);
    expect(v.lambda).toBe(10);
    expect(v.muJ).toBe(0);
    expect(v.sigmaJ).toBe(0.05);
    expect(v.riskFreeRate).toBe(5);
    expect(v.bidAskSpreadPct).toBe(5);
    expect(v.feePerTrade).toBe(0.50);
  });

  it("returns a new object each call", () => {
    expect(defaultMarketValues()).not.toBe(defaultMarketValues());
  });
});

describe("defaultStrategyValues", () => {
  it("returns correct shape", () => {
    const v = defaultStrategyValues();
    expect(v.targetDelta).toBe(0.30);
    expect(v.ivPremiumPct).toBe(15);
    expect(v.cycleLengthDays).toBe(7);
    expect(v.contracts).toBe(1);
    expect(v.adaptiveCalls).toBe(true);
    expect(v.minCallDelta).toBe(0.10);
    expect(v.maxCallDelta).toBe(0.50);
    expect(v.skipThresholdPct).toBe(0.1);
    expect(v.minStrikeAtCost).toBe(true);
    expect(v.ivRvSpread).toBe(true);
    expect(v.ivRvLookback).toBe(20);
    expect(v.ivRvMinMult).toBe(0.8);
    expect(v.ivRvMaxMult).toBe(1.3);
    expect(v.rollCall).toBe(false);
    expect(v.rollITMThreshold).toBe(5);
    expect(v.rollRequireCredit).toBe(true);
    expect(v.rollPut).toBe(false);
    expect(v.rollPutInitialDTE).toBe(30);
    expect(v.rollPutWhenBelow).toBe(14);
    expect(v.rollPutRequireCredit).toBe(true);
    expect(v.stopLoss).toBe(false);
    expect(v.stopLossDrawdown).toBe(30);
    expect(v.stopLossCooldown).toBe(7);
  });
});

describe("validateMarketValues", () => {
  it("passes valid values through", () => {
    const v = defaultMarketValues();
    expect(validateMarketValues(v)).toEqual(v);
  });

  it("fills missing fields from defaults", () => {
    const result = validateMarketValues({});
    expect(result).toEqual(defaultMarketValues());
  });

  it("clamps values to range", () => {
    const result = validateMarketValues({startPrice: 100, days: 1000, annualVol: 999, annualDrift: 200});
    expect(result.startPrice).toBe(500);
    expect(result.days).toBe(365);
    expect(result.annualVol).toBe(200);
    expect(result.annualDrift).toBe(100);
  });

  it("clamps negative values to range minimum", () => {
    const result = validateMarketValues({startPrice: -100, numSimulations: 1});
    expect(result.startPrice).toBe(500);
    expect(result.numSimulations).toBe(10);
  });

  it("rejects invalid model string, falls back to default", () => {
    const result = validateMarketValues({model: "invalid"});
    expect(result.model).toBe("gbm");
  });

  it("accepts valid model strings", () => {
    expect(validateMarketValues({model: "heston"}).model).toBe("heston");
    expect(validateMarketValues({model: "jump"}).model).toBe("jump");
    expect(validateMarketValues({model: "heston-jump"}).model).toBe("heston-jump");
  });

  it("handles non-finite numbers by using defaults", () => {
    const result = validateMarketValues({startPrice: NaN, days: Infinity, annualVol: -Infinity});
    expect(result.startPrice).toBe(defaultMarketValues().startPrice);
    expect(result.days).toBe(defaultMarketValues().days);
    expect(result.annualVol).toBe(defaultMarketValues().annualVol);
  });

  it("handles null input", () => {
    expect(validateMarketValues(null)).toEqual(defaultMarketValues());
  });

  it("handles string input", () => {
    expect(validateMarketValues("bad")).toEqual(defaultMarketValues());
  });

  it("strips unknown fields", () => {
    const result = validateMarketValues({startPrice: 3000, unknownField: "foo"}) as unknown as Record<string, unknown>;
    expect(result.unknownField).toBeUndefined();
    expect(result.startPrice).toBe(3000);
  });
});

describe("validateStrategyValues", () => {
  it("passes valid values through", () => {
    const v = defaultStrategyValues();
    expect(validateStrategyValues(v)).toEqual(v);
  });

  it("fills missing fields from defaults", () => {
    expect(validateStrategyValues({})).toEqual(defaultStrategyValues());
  });

  it("clamps values to range", () => {
    const result = validateStrategyValues({targetDelta: 1.0, cycleLengthDays: 100, stopLossDrawdown: 99});
    expect(result.targetDelta).toBe(0.50);
    expect(result.cycleLengthDays).toBe(30);
    expect(result.stopLossDrawdown).toBe(50);
  });

  it("handles boolean fields correctly", () => {
    const result = validateStrategyValues({adaptiveCalls: false, ivRvSpread: false, rollCall: true, stopLoss: true});
    expect(result.adaptiveCalls).toBe(false);
    expect(result.ivRvSpread).toBe(false);
    expect(result.rollCall).toBe(true);
    expect(result.stopLoss).toBe(true);
  });

  it("rejects non-boolean for boolean fields, falls back to default", () => {
    const result = validateStrategyValues({adaptiveCalls: "yes", rollCall: 1, stopLoss: null});
    expect(result.adaptiveCalls).toBe(defaultStrategyValues().adaptiveCalls);
    expect(result.rollCall).toBe(defaultStrategyValues().rollCall);
    expect(result.stopLoss).toBe(defaultStrategyValues().stopLoss);
  });

  it("handles null and corrupt input", () => {
    expect(validateStrategyValues(null)).toEqual(defaultStrategyValues());
    expect(validateStrategyValues("corrupt")).toEqual(defaultStrategyValues());
    expect(validateStrategyValues(42)).toEqual(defaultStrategyValues());
  });
});

describe("loadPresetStore", () => {
  it("returns built-ins when storage is empty", () => {
    const storage = makeStorage();
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    expect(store.presets).toHaveLength(MARKET_BUILT_INS.length);
    expect(store.presets.map(p => p.name)).toEqual(MARKET_BUILT_INS.map(p => p.name));
    expect(store.defaultPresetName).toBeNull();
  });

  it("marks built-ins with builtIn: true", () => {
    const storage = makeStorage();
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    expect(store.presets.every(p => p.builtIn)).toBe(true);
  });

  it("merges user presets with built-ins", () => {
    const storage = makeStorage();
    savePreset(MARKET_KEY, "My Preset", defaultMarketValues(), storage);
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    expect(store.presets).toHaveLength(MARKET_BUILT_INS.length + 1);
    expect(store.presets.find(p => p.name === "My Preset")).toBeDefined();
    expect(store.presets.find(p => p.name === "My Preset")?.builtIn).toBe(false);
  });

  it("user preset overrides built-in with same name", () => {
    const storage = makeStorage();
    const customDefault: MarketPresetValues = {...defaultMarketValues(), startPrice: 7500};
    savePreset(MARKET_KEY, "Default", customDefault, storage);
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    const defaultPreset = store.presets.find(p => p.name === "Default");
    expect(defaultPreset).toBeDefined();
    expect(defaultPreset?.values.startPrice).toBe(7500);
    expect(defaultPreset?.builtIn).toBe(false);
    expect(store.presets.filter(p => p.name === "Default")).toHaveLength(1);
  });

  it("returns defaultPresetName from storage", () => {
    const storage = makeStorage();
    setDefaultPreset(MARKET_KEY, "High Vol", storage);
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    expect(store.defaultPresetName).toBe("High Vol");
  });

  it("falls back to built-ins on corrupt JSON", () => {
    const storage = makeStorage();
    storage.store[MARKET_KEY] = "{not valid json{{";
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    expect(store.presets.map(p => p.name)).toEqual(MARKET_BUILT_INS.map(p => p.name));
    expect(store.defaultPresetName).toBeNull();
  });

  it("falls back to built-ins when stored value is wrong type", () => {
    const storage = makeStorage();
    storage.store[MARKET_KEY] = JSON.stringify("a string");
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    expect(store.presets.map(p => p.name)).toEqual(MARKET_BUILT_INS.map(p => p.name));
  });

  it("validates and sanitizes stored preset values", () => {
    const storage = makeStorage();
    storage.store[MARKET_KEY] = JSON.stringify({
      presets: [{name: "Bad", values: {startPrice: 999999, model: "invalid"}, createdAt: "2024-01-01"}],
      defaultPresetName: null
    });
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    const bad = store.presets.find(p => p.name === "Bad");
    expect(bad?.values.startPrice).toBe(8000);
    expect(bad?.values.model).toBe("gbm");
  });

  it("skips presets with missing name", () => {
    const storage = makeStorage();
    storage.store[MARKET_KEY] = JSON.stringify({
      presets: [{values: {startPrice: 1000}}, {name: "Good", values: {}}],
      defaultPresetName: null
    });
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    expect(store.presets.find(p => p.name === "Good")).toBeDefined();
    expect(store.presets.every(p => typeof p.name === "string")).toBe(true);
  });
});

describe("savePreset", () => {
  it("saves a new preset to storage", () => {
    const storage = makeStorage();
    const vals = {...defaultMarketValues(), startPrice: 3500};
    savePreset(MARKET_KEY, "Test", vals, storage);
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    const saved = store.presets.find(p => p.name === "Test");
    expect(saved?.values.startPrice).toBe(3500);
  });

  it("overwrites an existing preset", () => {
    const storage = makeStorage();
    savePreset(MARKET_KEY, "Test", {...defaultMarketValues(), startPrice: 3500}, storage);
    savePreset(MARKET_KEY, "Test", {...defaultMarketValues(), startPrice: 4000}, storage);
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    const saved = store.presets.filter(p => p.name === "Test");
    expect(saved).toHaveLength(1);
    expect(saved[0].values.startPrice).toBe(4000);
  });

  it("preserves other presets when saving", () => {
    const storage = makeStorage();
    savePreset(MARKET_KEY, "A", defaultMarketValues(), storage);
    savePreset(MARKET_KEY, "B", defaultMarketValues(), storage);
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    expect(store.presets.find(p => p.name === "A")).toBeDefined();
    expect(store.presets.find(p => p.name === "B")).toBeDefined();
  });

  it("preserves defaultPresetName when saving", () => {
    const storage = makeStorage();
    setDefaultPreset(MARKET_KEY, "High Vol", storage);
    savePreset(MARKET_KEY, "NewPreset", defaultMarketValues(), storage);
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    expect(store.defaultPresetName).toBe("High Vol");
  });
});

describe("deletePreset", () => {
  it("removes a user preset", () => {
    const storage = makeStorage();
    savePreset(MARKET_KEY, "ToDelete", defaultMarketValues(), storage);
    deletePreset(MARKET_KEY, "ToDelete", storage);
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    expect(store.presets.find(p => p.name === "ToDelete")).toBeUndefined();
  });

  it("does nothing when preset doesn't exist in storage", () => {
    const storage = makeStorage();
    savePreset(MARKET_KEY, "Keep", defaultMarketValues(), storage);
    deletePreset(MARKET_KEY, "NonExistent", storage);
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    expect(store.presets.find(p => p.name === "Keep")).toBeDefined();
  });

  it("clears defaultPresetName when deleted preset was default", () => {
    const storage = makeStorage();
    savePreset(MARKET_KEY, "MyDefault", defaultMarketValues(), storage);
    setDefaultPreset(MARKET_KEY, "MyDefault", storage);
    deletePreset(MARKET_KEY, "MyDefault", storage);
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    expect(store.defaultPresetName).toBeNull();
  });

  it("preserves defaultPresetName when a different preset is deleted", () => {
    const storage = makeStorage();
    savePreset(MARKET_KEY, "Keep", defaultMarketValues(), storage);
    savePreset(MARKET_KEY, "Delete", defaultMarketValues(), storage);
    setDefaultPreset(MARKET_KEY, "Keep", storage);
    deletePreset(MARKET_KEY, "Delete", storage);
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    expect(store.defaultPresetName).toBe("Keep");
  });

  it("built-in presets reappear after user attempts to delete them via storage", () => {
    const storage = makeStorage();
    // Simulate direct storage deletion of a built-in by name (no user copy)
    deletePreset(MARKET_KEY, "Default", storage);
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    // Built-in reappears since it was never in storage
    expect(store.presets.find(p => p.name === "Default")).toBeDefined();
  });
});

describe("setDefaultPreset", () => {
  it("sets the default preset name", () => {
    const storage = makeStorage();
    setDefaultPreset(MARKET_KEY, "High Vol", storage);
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    expect(store.defaultPresetName).toBe("High Vol");
  });

  it("clears the default when set to null", () => {
    const storage = makeStorage();
    setDefaultPreset(MARKET_KEY, "High Vol", storage);
    setDefaultPreset(MARKET_KEY, null, storage);
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    expect(store.defaultPresetName).toBeNull();
  });

  it("preserves existing user presets", () => {
    const storage = makeStorage();
    savePreset(MARKET_KEY, "Mine", defaultMarketValues(), storage);
    setDefaultPreset(MARKET_KEY, "Mine", storage);
    const store = loadPresetStore(MARKET_KEY, MARKET_BUILT_INS, validateMarketValues, storage);
    expect(store.presets.find(p => p.name === "Mine")).toBeDefined();
    expect(store.defaultPresetName).toBe("Mine");
  });
});

describe("getMarketDefaults", () => {
  it("returns hardcoded defaults when no storage data", () => {
    const storage = makeStorage();
    expect(getMarketDefaults(storage)).toEqual(defaultMarketValues());
  });

  it("returns hardcoded defaults when default preset name is not set", () => {
    const storage = makeStorage();
    savePreset(MARKET_KEY, "Custom", {...defaultMarketValues(), startPrice: 9000}, storage);
    expect(getMarketDefaults(storage)).toEqual(defaultMarketValues());
  });

  it("returns default preset values when one is set", () => {
    const storage = makeStorage();
    const highVol = MARKET_BUILT_INS.find(p => p.name === "High Vol")!;
    setDefaultPreset(MARKET_KEY, "High Vol", storage);
    expect(getMarketDefaults(storage)).toEqual(highVol.values);
  });

  it("returns user preset values when user preset is set as default", () => {
    const storage = makeStorage();
    const custom: MarketPresetValues = {...defaultMarketValues(), startPrice: 5000, days: 90};
    savePreset(MARKET_KEY, "My Config", custom, storage);
    setDefaultPreset(MARKET_KEY, "My Config", storage);
    const result = getMarketDefaults(storage);
    expect(result.startPrice).toBe(5000);
    expect(result.days).toBe(90);
  });

  it("returns hardcoded defaults when default preset name points to non-existent preset", () => {
    const storage = makeStorage();
    setDefaultPreset(MARKET_KEY, "Ghost Preset", storage);
    expect(getMarketDefaults(storage)).toEqual(defaultMarketValues());
  });

  it("returns hardcoded defaults when storage is corrupt", () => {
    const storage = makeStorage();
    storage.store[MARKET_KEY] = "INVALID_JSON";
    expect(getMarketDefaults(storage)).toEqual(defaultMarketValues());
  });
});

describe("getStrategyDefaults", () => {
  it("returns hardcoded defaults when no storage data", () => {
    const storage = makeStorage();
    expect(getStrategyDefaults(storage)).toEqual(defaultStrategyValues());
  });

  it("returns default preset values when one is set", () => {
    const storage = makeStorage();
    const conservative = STRATEGY_BUILT_INS.find(p => p.name === "Conservative")!;
    setDefaultPreset(STRATEGY_KEY, "Conservative", storage);
    expect(getStrategyDefaults(storage)).toEqual(conservative.values);
  });

  it("returns user strategy preset when set as default", () => {
    const storage = makeStorage();
    const custom: StrategyPresetValues = {...defaultStrategyValues(), targetDelta: 0.45, rollCall: true};
    savePreset(STRATEGY_KEY, "Custom Strategy", custom, storage);
    setDefaultPreset(STRATEGY_KEY, "Custom Strategy", storage);
    const result = getStrategyDefaults(storage);
    expect(result.targetDelta).toBe(0.45);
    expect(result.rollCall).toBe(true);
  });

  it("returns hardcoded defaults on corrupt storage", () => {
    const storage = makeStorage();
    storage.store[STRATEGY_KEY] = "{bad}";
    expect(getStrategyDefaults(storage)).toEqual(defaultStrategyValues());
  });
});

describe("no-storage fallback (getStorage)", () => {
  it("getMarketDefaults without storage arg uses fallback (no localStorage in test env)", () => {
    // In Node.js test environment localStorage is undefined, so FALLBACK_STORAGE is used.
    // Both getItem (returns null) and setItem (noop) paths are exercised.
    const result = getMarketDefaults();
    expect(result).toEqual(defaultMarketValues());
  });

  it("getStrategyDefaults without storage arg returns hardcoded defaults", () => {
    const result = getStrategyDefaults();
    expect(result).toEqual(defaultStrategyValues());
  });
});

describe("strategy built-in presets", () => {
  it("Conservative preset has expected values", () => {
    const cons = STRATEGY_BUILT_INS.find(p => p.name === "Conservative")!;
    expect(cons.values.targetDelta).toBe(0.15);
    expect(cons.values.stopLoss).toBe(true);
    expect(cons.values.adaptiveCalls).toBe(true);
  });

  it("Aggressive preset has expected values", () => {
    const agg = STRATEGY_BUILT_INS.find(p => p.name === "Aggressive")!;
    expect(agg.values.targetDelta).toBe(0.40);
    expect(agg.values.rollCall).toBe(true);
    expect(agg.values.rollPut).toBe(true);
  });
});

describe("market built-in presets", () => {
  it("High Vol preset has expected model and vol", () => {
    const hv = MARKET_BUILT_INS.find(p => p.name === "High Vol")!;
    expect(hv.values.annualVol).toBe(150);
    expect(hv.values.model).toBe("heston");
  });

  it("Crash Scenario preset has expected model and drift", () => {
    const crash = MARKET_BUILT_INS.find(p => p.name === "Crash Scenario")!;
    expect(crash.values.model).toBe("jump");
    expect(crash.values.annualDrift).toBe(-30);
  });
});
