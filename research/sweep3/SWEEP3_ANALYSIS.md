# Experiment 3: Vol Boundary Search — Analysis

## Objective
Find the exact annualized volatility level where the wheel strategy's Sharpe ratio crosses zero — defining the **"wheel deployment zone"** (the vol range where the strategy has positive risk-adjusted edge).

## Methodology

### Setup
| Parameter | Value |
|-----------|-------|
| Price model | GBM with stochastic IV (OU process) |
| Annual drift | 5% |
| IV mean reversion (κ) | 5.0 |
| Vol of vol (ξ) | 0.5 |
| VRP premium | 15% of realized vol |
| Paths per combo | 1,000 |
| Horizon | 365 days |
| Skip threshold | 0 (always sell) |

### Strategies Tested
Three representative strategies spanning the risk spectrum, all winners from Experiment 2:

| Strategy | Target Delta | Cycle (DTE) | Profile |
|----------|-------------|-------------|---------|
| Conservative | 0.10 | 30 | Low risk, low return |
| Moderate | 0.20 | 14 | Balanced |
| Active | 0.20 | 3 | High frequency |

### Approach
1. **Phase 1 (Coarse):** Sweep 24 vol levels from 40% to 155% in 5% increments × 3 strategies = 72 Monte Carlo runs (72,000 total simulation paths).
2. **Phase 2 (Fine):** For each strategy with a crossover detected, re-run at 1% increments within the bracket. Linear interpolation to pinpoint the crossing.

---

## Results

### Sharpe Zero-Crossing Points

| Strategy | Sharpe = 0 at | Deployment Zone |
|----------|--------------|-----------------|
| **Conservative (δ0.10/30d)** | **Never crosses** | 40%–155%+ (entire tested range) |
| **Moderate (δ0.20/14d)** | **~82% vol** | 40%–82% |
| **Active (δ0.20/3d)** | **~77% vol** | 40%–77% |

### Peak Performance by Strategy

| Strategy | Peak Sharpe | At Vol | APR | Alpha | MaxDD | Win Rate |
|----------|------------|--------|-----|-------|-------|----------|
| Conservative | **0.448** | 60% | 8.19% | +4.61% | 23.7% | 70.3% |
| Moderate | 0.153 | 40% | 11.64% | +7.51% | 28.5% | 61.5% |
| Active | 0.157 | 40% | 14.63% | +10.51% | 32.2% | 56.5% |

### Alpha vs Buy-and-Hold
All three strategies produced **positive alpha across the entire 40%–155% range**. The wheel always outperforms buy-and-hold in raw return terms — but at higher vol, the risk-adjusted return (Sharpe) turns negative because drawdowns grow faster than premium income.

---

## Key Findings

### 1. The Conservative Strategy Has No Vol Ceiling
The conservative parameterization (δ0.10, 30-day cycles) maintained positive Sharpe across the entire tested range — even at 155% vol (Sharpe 0.039). This is a fundamentally different beast from the higher-delta strategies:
- **Low delta means low gamma exposure.** The put is far OTM, so assignment losses are rare and small relative to premium collected.
- **30-day cycles provide time diversification.** Each cycle spans multiple vol moves, smoothing outcomes.
- **Tradeoff:** APR at low vol is modest (5.5% at 40% vol) but scales linearly with vol (20.6% at 155% vol).

### 2. Higher Delta = Lower Vol Ceiling
The relationship is monotonic and sharp:
- δ0.10 → no ceiling found up to 155%
- δ0.20/14d → ceiling at **~82% vol**
- δ0.20/3d → ceiling at **~77% vol**

Higher delta and shorter cycles amplify gamma exposure. In high-vol environments, this means more frequent deep-in-the-money assignments that overwhelm premium income. The Sharpe degradation is smooth and predictable — not a cliff edge.

### 3. The "Sweet Spot" Is 55%–65% Vol
Across all strategies, the conservative approach peaks at **60% vol** (Sharpe 0.448). This is the optimal environment because:
- Vol is high enough to generate meaningful premium.
- Vol is low enough that assignment losses don't consume the premium.
- The 15% VRP ensures implied vol exceeds realized, creating a structural edge.

### 4. Sharpe and APR Move in Opposite Directions
A counterintuitive but critical finding. As vol increases:
- **APR increases** monotonically (more premium captured).
- **Sharpe decreases** monotonically (risk grows faster than return).

At 155% vol, the conservative strategy earns 20.65% APR — nearly 4× the 40% vol return — but the Sharpe is only 0.039 (barely positive). This is a classic **return trap**: the nominal return looks great, but you're not compensated for the risk.

### 5. Alpha Is Universal But Misleading
The wheel beats buy-and-hold at every vol level tested. This sounds impressive but is tautological: the wheel collects premium on top of holding the asset, so raw alpha is always positive. What matters is **risk-adjusted alpha** — and that's what Sharpe measures. Positive alpha with negative Sharpe means you'd be better off in a risk-free asset with the same volatility exposure.

---

## Deployment Zones Summary

```
Vol%:  40   50   60   70   80   90   100  110  120  130  140  150  155
       ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
Consv: [============================= POSITIVE SHARPE =================>
Moder: [================ POSITIVE ===]  ← ~82% ceiling
Activ: [============= POSITIVE ==]      ← ~77% ceiling
                        ▲
                    Peak (60%)
```

### Practical Recommendations

1. **Below 60% vol:** All strategies viable. Use Active/Moderate for maximum APR if Sharpe > 0.10 is acceptable.
2. **60%–77% vol:** Only Conservative and Moderate viable. Conservative is optimal (peak Sharpe zone).
3. **77%–82% vol:** Only Conservative viable. Sharpe still 0.40+ — excellent risk-adjusted returns.
4. **Above 82% vol:** Only Conservative viable. Sharpe degrades but stays positive. Deploy cautiously.
5. **Above ~155% vol:** Even Conservative approaches Sharpe = 0. Don't deploy the wheel.

### Regime Detection Signal
For a live deployment, the vol boundary provides a clear entry/exit rule:
- **Measure 30-day realized vol** of the underlying.
- If using moderate/active strategies: **exit when RV > 75%**.
- If using conservative strategy: **exit when RV > 150%** (or adjust position size proportionally to Sharpe decay).

---

## Experiment Metadata
- **Script:** `research/sweep3/sweep3.ts`
- **Run command:** `npx tsx research/sweep3/sweep3.ts`
- **Phase 1:** 72 MC runs × 1,000 paths = 72,000 simulations
- **Phase 2:** 8 additional MC runs × 1,000 paths = 8,000 simulations
- **Total:** 80,000 simulation paths
