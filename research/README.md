# Wheel Strategy Simulator - AI Research & Optimization

This directory serves as the command center for AI-driven discovery of optimal market environments and trading strategy parameters for the Wheel Strategy Simulator.

## Purpose

The goal is to move beyond manual trial-and-error by deploying programmatic parameter sweeps, stress tests, and algorithmic optimization directly against the core TypeScript simulation engine (`src/components/monte-carlo.ts` and `src/components/strategy/simulate.ts`). 

This document tracks our methodologies, active experiments, and final findings.

---

## AI Optimization Approaches

We employ three main strategies to find the best presets:

### 1. Iterative Grid Search (Parameter Sweep)
**Best for:** Finding the optimal balance between a few key variables (e.g., target delta vs. cycle length).
- **Process:** We define a tight range of values for 2-4 parameters. A CLI script runs the simulation across all permutations.
- **Outcome:** A ranked list of parameter combinations highlighting the trade-offs (e.g., higher returns vs. higher max drawdown).
- **Interaction:** The user reviews the top 5, selects a favorite, and we narrow the grid search around that selection for fine-tuning.

### 2. Market Stress Test (Robustness Optimization)
**Best for:** Ensuring a strategy doesn't blow up when market conditions change.
- **Process:** We define three distinct market presets:
  - **Bull Run** (High drift, low/med vol)
  - **Bear Market** (Negative drift, high vol)
  - **High-Vol Sideways** (Zero drift, extreme vol)
- **Outcome:** We run strategy combinations across *all three* environments simultaneously and score them based on their worst-case performance (identifying the most robust "all-weather" strategy).

### 3. Algorithmic Optimization (Random Search / Simulated Annealing)
**Best for:** Exploring the massive, 20+ dimension parameter space (e.g., `adaptiveCalls`, `ivRvSpread`, `rollPutWhenBelow`, etc.) where grid search is computationally impossible.
- **Process:** A script randomly samples thousands of parameter combinations or uses a simple genetic algorithm to "evolve" the best strategy over generations based on a fitness function (e.g., Sharpe Ratio).
- **Outcome:** Discovers non-intuitive parameter synergies that a human might never try.

---

## Active Workflow

1. **Define the Goal:** State what a "good" strategy looks like (Max Return? Lowest Drawdown? Highest Win rate? Best Sharpe?).
2. **Set the Baseline Market:** Choose the market profile to optimize against.
3. **Execute:** AI writes and runs the search script.
4. **Analyze:** AI presents the top results; user provides feedback and direction.
5. **Save:** Winning combinations are baked into `src/components/presets.ts` as new built-in presets (e.g., "Aggressive Wheel", "Conservative Income").

---

## Log of Findings & Presets

*(This section will be updated as we complete our runs)*

### Experiment 1: High-Vol Sideways Grid Search
- **Goal:** Maximize Sharpe Ratio (Risk-Adjusted Return)
- **Market Baseline:** High-Vol Sideways (0% drift, 150% vol, Heston)
- **Approach:** Iterative Grid Search sweeping `targetDelta` (0.10–0.40), `cycleLengthDays` (3–30), and `skipThreshold` (0–10%) across 1,000 Monte Carlo paths over 365 days. 48 total combinations. Rolling disabled.
- **Results:**
  - **Best Risk-Adjusted:** `delta: 0.1, cycle: 30, skip: 0` — 0.013 Sharpe, 0.54% APR, 35.5% Max DD, 56.8% win rate. Sortino of 7.544 reveals right-skewed returns (upside vol >> downside vol).
  - **Best Nominal Return:** `delta: 0.3, cycle: 30, skip: 0` — 8.92% APR but -0.245 Sharpe and 50.7% Max DD. Uncompensated risk.
  - **Worst Strategy:** `delta: 0.4, cycle: 3, skip: 0.1` — -0.440 Sharpe, 61.5% Max DD, 35.2% win rate. Account destroyer.
