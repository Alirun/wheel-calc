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
  adaptiveCalls?: AdaptiveCallsConfig;
}

export interface AdaptiveCallsConfig {
  minDelta: number;         // min call delta when deep underwater (e.g. 0.10)
  maxDelta: number;         // max call delta when profitable (e.g. 0.50)
  skipThresholdPct: number; // skip if net premium < this % of position value
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
  totalSkippedCycles: number;
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
  let cycleActive = true;
  let totalSkippedCycles = 0;

  const T = cycleLengthDays / 365;

  // Compute call delta: adaptive if configured, otherwise fixed targetDelta
  function getCallDelta(spot: number): number {
    if (config.adaptiveCalls && entryPrice !== null) {
      const pnlPct = (spot - entryPrice) / entryPrice;
      // Map pnlPct from [-1, +1] to [0, 1]: -100% → minDelta, 0% → midpoint, +100% → maxDelta
      const t = Math.max(0, Math.min(1, (pnlPct + 1) / 2));
      const {minDelta, maxDelta} = config.adaptiveCalls;
      return minDelta + (maxDelta - minDelta) * t;
    }
    return targetDelta;
  }

  function openCycle(day: number): boolean {
    const spot = prices[day];
    spotAtOpen = spot;
    const optionType = phase === "selling_put" ? "put" : "call";

    const effectiveDelta = optionType === "call" ? getCallDelta(spot) : targetDelta;
    strike = findStrikeForDelta(effectiveDelta, spot, T, riskFreeRate, impliedVol, optionType);

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

    // Skip if call premium too low relative to position value
    if (optionType === "call" && config.adaptiveCalls && entryPrice !== null) {
      const netPremium = premium * contracts - feePerTrade * contracts;
      const positionValue = entryPrice * contracts;
      if (netPremium < config.adaptiveCalls.skipThresholdPct * positionValue) {
        totalSkippedCycles++;
        return false;
      }
    }

    return true;
  }

  // Open initial cycle
  cycleActive = openCycle(0);

  for (let day = 0; day < prices.length; day++) {
    const price = prices[day];
    const daysSinceCycleStart = day - cycleStartDay;

    // Check expiration
    if (daysSinceCycleStart >= cycleLengthDays && day > 0) {
     if (cycleActive) {
      const fees = feePerTrade * contracts;

      if (phase === "selling_put") {
        const assigned = price < strike;
        const tradePL = premium * contracts - fees;

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

     } // cycleActive

      // Open next cycle (may be skipped if call premium too low)
      cycleActive = openCycle(day);
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
    totalSkippedCycles,
  };
}
