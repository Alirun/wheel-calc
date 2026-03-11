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
  contracts?: number;
}

export interface PortfolioState {
  phase: Phase;
  position: Position | null;
  openOption: OpenOption | null;
  realizedPL: number;
  totalPremiumCollected: number;
  totalAssignments: number;
  totalSkippedCycles: number;
  lastStopLossDay: number | null;
  totalStopLosses: number;
  totalPutRolls: number;
}

export type Signal =
  | { action: "SELL_PUT"; strike: number; delta: number; premium: number;
      rule: string; reason: string }
  | { action: "SELL_CALL"; strike: number; delta: number; premium: number;
      rule: string; reason: string }
  | { action: "SKIP"; rule: string; reason: string }
  | { action: "CLOSE_POSITION"; rule: string; reason: string }
  | { action: "ROLL"; newStrike: number; newDelta: number;
      rollCost: number; newPremium: number; credit: number;
      rule: string; reason: string }
  | { action: "HOLD" };

export type Event =
  | { type: "OPTION_SOLD"; optionType: "put" | "call"; strike: number;
      premium: number; delta: number; fees: number;
      openDay: number; expiryDay: number; contracts?: number }
  | { type: "OPTION_EXPIRED"; optionType: "put" | "call"; strike: number;
      spot: number; assigned: boolean }
  | { type: "ETH_BOUGHT"; price: number; size: number }
  | { type: "ETH_SOLD"; price: number; size: number; pl: number }
  | { type: "PREMIUM_COLLECTED"; grossPremium: number; fees: number; netAmount: number }
  | { type: "CYCLE_SKIPPED"; reason: string }
  | { type: "POSITION_CLOSED"; price: number; size: number; pl: number;
      reason: string }
  | { type: "OPTION_BOUGHT_BACK"; optionType: "put" | "call"; strike: number;
      cost: number; fees: number }
  | { type: "OPTION_ROLLED"; optionType: "put" | "call"; oldStrike: number; newStrike: number;
      newDelta: number; originalPremium: number; rollCost: number;
      newPremium: number; fees: number; openDay: number; expiryDay: number; contracts?: number };

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
  skipBelowRatio?: number;
  skipSide?: "both" | "put";
}

export interface RollCallConfig {
  itmThresholdPct: number;
  requireNetCredit: boolean;
}

export interface RollPutConfig {
  initialDTE: number;
  rollWhenDTEBelow: number;
  requireNetCredit: boolean;
}

export interface StopLossConfig {
  drawdownPct: number;
  cooldownDays: number;
}

export interface PositionSizingConfig {
  mode: "fractionalKelly" | "trailingReturn" | "volScaled";
  kellyFraction?: number;
  kellyLookbackTrades?: number;
  returnLookbackDays?: number;
  returnThresholds?: { drawdown: number; sizeMult: number }[];
  volTarget?: number;
  volLookbackDays?: number;
  minSize?: number;
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
  rollCall?: RollCallConfig;
  rollPut?: RollPutConfig;
  stopLoss?: StopLossConfig;
  positionSizing?: PositionSizingConfig;
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
    totalStopLosses: number;
    totalPutRolls: number;
  };
}