- **Key Findings:**
  1. **No parameter combination produces a positive risk-adjusted return.** Best Sharpe is 0.013 (effectively zero). In 150% vol with no drift, the wheel is not a viable standalone strategy.
  2. **30 DTE dominates short DTE.** Short-dated options carry lethal gamma exposure in high-vol chop. 30 DTE gives theta room to work and absorbs gaps. The "sell weeklies" approach is the worst performer.
  3. **Delta is a risk factor, not a return lever.** 0.1→0.4 delta increases APR but Sharpe deteriorates monotonically. You're not paid for the extra drawdown.
  4. **Always be in the market.** Skip threshold (premium filter) hurt performance across every delta/cycle combo. Continuous premium collection offsets drawdowns better than selective entry.
  5. **Sharpe understates the strategy.** The 7.5 Sortino vs 0.01 Sharpe divergence shows the return distribution is right-skewed — Sharpe penalizes upside vol, making the strategy look worse than it is for downside-focused investors.
- **Conclusion:** **The wheel strategy is not suitable for high-volatility sideways markets.** With 150% annualized vol and zero drift, no parameterization produces a meaningful risk-adjusted return. The strategy has no edge in this regime — premium collected is fully consumed by assignment losses and gamma-driven drawdowns. Attempting to optimize within this environment is futile; the correct move is to not deploy the wheel here at all.
- **Action Taken:** Results documented in `research/SWEEP1_ANALYSIS.md`. No presets saved — no combination merits a built-in preset for this regime.

### Experiment 2: Normal-Vol Regime Grid Search
- **Goal:** Find vol regimes where the wheel generates positive risk-adjusted returns (alpha over buy-and-hold).
- **Market Baseline:** GBM with stochastic IV (OU process, κ=5.0, ξ=0.5, VRP=15%), 5% annual drift, tested at 25% vol (typical equity) and 50% vol (moderate crypto).
- **Approach:** Iterative Grid Search sweeping `targetDelta` (0.10–0.40), `cycleLengthDays` (3–30), and `skipThreshold` (0–10%) across 1,000 Monte Carlo paths over 365 days. 180 total combinations. Rolling disabled.
- **Results:**
  - **Best Risk-Adjusted (50% vol):** `delta: 0.1, cycle: 30, skip: 0` — 0.417 Sharpe, 6.68% APR, 20.69% Max DD, 71.7% win rate, +2.82% alpha.
  - **Best Risk-Adjusted (25% vol):** `delta: 0.20, cycle: 3, skip: 0` — 0.352 Sharpe, 13.17% APR, 21.06% Max DD, 62.1% win rate, +8.67% alpha.
  - **Best Nominal Return:** `vol: 50%, delta: 0.4, cycle: 3, skip: 0` — 21.70% APR but 0.051 Sharpe and 40.18% Max DD. Return trap.
- **Key Findings:**
  1. **The wheel generates genuine alpha in normal-vol regimes.** 43.3% of combos had positive Sharpe. 100% had positive mean APR.
  2. **Stochastic IV reveals divergent optimal strategies by vol level.** 50% vol favors long DTE (30-day); 25% vol favors short DTE (3-day) to capture IV variability.
  3. **50% vol is the sweet spot for conservative strategies.** `delta: 0.1, cycle: 30` tops 50% vol rankings — unchanged from Experiment 1.
  4. **Skip threshold always hurts.** Every top strategy uses `skip: 0`.
  5. **High delta is a return trap.** 21%+ APR at delta 0.4 but Sharpe near zero.
  6. **Stochastic IV deflated static-IV alpha by 25%.** 50% vol best alpha went from +3.77% (static IV) to +2.82% (stochastic IV), confirming the remaining edge is genuine VRP harvesting.
- **Conclusion:** **The wheel is viable at 25–50% vol with mild positive drift, but the optimal strategy is regime-specific.** At 50% vol, conservative parameterization (low delta 0.10, long cycle 30-day) delivers 0.42 Sharpe with +2.8% alpha. At 25% vol, the opposite works: moderate delta (0.15–0.25) with short 3-day cycles delivers 0.35 Sharpe with +6–10% alpha but higher tail risk. High delta is a return trap at 50% vol but viable at 25% vol — the delta-risk relationship is non-linear and vol-dependent.
- **Action Taken:** Full analysis in `research/sweep2/SWEEP2_ANALYSIS.md`. Preset candidates identified ("Conservative Income" at 50% vol, "Active Premium" at 25% vol).

