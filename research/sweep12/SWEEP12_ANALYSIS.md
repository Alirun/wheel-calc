# Experiment 12: Multi-Year Horizon

## Objective

Test whether the Exp 6 optimal configs (with Exp 10's Conservative lookback: 45d) remain viable over 2-year and 5-year horizons. All prior experiments used 365-day simulations. Key questions:

1. Does Active's drift immunity survive sustained multi-year decline?
2. Does the regime filter's ~94–97% skip rate compound differently over longer horizons?
3. Are `skipBelowRatio` thresholds stable as vol regimes shift over longer horizons?
4. How does MaxDD evolve with horizon — saturating, linear, or accelerating?

## Methodology

- **Horizons:** 365d (1yr baseline), 730d (2yr), 1825d (5yr)
- **Drift levels:** 0%, +5%, −30%
- **VRP:** 10%, 15%
- **Models:** GBM, Jump (Heston closed per Exp 11)
- **Vol:** 60% (Exp 3 sweet spot)
- **Strategies:** Conservative (δ0.10/30d, RF+AC+PR, lookback 45d), Moderate (δ0.20/14d, RF+PR, lookback 20d), Active (δ0.20/3d, RF only, lookback 20d)
- **Configs per combo:** Optimal (RF ON) + Baseline (RF OFF)
- **Total:** 3 × 3 × 2 × 2 × 3 × 2 = **216 combinations × 1,000 paths = 216,000 simulation paths**

## Results Summary

### Horizon Stability (RF ON, averaged across all drift × VRP × model)

| Strategy | Metric | 1yr | 2yr | 5yr | 1yr→5yr Change |
|---|---|---|---|---|---|
| **Conservative** | Sharpe | 0.262 | −0.077 | −0.287 | −209% |
| | APR% | 4.08 | 3.66 | 2.54 | −38% |
| | MaxDD% | 26.2 | 41.0 | 59.3 | +126% |
| | Positive | 8/12 | 8/12 | 0/12 | — |
| **Moderate** | Sharpe | 0.076 | 0.006 | −0.057 | −175% |
| | APR% | 13.82 | 13.16 | 13.18 | −5% |
| | MaxDD% | 31.4 | 38.3 | 43.8 | +39% |
| | Positive | 8/12 | 8/12 | 7/12 | — |
| **Active** | Sharpe | 0.506 | 0.483 | 0.397 | −22% |
| | APR% | 29.12 | 29.00 | 28.54 | −2% |
| | MaxDD% | 23.0 | 26.1 | 28.6 | +25% |
| | Positive | 12/12 | 12/12 | 11/12 | — |

### Active Drift Immunity (−30% drift)

| Horizon | Sharpe | APR% | MaxDD% | WinRate% | Alpha% | Positive |
|---|---|---|---|---|---|---|
| 1yr | 0.280 | 19.82 | 23.5 | 66.9 | +45.29 | 4/4 |
| 2yr | 0.244 | 17.66 | 26.0 | 73.6 | +40.13 | 4/4 |
| 5yr | 0.100 | 12.02 | 27.5 | 77.5 | +27.65 | 3/4 |

### Regime Filter Universality

| Strategy | 1yr RF Wins | 2yr RF Wins | 5yr RF Wins | 1yr ΔSharpe | 5yr ΔSharpe |
|---|---|---|---|---|---|
| Conservative | 12/12 | 12/12 | 12/12 | +0.099 | +0.050 |
| Moderate | 12/12 | 12/12 | 12/12 | +0.161 | +0.142 |
| Active | 12/12 | 12/12 | 12/12 | +0.316 | +0.335 |
| **Total** | **36/36** | **36/36** | **36/36** | — | — |

## Key Findings

### 1. Active is the only multi-year viable strategy

Active maintains positive avg Sharpe at every horizon (0.506 → 0.483 → 0.397), with only a 22% Sharpe decline over 5 years. Conservative collapses (−209%) and Moderate degrades below zero (−175%). The divergence is stark: at 5yr, Active has 11/12 positive vs Conservative's 0/12. **For multi-year deployment, only Active should be used.**

### 2. Active's drift immunity survives 5 years — barely

At −30% drift, Active maintains positive Sharpe at all horizons: 0.280 (1yr) → 0.244 (2yr) → 0.100 (5yr). The single failure is Jump/VRP=10%/−30% drift at 5yr (Sharpe −0.005 — essentially zero). Active earns 12% APR and +28% alpha even under sustained 5-year bear market conditions. Compounding drawdown does NOT overwhelm premium income — MaxDD grows only from 23.5% to 27.5% (1.17×).

### 3. Conservative is a 1-year strategy only

Conservative's Sharpe turns negative at 2yr (−0.077 avg) and deeply negative at 5yr (−0.287). Every single 5yr combination — including +5% drift with VRP=15% — produces negative Sharpe. The 99.2–99.8% skip rate means only 0.4–1.6 executed cycles over the entire period. With so few trades, the strategy cannot recover from the inevitable drawdowns that accumulate over 5 years. Conservative is viable only as a short-horizon (≤1yr) deployment.

### 4. MaxDD behavior is strategy-dependent

| Strategy | 1yr→5yr MaxDD Growth | Pattern |
|---|---|---|
| Conservative | 26.2% → 59.3% (2.27×) | Linear — unbounded growth, no premium cushion |
| Moderate | 31.4% → 43.8% (1.40×) | Saturating — premium income offsets tail events |
| Active | 23.0% → 28.6% (1.25×) | Saturating — MaxDD near-capped at ~29% |

Active's MaxDD is remarkably stable because its high cycle frequency (38+ executed trades over 5yr) continuously generates premium income that offsets drawdowns. Conservative's 1.6 trades over 5yr provide zero drawdown recovery.

### 5. Regime filter is universally beneficial at ALL horizons

RF wins 108/108 combinations across all strategies, horizons, drift levels, VRP levels, and models — the most comprehensive RF universality test to date. RF's ΔSharpe is:
- **Conservative:** Shrinks from +0.099 to +0.050 (still beneficial, fewer trades to filter)
- **Moderate:** Stable at +0.142–0.161
- **Active:** Stable-to-increasing at +0.316–0.335

### 6. Skip rates are horizon-invariant

Skip rates barely change with horizon length: Active 95.2% (1yr) → 95.5% (5yr), Moderate 97.6% → 97.7%, Conservative 99.2% → 99.8%. The regime filter's acceptance rate is a property of the IV/RV stochastic process, not the simulation length. `skipBelowRatio` thresholds do not need recalibration for longer horizons.

### 7. VRP=10% floor weakens at 5yr for Conservative/Moderate

| Strategy | VRP=10% 5yr Sharpe | Positive |
|---|---|---|
| Conservative | −0.300 | 0/6 |
| Moderate | −0.086 | 3/6 |
| Active | 0.329 | 5/6 |

For Active, VRP=10% remains viable at 5yr. For Conservative/Moderate, the thin premium edge at VRP=10% is insufficient to overcome multi-year drawdown accumulation.

### 8. Jump processes are benign over multi-year horizons

GBM-Jump Sharpe gap for Active: 1yr=+0.106 → 5yr=+0.119. The gap does not widen materially. Jump processes reduce Sharpe by ~20% consistently across all horizons — no compounding damage. For Conservative, the gap is negligible (<0.01) at any horizon.

## Conclusion

**Multi-year deployment is viable for Active only.** Active (δ0.20/3d, RF only) maintains 0.397 Sharpe and 28.5% APR at 5yr with only a 22% Sharpe decline — driven by high cycle frequency (38+ executed trades) that continuously generates premium to offset drawdowns. Active's drift immunity survives even a sustained 5-year bear market (−30% drift → 0.100 Sharpe, 12% APR, 28% MaxDD).

Conservative and Moderate are **short-horizon strategies** (≤1yr). Conservative's extreme skip rate (99.2–99.8%) results in too few executed trades to recover from multi-year drawdowns: 0/12 positive conditions at 5yr. Moderate fares slightly better (7/12 positive) but avg Sharpe is negative.

The regime filter is universally beneficial at all horizons (108/108 wins), and skip rates are horizon-invariant — no threshold recalibration needed. MaxDD saturates for Active/Moderate but grows linearly for Conservative.

**Deployment implications:**
- **Active:** Safe for multi-year deployment. Rebalance/monitor annually but no forced exit needed.
- **Moderate:** Reassess after 1yr. Exit or switch to Active if drift turns bearish.
- **Conservative:** 1yr horizon only. Do not deploy for multi-year periods.

## Action Items

- No preset changes needed — the strategy parameters are sound; the finding is about deployment horizon, not parameterization
- Consider adding horizon guidance to preset descriptions (e.g., "Conservative — short-term only")
- Active's all-weather status reinforced: drift-immune, model-robust, AND multi-year viable
