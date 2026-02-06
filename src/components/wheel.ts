// Wheel strategy simulation engine.
// Pure TypeScript — no framework dependencies.
// Designed for reuse in backtesting and live trading.

export interface WheelConfig {
  strikeOffsetPct: number; // e.g. 0.05 = 5% OTM
  premiumPct: number; // e.g. 0.03 = 3% of strike
  cycleLengthDays: number; // e.g. 7
  contracts: number; // ETH per contract
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
  const { strikeOffsetPct, premiumPct, cycleLengthDays, contracts } = config;

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

  function openCycle(day: number) {
    const spot = prices[day];
    if (phase === "selling_put") {
      strike = spot * (1 - strikeOffsetPct);
      premium = strike * premiumPct;
    } else {
      strike = spot * (1 + strikeOffsetPct);
      premium = strike * premiumPct;
    }
    cycleStartDay = day;
  }

  // Open initial cycle
  openCycle(0);

  for (let day = 0; day < prices.length; day++) {
    const price = prices[day];
    const daysSinceCycleStart = day - cycleStartDay;

    // Check expiration
    if (daysSinceCycleStart >= cycleLengthDays && day > 0) {
      if (phase === "selling_put") {
        const assigned = price < strike;
        const tradePL = assigned
          ? (premium - (strike - price)) * contracts
          : premium * contracts;

        trades.push({
          type: "put",
          strike,
          premium,
          startDay: cycleStartDay,
          endDay: day,
          assigned,
          pl: tradePL,
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
        let tradePL: number;

        if (assigned) {
          // Sell ETH at strike, realize gain/loss on ETH + premium
          tradePL =
            (premium + (strike - (entryPrice as number))) * contracts;
          entryPrice = null;
          phase = "selling_put";
          totalAssignments++;
        } else {
          // Keep premium, still hold ETH
          tradePL = premium * contracts;
        }

        trades.push({
          type: "call",
          strike,
          premium,
          startDay: cycleStartDay,
          endDay: day,
          assigned,
          pl: tradePL,
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
