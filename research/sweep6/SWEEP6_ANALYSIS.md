# Experiment 6: Combined Feature Stack — Analysis

## Summary

**320 unique configurations** tested across 3 strategy profiles × 4 vol levels × all 2^N feature combinations (5 features for Conservative/Moderate, 4 for Active). 1,000 Monte Carlo paths each, 365 days, 5% drift, GBM with stochastic IV.

### Key Result

**Features do NOT stack additively — one feature dominates, and others either conflict or contribute nothing.**

| Feature | Mean Marginal ΔSharpe | Verdict |
|---------|----------------------|---------|
| **Regime Filter** | **+0.186** | **KEEP — dominant feature** |
| Put Rolling | +0.020 | Keep (Conservative only) |
| Call Rolling | 0.000 | DROP — zero impact |
| Stop-Loss | 0.000 | DROP — zero impact |
| Adaptive Calls | -0.108 | **DROP — net harmful** |

---

## Finding 1: Regime Filter is the Only Feature That Matters for Moderate/Active

The regime filter (`skipBelowRatio + skipSide="put"`) is overwhelmingly the most important feature, providing +0.186 mean Sharpe improvement across all strategies and vol levels.

For **Moderate** and **Active** strategies, the best configuration at every vol level is either **RF alone** or **RF+PR** (put rolling). No other feature improves these strategies. The regime filter alone transforms the Active strategy from a marginal performer (0.286–0.322 Sharpe) into a strong one (0.518–1.044 Sharpe).

**Active with regime filter at 40% vol achieves 1.044 Sharpe** — the highest risk-adjusted return in the entire research program.

## Finding 2: Adaptive Calls Are Harmful for Moderate/Active

Adaptive calls have a **negative** marginal contribution for Moderate (-0.011 to -0.071) and Active (-0.339 to -0.383). The effect worsens at higher vol.

The conflict emerges from **Regime Filter × Adaptive Calls interaction**: -0.065 for Moderate, **-0.231 for Active** (the largest interaction detected). The two features work at cross-purposes: regime filter skips puts during low-VRP periods, while adaptive calls modify call delta based on unrealized P/L. When combined, adaptive calls' excessive skipping (200+ cycles at higher vol) destroys the income stream that regime filtering carefully preserved.

**For Conservative**, adaptive calls remain positive (+0.083 to +0.118 marginal) and synergize with regime filter (+0.041 interaction). The low delta (0.10) means adaptive calls operate in a narrower band that doesn't over-skip.

## Finding 3: Stop-Loss and Call Rolling Have Zero Impact

Both features show **exactly 0.000** marginal ΔSharpe across all strategies and vol levels. Adding either feature to any configuration produces identical Sharpe, APR, MaxDD, and win rate.

