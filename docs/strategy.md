# Wheel Strategy

## Overview

- Purpose: Define the Wheel strategy logic — phases, rules, configuration, trade lifecycle.
- Sources: `src/components/strategy/` (types, rules, strategy, executor, state, simulate)

## Text Representations

The algorithm has two text representations that **must stay in sync** when strategy logic changes:

| Location | Format | What it shows |
|----------|--------|---------------|
| `src/simulator.md` (rules panel) | Reactive HTML (`rulesHtml`) | Step-by-step rules with live parameter values (delta, DTE, IV, skip threshold) |
| `docs/strategy.md` (this file) | Markdown | Authoritative spec: phases, rules, formulas, config, lifecycle |

When modifying strategy logic: update both. This file is the source of truth for behavior; the simulator panel is a derived visualization.

## State Machine

Four phases with explicit intermediate states:

```
IDLE_CASH ───SELL_PUT───→ SHORT_PUT ←─── roll ───┐
     ↑                        │                   │
     │ SKIP            expired│assigned            │ (OTM + DTE ≤ threshold)
     │ (no VRP)     ┌─────────┘──────────┐         │
     │              ↓                    ↓         │
     └──────── IDLE_CASH          HOLDING_ETH ←────│────────────┐
                                      │  ↑         │            │
                           SELL_CALL  │  │ SKIP     │ expired OTM│
                                      │  │ (no VRP) │            │
                                      ↓  │          │            │
                         ┌──→ SHORT_CALL ──────────┘────────────┘
                         │        │
                    roll │   assigned
                         │        ↓
                         └── IDLE_CASH
```

Phase type: `"idle_cash" | "short_put" | "holding_eth" | "short_call"`

- **idle_cash**: No position, no open option. Strategy evaluates `BasePutRule`.
- **short_put**: Short put open. Waiting for expiry or DTE-ladder roll trigger.
- **holding_eth**: Assigned on put, holding ETH. Strategy evaluates `LowPremiumSkipRule` then `AdaptiveCallRule`.
- **short_call**: Short call open. Waiting for expiry, rolling mid-cycle if spot crosses the ITM threshold, or closing mid-cycle if stop-loss fires.

The `holding_eth` state enables decision-making between cycles: sell a call, skip, or close the position.

## Signal-Based Architecture

### Flow

```
MarketSnapshot → Rules → Signal → Executor → Events → State reducer → PortfolioState
```

1. **Rules** are pure functions: `(market, portfolio, config) → Signal | null`
2. **Strategy evaluator** runs rules in priority order; first non-null Signal wins, default `HOLD`
3. **Executor** converts Signals into Events (sim uses BS pricing; a future live executor uses real fills)
4. **State reducer** (`applyEvents`) applies Events to produce new `PortfolioState`

### Signals (strategy intent)

| Action | Produced by | Fields |
|--------|-------------|--------|
| `SELL_PUT` | `BasePutRule` | strike, delta, premium, rule, reason |
| `SELL_CALL` | `AdaptiveCallRule` | strike, delta, premium, rule, reason |
| `SKIP` | `LowPremiumSkipRule`, `StopLossCooldownRule`, `BasePutRule`, `AdaptiveCallRule` | rule, reason |
| `CLOSE_POSITION` | `StopLossRule` | rule, reason |
| `ROLL` | `RollCallRule`, `RollPutRule` | newStrike, newDelta, rollCost, newPremium, credit, rule, reason |
| `HOLD` | default | (no fields) |

### Events (execution facts)

