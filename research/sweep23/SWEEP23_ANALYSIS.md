# Sweep 23 Analysis: Preset Integration & Final Validation

## Setup

| Parameter | Value |
|-----------|-------|
| **Type** | Historical backtest (rolling windows + full period) |
| **Follows** | Exp 22 (Cold-Start Sizing Cap) |
| **Data** | ETH-PERPETUAL prices + ETH DVOL, 2021-03-24 → 2026-03-09 |
| **Windows** | 17 overlapping 365-day windows, stride 90 days |
| **Strategies** | 4: Conservative baseline, Conservative sized, Active baseline, Active sized |
| **Total Backtests** | 68 rolling + 4 full-period + 20 sub-period = 92: 0.06s |
| **Purpose** | Final validation of presets with position sizing integrated. Confirm MaxDD < 40% and Sharpe preservation for shipped presets. |

## Changes Made

### Preset Integration

1. **`StrategyPresetValues` extended** with 6 new fields: `sizingMode` ("none" | "volScaled"), `sizingVolTarget`, `sizingVolLookback`, `sizingMinSize`, `sizingColdStartDays`, `sizingColdStartSize`.

2. **Conservative preset** updated: `sizingMode: "volScaled"`, `sizingVolTarget: 40`, `sizingVolLookback: 45`, `sizingMinSize: 0.10`, `sizingColdStartDays: 45`, `sizingColdStartSize: 0.50`.

3. **Aggressive preset** updated: `sizingMode: "volScaled"`, `sizingVolTarget: 40`, `sizingVolLookback: 45`, `sizingMinSize: 0.10` (no cold-start — unnecessary per Exp 22).

4. **Moderate preset removed** from `STRATEGY_BUILT_INS`. Negative mean Sharpe, dominated in 16/17 windows (Exp 20), blew up on real data (Exp 18). Non-viable.

5. **Simulator UI** extended with Position Sizing section: sizing mode selector, vol target/lookback sliders, min size, cold-start days/size.

6. **Tests updated**: 345 tests passing, 4 new sizing validation tests.

## Results

### Part A: Rolling Window Validation (17 windows)

| Strategy | Mean Sharpe | Median Sharpe | Max MaxDD | Mean MaxDD | Mean APR | Neg Windows |
|----------|-------------|---------------|-----------|------------|----------|-------------|
| Cons-Baseline | **0.846** | 0.788 | **71.7%** | 26.0% | 19.4% | 6/17 (35.3%) |
| Cons-Sized | **0.964** | 0.827 | **37.7%** | 17.2% | 19.0% | 6/17 (35.3%) |
| Active-Baseline | **0.657** | 0.674 | **65.1%** | 27.7% | 40.6% | 6/17 (35.3%) |
| Active-Sized | **0.601** | 0.687 | **38.0%** | 20.0% | 31.5% | 6/17 (35.3%) |

#### Conservative: Sizing improves both risk AND return

- **Max MaxDD: 71.7% → 37.7%** (−33.9pp, meets < 40% target)
- **Mean Sharpe: 0.846 → 0.964** (+14.0%)
- Sharpe wins 14/17, MaxDD wins 11/17
- Mean ΔSharpe: **+0.118**
- Sizing is unambiguously beneficial — improves risk-adjusted return while halving worst-case drawdown

**Window-by-window highlights:**
- Window 1 (May 2021 crash): MaxDD 71.7% → 36.1% (−35.6pp), Sharpe 1.261 → 1.454 (+0.193)
- Window 2: MaxDD 69.3% → 37.7% (−31.7pp), Sharpe −0.647 → −0.089 (+0.558)
- Windows 6–9 (calm): No change (0% MaxDD, no trades)
- Window 4: Only window where Sharpe degrades meaningfully (−0.168) — vol-scaling undersizes during recovery

#### Active: Sizing trades return for risk reduction

- **Max MaxDD: 65.1% → 38.0%** (−27.1pp, meets < 40% target)
- **Mean Sharpe: 0.657 → 0.601** (−8.5%)
- Sharpe wins 4/17, MaxDD wins 13/17
- Mean ΔSharpe: **−0.056**
- Sizing costs 8.5% of Sharpe for 41.6% reduction in max drawdown — favorable tradeoff

### Part B: Full Period Validation (~5yr)

| Strategy | Sharpe | APR | MaxDD | Put Sells | Assignments | Full Cycles | Skip Rate |
|----------|--------|-----|-------|-----------|-------------|-------------|-----------|
| Cons-Baseline | 0.517 | 50.2% | **71.7%** | 11 | 9 | 4 | 95.2% |
| **Cons-Sized** | **0.537** | **34.8%** | **36.1%** | 11 | 9 | 4 | 95.2% |
| Active-Baseline | 0.369 | 35.1% | **65.1%** | 168 | 76 | 38 | 81.0% |
| **Active-Sized** | **0.365** | **25.3%** | **30.2%** | 168 | 76 | 38 | 81.0% |

