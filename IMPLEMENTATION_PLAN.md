# Implementation Plan: Signal-Based Architecture

## Problem Statement

The current `simulateWheel()` in `wheel.ts` is a ~190-line monolithic function that mixes three
concerns into one loop:

1. **Decision logic** — what delta to use, whether to skip a cycle (the strategy brain)
2. **Execution** — BS pricing, strike finding, assignment determination (the exchange)
3. **State management** — phase tracking, entryPrice, P/L accumulation (the bookkeeper)

This creates several problems:

- **Not portable to production.** The strategy is hardwired to a `prices[]` array. Moving to a
  live exchange (Deribit) means rewriting the entire function, not just swapping out the execution
  layer.
- **Not debuggable.** When a trade goes wrong, there's no record of *why* the strategy chose that
  strike/delta. Decisions are computed inline and immediately consumed — no inspection point.
- **Not extensible.** Every improvement from `IMPROVEMENTS.md` (stop-loss, rolling, trend
  filters, IV-rank delta, min-strike rule) means modifying the same function and weaving new
  conditionals into an already-complex loop.
- **Not testable.** You can't unit-test "does the stop-loss rule fire when P/L < -30%?" without
  running a full simulation. Rules are not independent units.

## Architecture

### Layer Overview

```
┌──────────────────────────────────────────────────────┐
│                     Simulation Loop                  │
│   (or live event loop — same interface)              │
│                                                      │
│  for each decision point:                            │
│    1. Observe    → MarketSnapshot                    │
│    2. Evaluate   → Rules produce Signals             │
│    3. Execute    → Executor produces Events          │
│    4. Update     → PortfolioState updated            │
│    5. Record     → Signal log + Event log + Daily    │
└──────────────────────────────────────────────────────┘

Layer 1: Types        — MarketSnapshot, PortfolioState, Signal, Event
Layer 2: Rules        — Pure functions: (market, portfolio, config) → Signal | null
Layer 3: Strategy     — Evaluates rules, resolves conflicts, emits one Signal
Layer 4: Executor     — Turns Signals into Events (sim vs live — same interface)
Layer 5: State        — Applies Events to PortfolioState, records history
```

### State Machine

The wheel has 4 explicit states. Currently the code has only 2 (`selling_put`, `selling_call`)
and jumps directly from assignment to the next option sale. Making intermediate states explicit
creates decision points where rules can evaluate.

```
IDLE_CASH ───SELL_PUT───→ SHORT_PUT
                              │
                   expired OTM│assigned
                   ┌──────────┘──────────┐
                   ↓                     ↓
             IDLE_CASH            HOLDING_ETH ←──────────────┐
                                      │                      │
                           SELL_CALL  │  CLOSE_POSITION      │ expired OTM
                                      ↓                      │
                                 SHORT_CALL ─────────────────┘
                                      │
                                 assigned
                                      ↓
                                 IDLE_CASH
```

The `HOLDING_ETH` state is the key addition. In this state, the strategy evaluates whether to:
- Sell a call (`SELL_CALL`) — normal wheel continuation
- Skip this cycle (`SKIP`) — premium too low, or trend-based filter
- Close the position (`CLOSE_POSITION`) — stop-loss or other exit rule
- Wait (`HOLD`) — not at a decision point yet

### Core Types