| Event | When |
|-------|------|
| `OPTION_SOLD` | Signal executed: put or call sold. Carries optional `contracts` (effective size after position sizing). |
| `OPTION_EXPIRED` | Expiry resolved: assigned or OTM |
| `ETH_BOUGHT` | Put assigned |
| `ETH_SOLD` | Call assigned |
| `PREMIUM_COLLECTED` | Option sold (emitted with `OPTION_SOLD` at time of sale) |
| `CYCLE_SKIPPED` | SKIP signal executed |
| `POSITION_CLOSED` | CLOSE_POSITION signal executed |
| `OPTION_BOUGHT_BACK` | Emitted before `POSITION_CLOSED` when an open option must be bought back (stop-loss fires while in `short_call`) |
| `OPTION_ROLLED` | ROLL signal executed: old option closed, new option opened. Carries `optionType: "put" \| "call"` identifying which leg was rolled, and optional `contracts` (effective size). |

## Rules

Each rule has a name, priority (lower = evaluated first), and a phase guard.

| Rule | Priority | Phase | Signal | Description |
|------|----------|-------|--------|-------------|
| `StopLossRule` | 1 | `holding_eth`, `short_call` | `CLOSE_POSITION` | Close ETH position when drawdown from entry ≥ `drawdownPct` |
| `StopLossCooldownRule` | 2 | `idle_cash` | `SKIP` | Block put-selling for `cooldownDays` after a stop-loss |
| `LowPremiumSkipRule` | 50 | `holding_eth` | `SKIP` | Skip call cycle when net premium < `skipThresholdPct` of position value |
| `BasePutRule` | 100 | `idle_cash` | `SELL_PUT` or `SKIP` | Sell OTM put at `targetDelta`. DTE uses `rollPut.initialDTE` when configured, else `cycleLengthDays`. Returns `SKIP` when IV/RV ratio is below `skipBelowRatio`. |
| `AdaptiveCallRule` | 100 | `holding_eth` | `SELL_CALL` or `SKIP` | Sell OTM call with delta scaled by unrealized P/L. Returns `SKIP` when IV/RV ratio is below `skipBelowRatio`. |
| `RollCallRule` | 100 | `short_call` | `ROLL` | Roll short call up and out when spot exceeds strike by ITM threshold |
| `RollPutRule` | 100 | `short_put` | `ROLL` | Roll short put forward when remaining DTE ≤ `rollWhenDTEBelow` and put is OTM (`spot > strike`) |

Priority ordering: risk rules (1–2) preempt skip rules (50) which preempt selection rules (100). `StopLossRule`, `RollCallRule`, and `RollPutRule` fire mid-cycle via dedicated triggers in `simulate.ts`. `RollPutRule` only fires when the put is OTM — ITM puts are left to expire for assignment.

### Planned rules

| Rule | Priority | Signal |
|------|----------|--------|
| `TrendFilterRule` | 40 | `SKIP` |
| `IVRankDeltaRule` | 90 | `SELL_PUT` / `SELL_CALL` |

## Configuration

### StrategyConfig

| Parameter | Type | Example | Description |
|-----------|------|---------|-------------|
| `targetDelta` | number | 0.30 | Target absolute delta for puts (and calls when adaptive is off) |
| `impliedVol` | number | 0.92 | Annualized IV for BS pricing |
| `riskFreeRate` | number | 0.05 | Risk-free rate |
| `cycleLengthDays` | number | 7 | Days per option cycle |
| `contracts` | number | 1 | ETH per contract (base size; scaled by `positionSizing` if configured) |
| `positionSizing` | optional | — | Dynamic position sizing config (see below) |
| `bidAskSpreadPct` | number | 0.05 | Premium haircut (5% = multiply raw premium by 0.95) |
| `feePerTrade` | number | 0.50 | USD per contract per trade |
| `adaptiveCalls` | optional | — | Adaptive call delta config (see below) |
| `ivRvSpread` | optional | — | IV/RV spread scaling config (see below) |
| `rollCall` | optional | — | Roll up & out config (see below) |
| `rollPut` | optional | — | Put DTE-ladder rolling config (see below). Absent = puts use `cycleLengthDays`, no mid-cycle rolling. |
| `stopLoss` | optional | — | Stop-loss config (see below). Absent = feature disabled, identical behavior to before. |

