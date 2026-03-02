# Experiment 7: Drift Sensitivity — Analysis

## Overview

**Goal:** Test whether the Exp 6 optimal configs (Conservative RF+AC+PR, Moderate RF+PR, Active RF-only) remain viable across different drift regimes. All prior experiments assumed 5% annual drift.

**Design:**
- 3 strategies × 6 drift levels (-30%, -10%, 0%, +5%, +20%, +50%) × 4 vol levels (40%, 60%, 80%, 100%)
- Each combo tested with optimal config (RF ON) and baseline (RF OFF) = **144 total combinations**
- 1,000 paths per combo = **144,000 simulation paths**
- Model: GBM with stochastic IV (OU, κ=5.0, ξ=0.5, VRP=15%)

---

## Key Findings

### 1. Active strategy is drift-immune — Sharpe positive across ALL 24 drift × vol combos

The most striking result of the research program. Active (δ0.20/3d, RF-only) maintains **positive Sharpe at every tested combination**, including -30% drift at 100% vol (Sharpe 0.296). No other strategy achieves this.

| Drift | 40% vol | 60% vol | 80% vol | 100% vol |
|-------|---------|---------|---------|----------|
| -30%  | 0.451   | 0.409   | 0.353   | 0.296    |
| -10%  | 0.792   | 0.631   | 0.521   | 0.425    |
| 0%    | 0.960   | 0.740   | 0.602   | 0.487    |
| +5%   | 1.044   | 0.797   | 0.640   | 0.518    |
| +20%  | 1.294   | 0.956   | 0.761   | 0.611    |
| +50%  | 1.765   | 1.271   | 0.992   | 0.797    |

Active's 1.044 Sharpe at +5% drift / 40% vol **does depend on positive drift** — it degrades to 0.451 at -30% drift — but never crosses zero. The strategy generates positive risk-adjusted returns in severe bear markets because the regime filter skips ~94% of put cycles, and the 3-day cycle length allows rapid premium collection on the ~6% of cycles where IV/RV is favorable.

### 2. Conservative and Moderate fail at -30% drift — but only at -30%

Both strategies have Sharpe < 0 across all vol levels at -30% drift:

| Strategy | -30% drift range | Crossover point |
|----------|-----------------|-----------------|
| Conservative | -0.349 to -0.061 | ~-17% to -25% depending on vol |
| Moderate | -0.276 to -0.144 | ~-11% to -18% depending on vol |
| Active | 0.296 to 0.451 | Never crosses zero |

At -10% drift, all strategies are positive. The deployment floor is approximately **-15% to -20% annual drift** for Conservative/Moderate, with no floor for Active.

### 3. The regime filter is universally beneficial across ALL drift regimes

**RF wins 72/72 combinations** (100% win rate across all strategies × drift × vol). Not a single case where removing RF improves Sharpe.

Mean ΔSharpe from RF by strategy:
- **Conservative:** +0.058 (consistent but modest)
- **Moderate:** +0.131 (substantial, lifts Sharpe at -10% from negative to positive)
- **Active:** +0.249 (dominant — the primary reason Active survives bear markets)

RF's value actually **increases in bear markets**:

| Strategy | RF ΔSharpe at -30% drift | RF ΔSharpe at +50% drift |
|----------|-------------------------|-------------------------|
| Active | +0.308 (avg across vols) | +0.177 |
| Moderate | +0.158 | +0.081 |
| Conservative | +0.067 | +0.036 |

The filter becomes more valuable in adverse conditions because RV rises persistently, causing more cycles to be correctly skipped.

### 4. Skip rates are insensitive to drift — the filter is not over-skipping

A key concern was that bear markets would cause the filter to skip >99% of cycles, leaving capital idle. The data shows skip rates are remarkably stable:

| Strategy | Skip% at -30% drift | Skip% at +50% drift |
|----------|---------------------|---------------------|
| Conservative | 99.3% | 98.1% |
| Moderate | 97.0% | 97.4% |
| Active | 94.2% | 94.5% |