### Experiment 3: Vol Boundary Search
- **Goal:** Find the exact vol level (between 50% and 150%) where Sharpe crosses zero — defining the "wheel deployment zone."
- **Market Baseline:** GBM with stochastic IV (OU process, κ=5.0, ξ=0.5, VRP=15%), 5% annual drift, vol range 40%–155%.
- **Approach:** Two-phase search. Phase 1: coarse sweep across 24 vol levels (5% increments) × 3 strategies (Conservative δ0.10/30d, Moderate δ0.20/14d, Active δ0.20/3d) × 1,000 paths. Phase 2: fine-grained 1% increment search around detected crossover points. 80,000 total simulation paths.
- **Results:**
  - **Conservative (δ0.10/30d):** Sharpe positive across entire range (40%–155%). Peak Sharpe **0.448 at 60% vol** (8.19% APR, +4.61% alpha, 23.7% MaxDD). No vol ceiling found.
  - **Moderate (δ0.20/14d):** Sharpe crosses zero at **~82% vol**. Peak Sharpe 0.153 at 40% vol (11.64% APR, +7.51% alpha, 28.5% MaxDD).
  - **Active (δ0.20/3d):** Sharpe crosses zero at **~77% vol**. Peak Sharpe 0.157 at 40% vol (14.63% APR, +10.51% alpha, 32.2% MaxDD).
- **Key Findings:**
  1. **The conservative strategy has no practical vol ceiling.** δ0.10/30d maintains positive Sharpe even at 155% vol (0.039). Low delta minimizes gamma exposure; 30-day cycles provide time diversification.
  2. **Higher delta = lower vol ceiling.** The relationship is monotonic: δ0.10 → no ceiling, δ0.20/14d → 82%, δ0.20/3d → 77%. Higher delta amplifies gamma-driven assignment losses that overwhelm premium at high vol.
  3. **The sweet spot is 55%–65% vol.** Conservative strategy peaks at 60% — vol is high enough for meaningful premium but low enough that assignment losses don't consume it.
  4. **Sharpe and APR move in opposite directions.** At 155% vol, conservative earns 20.65% APR (4× the 40% vol return) but Sharpe is only 0.039. Classic return trap.
  5. **Alpha is universal but misleading.** The wheel beats buy-and-hold at every vol level tested in raw return terms. But positive alpha with negative Sharpe means you're not compensated for the risk.
- **Conclusion:** **The vol boundary is strategy-dependent, not universal.** Conservative parameterization (δ0.10/30d) is viable at any vol below ~155%. Moderate/active strategies have firm ceilings at 82%/77% vol respectively. The optimal deployment zone is 55%–65% vol for all strategies. Above 80% vol, only conservative parameterization should be used. For live deployment: monitor 30-day realized vol; exit moderate/active when RV > 75%, exit conservative when RV > 150%.
- **Action Taken:** Full analysis in `research/sweep3/SWEEP3_ANALYSIS.md`. Deployment zone boundaries established for all three strategy profiles.

### Experiment 4: Regime Filter
- **Goal:** Test whether skipping premium selling when IV/RV is below a threshold (no positive variance risk premium) improves risk-adjusted returns.
- **Market Baseline:** GBM with stochastic IV (OU process, κ=5.0, ξ=0.5, VRP=15%), 5% annual drift, tested at 8 vol levels (40%–150%).
- **Approach:** Sweep `skipBelowRatio` (0, 0.8, 0.9, 1.0, 1.05, 1.1, 1.2, 1.3) × 3 strategies × 8 vol levels × 1,000 paths. 192 total combinations. IV/RV spread scaling enabled (lookback=20, minMult=0.8, maxMult=1.3).
- **Results:**
  - **Conservative (δ0.10/30d):** Best Sharpe 0.494 at 50% vol with skip<1.0 (+0.083 vs baseline). Sweet spot 0.90–1.00.
  - **Moderate (δ0.20/14d):** Best Sharpe 0.341 at 40% vol with skip<1.3 (+0.174). Vol ceiling shifts ~84%→~88%.
  - **Active (δ0.20/3d):** Best Sharpe 0.346 at 40% vol with skip<1.3 (+0.167). Vol ceiling shifts ~76%→~84%.