### AdaptiveCallsConfig

| Parameter | Type | Example | Description |
|-----------|------|---------|-------------|
| `minDelta` | number | 0.10 | Call delta when deep underwater |
| `maxDelta` | number | 0.50 | Call delta when profitable |
| `skipThresholdPct` | number | 0.001 | Skip call if net premium < this fraction of position value |
| `minStrikeAtCost` | boolean | true | Clamp call strike to never go below entry price (prevents locking in a loss) |

### IVRVSpreadConfig

| Parameter | Type | Example | Description |
|-----------|------|---------|-------------|
| `lookbackDays` | number | 20 | Trailing window for realized vol computation |
| `minMultiplier` | number | 0.8 | Floor for delta multiplier (prevents over-conservative deltas) |
| `maxMultiplier` | number | 1.3 | Cap for delta multiplier (prevents over-aggressive deltas) |
| `skipBelowRatio` | number? | 1.0 | When set and IV/RV < this value, `BasePutRule` and `AdaptiveCallRule` return `SKIP` instead of selling. `0` or absent = disabled. |
| `skipSide` | "both"\|"put"? | "both" | Which side(s) to skip when IV/RV < `skipBelowRatio`. `"both"` = skip puts and calls. `"put"` = skip puts only, always sell calls when holding ETH. |

### RollCallConfig

| Parameter | Type | Example | Description |
|-----------|------|---------|-------------|
| `itmThresholdPct` | number | 0.05 | Roll when `spot ≥ strike × (1 + itmThresholdPct)` |
| `requireNetCredit` | boolean | true | Skip roll if `(newPremium - rollCost) × contracts - fees ≤ 0` |

### RollPutConfig

| Parameter | Type | Example | Description |
|-----------|------|---------|-------------|
| `initialDTE` | number | 30 | DTE when selling (or rolling) a put. Replaces `cycleLengthDays` for put expiry. |
| `rollWhenDTEBelow` | number | 14 | Roll when `expiryDay - day ≤ rollWhenDTEBelow` and put is OTM |
| `requireNetCredit` | boolean | true | Skip roll if `(newPremium - rollCost) × contracts - fees ≤ 0` |

### StopLossConfig

| Parameter | Type | Example | Description |
|-----------|------|---------|-------------|
| `drawdownPct` | number | 0.30 | Close position when `(entryPrice - spot) / entryPrice ≥ drawdownPct` |
| `cooldownDays` | number | 7 | Days to wait before selling a new put after a stop-loss. `0` = no cooldown. |

### PositionSizingConfig

Optional. When present, `simulate()` applies a dynamic multiplier (0–1) to `config.contracts` on each put sale. The multiplier varies per trade based on trailing portfolio metrics.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | `"fractionalKelly"` \| `"trailingReturn"` \| `"volScaled"` | — | Sizing algorithm (required) |
| `kellyFraction` | number | 0.25 | Kelly: fraction of full Kelly to use (quarter-Kelly = 0.25) |
| `kellyLookbackTrades` | number | 10 | Kelly: trailing completed cycles for win rate estimation |
| `returnLookbackDays` | number | 30 | TRG: lookback window for trailing portfolio return |
| `returnThresholds` | `{ drawdown: number; sizeMult: number }[]` | — | TRG: tiered sizing reductions by drawdown level |
| `volTarget` | number | 0.60 | Vol-scaled: target annualized realized vol |
| `volLookbackDays` | number | 30 | Vol-scaled: lookback for RV computation |
| `minSize` | number | 0.10 | Floor multiplier — prevents going to zero contracts |

**Mode details:**

- **fractionalKelly**: `multiplier = kellyFraction × (p·W − q·L) / W` from trailing cycle P/L history. Cold start (no completed cycles): full size. All wins or all losses: clamps to 1 or minSize.
- **trailingReturn**: Reduces size when trailing N-day portfolio return is in drawdown. Linear interpolation between threshold steps. No drawdown: full size.
- **volScaled**: `multiplier = min(1, volTarget / trailingRV)`. Higher realized vol → smaller position. RV unavailable (insufficient history): full size.