```typescript
// ── Market observation ──────────────────────────────────────────────

interface MarketSnapshot {
  day: number;              // simulation day (or timestamp in production)
  spot: number;
  iv?: number;              // observed or estimated IV
}

// ── Portfolio state ─────────────────────────────────────────────────

type Phase = "idle_cash" | "short_put" | "holding_eth" | "short_call";

interface Position {
  size: number;             // ETH quantity
  entryPrice: number;       // cost basis (strike of assigned put)
}

interface OpenOption {
  type: "put" | "call";
  strike: number;
  delta: number;
  premium: number;          // net premium after bid-ask haircut
  openDay: number;
  expiryDay: number;
}

interface PortfolioState {
  phase: Phase;
  position: Position | null;
  openOption: OpenOption | null;
  realizedPL: number;
  totalPremiumCollected: number;
  totalAssignments: number;
  totalSkippedCycles: number;
}

// ── Signals (strategy intent) ───────────────────────────────────────

type Signal =
  | { action: "SELL_PUT";        strike: number; delta: number; premium: number;
      rule: string; reason: string }
  | { action: "SELL_CALL";       strike: number; delta: number; premium: number;
      rule: string; reason: string }
  | { action: "SKIP";            rule: string; reason: string }
  | { action: "CLOSE_POSITION";  rule: string; reason: string }
  | { action: "ROLL";            newStrike: number; newDelta: number; credit: number;
      rule: string; reason: string }
  | { action: "HOLD" }

// ── Events (execution facts) ────────────────────────────────────────

type Event =
  | { type: "OPTION_SOLD";       optionType: "put" | "call"; strike: number;
      premium: number; delta: number; fees: number }
  | { type: "OPTION_EXPIRED";    optionType: "put" | "call"; strike: number;
      spot: number; assigned: boolean }
  | { type: "ETH_BOUGHT";        price: number; size: number }
  | { type: "ETH_SOLD";          price: number; size: number; pl: number }
  | { type: "PREMIUM_COLLECTED"; amount: number }
  | { type: "CYCLE_SKIPPED";     reason: string }
  | { type: "POSITION_CLOSED";   price: number; size: number; pl: number;
      reason: string }

// ── Signal log entry (for debugging / visualization) ────────────────

interface SignalLogEntry {
  day: number;
  market: MarketSnapshot;
  portfolioBefore: PortfolioState;  // snapshot before execution
  signal: Signal;
  events: Event[];
  portfolioAfter: PortfolioState;   // snapshot after execution
}
```

### Rules

Each rule is a pure function with a name and a priority. Rules are evaluated in order; the first
non-null signal wins (or a resolver picks from all non-null signals).

```typescript
interface Rule {
  name: string;
  priority: number;         // lower = evaluated first (e.g., stop-loss before delta selection)
  evaluate(
    market: MarketSnapshot,
    portfolio: PortfolioState,
    config: StrategyConfig
  ): Signal | null;
}
```

#### Current logic → rules mapping

| Current code location            | Rule name            | Priority | Signal produced      |
|----------------------------------|----------------------|----------|----------------------|
| Fixed `targetDelta` for puts     | `BasePutRule`        | 100      | `SELL_PUT`           |
| `getCallDelta()` adaptive logic  | `AdaptiveCallRule`   | 100      | `SELL_CALL`          |
| Premium < threshold → skip       | `LowPremiumSkipRule` | 50       | `SKIP`               |

#### Future rules from IMPROVEMENTS.md

| Improvement                      | Rule name            | Priority | Signal produced      |
|----------------------------------|----------------------|----------|----------------------|
| Stop-loss on unrealized loss     | `StopLossRule`       | 10       | `CLOSE_POSITION`     |
| Never sell call below entry      | `MinStrikeRule`      | 20       | adjusts or `SKIP`    |
| IV-rank based delta adjustment   | `IVRankDeltaRule`    | 90       | `SELL_PUT/SELL_CALL` |
| Trend-based call skipping        | `TrendFilterRule`    | 40       | `SKIP`               |
| Roll ITM option before expiry    | `RollRule`           | 30       | `ROLL`               |

Priority ordering ensures safety rules (stop-loss, min-strike) are evaluated before selection
rules (delta choice). A `CLOSE_POSITION` at priority 10 preempts a `SELL_CALL` at priority 100.

### Executor Interface

The executor is the only part that differs between simulation and production.

```typescript
interface Executor {
  // Settle an expiring option (check assignment, collect premium)
  resolveExpiration(
    market: MarketSnapshot,
    portfolio: PortfolioState,
    config: StrategyConfig
  ): Event[];

  // Execute a signal (place order, compute fill)
  execute(
    signal: Signal,
    market: MarketSnapshot,
    portfolio: PortfolioState,
    config: StrategyConfig
  ): Event[];
}
```