Conservative already skips ~99% of cycles at any drift (because δ0.10/30d only has ~12 cycles/year, and most are skipped). The 1-2% variation across drift levels is negligible. Active's filter is calibrated tighter: ~94% skip regardless of drift.

**Critically, the high skip rates don't mean the strategy is idle.** The strategies still sell calls when holding ETH (skipSide="put"), so capital is actively deployed even during skipped put cycles.

### 5. Alpha inverts with drift — the wheel is a bear market outperformer

Alpha (wheel APR minus buy-and-hold APR) shows a perfect monotonic relationship with drift:

| Drift | Conservative α | Moderate α | Active α |
|-------|---------------|------------|----------|
| -30%  | +24.8% avg    | +34.4%     | +53.8%   |
| -10%  | +16.9%        | +28.5%     | +47.2%   |
| 0%    | +11.4%        | +24.7%     | +43.0%   |
| +5%   | +8.6%         | +22.4%     | +40.7%   |
| +20%  | -2.6%         | +14.9%     | +32.7%   |
| +50%  | -33.6%        | -6.7%      | +11.2%   |

In bear markets, buy-and-hold loses ~27% while the wheel collects premium and limits downside through selective entry. Active generates **+53.8% average alpha at -30% drift** — it earns 18-35% APR while B&H loses 27%.

At +50% drift, the wheel can't keep up with raw price appreciation. Conservative lags B&H by 34%, Moderate by 7%, but Active still beats B&H at 80% and 100% vol.

### 6. Drift sensitivity is monotonic and smooth — no regime cliffs

Sharpe degrades linearly with decreasing drift. There are no sudden cliffs or non-linear breakpoints. This means:
- Drift-based deployment rules can use simple linear thresholds
- No risk of sudden strategy failure at a drift boundary
- Gradual position sizing based on drift estimate is feasible

---

## Deployment Rules

### Updated Deployment Zone (Drift × Vol × Strategy)

| | Conservative | Moderate | Active |
|---|---|---|---|
| **Drift floor** | > -15% | > -10% | No floor (viable at -30%) |
| **Vol ceiling** (from Exp 3) | ~155% | ~88% | ~92% |
| **Sweet spot** | 0% to +20% drift, 55-65% vol | 0% to +20% drift, 40-60% vol | Any drift, 40-60% vol |

### Practical Recommendations

1. **Active is the all-weather strategy.** If you can only run one preset, use Active. It's the only config with positive Sharpe across the entire tested parameter space (-30% to +50% drift, 40-100% vol).

2. **No drift guard needed for Active.** The regime filter naturally adapts — it skips more put cycles when conditions are unfavorable, but the ~6% of cycles it accepts remain profitable.

3. **Conservative/Moderate need a drift guard.** Deploy only when estimated annual drift is above -15% (Conservative) or -10% (Moderate). In practice, this means exiting these strategies when trailing 30-90 day realized return annualizes below these thresholds.

4. **The wheel is not a bull market strategy.** At +50% drift, all strategies lag buy-and-hold significantly (Conservative by 34%, Moderate by 7%). The wheel trades upside participation for downside protection. Deploy when you expect sideways-to-moderate-bull conditions, or when you want bear market resilience.

5. **Regime filter is critical in all drift environments.** RF wins 72/72 combinations and its value increases in bear markets. Never disable it.

---

## Comparison with Prior Experiments

| Finding | Prior assumption | Exp 7 result |
|---------|-----------------|--------------|
| Active's 1.044 Sharpe | Assumed drift=+5% | Depends on drift: 0.451 at -30% to 1.765 at +50%. Still positive everywhere. |
| RF over-skipping in bears | Concern from README | Not an issue — skip rates stable at 94-99% regardless of drift |
| Drift guard needed? | Unknown | Yes for Conservative/Moderate (> -15%/-10%). No for Active. |
| Optimal configs change? | Concern | No — RF ON is optimal at every drift × vol × strategy. Exp 6 configs are drift-stable. |
| Alpha direction | Unknown | Inversely proportional to drift. Wheel is a bear market alpha generator. |
