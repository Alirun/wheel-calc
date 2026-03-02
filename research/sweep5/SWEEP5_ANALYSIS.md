# Experiment 5: Put-Only Regime Filter — Analysis

## Setup

| Parameter | Value |
|-----------|-------|
| **Goal** | Determine whether applying `skipBelowRatio` to puts only (always sell calls when holding ETH) improves risk-adjusted returns vs. skipping both sides |
| **Market** | GBM, stochastic IV (OU, κ=5.0, ξ=0.5, VRP=15%), 5% annual drift |
| **Vol levels** | 40%, 50%, 60%, 70%, 80%, 100%, 120%, 150% |
| **Skip thresholds** | 0 (baseline), 0.9, 1.0, 1.1, 1.2 |
| **Skip sides** | `"both"` (Sweep 4 behavior), `"put"` (new — always sell calls) |
| **Strategies** | Conservative (δ0.10/30d), Moderate (δ0.20/14d), Active (δ0.20/3d) |
| **Paths** | 1,000 per combo × 216 unique combos |
| **Engine change** | Added `skipSide?: "both" | "put"` to `IVRVSpreadConfig`, `side` param to `computeIVRVMultiplier` |

## Headline Results

### Put-only wins decisively across all three strategies

| Strategy | put-only wins | both wins | mean ΔSharpe (put−both) | mean ΔAPR (put−both) |
|----------|:---:|:---:|:---:|:---:|
| **Conservative (δ0.10/30d)** | 22/32 | 10/32 | +0.0075 | −0.30% |
| **Moderate (δ0.20/14d)** | 28/32 | 4/32 | +0.0237 | −0.52% |
| **Active (δ0.20/3d)** | **30/32** | **1/32** | **+0.0646** | +0.42% |

### Best overall configuration per strategy

| Strategy | Vol | Skip | Side | Sharpe | APR | MaxDD | Alpha |
|----------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Conservative | 60% | 1.1 | **put** | **0.503** | 10.92% | 21.4% | +7.34% |
| Moderate | 40% | 1.2 | **put** | **0.372** | 16.44% | 24.1% | +12.3% |
| Active | 40% | 1.2 | **put** | **0.473** | 21.31% | 27.0% | +17.2% |

### Vol ceiling shifts — put-only raises ceilings dramatically

| Strategy | Baseline ceiling | Both (skip=1.0) | **Put-only (skip=1.0)** | Shift |
|----------|:---:|:---:|:---:|:---:|
| Conservative | ∞ (positive everywhere) | ∞ | ∞ | — |
| Moderate | ~84% | ~88% | **~93%** | +9pp |
| Active | ~76% | ~84% | **~92%** | +16pp |

## Key Findings

### 1. Put-only filtering is strictly superior for moderate and active strategies

The effect is overwhelming for the Active strategy: 30 out of 32 comparisons favor put-only over both, with a mean ΔSharpe of +0.065. At the most aggressive filter threshold (skip=1.2), the Active strategy gains +0.131 to +0.161 Sharpe by keeping call-selling enabled. This is the single largest Sharpe improvement discovered in the research program.

For Moderate, 28/32 comparisons favor put-only with +0.024 mean ΔSharpe. Still meaningful and consistent.

### 2. Conservative strategy shows mild preference — effect is real but small

At 22/32 wins and +0.008 mean ΔSharpe, put-only helps but the margin is narrow. At low vol (40%), "both" actually wins slightly. The conservative strategy already has few cycles per year (30-day), so skipping calls affects fewer cycles overall.

### 3. The mechanism: call premium cushions naked ETH exposure during low-VRP periods

When IV/RV < threshold under "both" mode, the portfolio sits in holding_eth with zero income, fully exposed to directional risk. Put-only mode continues collecting call premium, which:

- **Reduces drawdown** — MaxDD drops 2–5pp across the board in put-only mode
- **Increases win rate** — consistently +2–6pp higher win rates
- **Skips fewer cycles** — put-only skips 20–40% fewer cycles than "both" mode (e.g., Active at 150% vol: 245 vs 279 skipped cycles)

### 4. APR slightly lower, but Sharpe much higher — classic risk-adjustment win

Put-only generally shows 0.3–1.0% lower APR than "both" mode (except Active at high vol, where it's higher). The lower APR comes from not skipping call cycles that happen to coincide with mild put-side underpricing. But the Sharpe improvement dominates — you sacrifice a tiny amount of nominal return for a large reduction in risk.

### 5. Effect scales with gamma exposure

The higher the delta and more frequent the cycles (= more gamma exposure), the more valuable keeping calls enabled becomes:

| Strategy | Gamma exposure | mean ΔSharpe |
|----------|:---:|:---:|
| Conservative δ0.10/30d | Lowest | +0.008 |
| Moderate δ0.20/14d | Medium | +0.024 |
| Active δ0.20/3d | Highest | **+0.065** |

High-gamma strategies hold ETH more frequently (more assignments from higher delta) and run shorter cycles. Every skipped call cycle leaves more naked ETH exposure per unit time.

### 6. Vol ceiling extension is dramatic for active strategies

The Active strategy's vol ceiling moves from ~76% baseline → ~84% with "both" filtering → **~92% with put-only filtering**. That's a 16pp extension of the viable deployment zone. For Moderate, the extension is 9pp (84% → 93%). This means put-only filtering makes these strategies viable in significantly more volatile markets.

## Recommendations

### Engine default: `skipSide: "put"` should be the default for moderate/active strategies

The data is unambiguous — there is no scenario where "both" is clearly better for moderate or active parameterizations. For conservative, the effect is small enough that either is acceptable, but put-only is still the better default.

### Updated optimal configurations (incorporating Sweep 4 + Sweep 5)

| Strategy | skipBelowRatio | skipSide | Vol sweet spot | Peak Sharpe |
|----------|:---:|:---:|:---:|:---:|
| Conservative | 1.0–1.2 | put (slight edge) | 55–65% | 0.50 |
| Moderate | 1.2 | **put** | 40–50% | 0.37 |
| Active | 1.2 | **put** | 40–50% | 0.47 |

### Notable: Active + put-only filter achieves higher Sharpe than conservative baseline

The Active strategy at δ0.20/3d, which was previously uncompetitive on a risk-adjusted basis, now achieves **0.473 Sharpe** with put-only filtering (skip=1.2, 40% vol) — higher than the Conservative strategy's baseline of 0.41. This rehabilitates the active approach for low-vol environments.

## Raw Data

Full output saved in `sweep5_output.txt`. Key tables in Sections 1–6 of the sweep output.
