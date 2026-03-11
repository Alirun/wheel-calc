import type {
  MarketSnapshot,
  StrategyConfig,
  PositionSizingConfig,
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

export interface CycleRecord {
  pl: number;
  isWin: boolean;
}

export function computeKellyMultiplier(
  cycles: CycleRecord[],
  fraction: number,
  lookback: number,
  minSize: number,
): number {
  if (cycles.length === 0) return 1;
  const recent = cycles.slice(-lookback);
  const wins = recent.filter(c => c.isWin);
  const losses = recent.filter(c => !c.isWin);
  if (wins.length === 0 || losses.length === 0) {
    return wins.length === 0 ? minSize : 1;
  }
  const p = wins.length / recent.length;
  const avgWin = wins.reduce((s, c) => s + c.pl, 0) / wins.length;
  const avgLoss = Math.abs(losses.reduce((s, c) => s + c.pl, 0) / losses.length);
  if (avgWin === 0 || avgLoss === 0) return minSize;
  const kelly = p - (1 - p) / (avgWin / avgLoss);
  return Math.max(minSize, Math.min(1, fraction * kelly));
}

export function computeTrailingReturnMultiplier(
  dailyStates: DailyState[],
  day: number,
  lookbackDays: number,
  thresholds: { drawdown: number; sizeMult: number }[],
  capitalAtRisk: number,
  minSize: number,
): number {
  if (day < 1 || dailyStates.length < 2 || capitalAtRisk === 0) return 1;
  const startIdx = Math.max(0, dailyStates.length - lookbackDays);
  const startPL = dailyStates[startIdx].cumulativePL + dailyStates[startIdx].unrealizedPL;
  const endPL = dailyStates[dailyStates.length - 1].cumulativePL + dailyStates[dailyStates.length - 1].unrealizedPL;
  const trailingReturn = (endPL - startPL) / capitalAtRisk;

  if (trailingReturn >= 0) return 1;

  const sorted = [...thresholds].sort((a, b) => a.drawdown - b.drawdown);
  const dd = -trailingReturn;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (dd >= sorted[i].drawdown) return Math.max(minSize, sorted[i].sizeMult);
  }
  return 1;
}

export function computeVolScaledMultiplier(
  prices: number[],
  day: number,
  volTarget: number,
  lookbackDays: number,
  minSize: number,
): number {
  const rv = computeRealizedVol(prices, day, lookbackDays);
  if (rv === undefined || rv === 0) return 1;
  return Math.max(minSize, Math.min(1, volTarget / rv));
}

export function computeSizingMultiplier(
  sizing: PositionSizingConfig,
  cycles: CycleRecord[],
  dailyStates: DailyState[],
  prices: number[],
  day: number,
  capitalAtRisk: number,
): number {
  const minSize = sizing.minSize ?? 0.1;
  switch (sizing.mode) {
    case "fractionalKelly":
      return computeKellyMultiplier(
        cycles,
        sizing.kellyFraction ?? 0.25,
        sizing.kellyLookbackTrades ?? 10,
        minSize,
      );
    case "trailingReturn":
      return computeTrailingReturnMultiplier(
        dailyStates,
        day,
        sizing.returnLookbackDays ?? 30,
        sizing.returnThresholds ?? [
          { drawdown: 0.10, sizeMult: 0.50 },
          { drawdown: 0.20, sizeMult: 0.25 },
          { drawdown: 0.30, sizeMult: 0.10 },
        ],
        capitalAtRisk,
        minSize,
      );
    case "volScaled":
      return computeVolScaledMultiplier(
        prices,
        day,
        sizing.volTarget ?? 0.60,
        sizing.volLookbackDays ?? 30,
        minSize,
      );
  }
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

  const sizing = config.positionSizing;
  const cycleRecords: CycleRecord[] = [];
  let cyclePremium = 0;
  let cycleStartPL = 0;
  const capitalAtRisk = prices[0] * config.contracts;

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
    const rollPutTrigger = !decisionPoint
      && config.rollPut
      && portfolio.phase === "short_put"
      && !!portfolio.openOption
      && (portfolio.openOption.expiryDay - day) <= config.rollPut.rollWhenDTEBelow
      && market.spot > portfolio.openOption.strike;
    const stopLossTrigger = !decisionPoint && !rollTrigger
      && config.stopLoss
      && (portfolio.phase === "holding_eth" || portfolio.phase === "short_call")
      && portfolio.position !== null
      && (portfolio.position.entryPrice - market.spot) / portfolio.position.entryPrice
         >= config.stopLoss.drawdownPct;

    if (decisionPoint || rollTrigger || rollPutTrigger || stopLossTrigger) {
      const before = snapshotPortfolio(portfolio);

      if (portfolio.openOption && day >= portfolio.openOption.expiryDay) {
        const effContracts = portfolio.openOption.contracts ?? config.contracts;
        const expiryConfig = sizing ? {...config, contracts: effContracts} : config;
        const expiryEvents = executor.resolveExpiration(market, portfolio, expiryConfig);

        if (sizing) {
          for (const e of expiryEvents) {
            if (e.type === "OPTION_EXPIRED" && e.optionType === "call" && e.assigned) {
              const cyclePL = portfolio.realizedPL - cycleStartPL;
              const plAfterSale = expiryEvents
                .filter((ev): ev is Extract<typeof ev, {type: "ETH_SOLD"}> => ev.type === "ETH_SOLD")
                .reduce((s, ev) => s + ev.pl, 0);
              const totalCyclePL = cyclePL + plAfterSale;
              cycleRecords.push({ pl: totalCyclePL, isWin: totalCyclePL > 0 });
            }
          }
        }

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
        let execConfig = config;
        if (sizing && signal.action === "SELL_PUT") {
          const mult = computeSizingMultiplier(
            sizing, cycleRecords, dailyStates, prices, day, capitalAtRisk,
          );
          execConfig = {...config, contracts: config.contracts * mult};
          cycleStartPL = portfolio.realizedPL;
          cyclePremium = 0;
        } else if (sizing && signal.action === "SELL_CALL" && portfolio.position) {
          execConfig = {...config, contracts: portfolio.position.size};
        } else if (sizing && (signal.action === "CLOSE_POSITION" || signal.action === "ROLL")) {
          const effContracts = portfolio.openOption?.contracts ?? portfolio.position?.size ?? config.contracts;
          execConfig = {...config, contracts: effContracts};
        }

        const execEvents = executor.execute(signal, market, portfolio, execConfig);
        portfolio = applyEvents(portfolio, execEvents);

        signalLog.push({
          day,
          market,
          portfolioBefore: beforeSignal,
          signal,
          events: execEvents,
          portfolioAfter: snapshotPortfolio(portfolio),
        });

        if (signal.action === "CLOSE_POSITION" && signal.rule === "StopLossRule") {
          portfolio = {...portfolio, lastStopLossDay: day, totalStopLosses: portfolio.totalStopLosses + 1};
        }
      }
    }

    const dayContracts = portfolio.position?.size ?? config.contracts;
    dailyStates.push(toDailyState(market, portfolio, dayContracts));
  }

  return {
    signalLog,
    dailyStates,
    summary: {
      totalRealizedPL: portfolio.realizedPL,
      totalPremiumCollected: portfolio.totalPremiumCollected,
      totalAssignments: portfolio.totalAssignments,
      totalSkippedCycles: portfolio.totalSkippedCycles,
      totalStopLosses: portfolio.totalStopLosses,
      totalPutRolls: portfolio.totalPutRolls,
    },
  };
}