- **SimExecutor**: Uses `prices[]`, Black-Scholes pricing, deterministic assignment
  (spot < strike → put assigned, spot >= strike → call assigned). This is what we build now.
- **DeribitExecutor** (future): Uses Deribit API, real orderbook, actual fills. The strategy
  code is identical — only the executor changes.

### State Reducer

Portfolio state is updated via a pure reducer function that applies events:

```typescript
function applyEvents(state: PortfolioState, events: Event[]): PortfolioState {
  let s = { ...state };
  for (const e of events) {
    switch (e.type) {
      case "OPTION_SOLD":
        s.openOption = { type: e.optionType, strike: e.strike, ... };
        s.phase = e.optionType === "put" ? "short_put" : "short_call";
        break;
      case "OPTION_EXPIRED":
        s.openOption = null;
        if (e.assigned && e.optionType === "put") {
          s.phase = "holding_eth";
        } else if (e.assigned && e.optionType === "call") {
          s.phase = "idle_cash";
        } else {
          s.phase = s.position ? "holding_eth" : "idle_cash";
        }
        break;
      case "ETH_BOUGHT":
        s.position = { size: e.size, entryPrice: e.price };
        break;
      // ... etc
    }
  }
  return s;
}
```

### Simulation Loop

The main loop becomes trivial orchestration:

```typescript
function simulate(
  prices: number[],
  rules: Rule[],
  config: StrategyConfig
): SimulationResult {
  let portfolio = initialPortfolio();
  const signalLog: SignalLogEntry[] = [];
  const dailyStates: DailyState[] = [];

  // Sort rules by priority
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  for (let day = 0; day < prices.length; day++) {
    const market: MarketSnapshot = { day, spot: prices[day] };

    if (isDecisionPoint(day, portfolio, config)) {
      const before = snapshot(portfolio);

      // 1. Settle expiring option if any
      if (portfolio.openOption && day >= portfolio.openOption.expiryDay) {
        const expiryEvents = executor.resolveExpiration(market, portfolio, config);
        portfolio = applyEvents(portfolio, expiryEvents);
      }

      // 2. Evaluate rules → produce signal
      let signal: Signal = { action: "HOLD" };
      for (const rule of sortedRules) {
        const s = rule.evaluate(market, portfolio, config);
        if (s) { signal = s; break; }
      }

      // 3. Execute signal → produce events
      const execEvents = executor.execute(signal, market, portfolio, config);
      portfolio = applyEvents(portfolio, execEvents);

      // 4. Log everything
      signalLog.push({ day, market, portfolioBefore: before, signal, events: execEvents,
                        portfolioAfter: snapshot(portfolio) });
    }

    // 5. Record daily state
    dailyStates.push(toDailyState(day, market, portfolio));
  }

  return { signalLog, dailyStates, finalPortfolio: portfolio };
}
```

## File Structure

### Current

```
src/components/
  wheel.ts          ← monolith: strategy + execution + state
  black-scholes.ts  ← pricing (unchanged)
  price-gen.ts      ← GBM price generator (unchanged)
  monte-carlo.ts    ← MC runner (updated to use new engine)
```

### After refactor

```
src/components/
  strategy/
    types.ts        ← Signal, Event, MarketSnapshot, PortfolioState, Phase, Config
    rules.ts        ← Rule interface + all rule implementations
    strategy.ts     ← Rule evaluator / conflict resolver
    executor.ts     ← Executor interface + SimExecutor
    state.ts        ← applyEvents reducer + initialPortfolio + helpers
    simulate.ts     ← Main simulation loop (orchestrator)
  black-scholes.ts  ← unchanged
  price-gen.ts      ← unchanged
  monte-carlo.ts    ← updated imports, uses simulate() from strategy/simulate.ts
```

## Implementation Steps

### Phase 1: Core types and state machine

**Files:** `src/components/strategy/types.ts`, `src/components/strategy/state.ts`

