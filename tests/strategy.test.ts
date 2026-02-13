import {describe, it, expect} from "vitest";
import {evaluateRules, isDecisionPoint} from "../src/components/strategy/strategy.js";
import {initialPortfolio} from "../src/components/strategy/state.js";
import type {Rule} from "../src/components/strategy/rules.js";
import type {MarketSnapshot, PortfolioState, StrategyConfig, Signal} from "../src/components/strategy/types.js";

const market: MarketSnapshot = {day: 0, spot: 2500};
const config: StrategyConfig = {
  targetDelta: 0.30, impliedVol: 0.92, riskFreeRate: 0.05,
  cycleLengthDays: 7, contracts: 1, bidAskSpreadPct: 0.05, feePerTrade: 0.50,
};

function makeRule(name: string, priority: number, signal: Signal | null): Rule {
  return {
    name,
    description: "test",
    phase: "idle_cash",
    priority,
    evaluate: () => signal,
  };
}

describe("evaluateRules", () => {
  it("returns first non-null signal in priority order", () => {
    const rules: Rule[] = [
      makeRule("B", 100, {action: "SELL_PUT", strike: 2400, delta: 0.3, premium: 50, rule: "B", reason: ""}),
      makeRule("A", 50, {action: "SKIP", rule: "A", reason: "low premium"}),
    ];
    const sig = evaluateRules(rules, market, initialPortfolio(), config);
    expect(sig.action).toBe("SKIP");
  });

  it("returns HOLD when all rules return null", () => {
    const rules: Rule[] = [
      makeRule("X", 10, null),
      makeRule("Y", 20, null),
    ];
    const sig = evaluateRules(rules, market, initialPortfolio(), config);
    expect(sig.action).toBe("HOLD");
  });

  it("lower priority number evaluates first", () => {
    const rules: Rule[] = [
      makeRule("High", 100, {action: "SELL_PUT", strike: 2400, delta: 0.3, premium: 50, rule: "High", reason: ""}),
      makeRule("Low", 10, {action: "CLOSE_POSITION", rule: "Low", reason: "stop-loss"}),
    ];
    const sig = evaluateRules(rules, market, initialPortfolio(), config);
    expect(sig.action).toBe("CLOSE_POSITION");
  });
});

describe("isDecisionPoint", () => {
  it("returns true when no open option", () => {
    expect(isDecisionPoint(0, initialPortfolio())).toBe(true);
  });

  it("returns true when option has expired", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "short_put",
      openOption: {type: "put", strike: 2400, delta: 0.3, premium: 50, openDay: 0, expiryDay: 7},
    };
    expect(isDecisionPoint(7, p)).toBe(true);
    expect(isDecisionPoint(10, p)).toBe(true);
  });

  it("returns false mid-cycle", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "short_put",
      openOption: {type: "put", strike: 2400, delta: 0.3, premium: 50, openDay: 0, expiryDay: 7},
    };
    expect(isDecisionPoint(3, p)).toBe(false);
    expect(isDecisionPoint(6, p)).toBe(false);
  });
});
