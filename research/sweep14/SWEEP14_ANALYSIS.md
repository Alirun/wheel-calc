# Experiment 14: Deployment Signal Estimation — Analysis

## Setup

| Parameter | Values |
|---|---|
| Strategy | Active (δ0.20/3d, RF only) |
| Signal types | VRP threshold, ACF guard, Combined |
| Vol | 40%, 60% |
| True VRP | 5%, 10%, 15% |
| Drifts | 0%, +5%, −30% |
| Models | GBM, Jump |
| Horizons | 1yr (365d), 5yr (1825d) |
| OU params | κ=5 (normal), κ=1 (high clustering for ACF test) |
| Paths | 1,000 per combo |
| Sub-experiments | A: Signal accuracy (72 combos), B: VRP deployment (216), C: ACF guard (56), D: Combined (288) |
| Execution | Multi-threaded (8 workers), 1,102s total |

All runs use Active's Exp 6 optimal config with regime filter ON. Deployment signals are an additional layer: VRP threshold requires trailing estimated VRP ≥ floor; ACF guard requires trailing ACF(1) ≤ ceiling. Both must pass for the strategy to deploy on a given day.

## Sub-experiment A: Signal Accuracy Validation

### VRP Estimation

| True VRP | Vol | Window | Mean Est | Std | RMSE | Bias |
|---|---|---|---|---|---|---|
| 5% | 40% | 20d | 3.26% | 15.35% | 15.40% | +1.26% |
| 5% | 40% | 60d | 2.96% | 13.87% | 13.90% | +0.96% |
| 10% | 40% | 20d | 5.19% | 15.43% | 15.48% | +1.19% |
| 10% | 60% | 20d | 7.28% | 16.62% | 16.67% | +1.28% |
| 15% | 40% | 20d | 7.14% | 15.49% | 15.54% | +1.14% |
| 15% | 60% | 60d | 9.92% | 14.64% | 14.67% | +0.92% |

**Systematic underestimation:** True 5% → estimated 3.3%, true 10% → 5.2%, true 15% → 7.1% (at 40% vol, 20d window). The estimator captures ~50% of true VRP at best (60% vol, 15% VRP → 10.3%).

**Noise overwhelms signal:** RMSE is 14–17% — 1.5–3× larger than the VRP being estimated. With standard deviation of 14–17% around a 3–10% mean, roughly half of all daily estimates will have the wrong sign. Any threshold will randomly reject ~50% of deploy-worthy days.

**Drift-invariant:** Identical estimates at 0% and 5% drift (bit-for-bit identical). The trailing VRP estimator correctly strips drift from both IV and RV estimates.

**Longer windows help marginally:** RMSE drops from 15.4% (20d) → 13.9% (60d) at 40% vol — a 10% reduction. The noise-to-signal ratio remains unacceptable regardless of window length.

### ACF Estimation

| Vol | Window | Mean ACF | Std ACF |
|---|---|---|---|
| 40% | 20d | 0.679 | 0.159 |
| 40% | 40d | 0.818 | 0.099 |
| 40% | 60d | 0.868 | 0.074 |
| 60% | 20d | 0.678 | 0.163 |
| 60% | 60d | 0.868 | 0.073 |

**ACF is universally high:** Mean ACF ranges 0.68–0.87 across all conditions. This is expected for an OU process at κ=5 — the log-return autocorrelation structure inherits the IV persistence. The ACF is a property of the OU dynamics, not of market regime.

**Tight variance at longer windows:** Std drops from 0.16 (20d) → 0.07 (60d). At 60d, 95% of ACF observations fall in [0.72, 1.01]. Any threshold below ~0.7 will block almost all trading.

## Sub-experiment B: VRP-Based Deployment

### Best VRP Configs (mean ΔSharpe across all conditions)