- [x] Define `MarketSnapshot`, `Phase` (4 states), `Position`, `OpenOption`, `PortfolioState`
- [x] Define `Signal` union type with `rule` and `reason` fields on every variant
- [x] Define `Event` union type for all execution outcomes
- [x] Define `SignalLogEntry` with before/after portfolio snapshots
- [x] Define `StrategyConfig` (superset of current `WheelConfig` — same fields, cleaner naming)
- [x] Define `DailyState` (same as current, plus phase uses 4-state model)
- [x] Define `SimulationResult` (signalLog, dailyStates, finalPortfolio, summary metrics)
- [x] Implement `initialPortfolio()` → idle_cash state with zero P/L
- [x] Implement `applyEvents()` reducer — pure function, handles all Event types
- [x] Implement `snapshotPortfolio()` — deep copy for logging

### Phase 2: Rules

**Files:** `src/components/strategy/rules.ts`

- [x] Define `Rule` interface: `{ name, priority, evaluate(market, portfolio, config) → Signal | null }`
- [x] Implement `BasePutRule` — when in `idle_cash`, compute target delta, find strike via BS, emit `SELL_PUT`
- [x] Implement `AdaptiveCallRule` — when in `holding_eth`, compute adaptive delta from P/L, find strike, emit `SELL_CALL`. Falls back to fixed delta when adaptive is disabled.
- [x] Implement `LowPremiumSkipRule` — when in `holding_eth`, check if net premium < threshold, emit `SKIP`
- [x] Implement `defaultRules(config)` helper — returns the 3 rules above in priority order
- [x] Verify: each rule is independently unit-testable with a handcrafted `MarketSnapshot` + `PortfolioState`

### Phase 3: Strategy evaluator

**Files:** `src/components/strategy/strategy.ts`

- [x] Implement `evaluateRules(rules, market, portfolio, config) → Signal`
  - Sort by priority, return first non-null signal, default to `HOLD`
- [x] Implement `isDecisionPoint(day, portfolio, config) → boolean`
  - True when: no open option, or open option has expired (day >= expiryDay)
  - This replaces the current `daysSinceCycleStart >= cycleLengthDays` check

### Phase 4: Executor

**Files:** `src/components/strategy/executor.ts`

- [x] Define `Executor` interface with `resolveExpiration()` and `execute()` methods
- [x] Implement `SimExecutor`:
  - `resolveExpiration()`: check spot vs strike, emit `OPTION_EXPIRED` + `ETH_BOUGHT`/`ETH_SOLD` + `PREMIUM_COLLECTED`
  - `execute(SELL_PUT)`: emit `OPTION_SOLD` with BS-priced premium adjusted for bid-ask + fees
  - `execute(SELL_CALL)`: same as above for calls
  - `execute(SKIP)`: emit `CYCLE_SKIPPED`
  - `execute(CLOSE_POSITION)`: emit `POSITION_CLOSED` + `ETH_SOLD` at spot
  - `execute(HOLD)`: emit nothing
  - `execute(ROLL)`: emit `OPTION_EXPIRED` (close current) + `OPTION_SOLD` (open new)
- [x] Port Black-Scholes pricing and strike-finding calls from current `wheel.ts` into executor

### Phase 5: Simulation loop

**Files:** `src/components/strategy/simulate.ts`

- [x] Implement `simulate(prices, rules, config) → SimulationResult`
  - Instantiate `SimExecutor`
  - Loop over days, check `isDecisionPoint`, resolve expiration, evaluate rules, execute signal
  - Build `signalLog[]`, `dailyStates[]`, summary metrics
- [x] Implement `toDailyState()` — converts market + portfolio to DailyState for charts
- [x] Implement summary computation (totalRealizedPL, totalPremiumCollected, totalAssignments, totalSkippedCycles) from final portfolio state

### Phase 6: Monte Carlo integration

**Files:** `src/components/monte-carlo.ts`

- [x] Update imports to use `simulate()` from `strategy/simulate.ts`
- [x] Update `runMonteCarlo()` to pass `defaultRules(config)` to `simulate()`
- [x] Update `RunSummary` computation to read from new `SimulationResult` shape
- [x] Update `rerunSingle()` similarly
- [x] Ensure `MonteCarloResult` shape is unchanged (or adapt minimally)

### Phase 7: Simulator UI update

