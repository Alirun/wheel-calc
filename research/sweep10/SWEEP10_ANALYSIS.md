# Experiment 10: Lookback × Cycle Interaction — Analysis

## Overview

**Objective:** Determine whether tuning `lookbackDays` (hardcoded at 20 in all prior experiments) can (a) improve GBM performance and (b) recover positive Sharpe under Heston.

**Parameter Space:** 2 models (GBM, Heston) × 7 lookbacks (5, 10, 15, 20, 30, 45, 60) × 2 drifts (0%, −30%) × 2 vols (40%, 60%) × 3 strategies × 2 configs (RF ON/OFF) = **336 combinations × 1,000 paths = 336,000 simulations.**

---

## Key Findings

### Finding 1: Lookback tuning CANNOT recover Heston performance

The critical path question is answered definitively: **no lookback value recovers positive Sharpe under Heston for Moderate or Active strategies.**

| Strategy     | Default (20d) Sharpe | Best Lookback | Best Sharpe | Positive |
|--------------|---------------------|---------------|-------------|----------|
| Conservative | −0.307              | 60d           | −0.278      | 1/4      |
| Moderate     | −0.345              | 30d           | −0.307      | 0/4      |
| Active       | −0.384              | 30d           | −0.371      | 0/4      |

The only positive Heston condition is Conservative at drift=0%, vol=60% (Sharpe 0.088 at 60d lookback — barely above zero). The ΔSharpe improvements from lookback tuning are +0.013 to +0.038 — marginal. Zero additional conditions flip from negative to positive.

The win rate gap between GBM and Heston is persistent and unclosable:
- Conservative: −7 to −10pp at all lookbacks
- Moderate: −10 to −16pp
- Active: **−30 to −33pp** — devastating

**Verdict:** The Heston failure is structural, not parametric. The regime filter's IV/RV signal degrades under Heston's variance clustering regardless of how much price history is used for realized vol estimation.

### Finding 2: Optimal GBM lookback is 30–45d, not 20d

Longer lookback windows marginally improve risk-adjusted returns under GBM:

| Strategy     | Default (20d) | Best Lookback | Best Sharpe | ΔSharpe |
|--------------|---------------|---------------|-------------|---------|
| Conservative | 0.101         | **45d**       | 0.126       | **+0.025** |
| Moderate     | 0.034         | 30d           | 0.052       | +0.018  |
| Active       | 0.640         | 30d           | 0.658       | +0.018  |

Conservative's improvement (+0.025) crosses the 0.02 significance threshold. Moderate and Active improvements are sub-threshold but directionally consistent — everything points toward 30d being a better default than 20d.

Bear drift (−30%) drives the benefit: longer lookback smooths the RV estimate, producing more stable IV/RV ratios and better trade selection. Under flat drift, the curve is flatter with a peak at 15–30d.

### Finding 3: There is no simple lookback/cycle ratio rule

The hypothesis that optimal lookback ≈ 2× cycle length does not hold:

| Strategy     | Cycle | Best LB (GBM) | Ratio  |
|--------------|-------|---------------|--------|
| Conservative | 30d   | 45d           | 1.5×   |
| Moderate     | 14d   | 30d           | 2.1×   |
| Active       | 3d    | 30d           | **10×** |

Active converges to 30d despite its 3-day cycle (ratio 10×). This reveals a **floor around 30d** driven by the minimum sample size needed for meaningful realized vol estimation, irrespective of trade frequency. The "optimal lookback" is a statistical estimation parameter, not a cycle-timing parameter.

### Finding 4: Regime filter is universally beneficial at lookback ≥ 15d under GBM

Under GBM:
- Moderate & Active: RF wins 4/4 conditions at **every** lookback value
- Conservative: RF wins 4/4 only at lookback ≥ 15d. At 5–10d, RF's signal quality degrades (too few data points for stable RV estimate)

