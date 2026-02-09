// Wheel strategy simulation engine.
// Pure TypeScript — no framework dependencies.
// Designed for reuse in backtesting and live trading.

import {
  bsCallPrice,
  bsPutPrice,
  bsCallDelta,
  bsPutDelta,
  findStrikeForDelta,
} from "./black-scholes.js";

export interface WheelConfig {
  targetDelta: number; // e.g. 0.30 = 30-delta
  impliedVol: number; // annualized IV for pricing (e.g. 0.92 = 92%)
  riskFreeRate: number; // e.g. 0.05 = 5%
  cycleLengthDays: number; // e.g. 7
  contracts: number; // ETH per contract
  bidAskSpreadPct: number; // e.g. 0.05 = 5% haircut on premium
  feePerTrade: number; // USD per contract per trade
}

export type Phase = "selling_put" | "selling_call";

export interface TradeRecord {
  type: "put" | "call";
  strike: number;
  premium: number;
  startDay: number;
  endDay: number;
  assigned: boolean;
  pl: number; // realized P/L for this trade (per-contract × contracts)
  spotAtOpen: number; // spot price when the option was sold
  spotAtExpiration: number; // spot price at expiration
  entryPrice: number | null; // ETH cost basis (strike of the PUT that got assigned), null if not holding
  impliedVol: number; // IV used for this trade
  delta: number; // delta of the option at open
}

export interface DailyState {
  day: number;
  price: number;
  phase: Phase;
  cumulativePL: number;
  unrealizedPL: number;
  holdingETH: boolean;
}

export interface SimulationResult {
  trades: TradeRecord[];
  dailyState: DailyState[];
  totalRealizedPL: number;
  totalPremiumCollected: number;
  totalAssignments: number;
}

export function simulateWheel(
  prices: number[],
  config: WheelConfig
): SimulationResult {
  const {
    targetDelta,
    impliedVol,
    riskFreeRate,
    cycleLengthDays,
    contracts,
    bidAskSpreadPct,
    feePerTrade,
  } = config;

  const trades: TradeRecord[] = [];
  const dailyState: DailyState[] = [];

  let phase: Phase = "selling_put";
  let cumulativePL = 0;
  let totalPremiumCollected = 0;
  let totalAssignments = 0;
  let entryPrice: number | null = null; // price at which ETH was acquired

  // Current cycle tracking
  let cycleStartDay = 0;
  let strike = 0;
  let premium = 0;
  let spotAtOpen = 0;
  let cycleDelta = 0;

  const T = cycleLengthDays / 365;

  function openCycle(day: number) {
    const spot = prices[day];
    spotAtOpen = spot;
    const optionType = phase === "selling_put" ? "put" : "call";

    strike = findStrikeForDelta(targetDelta, spot, T, riskFreeRate, impliedVol, optionType);

    const rawPremium =
      optionType === "put"
        ? bsPutPrice(spot, strike, T, riskFreeRate, impliedVol)
        : bsCallPrice(spot, strike, T, riskFreeRate, impliedVol);

    premium = rawPremium * (1 - bidAskSpreadPct);

    cycleDelta =
      optionType === "put"
        ? bsPutDelta(spot, strike, T, riskFreeRate, impliedVol)
        : bsCallDelta(spot, strike, T, riskFreeRate, impliedVol);

    cycleStartDay = day;
  }

  // Open initial cycle
  openCycle(0);

  for (let day = 0; day < prices.length; day++) {
    const price = prices[day];
    const daysSinceCycleStart = day - cycleStartDay;

    // Check expiration
    if (daysSinceCycleStart >= cycleLengthDays && day > 0) {
      const fees = feePerTrade * contracts;

      if (phase === "selling_put") {
        const assigned = price < strike;
        const tradePL = assigned
          ? (premium - (strike - price)) * contracts - fees
          : premium * contracts - fees;

        trades.push({
          type: "put",
          strike,
          premium,
          startDay: cycleStartDay,
          endDay: day,
          assigned,
          pl: tradePL,
          spotAtOpen,
          spotAtExpiration: price,
          entryPrice: assigned ? strike : null,
          impliedVol,
          delta: cycleDelta,
        });

        cumulativePL += tradePL;
        totalPremiumCollected += premium * contracts;

        if (assigned) {
          totalAssignments++;
          entryPrice = strike;
          phase = "selling_call";
        }
      } else {
        // selling_call
        const assigned = price >= strike;
        const costBasis = entryPrice; // capture before mutation
        let tradePL: number;

        if (assigned) {
          // Sell ETH at strike, realize gain/loss on ETH + premium
          tradePL =
            (premium + (strike - (entryPrice as number))) * contracts - fees;
          entryPrice = null;
          phase = "selling_put";
          totalAssignments++;
        } else {
          // Keep premium, still hold ETH
          tradePL = premium * contracts - fees;
        }

        trades.push({
          type: "call",
          strike,
          premium,
          startDay: cycleStartDay,
          endDay: day,
          assigned,
          pl: tradePL,
          spotAtOpen,
          spotAtExpiration: price,
          entryPrice: costBasis,
          impliedVol,
          delta: cycleDelta,
        });

        cumulativePL += tradePL;
        totalPremiumCollected += premium * contracts;
      }

      // Open next cycle
      openCycle(day);
    }

    // Compute unrealized P/L (only when holding ETH)
    const holdingETH = phase === "selling_call" && entryPrice !== null;
    const unrealizedPL = holdingETH
      ? (price - (entryPrice as number)) * contracts
      : 0;

    dailyState.push({
      day,
      price,
      phase,
      cumulativePL,
      unrealizedPL,
      holdingETH,
    });
  }

  return {
    trades,
    dailyState,
    totalRealizedPL: cumulativePL,
    totalPremiumCollected,
    totalAssignments,
  };
}
