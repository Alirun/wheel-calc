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

export function simulate(
  prices: number[],
  rules: Rule[],
  config: StrategyConfig,
): SimulationResult {
  let portfolio = initialPortfolio();
  const executor = new SimExecutor();
  const signalLog: SignalLogEntry[] = [];
  const dailyStates: DailyState[] = [];

  for (let day = 0; day < prices.length; day++) {
    const market: MarketSnapshot = {day, spot: prices[day]};

    if (isDecisionPoint(day, portfolio)) {
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