| Config | Mean ΔSharpe | Win Rate | N |
|---|---|---|---|
| w=20d, t=5% | **−0.030** | 5.6% | 18 |
| w=40d, t=5% | −0.037 | 0.0% | 18 |
| w=60d, t=5% | −0.038 | 0.0% | 18 |
| w=20d, t=8% | −0.061 | 0.0% | 18 |
| w=40d, t=8% | −0.072 | 0.0% | 18 |
| w=60d, t=8% | −0.074 | 0.0% | 18 |
| w=20d, t=10% | −0.089 | 0.0% | 18 |
| w=40d, t=10% | −0.101 | 0.0% | 18 |
| w=60d, t=10% | −0.105 | 0.0% | 18 |

**Every VRP config degrades performance.** The best config (20d window, 5% threshold) loses −0.030 mean Sharpe with a 5.6% win rate (1/18 combos positive). Only 1/162 total combos across all configs produces positive ΔSharpe — statistical noise, not signal.

**Higher thresholds → worse performance.** Each 3pp threshold increase costs −0.03 Sharpe. The threshold forces more deployment skips (171–210 skips/yr at 1yr), reducing executed cycles from ~8 to ~5 per year without improving trade quality.

**Longer windows → worse performance.** Longer lookback windows produce more stable VRP estimates but also lower ones (estimates converge further below true VRP), increasing the rejection rate.

### Horizon effect

At 5yr, performance degradation amplifies: VRP deployment skips compound to 686–1,155 days out of 1,825 (38–63% of the period paused). The strategy still executes 20–37 cycles but misses many profitable premium windows. ΔSharpe worsens from −0.030 (1yr) to −0.040 (5yr) at the best config.

### Why VRP thresholding fails

The root cause is Sub-experiment A's finding: RMSE (14–17%) dwarfs the signal (true VRP 5–15%). The estimated VRP is essentially a mean-zero noise process shifted by 3–10%. A threshold at 5% rejects ~40–60% of days randomly — not selectively removing low-VRP days. The regime filter already handles selective trading via the IV/RV ratio at each decision point, making an additional layer redundant.

## Sub-experiment C: ACF-Based Guard

### Results by OU persistence

| κ | Best Config | Mean ΔSharpe | Win Rate |
|---|---|---|---|
| 1 (high clustering) | w=30d, t=0.7 | −0.738 avg | 0.0% |
| 5 (normal) | w=30d, t=0.7 | −0.656 avg | 0.0% |
| Overall best | w=30d, t=0.7 | **−0.656** | **0.0%** |

**Catastrophic performance.** The ACF guard is the most destructive signal tested. Mean ΔSharpe ranges −0.66 to −0.84 across configs — worse than not trading at all.

**ACF guard blocks nearly all trading.** At the best config (w=30d, t=0.7), the strategy executes only 2.9–3.5 cycles per year (vs ~8 baseline). Deployment skips average 232–234 days/year, pausing the strategy ~64% of the time.

**The guard blocks good AND bad trades indiscriminately.** ACF for the OU process is inherently high (0.68–0.87 from Sub-exp A). Any ceiling ≤0.7 blocks most of the time; any ceiling >0.7 blocks little. The threshold has no discriminating power to distinguish high-clustering (danger) from normal mean-reversion (opportunity).

**Higher κ (less clustering) paradoxically produces similar or worse results.** At κ=1 (true high clustering), baseline Sharpe is already higher (0.84–0.99 vs 0.56–0.74 at κ=5) — the wheel strategy benefits somewhat from the wider IV/RV swings that come with slow mean-reversion. The ACF guard at κ=1 destroys even more absolute Sharpe.

## Sub-experiment D: Combined Signal

### Mean ΔSharpe by signal type (across all conditions)

| Signal | Mean ΔSharpe | Positive ΔSharpe |
|---|---|---|
| VRP only (w=20d, t=5%) | −0.047 | 2/72 (2.8%) |
| ACF only (w=30d, t=0.7) | −0.600 | 0/72 (0.0%) |
| Combined (VRP + ACF) | **−0.620** | 0/72 (0.0%) |

**Combined is worse than either individual signal.** Adding ACF to VRP makes the signal strictly worse — ACF dominates the combined decision and blocks most trading, just as it does alone.

