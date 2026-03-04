# Experiment 11: Heston Skip Threshold Recalibration — Analysis

## Overview

**Objective:** Last Heston recovery attempt. Test whether recalibrating `skipBelowRatio` thresholds under Heston-specific IV/RV distributions can restore positive risk-adjusted returns. Prior thresholds (Conservative=1.0, Moderate/Active=1.2) were implicitly calibrated on OU-generated IV/RV signals. Under Heston, IV/RV ratios have fatter tails and different autocorrelation — the same threshold admits different-quality trades.

**Parameter Space:** 11 thresholds (0.8–2.0) × 2 drifts (0%, +5%) × 2 vols (40%, 60%) × 3 strategies × Heston model + RF OFF baselines = **144 Heston combinations × 1,000 paths = 144,000 simulations.** GBM cross-validation: 32 additional combos.

**Decision gate:** If threshold recalibration restores positive Sharpe → implement model-adaptive `skipBelowRatio`. If not → close the Heston investigation permanently.

---

## Key Findings

### Finding 1: Threshold recalibration FAILS to recover Heston performance

The central question is answered definitively: **no `skipBelowRatio` value restores positive Sharpe for Moderate or Active strategies under Heston.** Only 3/12 total strategy × drift × vol combinations achieve positive Sharpe — all three belong to Conservative.

| Strategy | Best Threshold | Avg Sharpe | Positive | RF OFF Sharpe |
|---|---|---|---|---|
| Conservative | 0.9 | 0.089 | 3/4 | 0.103 |
| Moderate | 1.2 | −0.054 | 0/4 | −0.182 |
| Active | 1.1 | −0.199 | 0/4 | −0.255 |

The regime filter improves Moderate and Active *relative to their baselines* (ΔSharpe +0.07–0.13) but cannot push them above zero. Moderate at its best (`skipBelowRatio=1.2`, drift=+5%, vol=60%) reaches −0.001 — tantalizingly close to zero but still negative. Active never gets closer than −0.153.

**The Heston investigation is CLOSED.** Three recovery approaches have been exhausted:
1. **Exp 9:** Tested all 4 models → Heston fails structurally
2. **Exp 10:** Lookback tuning → marginal improvement (+0.01–0.04 ΔSharpe), no recovery
3. **Exp 11:** Threshold recalibration → 0/4 Moderate, 0/4 Active positive. No recovery.

### Finding 2: Conservative RF OFF is confirmed superior under Heston

Exp 10 found RF hurts Conservative under Heston at most lookbacks. This experiment confirms that finding with threshold recalibration:

| Drift | Vol | RF OFF Sharpe | RF ON (best=0.9) Sharpe | Winner |
|---|---|---|---|---|
| 0% | 40% | −0.007 | −0.030 | RF OFF |
| 0% | 60% | 0.116 | 0.116 | Tie |
| +5% | 40% | 0.112 | 0.080 | RF OFF |
| +5% | 60% | 0.191 | 0.191 | Tie |

RF OFF wins 3/4 conditions (ties counted as RF OFF wins since RF adds complexity for no gain). At 40% vol, RF actively degrades Sharpe by 0.02–0.03. At 60% vol, RF has zero effect.

**Conservative under Heston should operate with RF OFF.** The δ0.10 / 30-day cycle already skips ~98% of opportunities via its low delta — adding RF on top over-filters the few remaining trades, and the accepted trades under Heston dynamics are net-negative.

### Finding 3: Higher thresholds monotonically degrade Sharpe under Heston

Unlike under GBM where moderate thresholds (1.0–1.2) optimally balance selectivity vs. frequency, under Heston the relationship inverts beyond the optimum:

| Strategy | Sharpe at t=0.8 | Sharpe at t=1.2 | Sharpe at t=1.6 | Sharpe at t=2.0 |
|---|---|---|---|---|
| Conservative | 0.088 | −0.366 | −2.511 | −2.706 |
| Moderate | −0.174 | −0.054 | −0.629 | −0.811 |
| Active | −0.248 | −0.207 | −0.397 | −0.428 |

Conservative degrades catastrophically at high thresholds (−2.7 at t=2.0). The mechanism: with 99.9% skip rate, the strategy executes only 0.2 cycles/year on average. These rare accepted trades are essentially random draws from Heston's fat-tailed return distribution — the filter can't distinguish good from bad opportunities under stochastic variance.

