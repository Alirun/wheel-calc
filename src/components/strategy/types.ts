export type Phase = "idle_cash" | "short_put" | "holding_eth" | "short_call";

export interface MarketSnapshot {
  day: number;
  spot: number;
  iv?: number;
  realizedVol?: number;
}

export interface Position {
  size: number;
  entryPrice: number;
}

export interface OpenOption {
  type: "put" | "call";
  strike: number;
  delta: number;
  premium: number;
  openDay: number;
  expiryDay: number;
}

export interface PortfolioState {
  phase: Phase;
  position: Position | null;
  openOption: OpenOption | null;
  realizedPL: number;
  totalPremiumCollected: number;
  totalAssignments: number;
  totalSkippedCycles: number;
}

export type Signal =
  | { action: "SELL_PUT"; strike: number; delta: number; premium: number;
      rule: string; reason: string }
  | { action: "SELL_CALL"; strike: number; delta: number; premium: number;
      rule: string; reason: string }
  | { action: "SKIP"; rule: string; reason: string }
  | { action: "CLOSE_POSITION"; rule: string; reason: string }
  | { action: "ROLL"; newStrike: number; newDelta: number; credit: number;
      rule: string; reason: string }
  | { action: "HOLD" };

export type Event =
  | { type: "OPTION_SOLD"; optionType: "put" | "call"; strike: number;
      premium: number; delta: number; fees: number;
      openDay: number; expiryDay: number }
  | { type: "OPTION_EXPIRED"; optionType: "put" | "call"; strike: number;
      spot: number; assigned: boolean }
  | { type: "ETH_BOUGHT"; price: number; size: number }
  | { type: "ETH_SOLD"; price: number; size: number; pl: number }
  | { type: "PREMIUM_COLLECTED"; grossPremium: number; fees: number; netAmount: number }
  | { type: "CYCLE_SKIPPED"; reason: string }
  | { type: "POSITION_CLOSED"; price: number; size: number; pl: number;
      reason: string };

export interface SignalLogEntry {
  day: number;
  market: MarketSnapshot;
  portfolioBefore: PortfolioState;
  signal: Signal;
  events: Event[];
  portfolioAfter: PortfolioState;
}

export interface AdaptiveCallsConfig {
  minDelta: number;
  maxDelta: number;
  skipThresholdPct: number;
  minStrikeAtCost?: boolean;
}

export interface IVRVSpreadConfig {
  lookbackDays: number;
  minMultiplier: number;
  maxMultiplier: number;
}

export interface StrategyConfig {
  targetDelta: number;
  impliedVol: number;
  riskFreeRate: number;
  cycleLengthDays: number;
  contracts: number;
  bidAskSpreadPct: number;
  feePerTrade: number;
  adaptiveCalls?: AdaptiveCallsConfig;
  ivRvSpread?: IVRVSpreadConfig;
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
  signalLog: SignalLogEntry[];
  dailyStates: DailyState[];
  summary: {
    totalRealizedPL: number;
    totalPremiumCollected: number;
    totalAssignments: number;
    totalSkippedCycles: number;
  };
}