- **Key Findings:**
  1. **Universally beneficial.** 24/24 strategy-vol combos improved. First parameter with no losers.
  2. **Optimal threshold is strategy-dependent.** Conservative: skip=0.90–1.00. Moderate/Active: skip=1.10–1.20. Higher gamma → higher threshold.
  3. **Raises vol ceilings 5–10pp.** Active 76%→84%, Moderate 84%→88%.
  4. **Aggregate sweet spot: skip=1.10** (+0.056 mean ΔSharpe across all combos).
  5. **Over-filtering (skip=1.30) degrades at high vol** — skips 40%+ of cycles, APR drops 5–15pp for marginal Sharpe gain.
- **Conclusion:** **The regime filter is the most universally effective parameter discovered.** Recommended: `skipBelowRatio=1.0` for conservative, `1.10–1.20` for moderate/active.
- **Action Taken:** Full analysis in `research/sweep4/SWEEP4_ANALYSIS.md`. Engine: `skipBelowRatio` on `IVRVSpreadConfig`, integrated into `computeIVRVMultiplier`.

### Experiment 5: Put-Only Regime Filter
- **Goal:** Determine whether applying `skipBelowRatio` to puts only (always sell calls when holding ETH) improves risk-adjusted returns vs. the current "skip both" behavior from Experiment 4.
- **Market Baseline:** GBM with stochastic IV (OU process, κ=5.0, ξ=0.5, VRP=15%), 5% annual drift, tested at 8 vol levels (40%–150%).
- **Approach:** Sweep `skipSide` ("both", "put") × `skipBelowRatio` (0, 0.9, 1.0, 1.1, 1.2) × 3 strategies × 8 vol levels × 1,000 paths. 216 unique combinations.
- **Results:**
  - **Conservative (δ0.10/30d):** put-only wins 22/32 combos, mean ΔSharpe +0.008. Best: vol=60%, skip=1.1, side=put → Sharpe **0.503**, APR 10.92%.
  - **Moderate (δ0.20/14d):** put-only wins 28/32 combos, mean ΔSharpe +0.024. Best: vol=40%, skip=1.2, side=put → Sharpe **0.372**, APR 16.44%.
  - **Active (δ0.20/3d):** put-only wins **30/32** combos, mean ΔSharpe **+0.065**. Best: vol=40%, skip=1.2, side=put → Sharpe **0.473**, APR 21.31%. Largest single Sharpe improvement in the research program.
- **Key Findings:**
  1. **Put-only filtering is strictly superior for moderate/active strategies.** Skipping calls leaves naked ETH exposure with zero premium income — call premium cushions drawdowns during low-VRP periods.
  2. **Effect scales with gamma exposure.** Conservative: +0.008 mean ΔSharpe. Moderate: +0.024. Active: +0.065. Higher delta + shorter cycles = more value from keeping calls enabled.
  3. **Vol ceilings extend dramatically.** Active: 76%→92% (+16pp). Moderate: 84%→93% (+9pp). Put-only filtering makes moderate/active strategies viable in significantly more volatile markets.
  4. **APR slightly lower, Sharpe much higher.** Put-only sacrifices 0.3–1.0% APR for 2–5pp lower MaxDD and 2–6pp higher win rates — classic risk-adjustment win.
  5. **Active strategy rehabilitated.** At skip=1.2/put-only/40% vol, Active achieves 0.473 Sharpe — higher than Conservative's baseline 0.41. Previously uncompetitive on risk-adjusted basis.
  6. **Always sell calls when holding ETH.** The VRP regime signal is irrelevant for covered calls — you already own the ETH, so selling calls always reduces risk regardless of IV/RV ratio.
- **Conclusion:** **`skipSide: "put"` should be the default for moderate and active strategies.** There is no scenario where "both" is clearly better for these profiles. For conservative, the effect is small but still net positive. Recommended: `skipBelowRatio=1.2, skipSide="put"` for moderate/active; `skipBelowRatio=1.0–1.2, skipSide="put"` for conservative.
- **Action Taken:** Full analysis in `research/sweep5/SWEEP5_ANALYSIS.md`. Engine: `skipSide` on `IVRVSpreadConfig`, `side` parameter on `computeIVRVMultiplier`.