**Integration point:** In `simulate()`, before `executor.execute()` on put sale days, `computeSizingMultiplier()` determines `effectiveContracts = config.contracts × multiplier`. Call sales and option lifecycle events (expiry, roll, assignment) use the contracts from the open position, not a freshly computed size.

## Adaptive Call Delta

When enabled, call delta is computed from unrealized P/L on the ETH position:

```
pnlPct = (spot - entryPrice) / entryPrice
t = clamp((pnlPct + 1) / 2, 0, 1)
callDelta = minDelta + (maxDelta - minDelta) * t
```

Effect:
- Underwater (pnlPct ~ -100%) → delta ~ minDelta (deep OTM, low assignment risk)
- Breakeven (pnlPct ~ 0%) → delta ~ midpoint
- Profitable (pnlPct ~ +100%) → delta ~ maxDelta (closer ATM, higher premium)

## IV/RV Spread Scaling

When enabled, delta is dynamically adjusted based on how rich option premiums are relative to realized volatility:

```
realizedVol = std(logReturns[day-lookback+1..day]) * sqrt(365)
iv = market.iv ?? config.impliedVol
ratio = iv / realizedVol

if skipBelowRatio is set and ratio < skipBelowRatio → SKIP (no VRP, stay in cash/hold ETH)
  — when skipSide = "put": only put-side returns SKIP; call-side still uses the scaled multiplier
  — when skipSide = "both" (default): both sides return SKIP

multiplier = clamp(ratio, minMultiplier, maxMultiplier)
effectiveDelta = targetDelta * multiplier  (capped at 0.50)
```

Effect:
- IV/RV < skipBelowRatio → `SKIP` signal, no option sold (regime filter). With `skipSide="put"`, only puts are skipped; calls continue selling to collect premium while holding ETH.
- IV/RV = 1.0 → multiplier = 1.0, no change
- IV/RV = 1.3 → multiplier = 1.3, delta increases 30% (more aggressive, premiums are rich)
- IV/RV = 0.7 → multiplier = minMultiplier (more conservative, premiums are fair/cheap)

The multiplier applies to both `BasePutRule` (put delta) and `computeCallDelta()` (call delta, after adaptive P/L scaling). When `computeIVRVMultiplier` returns `0` (skip triggered), the calling rule emits a `SKIP` signal.

Edge cases:
- `ivRvSpread` config absent → no RV computed, multiplier = 1.0, zero overhead
- Day < lookback → `realizedVol = undefined`, multiplier = 1.0
- Constant prices (RV = 0) → guarded by `rv <= 0` check, multiplier = 1.0
- GBM model (no `market.iv`) → uses `config.impliedVol` for IV side of ratio
- Combined with adaptive calls → multiplier applied after P/L scaling, final delta capped at 0.50

## Minimum Strike at Cost Basis

When `minStrikeAtCost` is enabled (default), both `AdaptiveCallRule` and `LowPremiumSkipRule` clamp the computed call strike to `max(strike, entryPrice)`. This prevents selling a call below the ETH entry price, which would lock in a guaranteed loss on the stock leg if assigned.

If clamping pushes the strike up, the premium drops. This naturally interacts with `LowPremiumSkipRule` — if the only available call has insufficient premium, the skip rule catches it.

The clamp only activates when:
1. `adaptiveCalls.minStrikeAtCost` is `true`
2. A position exists (`portfolio.position !== null`)
3. The computed strike is below `entryPrice`

## Cycle Skip

When adaptive calls is enabled, a call cycle is skipped if:

```
netPremium = premium * contracts - fees
positionValue = entryPrice * contracts
skip if netPremium < skipThresholdPct * positionValue
```

