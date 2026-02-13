import type {MarketSnapshot, PortfolioState, StrategyConfig, Signal} from "./types.js";
import type {Rule} from "./rules.js";

export function evaluateRules(
  rules: Rule[],
  market: MarketSnapshot,
  portfolio: PortfolioState,
  config: StrategyConfig,
): Signal {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    const signal = rule.evaluate(market, portfolio, config);
    if (signal) return signal;
  }
  return {action: "HOLD"};
}

export function isDecisionPoint(
  day: number,
  portfolio: PortfolioState,
): boolean {
  if (!portfolio.openOption) return true;
  return day >= portfolio.openOption.expiryDay;
}