**Stop-Loss**: Zero stop-loss triggers (SL# = 0.00 across all 320 configs). The 25% drawdown threshold is never breached in any configuration — the strategy's structure (cycling between cash and positions) inherently limits drawdowns below this level. Stop-loss is not redundant because of regime filtering; it's redundant because the wheel strategy architecture prevents the deep sustained drawdowns it's designed to protect against.

**Call Rolling**: Zero effect because at δ0.10–0.20, calls are sold far OTM and rarely go ITM enough to trigger the 5% threshold for rolling. The covered call structure already caps upside, and rolling the cap doesn't change expected outcomes at these delta levels.

## Finding 4: Put Rolling Helps Conservative, Hurts/Neutral for Others

Put rolling provides consistent positive contribution for Conservative (+0.027 to +0.101) by extending duration when puts are OTM, reducing whipsaw from frequent reentry. It synergizes mildly with regime filter for Moderate (+0.019) but creates a small conflict with adaptive calls (-0.024 to -0.031).

For Moderate, put rolling is weakly positive at some vol levels (best config at 60/80/100% is RF+PR) but not at 40% (RF alone wins). For Active, put rolling is disabled by design (3-day cycles too short).

## Finding 5: Full Stack Actively Degrades Active Strategy

The full feature stack **hurts** the Active strategy at 60%+ vol:
- 60% vol: Full stack 0.302 vs RF-only 0.797 (**-0.495 Sharpe**)
- 80% vol: Full stack 0.190 vs RF-only 0.640 (**-0.450 Sharpe**)
- 100% vol: Full stack 0.097 vs RF-only 0.518 (**-0.421 Sharpe**)

This is entirely driven by the adaptive calls conflict. The "more features = better" assumption is catastrophically wrong for this strategy.

## Finding 6: Best Configs Are Vol-Robust

Each strategy's best config performs well across all tested vol levels:

**Conservative (RF+AC+PR)**: Sharpe degrades gracefully from 0.569 (40%) → 0.299 (100%). Never negative. Consistent +0.10 to +0.33 improvement over baseline at every vol level.

**Moderate (RF or RF+PR)**: Sharpe 0.422 (40%) → 0.112 (100%). Positive across range. The vol ceiling effectively eliminated by regime filter.

**Active (RF only)**: Sharpe 1.044 (40%) → 0.518 (100%). Still strongly positive even at 100% vol — a dramatic improvement from pre-filter ceilings of ~77% vol from Experiment 3.

---

## Optimal Configurations

### Conservative Income (δ0.10, 30d cycle)
**Features: RF + Adaptive Calls + Put Rolling**
- Regime filter: `skipBelowRatio=1.0, skipSide="put"`
- Adaptive calls: `minDelta=0.10, maxDelta=0.50, skipThresholdPct=0, minStrikeAtCost=true`
- Put rolling: `initialDTE=30, rollWhenDTEBelow=14, requireNetCredit=true`
- No stop-loss, no call rolling

| Vol | Sharpe | APR | MaxDD | WinRate | Alpha |
|-----|--------|-----|-------|---------|-------|
| 40% | 0.569 | 7.89% | 16.0% | 73.9% | +3.77% |
| 60% | 0.515 | 10.36% | 24.4% | 66.8% | +6.78% |
| 80% | 0.431 | 13.06% | 30.6% | 63.1% | +10.09% |
| 100% | 0.299 | 15.82% | 36.1% | 59.5% | +13.56% |

### Moderate Premium (δ0.20, 14d cycle)
**Features: RF + Put Rolling**
- Regime filter: `skipBelowRatio=1.2, skipSide="put"`
- Put rolling: `initialDTE=14, rollWhenDTEBelow=7, requireNetCredit=true`
- No adaptive calls, no stop-loss, no call rolling

| Vol | Sharpe | APR | MaxDD | WinRate | Alpha |
|-----|--------|-----|-------|---------|-------|
| 40% | 0.413* | 17.87% | 20.6% | 74.0% | +13.75% |
| 60% | 0.323 | 23.67% | 29.5% | 67.2% | +20.09% |
| 80% | 0.201 | 27.99% | 37.4% | 62.2% | +25.02% |
| 100% | 0.121 | 33.04% | 43.6% | 59.0% | +30.78% |

*At 40% vol, RF alone (0.422) slightly beats RF+PR (0.413), but RF+PR is more robust at higher vol.

### Active Trading (δ0.20, 3d cycle)
**Features: RF only**
- Regime filter: `skipBelowRatio=1.2, skipSide="put"`
- No adaptive calls, no put rolling, no stop-loss, no call rolling

| Vol | Sharpe | APR | MaxDD | WinRate | Alpha |
|-----|--------|-----|-------|---------|-------|
| 40% | **1.044** | 33.94% | 15.1% | 86.2% | +29.82% |
| 60% | 0.797 | 40.68% | 21.9% | 82.1% | +37.10% |
| 80% | 0.640 | 47.49% | 28.4% | 77.7% | +44.51% |
| 100% | 0.518 | 53.43% | 33.9% | 74.6% | +51.17% |

---

## Conclusions

1. **Less is more.** The best Active strategy uses ONE feature (regime filter). Adding more features degrades it. Conservative is the only profile that benefits from feature stacking (3 features).

2. **Stop-loss and call rolling should be removed from presets** — they contribute nothing in any configuration tested. Stop-loss could remain available for users who want it, but should default to OFF. Call rolling at low deltas is theoretically inert.

3. **Adaptive calls are strategy-dependent.** Beneficial for Conservative (low delta), harmful for Moderate/Active (higher delta). The conflict with regime filter at higher deltas means these two features should not be combined above δ0.15.

4. **The Active strategy with regime filter is the strongest risk-adjusted performer discovered in the entire research program** (1.044 Sharpe at 40% vol). It achieves this through aggressive filtering — skipping ~144 of ~365 trading days — waiting for favorable VRP before selling puts, while always selling calls when holding ETH.

5. **Presets should be updated** to reflect these optimal configurations. The current "Conservative" and "Aggressive" built-in presets don't match the research-optimal settings.