Skipped cycles are counted in `totalSkippedCycles`.

## Strike Selection

Uses binary search (`findStrikeForDelta`) to find the strike producing the target absolute delta:
- Puts: search range `[spot * 0.5, spot]` (below spot, OTM)
- Calls: search range `[spot, spot * 1.5]` (above spot, OTM)
- Convergence: 100 iterations or strike range < $0.01

## Volatility Selection

All rules resolve volatility as:

```
vol = market.iv ?? config.impliedVol
```

When a stochastic vol model (Heston, Heston-Jump) is active, `market.iv` is populated from the model's instantaneous volatility (`√v[t]`). For constant-vol models (GBM, Jump), `market.iv` is undefined and rules fall back to `config.impliedVol`.

This affects strike selection, premium calculation, and delta computation in all three rules.

## Premium Calculation

```
rawPremium = bsPutPrice(spot, strike, T, r, vol)  // or bsCallPrice
premium = rawPremium * (1 - bidAskSpreadPct)
```

## Roll Up & Out

When `rollCall` config is present, `simulate.ts` evaluates a **roll trigger** on every day a short call is open:

```
rollTrigger = spot ≥ openOption.strike × (1 + itmThresholdPct)
```

When triggered, `RollCallRule` evaluates and (if approved) emits `OPTION_ROLLED`. The `OPTION_ROLLED` event atomically closes the old call and opens a new one:

- **Buyback cost** (ask side): `bsCallPrice(spot, oldStrike, remainingT, r, vol) × (1 + bidAsk)`
- **New strike**: `findStrikeForDelta` at same effective delta, clamped to `max(raw, costBasis, spot)` — always OTM
- **New premium** (bid side): `bsCallPrice(spot, newStrike, newT, r, vol) × (1 - bidAsk)`
- **Net credit**: `(newPremium - rollCost) × contracts - 2 × feePerTrade × contracts`

Premium accounting per roll:

| Field | `totalPremiumCollected` | `realizedPL` |
|-------|------------------------|--------------|
| Roll fires | `+= newPremium` | `+= newPremium - rollCost - fees` |

Note: the original call's premium was already collected at sale time via `PREMIUM_COLLECTED`. The roll only books the new call's premium and debits the buyback cost + fees.

Phase stays `short_call` after a roll — no assignment, no phase transition. The new option's expiry is `rollDay + cycleLengthDays`.

## Put Rolling (DTE Ladder)

When `rollPut` config is present, puts are managed on a longer DTE cycle to stay within the theta sweet spot (21–45 DTE).

### Initial put DTE

`BasePutRule` and the `SELL_PUT` executor both use `rollPut.initialDTE` in place of `cycleLengthDays`:

```
T = initialDTE / 365                 (used for strike/premium pricing)
expiryDay = day + initialDTE         (stored on openOption)
```

When `rollPut` is absent, `cycleLengthDays` is used as before (backward compatible).

### Roll trigger

`simulate.ts` evaluates a **roll-put trigger** on every day a short put is open:

```
rollPutTrigger = (expiryDay - day) ≤ rollWhenDTEBelow  AND  spot > strike
```

The OTM guard (`spot > strike`) ensures ITM puts are left to expire for assignment — the wheel relies on assignments to acquire ETH.

### Roll mechanics (`RollPutRule`)

When triggered:

- **Buyback cost** (ask side): `bsPutPrice(spot, oldStrike, remainingT, r, vol) × (1 + bidAsk)`
- **New strike**: `findStrikeForDelta` at IV/RV-scaled effective delta, targeting fresh `initialDTE`
- **New premium** (bid side): `bsPutPrice(spot, newStrike, newT, r, vol) × (1 - bidAsk)`
- **Net credit**: `(newPremium - rollCost) × contracts - 2 × feePerTrade × contracts`

If `requireNetCredit` is true and net credit ≤ 0, the roll is skipped and the put runs to expiry.