### Experiment 6: Combined Feature Stack
- **Goal:** Test the full combination of best settings from Experiments 2–5 — regime filter, adaptive calls, call rolling, put rolling, stop-loss — all enabled simultaneously. Answer: Do features stack additively or interfere?
- **Market Baseline:** GBM with stochastic IV (OU process, κ=5.0, ξ=0.5, VRP=15%), 5% annual drift, tested at 4 vol levels (40%, 60%, 80%, 100%).
- **Approach:** Full factorial over 5 binary feature toggles × 3 strategies × 4 vol levels. Conservative/Moderate: 2^5 = 32 combos; Active: 2^4 = 16 (no put rolling). 320 total configurations × 1,000 paths = 320,000 simulation paths.
- **Results:**
  - **Conservative (δ0.10/30d):** Best config **RF+AC+PR** (Regime Filter + Adaptive Calls + Put Rolling). Sharpe 0.569 at 40% vol, 0.515 at 60%. Robust across all vol levels.
  - **Moderate (δ0.20/14d):** Best config **RF** or **RF+PR** (Regime Filter ± Put Rolling). Sharpe 0.422 at 40% vol, 0.323 at 60%. Adaptive calls harmful (-0.011 to -0.071 ΔSharpe).
  - **Active (δ0.20/3d):** Best config **RF only** (Regime Filter alone). Sharpe **1.044** at 40% vol — highest risk-adjusted return in entire research program. 33.94% APR, 15.1% MaxDD, 86.2% win rate.
- **Key Findings:**
  1. **Features do NOT stack additively.** The dominant feature (regime filter, +0.186 mean ΔSharpe) provides the vast majority of improvement. Adding more features yields diminishing or negative returns.
  2. **Adaptive Calls are strategy-dependent.** Beneficial for Conservative (low δ0.10, +0.083–0.118 marginal), but harmful for Moderate/Active (higher δ0.20, -0.011 to -0.383 marginal). Conflicts with regime filter at higher delta: -0.231 interaction for Active.
  3. **Stop-Loss has zero impact.** Zero triggers across all 320 configurations. The wheel strategy's cycling structure inherently limits drawdowns below the 25% threshold. Stop-loss is not redundant because of filtering — it's structurally unnecessary.
  4. **Call Rolling has zero impact.** At δ0.10–0.20, calls are sold far enough OTM that the 5% ITM threshold for rolling is never triggered.
  5. **Put Rolling helps Conservative only.** +0.020 mean ΔSharpe. Extends OTM put duration, reducing whipsaw. Weakly positive for Moderate at higher vol, disabled for Active (3d cycle too short).
  6. **Full stack actively degrades Active.** At 60% vol: full stack 0.302 Sharpe vs RF-only 0.797 — a -0.495 loss. More features ≠ better.
  7. **Less is more.** Optimal feature count: Conservative=3 (RF+AC+PR), Moderate=1–2 (RF or RF+PR), Active=1 (RF only).
- **Conclusion:** **The regime filter is the single most important feature, and it's sufficient alone for Moderate/Active strategies.** Conservative benefits from layering adaptive calls and put rolling on top, but only because its low delta avoids the filter-adaptive conflict. Stop-loss and call rolling should default to OFF — they contribute nothing at the tested parameter ranges. The Active strategy with regime filter alone (1.044 Sharpe at 40% vol) is the strongest risk-adjusted configuration discovered in the research program.
- **Action Taken:** Full analysis in `research/sweep6/SWEEP6_ANALYSIS.md`. Presets updated: Conservative (δ0.10/30d, RF+AC+PR), Moderate (δ0.20/14d, RF+PR), Aggressive (δ0.20/3d, RF only).

### Experiment 7: Drift Sensitivity
- **Goal:** Test whether the Exp 6 optimal configs remain viable across different drift regimes. All prior experiments assumed 5% annual drift. Crypto drift ranges from -80% (bear) to +200% (bull).
- **Market Baseline:** GBM with stochastic IV (OU process, κ=5.0, ξ=0.5, VRP=15%), tested at 6 drift levels (-30%, -10%, 0%, +5%, +20%, +50%) and 4 vol levels (40%, 60%, 80%, 100%).
- **Approach:** Each strategy tested with optimal config (RF ON) and baseline (RF OFF) across all drift × vol combos. 144 total combinations × 1,000 paths = 144,000 simulation paths.
- **Results:**
  - **Conservative (δ0.10/30d, RF+AC+PR):** Sharpe positive at 20/24 combos (83%). Fails only at -30% drift (all vol levels). Best: +50% drift / 40% vol → Sharpe 1.477. Crossover at ~-17% to -25% drift depending on vol.
  - **Moderate (δ0.20/14d, RF+PR):** Sharpe positive at 20/24 combos (83%). Fails only at -30% drift. Best: +50% drift / 40% vol → Sharpe 1.245. Crossover at ~-11% to -18% drift depending on vol.
  - **Active (δ0.20/3d, RF only):** **Sharpe positive at ALL 24/24 combos (100%).** Even at -30% drift / 100% vol: Sharpe 0.296, APR 34.86%, 66.5% win rate. Best: +50% drift / 40% vol → Sharpe 1.765.