**Files:** `src/simulator.md`

- [x] Update imports to new module paths
- [x] Update `wheelConfig` construction to use new `StrategyConfig` shape
- [x] Adapt price chart cycle bands to read from signal log
- [x] Add signal markers on price chart (colored by signal type: SELL_PUT, SELL_CALL, SKIP, etc.)
- [x] Adapt inventory events to read from event log
- [x] Adapt cumulative P/L chart to use `dailyStates` (should be nearly identical)
- [x] **New: State machine visualization** — live diagram showing the 4 phases (idle_cash, short_put, holding_eth, short_call) with the current phase highlighted. Updates reactively as the user scrubs through the detail view. Render as an inline SVG or Observable Plot with nodes and directed edges.
- [x] **Updated: Trade log table** — replace current flat event rows with `signalLog`-based rows. Add **Rule** column (which rule produced the signal) and **Reason** column (why). Skipped cycles appear as visible `SKIP` rows instead of just a counter.
  - Columns: #, Day, Rule, Signal, Strike, Spot, Delta, IV, Premium, Reason, dPNL, Total PNL

### Phase 8: Unit tests

**Files:** `tests/state.test.ts`, `tests/rules.test.ts`, `tests/strategy.test.ts`, `tests/executor.test.ts`, `tests/simulate.test.ts`

Setup:

- [x] Choose a lightweight test runner (Vitest — works with esbuild/TS out of the box, no config needed)
- [x] Add `vitest` as devDependency, add `"test": "vitest run"` and `"test:watch": "vitest"` to package.json scripts

State reducer (`tests/state.test.ts`):

- [x] `applyEvents` with `OPTION_SOLD` → sets `openOption`, transitions phase to `short_put` / `short_call`
- [x] `applyEvents` with `OPTION_EXPIRED` (OTM put) → clears `openOption`, phase back to `idle_cash`
- [x] `applyEvents` with `OPTION_EXPIRED` (assigned put) + `ETH_BOUGHT` → phase to `holding_eth`, position set
- [x] `applyEvents` with `OPTION_EXPIRED` (assigned call) + `ETH_SOLD` → phase to `idle_cash`, position cleared, P/L updated
- [x] `applyEvents` with `PREMIUM_COLLECTED` → `totalPremiumCollected` incremented
- [x] `applyEvents` with `CYCLE_SKIPPED` → `totalSkippedCycles` incremented
- [x] `applyEvents` with `POSITION_CLOSED` → position cleared, phase to `idle_cash`, P/L updated
- [x] `initialPortfolio()` → phase is `idle_cash`, all counters zero, no position, no option

Rules (`tests/rules.test.ts`):

- [x] `BasePutRule` returns `SELL_PUT` when phase is `idle_cash`
- [x] `BasePutRule` returns `null` when phase is not `idle_cash`
- [x] `AdaptiveCallRule` returns `SELL_CALL` when phase is `holding_eth`
- [x] `AdaptiveCallRule` returns `null` when phase is not `holding_eth`
- [x] `AdaptiveCallRule` delta scales with P/L: underwater → low delta, profitable → high delta
- [x] `AdaptiveCallRule` falls back to `targetDelta` when adaptive config is absent
- [x] `LowPremiumSkipRule` returns `SKIP` when net premium < threshold
- [x] `LowPremiumSkipRule` returns `null` when premium is above threshold
- [x] `LowPremiumSkipRule` returns `null` when phase is not `holding_eth`

Strategy evaluator (`tests/strategy.test.ts`):

- [x] `evaluateRules` returns first non-null signal in priority order
- [x] `evaluateRules` returns `HOLD` when all rules return `null`
- [x] Lower-priority rule (e.g., `SKIP` at 50) preempts higher-priority rule (e.g., `SELL_CALL` at 100)
- [x] `isDecisionPoint` returns `true` when no open option
- [x] `isDecisionPoint` returns `true` when open option has expired (day >= expiryDay)
- [x] `isDecisionPoint` returns `false` mid-cycle

Executor (`tests/executor.test.ts`):