### Premium accounting per roll

| Field | `totalPremiumCollected` | `realizedPL` |
|-------|------------------------|--------------|
| Roll fires | `+= newPremium` | `+= newPremium - rollCost - fees` |

Phase stays `short_put` after a roll. The new option's expiry is `rollDay + initialDTE`.

### `totalPutRolls`

`PortfolioState` tracks `totalPutRolls` (incremented in `applyEvents` when `OPTION_ROLLED.optionType === "put"`). Exposed in `SimulationResult.summary`.

## Stop-Loss

When `stopLoss` config is present, `simulate.ts` evaluates a **stop-loss trigger** on every day the strategy is in `holding_eth` or `short_call` phase:

```
stopLossTrigger = (entryPrice - spot) / entryPrice >= drawdownPct
```

The trigger fires only when no `decisionPoint` or `rollTrigger` is already active for that day.

### Event sequence when stop-loss fires in `short_call`

An open call must be bought back at ask before closing the ETH position:

1. `OPTION_BOUGHT_BACK` — buys back the call at `bsCallPrice × (1 + bidAskSpreadPct)`, debits `cost + fees` from `realizedPL`, clears `openOption`
2. `POSITION_CLOSED` — sells ETH at spot, credits `(spot - entryPrice) × size` to `realizedPL`, transitions to `idle_cash`

When stop-loss fires in `holding_eth` (no open option), only `POSITION_CLOSED` is emitted.

### State tracking

After a stop-loss close, `portfolio.lastStopLossDay` is set to the current day and `portfolio.totalStopLosses` increments. These fields are used by `StopLossCooldownRule`.

### Cooldown

While `day - lastStopLossDay < cooldownDays` and `phase === idle_cash`, `StopLossCooldownRule` (priority 2) returns `SKIP`, blocking the `BasePutRule` from opening a new put.

### P/L accounting

| Event | `realizedPL` change |
|-------|-------------------|
| `OPTION_BOUGHT_BACK` | `−= cost + fees` |
| `POSITION_CLOSED` | `+= (spot − entryPrice) × size` |

The buyback cost (`cost`) is priced as `bsCallPrice(spot, strike, T, r, vol) × (1 + bidAskSpreadPct) × contracts` where `T = max((expiryDay - day) / 365, 1/365)`.

## Trade Lifecycle

1. **Decision point**: No open option, open option has expired (`day ≥ expiryDay`), roll-call trigger fires mid-cycle, roll-put trigger fires mid-cycle, or stop-loss trigger fires mid-cycle.
2. **Resolve expiration** (if option open and at expiry): Check assignment, emit `OPTION_EXPIRED` + assignment events. (Premium was already collected at sale.)
3. **Evaluate rules**: Run rules in priority order → produce Signal.
4. **Execute signal**: Executor converts Signal to Events (BS pricing for sim).
5. **Update state**: `applyEvents` reducer applies Events → new PortfolioState.
6. **Log**: `SignalLogEntry` records market, signal, events, and before/after portfolio snapshots.

## Output

### SignalLogEntry (per decision)

Every decision point produces a log entry with: `day`, `market`, `portfolioBefore`, `signal`, `events[]`, `portfolioAfter`.

Replaces the old `TradeRecord`. Contains the signal (with rule name and reason), execution events (premium, fees, assignment), and full state snapshots.

### DailyState (per day)

`day`, `price`, `phase`, `cumulativePL`, `unrealizedPL`, `holdingETH`

### SimulationResult (aggregate)

```typescript
{
  signalLog: SignalLogEntry[];
  dailyStates: DailyState[];
  summary: {
    totalRealizedPL: number;
    totalPremiumCollected: number;
    totalAssignments: number;
    totalSkippedCycles: number;
    totalStopLosses: number;  // 0 when stopLoss config absent
    totalPutRolls: number;    // 0 when rollPut config absent
  };
}
```