**Model-invariant result.** GBM and Jump both show the same pattern: VRP-only degrades mildly, ACF-only collapses performance, combined collapses further. Under Jump, VRP-only occasionally produces +ΔSharpe (2 combos) but combined never does.

**5yr amplifies the damage.** At 5yr, combined signals skip 1,486–1,601 of 1,825 days (81–88% paused). The strategy executes only 20–34 cycles over 5 years, and even the accepted trades produce inferior Sharpe because the random selection misses many premium-rich windows.

## Whipsaw Analysis

| Horizon | Avg Deploy Skips | Avg Exec Cycles | Skip/Execute Ratio |
|---|---|---|---|
| 1yr | 158.9 | 6.0 | 26.4 |
| 5yr | 915.3 | 28.0 | 32.7 |

The deployment signal creates extreme whipsaw: ~27–33 days skipped for every executed cycle. This granular deploy/pause oscillation provides no regime-filtering benefit — it's random noise-driven switching that reduces exposure without improving trade selection. The regime filter's IV/RV ratio already achieves selective trade entry without this overhead.

## Key Findings

1. **Deployment signal does NOT improve performance.** Only 1/210 signal combos (0.5%) achieve positive ΔSharpe. Mean ΔSharpe across all signal types is −0.225. The existing regime filter is sufficient and strictly better than any additional deployment layer.

2. **VRP estimation noise is fundamental, not fixable.** RMSE of 14–17% against true VRP of 5–15% means the signal-to-noise ratio is <1. Even at the optimal window (20d), the estimator captures only ~50% of true VRP with standard deviation 3× larger than the estimate itself. No practical threshold can extract useful information from this noise.

3. **ACF guard is structurally incompatible with OU dynamics.** OU processes at realistic κ values produce ACF(1) in the 0.68–0.87 range universally. The ACF measurement cannot distinguish "dangerous clustering" from "normal mean-reversion" because the OU-driven IV path exhibits persistent autocorrelation by construction. The Exp 9/11 recommendation to "pause when ACF > 0.5" was designed for Heston-vs-OU *detection* (Heston ACF >> OU ACF), not for within-OU regime filtering.

4. **The regime filter already IS the deployment signal.** Active's RF checks IV/RV ratio at each put-sale decision point, accepting ~5% of opportunities. This per-decision gate is superior to a coarse deploy/pause layer because it operates at the right granularity — individual trade decisions, not daily on/off switches.

5. **Active's all-weather property makes deployment signals unnecessary.** Exp 7–8 showed Active's Sharpe degrades smoothly and linearly with drift and VRP, never exhibits regime cliffs. A deployment signal would be valuable if there were a sharp boundary between "deploy" and "don't deploy" regimes, but Active's edge erodes gradually. Pausing removes premium income during weak-edge periods, producing net-negative impact.

6. **Estimation lag causes whipsaw, not margin protection.** The original hypothesis (from Exp 14 description) asked whether "smooth Sharpe degradation provides enough margin" for estimation lag. The answer is: the margin exists, but the estimator's noise creates constant deploy/pause oscillation (26–33 skip days per executed cycle) that overwhelms any margin benefit.

## Conclusion

**No deployment signal should be added to the framework.** The existing regime filter (`skipBelowRatio`, `skipSide: "put"`) already provides the optimal deployment decision at the correct granularity — per-trade, not per-day. Adding VRP thresholds or ACF guards on top removes profitable trades without improving selectivity.

For live deployment: the Exp 8 VRP floor (≥10%) and Exp 9/11 Heston-detection guidance (ACF > 0.5 = Heston dynamics) remain valid as *human-level* monitoring checks performed before deploying the strategy to a new market. They should NOT be automated as real-time signal gates in the production engine — the estimation noise makes automated thresholding worse than no thresholding.

**Recommendation:** Remove the `deploymentSignal` config from the engine — it adds complexity with no benefit. If retained for future research, it should be disabled by default.