Under Heston:
- Moderate & Active: RF wins 4/4 at every lookback, but can't rescue negative baseline Sharpe
- Conservative: RF **hurts** at short lookbacks (5–15d, ΔSharpe −0.03 to −0.04). Only at 60d does RF break even. This confirms the Conservative + Heston combination is uniquely problematic: at δ0.10 with 99%+ skip rates, the few accepted trades under Heston are net-negative

### Finding 5: Skip rate increases monotonically with lookback

Longer lookback → more conservative RV estimate → higher IV/RV threshold → more cycles skipped:
- GBM Active: 88.9% (5d) → 94.8% (30d) → 95.2% (60d)
- Heston Active: 90.5% (5d) → 98.0% (30d) → 98.5% (60d)

At short lookbacks (5d), the RV estimate is noisy, producing volatile IV/RV ratios that occasionally admit more trades — but the quality of those trades is lower (win rate drops). The 30d lookback hits the optimal accuracy/frequency tradeoff.

---

## Detailed Results

### GBM Sharpe by Lookback (Average across drift × vol)

| Lookback | Conservative | Moderate | Active  |
|----------|-------------|----------|---------|
| 5d       | −0.005      | −0.022   | 0.556   |
| 10d      | 0.039       | 0.022    | 0.624   |
| 15d      | 0.095       | 0.039    | 0.639   |
| **20d**  | **0.101**   | **0.034**| **0.640**|
| **30d**  | 0.114       | **0.052**| **0.658**|
| **45d**  | **0.126**   | 0.044   | 0.615   |
| 60d      | 0.094       | 0.020   | 0.604   |

### Heston Sharpe by Lookback (Average across drift × vol)

| Lookback | Conservative | Moderate | Active  |
|----------|-------------|----------|---------|
| 5d       | −0.376      | −0.360   | −0.393  |
| 10d      | −0.328      | −0.342   | −0.398  |
| 15d      | −0.319      | −0.332   | −0.379  |
| **20d**  | **−0.307**  | **−0.345**| **−0.384**|
| **30d**  | −0.294      | **−0.307**| **−0.371**|
| 45d      | −0.295      | −0.326   | −0.374  |
| **60d**  | **−0.278**  | −0.327   | −0.403  |

---

## Conclusions

1. **Heston recovery via lookback tuning: FAILED.** The OU-to-Heston IV signal mismatch is structural. Lookback tuning produces marginal improvements (ΔSharpe +0.01–0.04) but cannot flip negative Sharpe to positive. Proceed to Experiment 11 (skip threshold recalibration) as the next recovery attempt; if that also fails, the Heston investigation should be closed.

2. **GBM default lookback: CHANGE Conservative to 45d, KEEP 20d for others.** Conservative's +0.025 ΔSharpe at 45d is the only above-threshold improvement. The 30d universal optimum for Moderate/Active (+0.018) is directionally correct but too small to justify a preset change. If simplicity is preferred, 30d is a reasonable universal default that never hurts.

3. **No lookback/cycle ratio rule exists.** Optimal lookback is 30–45d regardless of cycle length, driven by the minimum sample size for stable RV estimation. Short lookbacks (5–10d) produce noisy RV → noisy IV/RV ratios → degraded RF signal quality.

4. **Short lookback (5d) hurts every strategy.** 5d lookback has the worst Sharpe at 5/6 model × strategy combinations. It's worse than no regime filter for Conservative under GBM (negative ΔSharpe at 5d/10d). The absolute minimum viable lookback is 15d.

5. **RF is universally beneficial at lookback ≥ 15d under GBM.** Below 15d, Conservative's RF signal degrades. For Moderate/Active, RF helps at every lookback.

---

## Action Items

- [ ] Update Conservative preset: `lookbackDays: 20 → 45`
- [ ] Consider updating universal default to 30d (optional — improvement sub-threshold for Moderate/Active)
- [ ] Proceed to Experiment 11: Heston Skip Threshold Recalibration
- [ ] If Exp 11 also fails to recover Heston, close the Heston investigation and document as structural limitation