Full-period confirms:
- **Conservative**: MaxDD halved (71.7% → 36.1%), Sharpe slightly improved (0.517 → 0.537, +3.9%), APR reduced (50.2% → 34.8%) due to smaller position sizes during volatile periods
- **Active**: MaxDD more than halved (65.1% → 30.2%), Sharpe preserved (0.369 → 0.365, −1.1%), APR reduced (35.1% → 25.3%)
- Trade count and skip rate unchanged — sizing affects notional, not trade decisions

### Sub-period Highlights

**Conservative Sized vs Baseline:**
- 2021 H2 (crash): MaxDD 71.7% → 36.1% (−35.6pp), APR 236.2% → 131.0% (still strongly positive)
- 2022 (bear): MaxDD 27.2% → 18.4% (−8.8pp), loss −17.0% → −10.0% (smaller)
- 2025 H1 (bear): MaxDD 18.5% → 13.4% (−5.1pp), APR −2.3% → +0.5% (turns profitable)

**Active Sized vs Baseline:**
- 2021 H2 (crash): MaxDD 65.1% → 26.5% (−38.5pp), APR 142.1% → 91.8% (still strongly positive)
- 2022 (bear): MaxDD 29.6% → 20.6% (−9.0pp), loss −6.7% → −2.5% (smaller)
- 2023 (recovery): MaxDD 12.3% → 13.1% (+0.8pp, negligible), APR 80.5% → 66.7% (cost of conservatism)

## Key Findings

### 1. Both strategies meet the MaxDD < 40% target

Conservative: max 37.7% (rolling), 36.1% (full-period). Active: max 38.0% (rolling), 30.2% (full-period). The deployment blocker identified in Exp 20 is resolved.

### 2. Conservative sizing is a pure improvement

Unlike Active, where sizing costs Sharpe, Conservative's sizing actually improves mean Sharpe (+14.0% rolling, +3.9% full-period). The mechanism is the same as Exp 22: the cold-start cap avoids exposure during the net-negative early period, and vol-scaling reduces position size during high-vol episodes where crash risk exceeds premium opportunity.

### 3. Active sizing is a favorable tradeoff

Active loses 8.5% mean Sharpe (0.657 → 0.601) in exchange for 41.6% reduction in max MaxDD (65.1% → 38.0%). At deployment scale, a 38% max drawdown is dramatically more survivable than 65%.

### 4. Moderate removal is confirmed

Moderate strategy (δ0.20/c14, RF+PR) was removed from built-in presets. Exp 18: blew up (124.7% MaxDD). Exp 20: negative mean Sharpe (−0.077), dominated in 16/17 windows at p<0.001.

### 5. Results match Exps 20–22 exactly

| Metric | Exp 20/22 | Exp 23 | Match? |
|--------|-----------|--------|--------|
| Cons-Baseline mean Sharpe | 0.846 | 0.846 | ✓ |
| Cons-Sized mean Sharpe | 0.964 | 0.964 | ✓ |
| Cons-Sized max MaxDD | 37.7% | 37.7% | ✓ |
| Active-Baseline mean Sharpe | 0.657 | 0.657 | ✓ |
| Active-Sized max MaxDD | 38.0% | 38.0% | ✓ |
| Cons full-period MaxDD sized | 36.1% | 36.1% | ✓ |
| Active full-period MaxDD sized | 30.2% | 30.2% | ✓ |

Perfect reproducibility. The preset integration introduces zero behavioral changes — it's purely additive configuration wiring.

## Final Preset Configurations

### Conservative (shipped)
```
targetDelta: 0.10, cycleLengthDays: 30
adaptiveCalls: true (min 0.10, max 0.50)
ivRvSpread: true (lookback 45d, skip < 1.1, put-only)
rollPut: true (initial 30 DTE, roll < 14 DTE)
positionSizing: volScaled (target 40%, lookback 45d, min 10%, coldStart 45d @ 50%)
```
Rolling: 0.964 Sharpe, 17.2% mean MaxDD, 37.7% max MaxDD, 19.0% APR
Full-period: 0.537 Sharpe, 36.1% MaxDD, 34.8% APR

### Aggressive (shipped)
```
targetDelta: 0.20, cycleLengthDays: 3
ivRvSpread: true (lookback 20d, skip < 1.2, put-only)
positionSizing: volScaled (target 40%, lookback 45d, min 10%)
```
Rolling: 0.601 Sharpe, 20.0% mean MaxDD, 38.0% max MaxDD, 31.5% APR
Full-period: 0.365 Sharpe, 30.2% MaxDD, 25.3% APR

### Moderate — REMOVED
Non-viable. Negative mean Sharpe, 124.7% MaxDD on real data.
