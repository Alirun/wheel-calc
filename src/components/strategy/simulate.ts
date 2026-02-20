import type {
  MarketSnapshot,
  StrategyConfig,
  SignalLogEntry,
  DailyState,
  SimulationResult,
} from "./types.js";
import type {Rule} from "./rules.js";
import {initialPortfolio, snapshotPortfolio, applyEvents, toDailyState} from "./state.js";
import {evaluateRules, isDecisionPoint} from "./strategy.js";
import {SimExecutor} from "./executor.js";

export function computeRealizedVol(prices: number[], day: number, lookback: number): number | undefined {
  if (day < lookback) return undefined;
  const logReturns: number[] = [];
  for (let i = day - lookback + 1; i <= day; i++) {
    logReturns.push(Math.log(prices[i] / prices[i - 1]));
  }
  const mean = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
  const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (logReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(365);
}

export function simulate(
  prices: number[],
  rules: Rule[],
  config: StrategyConfig,
  ivPath?: number[],
): SimulationResult {
  let portfolio = initialPortfolio();
  const executor = new SimExecutor();
  const signalLog: SignalLogEntry[] = [];
  const dailyStates: DailyState[] = [];

  for (let day = 0; day < prices.length; day++) {
    const rv = config.ivRvSpread
      ? computeRealizedVol(prices, day, config.ivRvSpread.lookbackDays)
      : undefined;
    const market: MarketSnapshot = {day, spot: prices[day], iv: ivPath?.[day], realizedVol: rv};

    const decisionPoint = isDecisionPoint(day, portfolio);
    const rollTrigger = !decisionPoint
      && config.rollCall
      && portfolio.phase === "short_call"
      && !!portfolio.openOption
      && market.spot >= portfolio.openOption.strike * (1 + config.rollCall.itmThresholdPct);

    if (decisionPoint || rollTrigger) {
      const before = snapshotPortfolio(portfolio);

      if (portfolio.openOption && day >= portfolio.openOption.expiryDay) {
        const expiryEvents = executor.resolveExpiration(market, portfolio, config);
        portfolio = applyEvents(portfolio, expiryEvents);

        signalLog.push({
          day,
          market,
          portfolioBefore: before,
          signal: {action: "HOLD"},
          events: expiryEvents,
          portfolioAfter: snapshotPortfolio(portfolio),
        });
      }

      const beforeSignal = snapshotPortfolio(portfolio);
      const signal = evaluateRules(rules, market, portfolio, config);

      if (signal.action !== "HOLD") {
        const execEvents = executor.execute(signal, market, portfolio, config);
        portfolio = applyEvents(portfolio, execEvents);

        signalLog.push({
          day,
          market,
          portfolioBefore: beforeSignal,
          signal,
          events: execEvents,
          portfolioAfter: snapshotPortfolio(portfolio),
        });
      }
    }

    dailyStates.push(toDailyState(market, portfolio, config.contracts));
  }

  return {
    signalLog,
    dailyStates,
    summary: {
      totalRealizedPL: portfolio.realizedPL,
      totalPremiumCollected: portfolio.totalPremiumCollected,
      totalAssignments: portfolio.totalAssignments,
      totalSkippedCycles: portfolio.totalSkippedCycles,
    },
  };
}