- [x] `SimExecutor.resolveExpiration` — put OTM: emits `OPTION_EXPIRED(assigned=false)` + `PREMIUM_COLLECTED`
- [x] `SimExecutor.resolveExpiration` — put ITM: emits `OPTION_EXPIRED(assigned=true)` + `ETH_BOUGHT` + `PREMIUM_COLLECTED`
- [x] `SimExecutor.resolveExpiration` — call OTM: emits `OPTION_EXPIRED(assigned=false)` + `PREMIUM_COLLECTED`
- [x] `SimExecutor.resolveExpiration` — call ITM: emits `OPTION_EXPIRED(assigned=true)` + `ETH_SOLD` + `PREMIUM_COLLECTED`
- [x] `SimExecutor.execute(SELL_PUT)` — emits `OPTION_SOLD` with correct premium (BS-priced, bid-ask adjusted)
- [x] `SimExecutor.execute(SELL_CALL)` — same for calls
- [x] `SimExecutor.execute(SKIP)` — emits `CYCLE_SKIPPED`
- [x] `SimExecutor.execute(CLOSE_POSITION)` — emits `POSITION_CLOSED` + `ETH_SOLD` at spot
- [x] `SimExecutor.execute(HOLD)` — emits no events

Integration / regression (`tests/simulate.test.ts`):

- [x] Full simulation with known seed produces deterministic output (snapshot test)
- [x] Same seed + same config through new `simulate()` matches old `simulateWheel()` P/L within floating-point tolerance
- [x] Monte Carlo summary stats (winRate, meanAPR) match between old and new for a small run count

### Phase 9: Verification and cleanup

- [x] Run full test suite, all green
- [x] Run the simulator UI with identical parameters and visually confirm output matches pre-refactor
- [x] Remove old `wheel.ts` once verified

## Output Contract: What the UI Consumes

The UI currently reads from `SimulationResult` and `TradeRecord`. After refactor, it reads from:

```typescript
// What the UI gets from simulate()
interface SimulationResult {
  signalLog: SignalLogEntry[];  // replaces trades[] — richer, every decision logged
  dailyStates: DailyState[];   // same shape, phase now has 4 values
  summary: {
    totalRealizedPL: number;
    totalPremiumCollected: number;
    totalAssignments: number;
    totalSkippedCycles: number;
  };
}

// What Monte Carlo aggregates (unchanged)
interface MonteCarloResult { ... }  // same shape
```

The `SignalLogEntry` is a superset of `TradeRecord` — it contains the signal (with rule name and
reason), the events (with premium, fees, assignment), and before/after portfolio state. The UI
can extract everything it currently shows from this, plus new views like the signal log table.

## Benefits After Refactor

| Goal                | How it's achieved                                                |
|---------------------|------------------------------------------------------------------|
| **Production reuse**| Strategy (rules + evaluator) is executor-agnostic. Write a `DeribitExecutor` and the same rules run live. |
| **Debuggability**   | Every decision is a `SignalLogEntry` with rule name, reason, and full state snapshot before/after. |
| **Observability**   | Signal log can be visualized as colored markers on chart, filtered by rule, aggregated across MC runs. |
| **Extensibility**   | New rules from IMPROVEMENTS.md are independent files. Add a `StopLossRule`, register it, done. No touching the simulation loop. |
| **Testability**     | Each rule is a pure function testable with handcrafted snapshots. No simulation needed. |

## Risk & Migration Notes

- **Breaking change for UI.** The `trades[]` array goes away, replaced by `signalLog[]`. The UI
  trade log, cycle bands, inventory events, and summary cards all need updating. This is the
  largest piece of UI work.
- **Observable Framework reactivity.** The UI uses reactive `view()` bindings. The refactor
  doesn't change how data flows — `runMonteCarlo()` and `rerunSingle()` still return data
  objects that the UI renders. Only the shape changes.
- **No new dependencies.** Everything stays pure TypeScript. Black-Scholes and price-gen are
  untouched.
- **Backwards compatibility not needed.** The old `simulateWheel()` is only called from
  `monte-carlo.ts` and `simulator.md`. Once both are migrated, the old function is deleted.