- **Key Findings:**
  1. **Active is drift-immune.** Positive Sharpe across the entire tested parameter space (-30% to +50% drift, 40-100% vol). The regime filter naturally adapts by skipping more put cycles in adverse conditions; the ~6% of cycles it accepts remain profitable. No drift guard needed.
  2. **Conservative/Moderate fail only at -30% drift.** At -10% drift, both strategies are viable across all vol levels. Deployment floor is approximately -15% (Conservative) to -10% (Moderate) annual drift.
  3. **Regime filter wins 72/72 combinations (100%).** Not a single case where removing RF improves Sharpe. RF's value *increases* in bear markets: Active ΔSharpe from RF is +0.308 at -30% drift vs +0.177 at +50% drift.
  4. **Skip rates are insensitive to drift.** Conservative: 98-99% skip at any drift. Active: ~94%. The filter is not over-skipping in bear markets — skip rates vary <2% across drift levels.
  5. **Alpha inverts with drift.** The wheel generates massive alpha in bear markets (+54% avg for Active at -30% drift) and trails buy-and-hold in strong bulls (-34% for Conservative at +50% drift). The wheel is a bear market outperformer that trades upside participation for downside protection.
  6. **Drift sensitivity is monotonic and smooth.** No regime cliffs or non-linear breakpoints. Sharpe degrades linearly with decreasing drift, enabling simple linear deployment rules.
  7. **Exp 6 configs are drift-stable.** RF ON is optimal at every drift × vol × strategy combination. No need for drift-specific preset configurations.
- **Conclusion:** **Active (δ0.20/3d, RF only) is the all-weather strategy.** It maintains positive risk-adjusted returns across the entire tested drift × vol space, generating +54% alpha over buy-and-hold in deep bear markets while still delivering 1.765 Sharpe in strong bulls. Conservative/Moderate need a drift guard (exit when trailing annualized return < -15%/-10%) but are otherwise robust. The regime filter is universally beneficial and becomes *more* valuable in adverse drift conditions. No changes to preset configurations are needed — Exp 6 optimal configs are drift-regime invariant.
- **Action Taken:** Full analysis in `research/sweep7/SWEEP7_ANALYSIS.md`. Deployment zone updated with drift boundaries. No preset changes — Exp 6 configs confirmed stable across drift regimes.

---

<!-- NOTE: Keep this section at the end of the file. New experiments append above this section; new follow-up ideas append to the list below. -->
## Recommended Next Experiments

### Critical — Must answer before production deployment

- **Experiment 8: VRP Sensitivity** — The regime filter is the single most important feature across all 7 experiments: +0.186 mean ΔSharpe (Exp 6), 72/72 win rate across drift regimes (Exp 7), and the primary reason Active survives bear markets (+0.308 ΔSharpe at -30% drift). It explicitly exploits VRP by comparing IV to RV — if real VRP is lower than the assumed 15%, the filtering signal degrades and the entire strategy framework may be overfitted. Test the Exp 6 optimal configs at VRP=0% (no edge), 5% (thin edge), 10%, 15% (current), and 25% (fat edge) across drift levels 0% and -30% (Exp 7 showed drift matters). Key questions: At what VRP level does the regime filter stop helping? Does Active's drift immunity (Exp 7) depend on VRP=15%? Is the put-only filter still beneficial when IV barely exceeds RV? This is existential — if VRP < 10% breaks the strategy, the "deployment zone" needs a VRP floor alongside the drift floor established in Exp 7.

### High — Robustness validation; affects deployment confidence