Moderate and Active show a mild hump at 1.1–1.2 before degrading. The optimal thresholds (0.9, 1.2, 1.1) are close to or below the GBM-calibrated values — the Heston IV/RV distribution doesn't reward tighter filtering.

### Finding 4: Win rates improve with threshold but can't reach GBM levels

Under Heston, raising the threshold progressively increases win rate and decreases MaxDD:

| Threshold | Conservative WR% | Moderate WR% | Active WR% |
|---|---|---|---|
| OFF | 60.7 | 50.1 | 46.0 |
| 1.0 | 63.3 | 51.2 | 47.5 |
| 1.2 | 74.5 | 56.4 | 54.0 |
| 1.5 | 87.0 | 67.5 | 56.7 |
| 2.0 | 88.6 | 71.0 | 56.5 |

Active's win rate plateaus at ~57% by threshold 1.5 — far below the ~78% GBM benchmark from Exp 9. The filter successfully removes the worst trades (MaxDD drops from 31% to 10%), but the remaining trades still have sub-50% per-cycle win rates. This confirms the problem is in accepted-trade quality, not in the filter's selectivity — Heston's variance clustering corrupts the IV/RV signal that identifies profitable trades.

### Finding 5: GBM presets remain optimal — no changes needed

GBM cross-validation confirms the Heston-optimal thresholds would slightly degrade GBM performance:

| Strategy | GBM Sharpe (original t) | GBM Sharpe (Heston t) | Degradation |
|---|---|---|---|
| Conservative | 0.475 (t=1.0) | 0.474 (t=0.9) | −0.001 |
| Moderate | 0.331 (t=1.2) | — (same) | None |
| Active | 0.901 (t=1.2) | 0.867 (t=1.1) | −0.034 |

Active would lose 0.034 Sharpe under GBM if its threshold were lowered to the Heston "best." Since Heston recovery failed anyway, there is no reason to change any GBM thresholds. **All existing preset `skipBelowRatio` values are confirmed optimal.**

### Finding 6: The structural mechanism — why Heston breaks the filter

Synthesizing Experiments 9–11, the root cause is now clear:

1. **IV path source mismatch.** Under GBM, IV follows an OU process with predictable mean-reversion. The IV/RV ratio fluctuates smoothly around the VRP offset, creating clean buy/sell signals. Under Heston, IV is derived from the variance process (√v), which exhibits volatility clustering — extended periods of elevated or depressed vol with abrupt transitions.

2. **Signal quality collapse.** The IV/RV ratio under Heston has higher autocorrelation and fatter tails. When IV/RV > threshold, it often signals a vol regime shift (not a transient premium opportunity). The strategy enters trades that look profitable by the IV/RV metric but are actually at the onset of a vol cluster — subsequent price action is far more volatile than the RV estimate suggests.

3. **Lookback and threshold are both parametric solutions to a structural problem.** Longer lookback (Exp 10) smooths RV but can't track abrupt vol transitions. Higher thresholds (Exp 11) filter more aggressively but can't distinguish vol regime shifts from premium opportunities. The filter needs a fundamentally different signal (e.g., vol-of-vol, regime classifier) to work under Heston dynamics.

---

## Conclusions

1. **The Heston investigation is closed.** Three independent recovery attempts (model testing, lookback tuning, threshold recalibration) all fail. The wheel strategy under Heston dynamics is structurally non-viable for Moderate and Active profiles.

2. **Conservative is marginally viable under Heston with RF OFF** (avg Sharpe 0.103, 3/4 positive), but the edge is tiny and not worth deploying — it's pure buy-and-hold with <2 option trades per year.

3. **No preset changes needed.** All GBM `skipBelowRatio` thresholds (Conservative=1.0, Moderate=1.2, Active=1.2) are confirmed optimal.

4. **Deployment implication:** The framework's edge depends on OU-like IV/RV mean-reversion. If real-market IV dynamics exhibit Heston-like clustering (ACF > 0.5 at lag 1), the wheel strategy should not be deployed. Monitor IV/RV autocorrelation as a deployment gate.

---

## Archived Parameters

| Parameter | Values Tested |
|---|---|
| `skipBelowRatio` | 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2.0 |
| `lookbackDays` | 60 (Conservative), 30 (Moderate/Active) — from Exp 10 |
| Drifts | 0%, +5% |
| Vols | 40%, 60% |
| Model | Heston (κ=2, σ=0.5, ρ=−0.7, θ=vol²) |
| Simulations | 1,000 paths × 365 days per combo |