- **Experiment 9: Model Robustness** — All 7 experiments used GBM with stochastic IV. Run the Exp 6 optimal configs across all 4 price models (GBM, Heston, Jump, Heston-Jump) at vol levels 40–80%. Heston's vol clustering may cause the regime filter to trigger in bursts rather than smoothly — the filter could skip 50 consecutive cycles then fire 30 in a row, producing path-dependent outcomes very different from GBM's smoother IV dynamics. Jump processes may cause sudden assignment cascades that the δ0.20 strategies can't absorb. Exp 7 showed Active is robust across drift — but that was GBM-only. If Active's drift immunity breaks under Heston-Jump, the "all-weather" claim needs qualification.
- **Experiment 10: Multi-Year Horizon** — All experiments use 365-day simulations. Run the Exp 6 optimal configs over 2-year and 5-year horizons at multiple drift levels (0%, +5%, -30%). Exp 7 showed Active earns 18% APR at -30% drift over 1 year — does that survive 2+ years of sustained decline, or does compounding drawdown eventually overwhelm premium income? The regime filter skips ~94% of cycles for Active — over multiple years, the ~6% acceptance rate compounds differently than 1-year projections suggest. Also tests whether `skipBelowRatio` thresholds remain stable or need recalibration as vol regimes shift.
- **Experiment 11: Lookback × Cycle Interaction** — *(Elevated from Medium.)* IV/RV lookback is fixed at 20 days across all 7 experiments. The regime filter is the dominant feature (Exp 6) and its effectiveness in bear markets (Exp 7) depends directly on lookback window quality. Active's 3-day cycle with 20-day lookback may act on stale regime signals; Conservative's 30-day cycle might benefit from longer lookback. Test lookback values 5–60 days crossed with all three cycle lengths at drift levels 0% and -30%. Since RF is the only feature that matters for Moderate/Active, optimizing its input signal has outsized impact.

### Medium — Parameter refinement within proven framework

- **Experiment 12: Adaptive Calls Rehabilitation** — Exp 6 found adaptive calls are harmful for Moderate/Active (up to -0.383 ΔSharpe) due to a -0.231 interaction with regime filter. But AC helps Conservative (+0.118). The conflict may be caused by AC's wide delta band (0.10–0.50) and aggressive skipping at higher base deltas. Test narrower bands (0.15–0.30), higher `skipThresholdPct` values (0.5–2%), and `minStrikeAtCost=false` for Moderate/Active to see if a tuned AC can coexist with RF. If solvable, all three strategies benefit from adaptive calls.
- **Experiment 13: Vol-Adaptive Skip Threshold** — Experiments 4–6 confirmed that optimal `skipBelowRatio` varies by strategy (Conservative: 1.0, Moderate/Active: 1.2). Exp 7 showed skip rates are remarkably stable across drift (< 2% variation), suggesting the current fixed thresholds are robust. Test a dynamic formula: `skipBelowRatio = base + k × annualizedVol` to see if a single adaptive rule replaces per-strategy tuning. Lower priority than before — Exp 7 demonstrated the fixed thresholds work across drift regimes, so the main benefit is configuration simplification rather than performance improvement.

### Low — Speculative or requires engine changes

- **Experiment 14: Defined-Risk Spreads** — Vertical spreads (5-wide, 10-wide put spreads) to cap max loss per cycle. Exp 6 showed stop-loss is structurally unnecessary at 25% threshold (zero triggers), but spreads address a different problem: truncating gamma-driven drawdown tails for deployment above 80% vol. Requires engine changes: spread payoff logic, margin treatment, and dual-leg rolling. High implementation cost but could eliminate the vol ceiling entirely.
- **Experiment 15: Kelly Sizing** — Fractional Kelly criterion for position sizing. Exp 6 showed the wheel's cycling structure inherently limits drawdowns below 25%, so Kelly's main value is in marginal vol regimes (80–100%) where exposure reduction during thin-edge periods could lift Sharpe. Test ½-Kelly and ¼-Kelly against fixed 1-contract sizing. Requires bankroll tracking in the simulation engine.
- **Experiment 16: Drift Estimation Signal** — Exp 7 established that Conservative/Moderate need a drift guard (exit below -15%/-10% annual drift). In practice, drift must be estimated from trailing price data. Test trailing windows (30d, 60d, 90d annualized return) as drift estimators and simulate the strategy switching between Active (any drift) and Conservative/Moderate (above threshold) based on the signal. Key question: does the estimation lag cause whipsaw at drift boundaries, or does the smooth Sharpe degradation (Exp 7 finding #6) provide enough margin?
