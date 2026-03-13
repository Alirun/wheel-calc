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

### Performance Note

Sweep scripts should use **multi-threaded execution** (e.g., Node.js `worker_threads`) to parallelize Monte Carlo paths across available CPU cores. Single-threaded sweeps with 200+ combos × 1,000 paths take unnecessarily long when the machine has many cores idle. This is especially critical for multi-year simulations (5yr = 1,825 daily steps per path) where per-path compute is 5× a 1yr sweep — Exps 12–13 were bottlenecked by single-core execution despite having many cores available.

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

### Experiment 8: VRP Sensitivity
- **Goal:** Test whether the regime filter and strategy viability depend on the assumed Variance Risk Premium (VRP). All prior experiments assumed VRP=15%. The regime filter explicitly exploits VRP — if real VRP is lower, the filtering signal degrades and the entire framework may be overfitted.
- **Market Baseline:** GBM with stochastic IV (OU process, κ=5.0, ξ=0.5), VRP varied from 0% to 25%, tested at drift levels 0% and -30%, vol levels 40%–100%.
- **Approach:** Sweep VRP (0%, 5%, 10%, 15%, 25%) × drift (0%, -30%) × vol (40%, 60%, 80%, 100%) × 3 strategies × 2 configs (Optimal RF ON, Baseline RF OFF) × 1,000 paths. 240 total combinations = 240,000 simulation paths.
- **Results:**
  - **Conservative (δ0.10/30d, RF+AC+PR):** At drift=0%, viable (Sharpe>0) at VRP≥5%. At drift=-30%, not viable at any tested VRP except VRP=25% at vol≥60%. Avg Sharpe ranges from -0.150 (VRP=0%) to 0.300 (VRP=25%).
  - **Moderate (δ0.20/14d, RF+PR):** At drift=0%, viable at VRP≥10%. At drift=-30%, not viable at 40-60% vol even at VRP=25%. Avg Sharpe ranges from -0.187 (VRP=0%) to 0.172 (VRP=25%).
  - **Active (δ0.20/3d, RF only):** At drift=0%, viable at VRP≥5% (all vol≤80% at VRP=0%). At drift=-30%, viable at VRP≥10%. Avg Sharpe ranges from 0.060 (VRP=0%) to 0.889 (VRP=25%). Drift-immune at VRP≥10%.
- **Key Findings:**
  1. **Regime filter wins 120/120 combinations — universally beneficial at every VRP level.** Even at VRP=0%, RF improves Sharpe for every strategy × drift × vol combo. RF value *inversely* correlates with VRP: Active ΔSharpe is +0.517 at VRP=0% vs +0.164 at VRP=25%. RF exploits IV/RV *variance*, not just mean VRP.
  2. **Active's drift immunity breaks below VRP=10%.** At VRP=15%: 8/8 positive (confirming Exp 7). At VRP=10%: still 8/8. At VRP=5%: 7/8 (fails at -30% drift / 100% vol). At VRP=0%: 4/8 failures. The drift immunity threshold is VRP≥10%.
  3. **VRP=10% is the practical deployment floor.** Below 10%: Active loses drift immunity, Moderate has negative avg Sharpe, Conservative near-zero even at drift=0%. Above 10%, framework is robust.
  4. **Sharpe scales linearly with VRP — no cliff edges.** ~+0.16 Sharpe per 5pp of VRP for Active (constant slope). Framework degrades gracefully, not catastrophically. Interpolation between tested levels is reliable.
  5. **Skip rates are VRP-insensitive.** Active: 97.0% skip at VRP=0% vs 91.0% at VRP=25% — the filter finds transient IV>RV windows even with zero mean VRP. Confirms RF exploits stochastic IV variance, not just the VRP offset.
  6. **The framework is NOT overfitted to VRP=15%.** Active achieves positive Sharpe at VRP=0% / drift=0% (avg 0.195). RF is universally beneficial. Feature stack ranking unchanged. The 15% assumption provides comfortable margin, not structural dependence.
  7. **`skipBelowRatio` thresholds do not need recalibration.** RF helps at every VRP level with no sign of the current thresholds (1.0 Conservative, 1.2 Moderate/Active) being suboptimal at low VRP.
- **Conclusion:** **VRP=10% is the deployment floor for the framework.** Below this, Active loses drift immunity and Conservative/Moderate produce negative Sharpe. The regime filter is VRP-independent — it helps at every level tested, with value increasing as VRP decreases. The framework is not overfitted to VRP=15%; Active remains viable down to VRP≈0% in non-bear markets. For live deployment: estimate trailing IV-RV spread; if below 10%, restrict to Active only; if below 5%, reduce sizing or pause.
- **Action Taken:** Full analysis in `research/sweep8/SWEEP8_ANALYSIS.md`. Deployment zone updated with VRP floor. No preset changes — Exp 6 configs confirmed stable across VRP regimes.

### Experiment 9: Model Robustness
- **Goal:** Test whether the Exp 6 optimal configs remain viable across all 4 price models (GBM, Heston, Jump, Heston-Jump). All prior experiments used GBM only.
- **Market Baseline:** 4 models × 3 vol levels (40%, 60%, 80%) × 3 drifts (+5%, 0%, −30%). GBM/Jump: stochastic OU IV (κ=5, ξ=0.5, VRP=15%). Heston/Heston-Jump: IV from variance process √v. Heston: κ=2, σ=0.5, ρ=−0.7, θ=vol². Jump: λ=10, μJ=0, σJ=0.05.
- **Approach:** Each of 3 strategies tested with Optimal (RF ON) and Baseline (RF OFF) across all model × drift × vol combos. 216 total combinations × 1,000 paths = 216,000 simulation paths.
- **Results:**
  - **GBM:** Avg Sharpe 0.345, 21/27 positive. Active 9/9 positive, drift-immune. Baseline control.
  - **Jump:** Avg Sharpe 0.272, 21/27 positive. Active 9/9 positive, drift-immune. −21% Sharpe vs GBM.
  - **Heston:** Avg Sharpe **−0.216**, 5/27 positive. Active 0/9 positive. Moderate 0/9 positive. Conservative 5/9 positive (marginal, 0.042–0.146 Sharpe at drift ≥ 0%).
  - **Heston-Jump:** Avg Sharpe **−0.289**, 2/27 positive. Every strategy fails at nearly every combo.
- **Key Findings:**
  1. **The IV path source is the critical differentiator.** GBM/Jump (OU-based IV) work; Heston/Heston-Jump (variance-based IV) fail. The split is clean and absolute. Jump processes are benign (−21% Sharpe); stochastic variance is the Achilles' heel (−143% to −360% Sharpe).
  2. **The regime filter was implicitly calibrated on OU-generated IV/RV signals.** OU produces smooth, normally-distributed IV paths with predictable mean-reversion. Heston's variance process produces clustered vol with abrupt transitions. Under Heston, the filter skips ~3% more cycles but accepted-trade win rates collapse from 78% to 47%.
  3. **RF is still beneficial under Heston for Moderate/Active (9/9 wins each)** but can't rescue them. Exception: RF *hurts* Conservative under Heston (1/9 wins, −0.018 ΔSharpe) — at δ0.10 with 99%+ skip rates, the filter's few accepted trades are net-negative.
  4. **Active's drift immunity breaks completely under Heston.** 0/9 positive — fails at every drift × vol combo including +5%/40% (Sharpe −0.200). This is not a bear market problem; the strategy is fundamentally non-viable under stochastic variance dynamics.
  5. **The "all-weather" claim requires model qualification.** Active: 18/36 combos positive (all 18 failures under Heston-family). Corrected: "all-weather under diffusion models (GBM, Jump); non-viable under stochastic variance models (Heston, Heston-Jump)."
  6. **Jump processes are benign.** Merton jumps reduce Sharpe by ~21% but preserve all qualitative properties: drift immunity, RF universality (27/27), positive Sharpe at all combos. No assignment cascades observed.
  7. **MaxDD increases are moderate under Heston** (+2–6pp vs GBM). The problem is insufficient return, not excess drawdown. The strategy loses money slowly, not through blowups.
- **Conclusion:** **The framework is model-dependent, not model-robust.** It works under GBM and Jump (OU-based IV), fails under Heston and Heston-Jump (variance-based IV). The regime filter's IV/RV signal degrades under Heston dynamics due to vol clustering and abrupt regime transitions. No preset changes are needed — the issue is structural, not parametric. For live deployment: the framework's edge depends on IV/RV dynamics that follow OU-like mean-reversion. Monitor IV/RV autocorrelation; if clustering is detected (ACF > 0.5 at lag 1), reduce sizing or pause. Experiment 11 (Lookback × Cycle Interaction) should now be tested under both GBM and Heston to determine if lookback tuning can recover Heston performance.
- **Action Taken:** Full analysis in `research/sweep9/SWEEP9_ANALYSIS.md`. "All-weather" claim qualified. Deployment zone updated with model condition. No preset changes — structural mismatch, not parameter issue.

### Experiment 10: Lookback × Cycle Interaction
- **Goal:** Determine whether tuning `lookbackDays` (hardcoded at 20 in all prior experiments) can (a) improve GBM performance and (b) recover positive Sharpe under Heston — the critical path question from Exp 9.
- **Market Baseline:** GBM and Heston, stochastic IV (OU for GBM: κ=5.0, ξ=0.5, VRP=15%; variance-derived for Heston), tested at 2 drift levels (0%, −30%) and 2 vol levels (40%, 60%).
- **Approach:** Sweep `lookbackDays` (5, 10, 15, 20, 30, 45, 60) × 2 models × 2 drifts × 2 vols × 3 strategies × 2 configs (RF ON/OFF) × 1,000 paths. 336 total combinations = 336,000 simulation paths.
- **Results:**
  - **GBM Conservative (δ0.10/30d):** Best lookback **45d**, Sharpe 0.126 (+0.025 vs 20d). The only above-threshold improvement.
  - **GBM Moderate (δ0.20/14d):** Best lookback 30d, Sharpe 0.052 (+0.018 vs 20d). Sub-threshold.
  - **GBM Active (δ0.20/3d):** Best lookback 30d, Sharpe 0.658 (+0.018 vs 20d). Sub-threshold. 4/4 positive at every lookback.
  - **Heston Conservative:** Best lookback 60d, Sharpe **−0.278** (1/4 positive). No recovery.
  - **Heston Moderate:** Best lookback 30d, Sharpe **−0.307** (0/4 positive). No recovery.
  - **Heston Active:** Best lookback 30d, Sharpe **−0.371** (0/4 positive). No recovery.
- **Key Findings:**
  1. **Lookback tuning CANNOT recover Heston performance.** No lookback value achieves positive Sharpe for Moderate or Active under Heston. The best improvements are marginal (ΔSharpe +0.01–0.04), and zero conditions flip from negative to positive. The GBM-Heston win rate gap (−7 to −33pp) is persistent and unclosable at any lookback.
  2. **Optimal GBM lookback is 30–45d, not 20d.** Longer lookback windows smooth the realized vol estimate, producing more stable IV/RV ratios. Conservative benefits most (45d, +0.025 ΔSharpe). All three strategies peak at 30d+, but Moderate/Active improvements are below the 0.02 significance threshold.
  3. **No lookback/cycle ratio rule exists.** The hypothesis that lookback ≈ 2× cycle length does not hold. Active converges to 30d despite its 3-day cycle (ratio 10×). There's a **floor around 30d** driven by the minimum sample size for meaningful RV estimation, irrespective of trade frequency.
  4. **Short lookback (5d) hurts every strategy.** 5d lookback produces the worst Sharpe at 5/6 model × strategy combinations. The noisy RV estimate at 5d degrades the regime filter's signal quality. Minimum viable lookback is 15d.
  5. **RF is universally beneficial at lookback ≥ 15d under GBM.** Below 15d, Conservative's RF signal degrades (2–3/4 wins instead of 4/4). For Moderate/Active, RF helps at every lookback under both models.
  6. **RF hurts Conservative under Heston at short lookbacks.** At 5–15d, RF produces negative ΔSharpe for Conservative under Heston — the only model × strategy × lookback combination where RF is harmful. At δ0.10 with 99%+ skip rates, the few admitted trades are net-negative under Heston dynamics.
  7. **Skip rate increases monotonically with lookback.** Longer lookback → more stable RV → more conservative filtering → fewer trades. GBM Active: 88.9% (5d) → 94.8% (30d). The 30d lookback hits the optimal accuracy/frequency tradeoff.
- **Conclusion:** **The Heston failure is structural, not parametric — lookback tuning cannot solve it.** The regime filter's IV/RV signal fundamentally degrades under Heston's variance clustering, regardless of how much price history is used for RV estimation. For GBM, the default lookback of 20d is near-optimal; Conservative benefits from extending to 45d (+0.025 ΔSharpe), while Moderate/Active see sub-threshold improvements at 30d. The absolute minimum viable lookback is 15d. Proceed to Exp 11 (Heston skip threshold recalibration) as the next recovery attempt; if that also fails, close the Heston investigation.
- **Action Taken:** Full analysis in `research/sweep10/SWEEP10_ANALYSIS.md`. Conservative preset lookback updated: 20d → 45d. Heston recovery remains open → Exp 11.

### Experiment 11: Heston Skip Threshold Recalibration
- **Goal:** Last Heston recovery attempt. Test whether recalibrating `skipBelowRatio` under Heston-specific IV/RV distributions restores positive Sharpe. If this also fails, close the Heston investigation permanently.
- **Market Baseline:** Heston (κ=2, σ=0.5, ρ=−0.7, θ=vol²), tested at 2 drift levels (+0%, +5%) and 2 vol levels (40%, 60%). Lookbacks from Exp 10: Conservative=60d, Moderate/Active=30d.
- **Approach:** Sweep `skipBelowRatio` (0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2.0) × 2 drifts × 2 vols × 3 strategies × RF ON + RF OFF baselines. 144 Heston combinations × 1,000 paths = 144,000 simulations. GBM cross-validation: 32 additional combos.
- **Results:**
  - **Conservative (δ0.10/30d):** Best threshold **0.9**, avg Sharpe **0.089**, 3/4 positive. But RF OFF baseline is better (avg Sharpe 0.103). RF hurts Conservative under Heston — confirmed.
  - **Moderate (δ0.20/14d):** Best threshold **1.2** (same as GBM), avg Sharpe **−0.054**, **0/4 positive**. No recovery. RF improves vs baseline (−0.182) but can't reach positive.
  - **Active (δ0.20/3d):** Best threshold **1.1**, avg Sharpe **−0.199**, **0/4 positive**. No recovery. RF improves vs baseline (−0.255) but can't reach positive.
- **Key Findings:**
  1. **Threshold recalibration FAILS to recover Heston.** Only 3/12 total combos achieve positive Sharpe — all Conservative. Moderate: 0/4. Active: 0/4. No threshold in the 0.8–2.0 range restores positive risk-adjusted returns for Moderate or Active under Heston.
  2. **Conservative RF OFF is confirmed superior under Heston.** RF OFF wins 3/4 conditions. At 40% vol, RF actively degrades Conservative Sharpe by 0.02–0.03. At 60% vol, RF has zero effect. The δ0.10/30d cycle already over-filters at 98%+ skip rates.
  3. **Higher thresholds monotonically degrade Sharpe.** Unlike GBM where 1.0–1.2 is optimal, under Heston Conservative collapses to −2.7 Sharpe at t=2.0. With 99.9% skip and 0.2 cycles/year, the rare accepted trades are random draws from Heston's fat tails.
  4. **Win rates improve with threshold but can't reach GBM levels.** Active plateaus at ~57% by t=1.5 — far below GBM's ~78%. The filter removes the worst trades but remaining accepted trades still have sub-50% per-cycle win rates under Heston.
  5. **GBM presets confirmed optimal.** Cross-validation shows Heston-optimal thresholds would degrade GBM: Active loses −0.034 Sharpe at t=1.1 vs t=1.2. No changes to existing `skipBelowRatio` values.
  6. **Root cause identified (synthesis of Exps 9–11).** Heston's variance-derived IV exhibits vol clustering with abrupt regime transitions. The IV/RV ratio under Heston signals vol regime shifts, not transient premium opportunities. All parametric solutions (lookback, threshold) fail because they can't distinguish vol regimes from trade opportunities — the filter needs a fundamentally different signal.
- **Conclusion:** **HESTON INVESTIGATION CLOSED.** Three independent recovery attempts (model testing Exp 9, lookback tuning Exp 10, threshold recalibration Exp 11) all fail. The wheel strategy under Heston dynamics is structurally non-viable for Moderate and Active. Conservative is marginally viable with RF OFF (avg Sharpe 0.103) but earns <1% APR with <2 trades/year — not deployable. No preset changes needed. For live deployment: monitor IV/RV autocorrelation; if clustering is detected (ACF > 0.5 at lag 1), the framework's edge does not exist.
- **Action Taken:** Full analysis in `research/sweep11/SWEEP11_ANALYSIS.md`. Heston investigation closed. No preset changes — all GBM thresholds confirmed optimal.

### Experiment 12: Multi-Year Horizon
- **Goal:** Test whether the Exp 6 optimal configs remain viable over 2-year and 5-year horizons. All prior experiments used 365-day simulations. Key questions: does Active's drift immunity survive sustained multi-year decline? Does the regime filter's ~94–97% skip rate compound differently? Are `skipBelowRatio` thresholds stable? How does MaxDD evolve?
- **Market Baseline:** GBM and Jump (Heston closed per Exp 11), 60% vol (Exp 3 sweet spot), stochastic IV (OU process, κ=5.0, ξ=0.5). Tested at 3 drift levels (0%, +5%, −30%) and 2 VRP levels (10%, 15%).
- **Approach:** Sweep horizons (365d, 730d, 1825d) × drift (0%, +5%, −30%) × VRP (10%, 15%) × model (GBM, Jump) × 3 strategies × 2 configs (RF ON/OFF). 216 total combinations × 1,000 paths = 216,000 simulation paths.
- **Results:**
  - **Conservative (δ0.10/30d, RF+AC+PR):** Sharpe collapses: 0.262 (1yr) → −0.077 (2yr) → **−0.287 (5yr)**. 0/12 positive at 5yr. MaxDD: 26.2% → 59.3% (2.27×, linear growth). Only 0.4–1.6 executed cycles over entire period — too few trades to recover from multi-year drawdowns.
  - **Moderate (δ0.20/14d, RF+PR):** Sharpe degrades: 0.076 (1yr) → 0.006 (2yr) → **−0.057 (5yr)**. 7/12 positive at 5yr. MaxDD: 31.4% → 43.8% (1.40×, saturating). APR stable at ~13% across all horizons.
  - **Active (δ0.20/3d, RF only):** Sharpe stable: **0.506 (1yr) → 0.483 (2yr) → 0.397 (5yr)**. **11/12 positive at 5yr.** MaxDD: 23.0% → 28.6% (1.25×, saturating). APR stable at ~29% across all horizons. 38+ executed trades over 5yr provide continuous premium income.
- **Key Findings:**
  1. **Active is the only multi-year viable strategy.** Sharpe declines only 22% over 5yr (vs −209% Conservative, −175% Moderate). High cycle frequency (38+ trades) continuously generates premium to offset drawdowns. At 5yr: 11/12 positive, 28.5% APR, 28.6% MaxDD.
  2. **Active's drift immunity survives 5 years.** At −30% drift: Sharpe 0.280 (1yr) → 0.100 (5yr), APR 12%, MaxDD 27.5%, +28% alpha over buy-and-hold. Single failure: Jump/VRP=10%/−30% at 5yr (Sharpe −0.005 — essentially zero). Compounding drawdown does NOT overwhelm premium income.
  3. **Conservative is a 1-year strategy only.** Every 5yr combination — including +5% drift / VRP=15% — produces negative Sharpe. The 99.2–99.8% skip rate executes only 0.4–1.6 cycles over 5 years, providing no drawdown recovery.
  4. **MaxDD behavior is strategy-dependent.** Active: saturating at ~29% (1.25× over 5yr). Moderate: saturating at ~44% (1.40×). Conservative: linear growth to 59% (2.27×). Active's high trade frequency caps MaxDD; Conservative's near-zero trades allow unbounded drawdown accumulation.
  5. **RF is universally beneficial at ALL horizons.** 108/108 wins — the most comprehensive universality test. For Active, RF ΔSharpe is stable-to-increasing: +0.316 (1yr) → +0.335 (5yr). For Conservative, RF value shrinks: +0.099 → +0.050, but still positive.
  6. **Skip rates are horizon-invariant.** Active: 95.2% (1yr) → 95.5% (5yr). Moderate: 97.6% → 97.7%. Conservative: 99.2% → 99.8%. The regime filter's acceptance rate is a property of the IV/RV stochastic process, not simulation length. No `skipBelowRatio` recalibration needed for longer horizons.
  7. **VRP=10% floor weakens at 5yr for Conservative/Moderate** (0/6 and 3/6 positive respectively) but holds for Active (5/6, avg Sharpe 0.329).
  8. **Jump processes are benign over multi-year horizons.** GBM-Jump Sharpe gap for Active: 1yr=+0.106 → 5yr=+0.119 — gap does not widen. No compounding jump damage.
- **Conclusion:** **Multi-year deployment is viable for Active only.** Active (δ0.20/3d, RF only) maintains 0.397 Sharpe and 28.5% APR at 5yr with saturating MaxDD (~29%), powered by 38+ executed trades that continuously generate premium. Active's drift immunity survives even a sustained 5-year bear market (−30% drift → 0.100 Sharpe, 12% APR). Conservative and Moderate are short-horizon strategies (≤1yr) — Conservative's extreme skip rate (99%+) produces too few trades for multi-year drawdown recovery. RF is universally beneficial (108/108 wins) and skip rates are horizon-invariant. No preset changes needed — the finding is about deployment horizon, not parameterization.
- **Action Taken:** Full analysis in `research/sweep12/SWEEP12_ANALYSIS.md`. No preset changes. Deployment guidance updated: Active for multi-year, Conservative/Moderate for ≤1yr only.

### Experiment 13: Execution Cost Sensitivity
- **Goal:** Determine whether Active's edge survives realistic Deribit execution friction. All prior experiments assumed fixed 5% bid-ask spread and $0.50 fee per trade. Real Deribit spreads vary by delta, expiry, and liquidity (1–15% for far OTM options).
- **Market Baseline:** GBM with stochastic IV (OU process, κ=5.0, ξ=0.5, VRP=15%), 5% annual drift, tested at 2 vol levels (40%, 60%).
- **Approach:** Sweep `bidAskSpreadPct` (1%, 3%, 5%, 8%, 12%) × `feePerTrade` ($0.25, $0.50, $1.00, $2.00) × 3 strategies × 2 vol levels × 2 horizons (1yr, 5yr). 240 total combinations × 1,000 paths = 240,000 simulation paths.
- **Results:**
  - **Conservative (δ0.10/30d, RF+AC+PR):** 1yr Sharpe positive at all costs (0.324–0.657). 5yr Sharpe near-zero at 40% vol (0.105 best), negative at 60% vol at all costs. 0/40 combos achieve Sharpe ≥ 0.20 at 5yr.
  - **Moderate (δ0.20/14d, RF+PR):** 1yr Sharpe positive at all costs (0.132–0.522). 5yr Sharpe positive at all but one combo (12%/$2.00/60%vol → −0.003). 19/40 combos achieve Sharpe ≥ 0.20 at 5yr.
  - **Active (δ0.20/3d, RF only):** **Sharpe positive at ALL 80/80 combos.** 1yr: 0.475–1.189. 5yr: 0.389–1.236. **40/40 combos achieve Sharpe ≥ 0.20 at 5yr** — including worst case (12% spread, $2.00 fee, 60% vol → Sharpe 0.389, APR 35.44%).
- **Key Findings:**
  1. **Active's edge is cost-immune.** Sharpe never crosses zero at any tested cost level, vol, or horizon. Even at extreme worst case (12%/$2.00/60%vol/5yr), Active maintains 0.389 Sharpe and 35.44% APR. The "all-weather" designation survives realistic execution friction.
  2. **Active is the least cost-sensitive per trade.** Despite 20× more trades than Conservative, Active loses only −0.0602 Sharpe per executed cycle vs Conservative's −0.6444 (10.7× worse). Higher trade frequency amortizes cost per unit of premium income.
  3. **Active's multi-year advantage is cost-invariant.** 1yr→5yr Sharpe decay is ≤3.8% for Active at any cost level. Conservative collapses 92–119%, Moderate degrades 30–63%. Costs do not amplify Active's time decay.
  4. **Conservative is 1yr-only (now cost-qualified).** At realistic costs (8%/$1.00), 5yr Sharpe is −0.025. Even at lowest cost (1%/$0.25), 5yr Sharpe is 0.048/40%vol and negative at 60%vol.
  5. **No strategy ranking reversal at any cost level.** Active > Moderate > Conservative at every tested (spread, fee, vol, horizon) combination. There is no scenario where Moderate becomes the practical choice over Active due to friction.
  6. **Spread dominates fee as cost driver.** Spread contributes ~3–5× more Sharpe erosion per unit increase than fee per trade. Optimizing execution quality (tighter spreads via limit orders) matters more than fee negotiation.
  7. **At conservative Deribit costs (8%/$1.00), Active delivers 0.784 Sharpe and 33.19% APR at 1yr, 0.768 Sharpe and 39.81% APR at 5yr.** These are deployment-grade returns.
- **Conclusion:** **Execution costs do not threaten the framework's viability.** Active (δ0.20/3d, RF only) maintains Sharpe ≥ 0.39 even at extreme cost assumptions over 5 years. The strategy's high trade frequency, counterintuitively, makes it the most cost-resilient — each trade is a small fraction of total return, so per-trade friction is diluted across ~40 executed cycles over 5yr. The prior "all-weather" claim for Active is strengthened. For live deployment: focus on minimizing bid-ask spread (use limit orders, avoid illiquid strikes) rather than fee negotiation — spread is the dominant cost factor.
- **Action Taken:** Full analysis in `research/sweep13/SWEEP13_ANALYSIS.md`. No preset changes. Execution cost sensitivity confirmed as non-blocking for deployment.

### Experiment 14: Deployment Signal Estimation
- **Goal:** Test whether trailing VRP estimates and IV/RV autocorrelation can reliably drive automated deploy/pause decisions for the Active strategy. Prior experiments established drift floors (Exp 7), VRP floor (Exp 8), OU-dynamics requirement (Exp 9), and cost resilience (Exp 13). Can these conditions be estimated from trailing market data to automate deployment timing?
- **Market Baseline:** GBM and Jump with stochastic IV (OU process, κ=5.0 and κ=1.0, ξ=0.5), VRP 5%/10%/15%, tested at drifts 0%/+5%/−30%, vol 40%/60%, horizons 1yr/5yr.
- **Approach:** Four sub-experiments. A: Signal accuracy — validate VRP estimation bias/RMSE and ACF distinguishability across 72 condition combos. B: VRP deployment — test trailing VRP threshold (0%/5%/8%/10%) × 3 windows × 3 VRP × 3 drift × 2 horizons = 216 combos. C: ACF guard — test ACF ceiling (0.3/0.5/0.7) × 2 windows × 2 κ values × 4 conditions = 56 combos. D: Combined — best VRP + best ACF vs individual signals across 288 combos. All × 1,000 paths. Multi-threaded (8 workers), 1,102s total.
- **Results:**
  - **VRP estimation:** Systematic underestimation (true 5% → est 3.3%, true 15% → 7.1% at 40% vol). RMSE 14–17% — 1.5–3× larger than the VRP being estimated. Noise overwhelms signal. Drift-invariant (correct). Longer windows reduce RMSE marginally (15.4% → 13.9%).
  - **VRP deployment (B):** Best config w=20d, t=5%. Mean ΔSharpe **−0.030**, win rate 5.6%. Only 1/162 combos achieves positive ΔSharpe. Higher thresholds and longer windows strictly degrade performance.
  - **ACF guard (C):** Best config w=30d, t=0.7. Mean ΔSharpe **−0.656**, win rate **0.0%**. Catastrophically destructive — ACF is universally high (0.68–0.87) under OU dynamics, so any threshold blocks most trading.
  - **Combined (D):** Mean ΔSharpe **−0.620**, worse than either individual signal. ACF dominates, blocking 81–88% of the 5yr period.
- **Key Findings:**
  1. **No deployment signal improves performance.** Only 1/210 signal combos (0.5%) achieves positive ΔSharpe. Mean ΔSharpe across all signal types is −0.225. The existing regime filter is strictly superior to any additional deployment layer.
  2. **VRP estimation noise is fundamental.** RMSE of 14–17% against true VRP of 5–15% produces signal-to-noise ratio <1. Any threshold randomly rejects ~50% of deploy-worthy days. Not fixable with longer windows or better estimators.
  3. **ACF guard is structurally incompatible with OU dynamics.** OU processes at realistic κ produce ACF(1) of 0.68–0.87 universally. The guard cannot distinguish "dangerous clustering" from "normal mean-reversion" because OU-driven IV is persistently autocorrelated by construction. The Exp 9/11 "ACF > 0.5" guidance is valid for Heston-vs-OU *detection*, not for within-OU filtering.
  4. **The regime filter already IS the deployment signal.** Active's RF checks IV/RV ratio at each put-sale decision, operating at the correct granularity (per-trade). A daily deploy/pause layer is redundant and reduces profitable exposure.
  5. **Active's smooth degradation makes signals unnecessary.** Sharpe degrades linearly with drift (Exp 7) and VRP (Exp 8) — no regime cliffs. A binary deploy/pause signal provides no value when the underlying edge erodes gradually.
  6. **Estimation lag causes whipsaw, not margin protection.** 26–33 skip days per executed cycle — constant deploy/pause oscillation driven by estimation noise.
- **Conclusion:** **No deployment signal should be added to the framework.** The regime filter (`skipBelowRatio`, `skipSide: "put"`) provides optimal deployment decisions at per-trade granularity. VRP and ACF checks remain valid as human-level monitoring before deploying to a new market, but should NOT be automated as real-time signal gates. The `deploymentSignal` engine integration can be removed or left disabled. No remaining experiments block live deployment — the framework is deployment-ready for Active (δ0.20/3d, RF only) under OU-like IV dynamics.
- **Action Taken:** Full analysis in `research/sweep14/SWEEP14_ANALYSIS.md`. No preset changes. Deployment signal confirmed as non-beneficial — existing regime filter is sufficient. **Engine integration was fully implemented** (`src/components/signals.ts` with `computeTrailingVRP`, `computeTrailingACF`, `shouldDeploy`; `DeploymentSignalConfig` in `strategy/types.ts`; deployment signal check in `simulate.ts`; `deploymentSkips` tracking in `monte-carlo.ts` `RunSummary`) **and then removed** after the experiment conclusively showed no signal improves performance. Production code reverted to pre-experiment state (net zero changes). Signal module and its 30 tests deleted as dead code.

### Experiment 15: Multi-Year Vol Sensitivity
- **Goal:** Test whether Active's multi-year viability (confirmed at 60% vol in Exp 12) extends to 80%+ vol. Does MaxDD saturate? Does drift immunity hold? Is the vol ceiling for multi-year deployment different from the 1yr ceiling (77–92% from Exps 3, 5)?
- **Market Baseline:** GBM and Jump with stochastic IV (OU process, κ=5.0, ξ=0.5), tested at 4 vol levels (40%, 60%, 80%, 100%), 3 drifts (0%, +5%, −30%), 2 VRP levels (10%, 15%), 3 horizons (1yr, 2yr, 5yr).
- **Approach:** Full factorial: 3 horizons × 4 vols × 3 drifts × 2 VRPs × 2 models × 3 strategies × 2 RF configs. 864 total combinations × 1,000 paths = 864,000 simulation paths. Multi-threaded (8 workers), 215.2s.
- **Results:**
  - **Conservative (δ0.10/30d, RF+AC+PR):** Non-viable at 5yr for ALL vol levels. 0/12 positive at 60–100% vol, 2/12 at 40% vol. MaxDD grows linearly (1.74–2.63× at 5yr vs 1yr). Near-zero trade frequency (~0.4–1.9 cycles) provides no drawdown recovery.
  - **Moderate (δ0.20/14d, RF+PR):** Marginal at 5yr. 40% vol: 8/12 positive (Sharpe −0.042). 60% vol: 7/12 (−0.057). 80% vol: 4/12 (−0.091). 100% vol: 0/12 (−0.123). Degrades monotonically with vol.
  - **Active (δ0.20/3d, RF only):** **Positive Sharpe at ALL vol × horizon combinations.** 40%: 0.628→0.586 (−7% decay). 60%: 0.506→0.397 (−22%). 80%: 0.413→0.256 (−38%). 100%: 0.331→0.151 (−54%). 139/144 combos positive (96.5%). MaxDD saturating at all vol levels (5yr/1yr ratio 1.20–1.27×).
- **Key Findings:**
  1. **Active has no practical vol ceiling at any horizon.** Sharpe positive at 100% vol / 5yr (0.151, 10/12 positive). Degradation smooth and monotonic (~0.145 Sharpe per 20pp vol at 5yr). Extrapolated zero-crossing at ~120% vol.
  2. **MaxDD saturation strengthens at higher vol.** 5yr/1yr ratio: 40%=1.27×, 60%=1.25×, 80%=1.22×, 100%=1.20×. Higher vol generates more premium income per cycle, providing stronger drawdown cushioning. Even at 100% vol / 5yr, MaxDD is 41.4% (vs 34.5% at 1yr).
  3. **Drift immunity survives 5yr bear at all vol levels.** Active at −30% drift / 5yr: 40%=0.120, 60%=0.100, 80%=0.050, 100%=0.002 (marginal but positive). Single-combo failures consistently at Jump/VRP=10%.
  4. **RF universality confirmed: 432/432 (100%).** The most comprehensive test — RF wins every combination across all vol × horizon × drift × VRP × model × strategy combos.
  5. **VRP=10% floor holds at 5yr for Active at all vol levels.** 100% vol / VRP=10% / 5yr: Sharpe 0.080, 4/6 positive.
  6. **GBM-Jump gap stable at all vol levels.** No compounding jump damage over multi-year horizons regardless of vol.
  7. **Sharpe decay proportional to vol:** ~16pp additional 5yr decay per 20pp of vol. At 40% vol, 5yr barely erodes the edge (−7%); at 100% vol, significant but insufficient to turn negative (−54%).
  8. **Conservative/Moderate confirmed non-viable at 5yr for ALL vol levels.** Conservative: 2/48 positive. Moderate: 19/48 and degrading monotonically with vol.
- **Conclusion:** **Active's multi-year viability extends to 100% vol with no practical ceiling.** MaxDD saturation strengthens at higher vol (5yr/1yr ratio decreases), drift immunity survives, and RF is universally beneficial. Active can be deployed at any realistic crypto vol level for any horizon, with degradation smooth and predictable. Effective vol ceiling extrapolates to ~120% for 5yr deployment. Active's "all-weather" designation now includes vol dimension: drift-immune, model-robust, multi-year viable, and vol-ceiling-free up to 100% tested.
- **Action Taken:** Full analysis in `research/sweep15/SWEEP15_ANALYSIS.md`. No preset changes. Deployment guidance extended: Active viable at any vol ≤100% for multi-year deployment (was confirmed only at 60% vol in Exp 12).

---

### Experiment 16: Historical IV/RV Dynamics Validation
- **Goal:** Validate whether real Deribit ETH IV/RV dynamics match the OU stochastic IV model used in Exps 1–15, or exhibit Heston-like variance clustering that would invalidate the framework. Data analysis task — no Monte Carlo simulation.
- **Data Source:** Deribit public API. 1,812 daily ETH DVOL records (2021-03-24 → 2026-03-09), 2,261 daily ETH-PERPETUAL prices (2019-12-31 → 2026-03-09). 5 years of aligned IV + price data.
- **Approach:** Eight analyses: (A) IV dynamics — ACF, ΔIV distribution, ARCH effects, AR(1) mean-reversion estimation. (B) VRP — daily VRP = DVOL − RV(20d), rolling 90d windows. (C) IV/RV ratio distribution, regime filter skip rates at various thresholds. (D) Simulated OU comparison — 1,000 OU paths with data-estimated parameters vs real distributions. (E) Sub-period analysis across 5 distinct market regimes.
- **Results:**
  - **Mean-reversion speed matches:** κ=5.55 (framework default 5.0). Half-life 46 days. AR(1) φ=0.985.
  - **Fat tails detected:** ΔIV kurtosis **27.07** (OU predicts 3.0). Daily ΔIV std 3.93% vs OU simulated 0.68% — real IV is **5.7× more volatile**.
  - **ARCH effects present:** Squared ΔIV ACF(1)=**0.351** (OU predicts ~0, threshold ±0.047). Vol clustering lasts ~2 weeks (insignificant by lag 10).
  - **VRP below assumption:** Mean VRP **6.35%** (framework assumes 15%). Positive 70% of days. Regime-dependent: +25–30% post-crash, −3% to −12% during trends. Above Exp 8's Active viability floor (5%) but below Conservative/Moderate floor (10%).
  - **Skip rate mismatch:** At `skipBelowRatio=1.2`, real skip rate **61.8%** vs simulated **94–97%**. Real IV/RV ratio has wider dispersion, so the filter accepts far more trades.
  - **Sub-period κ varies 6–52.** Only 2023 (κ=6.6) matches OU assumptions across all metrics. Other periods have much faster mean-reversion ("sticky" IV with occasional jumps).
- **Key Findings:**
  1. **Real ETH IV is "OU with jumps" — neither pure OU nor pure Heston.** Mean-reversion speed matches OU (κ=5.55). But innovations are non-Gaussian (kurtosis 27), exhibit ARCH clustering (ACF=0.35), and are 5.7× more volatile than OU predicts. Qualitatively closer to OU than Heston (fast-decaying clustering, correct κ range), but quantitatively far from either.
  2. **The OU model is 5.7× too smooth.** The framework's `volOfVol=0.5` generates IV paths dramatically less volatile than reality. The regime filter's IV/RV signal is calibrated to a much less noisy world.
  3. **The skip threshold is miscalibrated.** `skipBelowRatio=1.2` skips 62% in reality vs 95% in simulation. The filter is 6× less selective in practice. This means Active would execute ~10× more trades than simulated — which may actually help (higher trade frequency improved resilience in Exps 12–13).
  4. **VRP is sufficient for Active (6.35% > 5% floor) but marginal for Conservative/Moderate.** VRP is positive 70% of days and regime-dependent — strong post-crash, weak during trends.
  5. **ARCH effects are fast-decaying.** Significant at lag 1–5, insignificant by lag 10. Unlike Heston's persistent clustering, this ~2-week clustering is averaged over by the regime filter's 20–45d lookback. The Heston failure (Exps 9–11) was driven by persistent clustering, not this transient variety.
  6. **Strategic conclusions are likely robust.** Active's dominance, RF universality, drift immunity, and cost immunity depend on mean-reversion structure (which matches) and VRP existence (which is confirmed), not on OU's specific distributional assumptions. Parameter calibrations (skip thresholds) need adjustment.
  7. **The OU model is a useful but imperfect approximation** that correctly captures mean-reversion speed, persistence, and VRP sign, but incorrectly assumes Gaussian innovations and constant vol-of-vol.
- **Conclusion:** **Conditionally validated.** Real ETH IV dynamics preserve the structural properties the framework exploits (mean-reversion at κ≈5, positive VRP), but the OU model is quantitatively too smooth (5.7× less volatile, no fat tails, no ARCH). The skip rate miscalibration (62% vs 95%) is the most actionable finding — the filter is less selective in reality, meaning Active trades ~10× more than simulated. Strategic conclusions (Active > Moderate > Conservative, RF universally beneficial) are likely robust. Tactical calibrations need recalibration against realistic IV dynamics. Recommended: (a) increase OU `volOfVol` ~6× to match real ΔIV std, (b) consider jump component in IV process, (c) re-validate Active with recalibrated model.
- **Action Taken:** Full analysis in `research/sweep16/SWEEP16_ANALYSIS.md`. Framework conditionally validated — structural properties match, calibration needs updating. API module extended with DVOL and TradingView endpoints.

### Experiment 17: OU Recalibration & Re-validation
- **Goal:** Recalibrate the OU stochastic IV model to match real ETH DVOL dynamics (Exp 16 found Δ IV 5.7× too smooth, kurtosis 27 vs 3, no ARCH). Add Poisson jumps to IV process, re-validate Active's dominance and regime filter universality under realistic IV dynamics and VRP=6%.
- **Market Baseline:** GBM with OU+Jump stochastic IV (κ=5.0, ξ=0.50, λ=10, σJ=0.15), tested at VRP levels 6% (real) and 15% (framework default), vol levels 40–100%.
- **Approach:** Three sub-experiments. A: Model calibration — test 21 OU/OU+Jump variants against real DVOL statistics (ΔIV std, kurtosis, sqACF1, skip rate), ranked by weighted distance. B: Feature stack re-validation — replay Exp 6's Combined Feature Stack with best calibrated model at 96 combos (5 feature sets × 4 vol × 2 VRP × 3 strategies). C: Threshold re-sweep — sweep `skipBelowRatio` (0.8–1.8) × 3 vol × 3 strategies at VRP=6%. Multi-threaded (8 workers), 12.3s total.
- **Results:**
  - **Best model: OU+J ξ=0.50 λ=10 σJ=0.15.** Score 0.239 (51.2% improvement vs baseline). ΔIV std=3.610 (real: 3.926), kurtosis=24.94 (real: 27.07), skip rate=62.7% (real: 61.8%). ARCH clustering NOT reproduced (sqACF1=0.000 vs 0.351) — requires stochastic vol-of-vol beyond OU architecture.
  - **RF universality: 24/24 (100%).** All strategy × vol × VRP combos improved by regime filter. Confirmed under calibrated model.
  - **Feature stack confirmed.** Conservative: RF+AC+PR (avg Sharpe 0.449). Moderate: RF+PR (avg Sharpe 0.281). Active: RF only (avg Sharpe 0.782). Identical rankings to Exp 6.
  - **Active Sharpe IMPROVED.** At VRP=15%/40%vol: 1.356 (was 1.044 in Exp 6, +30%). At realistic VRP=6%/40%vol: 1.031. Wider IV/RV distribution produces better-quality regime filter signals.
  - **Optimal thresholds shifted.** Conservative: 1.0→1.1. Moderate: 1.2→1.3. Active: 1.2 confirmed.
- **Key Findings:**
  1. **All strategic conclusions are confirmed under realistic IV dynamics.** Active > Moderate > Conservative, RF universally beneficial, feature stack rankings preserved, AC harmful for Moderate. No qualitative changes to any Exp 6–15 findings.
  2. **Framework viable at real VRP=6%.** Active achieves Sharpe >1.0 at 40% vol with VRP=6% — above the Exp 8 deployment floor. Conservative and Moderate also viable at 40–60% vol.
  3. **Calibrated model matches 3 of 4 real data metrics.** ΔIV std (−8%), kurtosis (−8%), and skip rate (~match) are well-calibrated. ARCH clustering is the persistent gap — fundamentally incompatible with OU architecture. This gap means simulated skip rates at higher thresholds are slightly higher than reality (clustered opportunities in real data create more trading windows).
  4. **Poisson jumps capture fat tails.** λ=10 jumps/year (~1 every 5 weeks) with σJ=15% jump size reproduces kurtosis=25 (vs Gaussian 3). Higher frequency (λ=20–30) dilutes jump character and approaches Gaussian. Lower frequency or higher σJ overshoots.
  5. **Threshold shift is modest.** Conservative moved from 1.0 to 1.1, Moderate from 1.2 to 1.3. Active unchanged at 1.2. The wider IV/RV distribution under the calibrated model requires slightly more selective filtering, but the effect is small.
  6. **Higher ξ alone is inferior to OU+Jump.** Pure OU at ξ=0.75 matches ΔIV std perfectly (3.938) but has Gaussian kurtosis (3.0). OU+Jump at ξ=0.50 matches both std and kurtosis. Jump component's value is fat-tail reproduction, not magnitude scaling.
- **Conclusion:** **Framework conditionally validated with calibrated model.** All strategic conclusions hold under realistic IV dynamics and VRP. The recalibrated model (OU+J ξ=0.50 λ=10 σJ=0.15) closes the gap on 3/4 real data metrics. The remaining ARCH gap requires the historical backtest (Exp 18) for definitive resolution. Conservative threshold lowered to 1.1, Moderate raised to 1.3, Active confirmed at 1.2. IV jump parameters should be offered as a "calibrated" IV mode in the simulator.
- **Action Taken:** Full analysis in `research/sweep17/SWEEP17_ANALYSIS.md`. IV jump extension added to `price-gen.ts` (`IVJumpParams` interface, backward-compatible). Preset thresholds updated: Conservative 1.2→1.1, Moderate 1.2→1.3, Active 1.2 (unchanged).

### Experiment 18: Historical Backtest
- **Goal:** Definitive validation — run all three strategies against real 2021–2026 ETH price + DVOL data (cached from Exp 16). No Monte Carlo, no model — one actual market path. Bypasses all model uncertainty including the ARCH clustering gap from Exp 17.
- **Data Source:** ETH-PERPETUAL daily closes + ETH DVOL, 1,812 aligned days (2021-03-24 → 2026-03-09, ~4.96 years). Sub-periods: 2021 H2 (bull), 2022 (bear), 2023 (recovery), 2024–2025 (mixed), 2025–2026 H1 (recent bear).
- **Approach:** Feed historical price and DVOL arrays directly into `simulate()`. One run per strategy × 6 periods. No Monte Carlo, no workers. 18 total backtests, 0.03s execution.
- **Results:**
  - **Conservative (δ0.10/30d, RF+AC+PR):** Sharpe **0.517**, APR +50.19%, MaxDD 71.7%, 11 put sells, 4 full cycles, skip rate 95.2%. Alpha +44.37% over buy-and-hold. **Best strategy on real data.**
  - **Moderate (δ0.20/14d, RF+PR):** Sharpe **−0.348**, APR −26.49%, MaxDD **124.7%** (account blow-up). 25 put sells, 23 assignments (92% assignment rate). Premium ($9,158) insufficient to offset assignment losses. **Not deployable.**
  - **Active (δ0.20/3d, RF):** Sharpe **0.369**, APR +35.10%, MaxDD 65.1%, 168 put sells, 76 assignments, skip rate 81.0%. Alpha +29.27%. **Viable but not dominant.**
- **Key Findings:**
  1. **Strategy rankings are inverted vs simulation.** Simulation: Active > Moderate > Conservative (Exps 6–17). Reality: Conservative > Active ≫ Moderate. The OU+Jump model's inability to reproduce ARCH clustering and crash dynamics leads to materially wrong rankings.
  2. **Conservative matches simulation predictions exactly.** Sharpe 0.517 vs Exp 17 prediction 0.505 at 40% vol / VRP=6%. Conservative's extreme selectivity (95.2% skip rate, 11 put sells in 5 years) and low delta (far OTM strikes) make it robust to model mis-specification.
  3. **Active's drift immunity is falsified.** Negative Sharpe in both real bear markets: 2022 (−0.488), 2025 H1 (−0.867). Crash dynamics with assignment cascades overwhelm premium income. Exp 7's claim of positive Sharpe at −30% drift does not hold under real market volatility clustering.
  4. **Moderate blew up.** 92% assignment rate at δ0.20/14d — close enough to get assigned, slow enough to not recover. 124.7% MaxDD means the account went underwater by more than the initial capital.
  5. **Skip rates are between Exp 16 and Exp 17 predictions.** Active: 81% real vs 61.8% Exp 16 vs 90.6–97.4% Exp 17. The regime filter operates within simulation context (phase timing, cycle boundaries), producing higher skip rates than raw IV/RV ratio distribution analysis.
  6. **ARCH clustering materially affects outcomes.** Real IV clustering creates correlated assignment cascades during bear markets and clustered profitable trades during recoveries. The OU+Jump model, which correctly matched 3/4 calibration metrics (Exp 17), still fails to capture this sequential dependence.
  7. **MaxDD is significantly underestimated by simulations.** Active real 5yr MaxDD: 65.1% vs simulated 28.6% (Exp 12, 2.3× ratio). Conservative: 71.7% vs 59.3% (1.2×). Real crash dynamics produce deeper drawdowns than smooth GBM paths.
  8. **Sub-period performance is highly regime-dependent.** Conservative: 2.591 Sharpe in 2023 recovery, −0.422 in 2025 bear. Active: 1.474 in 2023, −0.867 in 2025 bear. Both strategies thrive in recovery/bull periods and suffer in sustained bears — but Conservative's losses are much smaller.
- **Conclusion:** **Conservative (δ0.10/30d, RF+AC+PR) is the real-data winner.** It achieves 0.517 Sharpe and +50% APR over 5 years, matching simulation predictions almost exactly. Active is viable (0.369 Sharpe) but with severe MaxDD (65.1%) and falsified drift immunity. Moderate is not deployable (blow-up). The simulation framework correctly identifies Conservative as viable and the regime filter as essential, but incorrectly ranks Active above Conservative due to ARCH clustering and crash dynamics the OU+Jump model cannot reproduce. For deployment: Conservative is the recommended strategy; Active requires bear-market sizing reduction.
- **Action Taken:** Full analysis in `research/sweep18/SWEEP18_ANALYSIS.md`. Exported `summarizeRun` and `countFullCycles` from `monte-carlo.ts` (backward-compatible). Moderate preset should carry a health warning or be removed. Strategy rankings revised: Conservative > Active ≫ Moderate on real data.

### Experiment 19: Conservative Parameter Sweep on Real Data
- **Goal:** Optimize Conservative (the Exp 18 real-data winner) by sweeping parameters and testing feature ablation against historical data. Answer: is δ0.10/c30/s1.1/lb45 optimal, or can we improve?
- **Data Source:** Same as Exp 18: ETH-PERPETUAL + ETH DVOL, 1,812 days (2021-03-24 → 2026-03-09).
- **Approach:** Three sub-experiments. A: Core sweep — 5 deltas (0.05–0.15) × 5 cycles (21–45d) × 7 skip thresholds (0.9–1.3) × 4 lookbacks (20–60d) = 700 combos, all RF+AC+PR. B: Feature ablation — 5 feature sets × top 5 configs = 25 runs. C: Wider delta (0.03–0.20) at best A params. Single historical path, 1.35s total execution.
- **Results:**
  - **Best config:** δ0.15/c25/s1.3/lb60 — Sharpe **0.620**, APR 52.94%, MaxDD 57.8%, 9 put sells, 6 full cycles. +20% Sharpe and −14pp MaxDD vs current preset.
  - **Runner-up:** δ0.12/c30/s1.15/lb60 — Sharpe 0.617, APR 63.51%, MaxDD 69.4%. Better bear-market resilience (2022: −0.404 vs −0.998).
  - **Current preset (δ0.10/c30/s1.1/lb45):** Rank **14/700**, Sharpe 0.517. Solid but not optimal.
  - **Feature ablation:** RF+AC+PR is best on average (mean ΔSharpe = 0.000 baseline). One config achieves 1.325 Sharpe with RF only (vs 0.556 with full stack) — put rolling can hurt by concentrating risk.
  - **Delta exploration:** Sweet spot δ0.10–0.15. Ultra-low δ0.03 is non-viable (0 full cycles). δ0.20 increases MaxDD to 72.3%.
- **Key Findings:**
  1. **Current config is good but not optimal.** Rank 14/700 with room for improvement. Best config improves Sharpe by +20% with lower MaxDD.
  2. **Shorter cycles (21–25d) outperform 30d.** Mean Sharpe 0.293–0.303 vs 0.249. More decision points for the regime filter to select trades.
  3. **Lookback 60d dominates.** Mean Sharpe 0.306 vs 0.241–0.247 for shorter windows. Longer smoothing produces more reliable IV/RV signals.
  4. **Skip threshold 0.9–1.15 is the optimal range.** Current 1.1 is fine. Threshold 1.3 over-filters (mean Sharpe 0.201).
  5. **Higher trade frequency (15–20 puts) correlates with better Sharpe (0.304) and lower MaxDD (53.7%)** vs 0–5 puts (Sharpe 0.196, MaxDD 80.3%).
  6. **All results are N=1 and highly path-dependent.** A 1-day config difference caused Sharpe to swing from 0.517 to 0.179 via butterfly effect. Individual rankings are not statistically significant.
  7. **Bear-market resilience varies across top configs.** Best Sharpe config (δ0.15) has 2022 Sharpe −0.998; runner-up (δ0.12/c30) has −0.404. Tradeoff between full-period optimization and worst-case robustness.
- **Conclusion:** **Do not update Conservative preset from this experiment alone.** The improvement (0.620 vs 0.517) is within the noise band of a single-path backtest. Marginal analysis suggests directional improvements: lookback 45→60d (strongest signal), cycle 30→25d (moderate), delta 0.10→0.12 (weak). These should be validated via Exp 20 (Rolling Window Backtest) before committing. The N=1 limitation means over-optimizing to this particular 5-year path risks overfitting.
- **Action Taken:** Full analysis in `research/sweep19/SWEEP19_ANALYSIS.md`. No preset changes — deferred to Exp 20 validation.

### Experiment 20: Rolling Window Backtest
- **Goal:** Address N=1 limitation from Exps 18–19. Run 1-year rolling windows across the 5-year dataset to produce Sharpe/APR/MaxDD distributions instead of single-point estimates. Validate Exp 19 parameter candidates and strategy rankings.
- **Data Source:** Same as Exps 18–19: ETH-PERPETUAL + ETH DVOL, 1,812 aligned days (2021-03-24 → 2026-03-09).
- **Approach:** 17 overlapping 365-day windows (stride 90d) × 5 strategies (Conservative current, 2 Exp 19 candidates, Moderate, Active). 85 total backtests, 0.05s execution. Six analyses: distribution statistics, negative Sharpe frequency, paired window-by-window comparisons, walk-forward validation, per-window dominance, structural break detection.
- **Results:**
  - **Conservative Current (δ0.10/c30/s1.1/lb45):** Mean Sharpe **0.846** (best), median 0.788, std 1.239. 11/17 windows positive (64.7%), 9/17 above 0.3 threshold. Walk-forward stable (−0.014 first→second half).
  - **Conservative Cand1 (δ0.12/c25/s1.15/lb60):** Mean Sharpe 0.747. Current wins 10/17 paired comparisons (+0.100 mean ΔSharpe, t=0.60, non-significant).
  - **Conservative Cand2 (δ0.15/c25/s1.3/lb60):** Mean Sharpe 0.611. Current wins 10/17, 1 tie (+0.235 mean ΔSharpe, t=1.34, non-significant). Highest positive-Sharpe frequency (82.4%) due to extreme filtering, but lowest upside.
  - **Active (δ0.20/c3/s1.2/lb20):** Mean Sharpe **0.657**, median 0.674, std 0.925 (lowest variance). Wins 7/17 windows on absolute Sharpe (most of any strategy). Lowest MaxDD variance (std 13.1%). Complementary win pattern to Conservative.
  - **Moderate (δ0.20/c14/s1.3/lb20):** Mean Sharpe **−0.077** (only negative). Conservative dominates 16/17 windows (t=4.68, p<0.001). 52.9% negative Sharpe rate. Confirmed non-viable.
- **Key Findings:**
  1. **Conservative Current preset is confirmed optimal.** Highest mean Sharpe (0.846), best walk-forward stability (−0.014 degradation), wins paired comparisons against every competitor. No preset change warranted.
  2. **Exp 19 parameter improvements were artifacts of N=1 overfitting.** Both candidates underperform rolling-window mean: Cand1 0.747 vs 0.846 (−12%), Cand2 0.611 vs 0.846 (−28%). Lookback 60d and cycle 25d do not consistently improve on 45d/30d.
  3. **Moderate is consistently non-viable (not a fluke).** Negative mean Sharpe, dominated in 16/17 windows at p<0.001. Exp 18 blow-up was representative, not an outlier.
  4. **Active is a complementary strategy, not a replacement.** Wins most individual windows (41.2%) but on risk-adjusted mean, ranks #3. Active excels in bear-to-recovery transitions (windows 2–3, 9–12); Conservative excels in post-crash recovery and recent volatile markets (windows 6–8, 15–16). Different failure windows suggest a blend could outperform either alone.
  5. **No structural breaks.** Spearman correlations all within [−0.23, +0.21]. Edge is stationary across the 5-year dataset. No evidence of strategy decay.
  6. **Conservative has high per-window variance (std 1.239).** Driven by low trade count (mean 3.0 puts/window). Single-trade outcomes dominate individual windows. Active's higher trade count (34.4 puts/window) diversifies this risk — lower per-window Sharpe variance despite lower mean.
  7. **All strategies have 35% negative-Sharpe frequency.** No strategy avoids losing windows entirely. Conservative, Active, and Cand1 share the same 35.3% loss rate; Cand2 drops to 17.6% via extreme filtering but sacrifices mean Sharpe.
  8. **Walk-forward validation passes for all strategies.** Sign consistency maintained across first/second halves. Strategies are not overfit to early data.
- **Conclusion:** **Conservative Current (δ0.10/c30/s1.1/lb45, RF+AC+PR) is definitively the optimal preset.** Rolling-window validation eliminates the N=1 concern and confirms current parameters are superior to Exp 19 directional candidates. Moderate should carry a deployment warning or be removed. Active remains viable as second-choice or blend component. The next priority is MaxDD reduction (Exp 21: Dynamic Position Sizing) — both Conservative (71.7% worst-window MaxDD) and Active (65.1%) have unacceptable drawdowns for live deployment.
- **Action Taken:** Full analysis in `research/sweep20/SWEEP20_ANALYSIS.md`. No preset changes — current Conservative confirmed optimal. Exp 19 candidates rejected.

### Experiment 21: Dynamic Position Sizing
- **Goal:** Reduce MaxDD below 40% (currently 65–72% for Active/Conservative on real data) without destroying Sharpe. Test three position sizing approaches: fractional Kelly, trailing return gate, vol-scaled sizing.
- **Data Source:** Phase 1: ETH-PERPETUAL + ETH DVOL, 1,812 aligned days, 17 rolling 365-day windows (same as Exp 20). Phase 2: GBM + OU+Jump IV (calibrated Exp 17 model), 1000 MC paths × 3 vols × 3 drifts × 2 horizons.
- **Approach:** Engine extension: added `PositionSizingConfig` to `StrategyConfig` with 3 sizing modes, integrated into `simulate()`. Phase 1: 25 sizing variants × 2 strategies × 17 windows = 850 backtests (0.34s). Phase 2: top configs per strategy × 18 MC conditions = 108,000 paths (173.7s).
- **Results:**
  - **Vol-Scaled (VS-40/45) dominates.** Only effective sizing mode for both strategies. Kelly and TRG have zero/destructive effect.
  - **Conservative + VS-40/45:** Mean Sharpe 0.887 (+4.7%), Mean MaxDD 22.1% (−3.9pp), Max MaxDD 71.7% (unchanged — cold-start problem). MC: Sharpe *improves* at all conditions (+0.005 to +0.099), MaxDD reduces up to −19.7pp at 80% vol / 5yr.
  - **Active + VS-40/45:** Mean Sharpe 0.601 (91.4% preserved), Mean MaxDD 20.0% (−7.7pp), **Max MaxDD 38.0%** (−27.1pp, **meets <40% target**). MaxDD wins 13/17 windows. MC: MaxDD reduces −3.4pp to −8.8pp at cost of −0.102 to −0.166 Sharpe.
- **Key Findings:**
  1. **Vol-Scaled is the only effective sizing mode.** Kelly fails due to cold-start problem and permanent undersizing. TRG fails because Conservative trades too infrequently and Active's premium income masks drawdowns. Vol-Scaled works because it uses trailing realized vol — a forward-looking signal independent of trade history.
  2. **VS-40/45 has asymmetric Sharpe effects.** Improves Conservative Sharpe (lower return variance with minimal mean loss) but costs Active Sharpe (sacrifices premium during high-vol periods). Unambiguous win for Conservative, tradeoff for Active.
  3. **Active meets the MaxDD < 40% target.** 38.0% max across all 17 windows (down from 65.1%). Driven by −38.5pp reduction in the worst window (2021 crash).
  4. **Conservative's worst-case MaxDD (71.7%) is not reducible by sizing alone.** The crash occurs before vol-scaling has enough lookback data. Defined-risk spreads (Exp 22) may be needed.
  5. **Strategy ranking preserved.** Conservative (0.887 Sharpe) > Active (0.601 Sharpe) with sizing. Both benefit from VS-40/45.
  6. **Kelly is destructive for Active (33–41% Sharpe preservation).** Cold-start uses full size for early trades, then permanently undersizes. Insufficient cycle history for reliable estimation.
  7. **TRG is structurally ineffective.** Conservative's 90%+ skip rate means no sustained drawdowns to detect. Active's premium income offsets losses within the lookback window, preventing gate activation.
- **Conclusion:** **VS-40/45 should be added to both presets.** It is an unambiguous improvement for Conservative and achieves the MaxDD target for Active. `positionSizing: { mode: "volScaled", volTarget: 0.40, volLookbackDays: 45, minSize: 0.10 }`. Conservative's cold-start MaxDD problem requires further investigation (Exp 22 or initial sizing caps).
- **Action Taken:** Full analysis in `research/sweep21/SWEEP21_ANALYSIS.md`. Engine extended: `PositionSizingConfig` in types.ts, sizing computation in simulate.ts, contracts tracking in executor.ts/state.ts. 24 new tests, 337 total passing (98.67% coverage).

### Experiment 22: Cold-Start Sizing Cap
- **Goal:** Reduce Conservative's cold-start MaxDD from 71.7% to <45%. Exp 21's VS-40/45 cannot help because the crash occurs in the first ~45 days — before `computeVolScaledMultiplier` has enough price history for a meaningful realized vol estimate.
- **Data Source:** Same as Exps 18–21: ETH-PERPETUAL + ETH DVOL, 1,812 aligned days (2021-03-24 → 2026-03-09). 17 rolling 365-day windows (stride 90d).
- **Approach:** Added `coldStartDays` and `coldStartSize` to `PositionSizingConfig`. During `day < coldStartDays`, the sizing multiplier is capped at `min(computed, coldStartSize)`. Swept `coldStartDays` ∈ {30, 45, 60, 90} × `coldStartSize` ∈ {0.10, 0.25, 0.50, 0.75} in two modes: VS+CS (cold-start on top of VS-40/45) and CS-only (cold-start without vol-scaling). 34 sizing variants × 2 strategies × 17 windows = 1,156 backtests, 0.49s.
- **Results:**
  - **Conservative:** 18/32 cold-start configs meet both targets (Max MaxDD < 45% AND Sharpe ≥ 90% baseline). Best: VS+CS-10/60 → Max MaxDD **33.1%** (−38.6pp), Mean Sharpe **1.094** (+29.3%). Recommended: VS+CS-50/45 → Max MaxDD **37.7%**, Mean Sharpe **0.964** (+13.9%). Full-period: MaxDD 71.7% → **36.1%**.
  - **Active:** Cold-start unnecessary. VS-40/45 (Exp 21) already achieves 38.0% Max MaxDD. Adding cold-start costs 6–22% Sharpe for <2pp further MaxDD reduction. Active's higher trade frequency self-heals through the cold-start period.
- **Key Findings:**
  1. **Cold-start cap solves Conservative's last deployment blocker.** Max MaxDD drops 71.7% → 33.1–37.7% depending on config. All 18 qualifying configs are well below the 45% target.
  2. **Cold-start *improves* Conservative Sharpe.** Every qualifying config has higher mean Sharpe than baseline (0.916–1.132 vs 0.846). The cold-start period is net-negative EV for Conservative — crash-period assignments dominate premium income — so withholding capital during this period improves both risk and return.
  3. **Smaller cold-start size is monotonically better for Conservative.** No tradeoff: 10% → 75% size degrades both max MaxDD (33.1% → 54.1%) and Sharpe (1.132 → 0.923). Conservative's 95%+ skip rate means very few trades occur during cold-start regardless.
  4. **`coldStartDays` has minimal impact beyond 30 days.** Max MaxDD is identical (±0.2pp) across 30–90d at any fixed `coldStartSize`. The crashes that determine worst-case MaxDD happen within the first 30 days.
  5. **VS+CS dominates CS-only in all 16/16 comparisons.** Vol-scaling adds value on top of cold-start for both MaxDD and Sharpe. The effects are complementary: cold-start handles initialization, vol-scaling handles ongoing high-vol episodes.
  6. **Cold-start is not needed for Active.** VS-40/45 already meets the <40% target. Cold-start adds cost without meaningful benefit because Active's high trade frequency generates premium even during the cold-start period.
  7. **Exp 23 (Defined-Risk Spreads) is no longer needed.** Cold-start cap alone brings Conservative below 45% — no engine architecture changes required for spread payoff logic.
- **Conclusion:** **Conservative's deployment blocker is resolved.** Recommended config: `coldStartDays: 45, coldStartSize: 0.50` on top of VS-40/45. This achieves 37.7% max MaxDD (rolling) / 36.1% (full-period) with 113.9% Sharpe preservation — both better risk and better return than the unsized baseline. Active should continue using VS-40/45 without cold-start. Both strategies now achieve max MaxDD < 40% with positive Sharpe. The framework is deployment-ready.
- **Action Taken:** Full analysis in `research/sweep22/SWEEP22_ANALYSIS.md`. Engine extended: `coldStartDays` and `coldStartSize` added to `PositionSizingConfig`, cold-start cap applied in `computeSizingMultiplier`. 4 new tests, 341 total passing.

### Experiment 23: Preset Integration & Final Validation
- **Goal:** Ship the research findings. Add `positionSizing` to Conservative and Aggressive presets, remove Moderate, re-run rolling-window + full-period validation with sizing enabled. No new research — integration and final sign-off.
- **Data Source:** Same as Exps 18–22: ETH-PERPETUAL + ETH DVOL, 1,812 aligned days (2021-03-24 → 2026-03-09). 17 rolling 365-day windows (stride 90d).
- **Approach:** 4 strategies (Conservative baseline/sized, Active baseline/sized) × 17 windows + full-period + sub-period analysis. 92 total backtests, 0.06s.
- **Changes Made:**
  - `StrategyPresetValues` extended with 6 position sizing fields (`sizingMode`, `sizingVolTarget`, `sizingVolLookback`, `sizingMinSize`, `sizingColdStartDays`, `sizingColdStartSize`)
  - Conservative preset: added VS-40/45 + CS-50/45
  - Aggressive preset: added VS-40/45 (no cold-start)
  - Moderate preset: removed from `STRATEGY_BUILT_INS`
  - Simulator UI: Position Sizing section added
  - 345 tests passing (4 new sizing validation tests)
- **Results:**
  - **Conservative Sized:** Mean Sharpe **0.964** (+14.0% vs baseline 0.846), max MaxDD **37.7%** (−33.9pp vs 71.7%). Full-period: Sharpe 0.537, APR 34.8%, MaxDD 36.1%. Sharpe wins 14/17 windows.
  - **Active Sized:** Mean Sharpe **0.601** (−8.5% vs baseline 0.657), max MaxDD **38.0%** (−27.1pp vs 65.1%). Full-period: Sharpe 0.365, APR 25.3%, MaxDD 30.2%. MaxDD wins 13/17 windows.
- **Key Findings:**
  1. **Both strategies meet MaxDD < 40% target.** Conservative: 37.7% (rolling) / 36.1% (full-period). Active: 38.0% (rolling) / 30.2% (full-period). Deployment blocker resolved.
  2. **Conservative sizing is a pure improvement.** Improves both Sharpe (+14.0%) and MaxDD (−33.9pp). Cold-start cap avoids net-negative early trades; vol-scaling reduces exposure during high-vol crashes.
  3. **Active sizing is a favorable tradeoff.** Costs 8.5% Sharpe for 41.6% MaxDD reduction — the drawdown at deployment scale is dramatically more survivable.
  4. **Results match Exps 20–22 exactly.** Perfect reproducibility confirms zero behavioral changes from preset integration.
  5. **Moderate removal confirmed.** Negative mean Sharpe, 124.7% MaxDD on real data, dominated in 16/17 windows.
- **Conclusion:** **Framework is deployment-ready.** Both Conservative and Aggressive presets now ship with position sizing that keeps MaxDD < 40% while preserving positive Sharpe. No further research blocks deployment.
- **Action Taken:** Full analysis in `research/sweep23/SWEEP23_ANALYSIS.md`. Presets shipped: Conservative (VS-40/45 + CS-50/45), Aggressive (VS-40/45). Moderate removed. UI extended. 345 tests passing.

### Experiment 24: Multi-Asset Validation (BTC)
- **Goal:** Validate whether the wheel strategy framework — developed and optimized against ETH data in Exps 1–23 — generalizes to BTC. First multi-asset test.
- **Data Source:** BTC DVOL + BTC-PERPETUAL daily closes from Deribit (2021-03-24 → 2026-03-11, 1,814 aligned days). ETH data from Exp 16 cache for cross-asset comparison.
- **Approach:** Combined Exp 16 (IV dynamics) + Exp 18 (historical backtest) + Exp 20/23 (rolling window) for BTC. Both strategies with final shipped sizing configs. Single script, 1.27s.
- **Results:**
  - **IV Dynamics:** BTC κ=6.60 (OU-compatible, ETH: 5.55). VRP 9.64% (ETH: 6.35%). Skip rate at t=1.2: 45.3% (ETH: 61.8%). BTC IV is smoother (ΔIV std 3.45% vs 3.93%) with identical fat-tail kurtosis (27.0).
  - **Full Period:** BTC Conservative Sharpe 0.127, MaxDD 34.0%. BTC Aggressive Sharpe 0.499, MaxDD 26.0%. ETH Conservative Sharpe 0.537, ETH Aggressive 0.365. Full-period rankings differ by asset (Aggr > Cons on BTC, Cons > Aggr on ETH).
  - **Rolling Window (17 × 365d):** BTC Cons mean Sharpe 1.118 / max MaxDD 35.6%. BTC Aggr mean Sharpe 1.043 / max MaxDD 32.7%. Both outperform ETH equivalents (0.964 / 0.601). Paired: Cons wins 9/17, Aggr 8/17, t=0.30 (non-significant).
- **Key Findings:**
  1. **BTC IV dynamics are OU-compatible — framework validated for BTC.** κ=6.60 (range 2–10), ACF=0.982, identical fat-tail kurtosis.
  2. **BTC VRP is higher than ETH (9.64% vs 6.35%).** Above Active floor (5%), borderline Conservative floor (10%). Options systematically more overpriced.
  3. **BTC skip rate 16.5pp lower than ETH at t=1.2 (45.3% vs 61.8%).** More trade opportunities due to higher VRP.
  4. **Strategy ranking is asset-dependent.** Conservative dominates on ETH (rolling mean 0.964 vs 0.601), tied on BTC (1.118 vs 1.043, t=0.30).
  5. **Both strategies meet MaxDD < 40% on BTC.** Cons 35.6%, Aggr 32.7%. Both better than ETH.
  6. **BTC strategies outperform ETH across all windows.** BTC Cons +16%, BTC Aggr +74% vs ETH equivalents. Lower negative-Sharpe frequency (11.8% vs 35.3% for Aggressive).
  7. **Full-period results misleading for Conservative.** Skip rate 98.8% (6 puts in 5yr) concentrates full-period Sharpe on few trades. Rolling window captures seasonal opportunities.
- **Conclusion:** **Framework validated for BTC deployment.** No engine or preset changes needed — same params generalize across assets. Strategy selection is asset-dependent: Conservative for ETH, either for BTC (statistically tied). BTC is a more favorable environment for premium selling (higher VRP, lower IV, lower MaxDD).
- **Action Taken:** Full analysis in `research/sweep24/SWEEP24_ANALYSIS.md`. BTC data cached in `research/sweep24/data/`. No code changes.

### Experiment 25: Additional Asset Validation (SOL)
- **Goal:** Extend multi-asset validation to SOL before portfolio analysis (Exp 26). Test whether SOL's IV dynamics match OU model assumptions and whether strategy performance generalizes to a third asset.
- **Data Source:** SOL DVOL (206 records, 2022-05-04 → 2022-11-25, **discontinued**) + SOL_USDC-PERPETUAL (1,460 records, 2022-03-15 → 2026-03-13). ETH/BTC data from Exp 24 cache for cross-asset comparison.
- **Approach:** Adapted Exp 24 approach for limited data. (1) IV dynamics analysis on 206-day SOL DVOL with cross-asset comparison for same period. (2) Limited historical backtest (206 days, bear-only). (3) Long-term price dynamics analysis using SOL_USDC-PERPETUAL RV (1,460 days). Rolling window backtest impossible (206 < 365d minimum).
- **Results:**
  - **Critical Data Limitation:** SOL DVOL discontinued after Nov 2022 — only 206 daily records exist. Covers exclusively the May–Nov 2022 bear market (Terra/Luna, 3AC, FTX). No multi-regime data available.
  - **IV Dynamics (206d):** SOL κ=19.73 (outside OU range 2–10), but same-period ETH κ=49.2, BTC κ=48.5 — crash period distorts κ for all assets. SOL ACF(1)=0.942, sq ΔIV ACF(1)=0.199 (less ARCH than ETH/BTC). VRP=5.50% (marginal — above Active 5% floor, below Conservative 10% floor).
  - **Backtest (206d bear):** All strategies negative (expected, SOL −84.5% drawdown). SOL Conservative: Sharpe −1.869, MaxDD 31.9% (below 40% target — sizing works). SOL Aggressive: Sharpe −2.708, MaxDD 61.6%. Conservative skip rate 98.9% (1 put in 7mo).
  - **Price Dynamics (1,460d RV):** SOL ann RV 98.5% (ETH 79.2%, BTC 61.1%). RV declining year-over-year: 123.6% (2022) → 82.4% (2026). RV persistence similar across assets (ACF ≈ 0.98).
- **Key Findings:**
  1. **SOL DVOL is discontinued — proper validation impossible.** Only 206 days of IV data exist, all from a single bear regime. Cannot estimate reliable κ, cannot run rolling windows, cannot assess cross-regime performance.
  2. **SOL IV dynamics are not clearly OU-incompatible.** The high κ=19.73 is a crash-period artifact (ETH/BTC also anomalous). SOL has less ARCH clustering and more IV persistence than ETH/BTC in the same window.
  3. **Position sizing controls work on SOL.** Conservative MaxDD 31.9% during an 84.5% crash — cold-start cap and vol-scaling contained drawdown below the 40% target.
  4. **SOL is ~25% more volatile than ETH, ~60% more than BTC** (RV 91% vs 73% vs 55%). At upper end of framework range but within Active viability (≤100% per Exp 15).
  5. **SOL VRP is marginal (5.5%).** High uncertainty due to small sample and period bias.
  6. **SOL cannot be included in Exp 26 (portfolio analysis).** No multi-year DVOL data for reliable historical backtest.
- **Conclusion:** **Validation blocked by insufficient data.** SOL DVOL was discontinued after 206 days. Limited evidence suggests SOL IV may be OU-compatible and sizing controls are effective, but no confident conclusions possible from a single 7-month bear window. Exp 26 scope narrowed to ETH + BTC only.
- **Action Taken:** Full analysis in `research/sweep25/SWEEP25_ANALYSIS.md`. SOL data cached in `research/sweep25/data/`. No code changes. No preset changes.

### Experiment 26: Cross-Asset Portfolio Analysis
- **Goal:** Test whether combining ETH and BTC wheel strategies into a portfolio improves risk-adjusted returns and reduces MaxDD below individual-asset levels. Key questions: cross-asset return correlation, optimal allocation (equal weight vs inverse-vol), and whether diversification provides genuine Sharpe improvement.
- **Data Source:** ETH-PERPETUAL + ETH DVOL (1,812 days, Exp 16 cache) and BTC-PERPETUAL + BTC DVOL (1,814 days, Exp 24 cache). Common alignment: 1,812 days (2021-03-24 → 2026-03-09).
- **Approach:** Build daily equity curves for 4 asset-strategy legs (ETH-Conservative, ETH-Aggressive, BTC-Conservative, BTC-Aggressive). Construct 15 portfolio variants: 4 single-asset baselines, 4 two-asset equal-weight, 4 two-asset inverse-vol-weighted, 2 four-leg (EW and IV), 1 dynamic Sharpe-weighted. Full-period + 17 rolling 365d windows + efficient frontier sweep (11 weight increments). 374 total backtests, 0.12s execution.
- **Results:**
  - **Correlation:** ETH-Cons ↔ BTC-Aggr = **0.236** (lowest cross-asset pair). Conservative cross-asset = 0.346. Aggressive cross-asset = 0.632. Rolling 90d Conservative correlation: mean 0.361, range [−0.395, 0.915] — spikes during crashes.
  - **Best portfolio (full-period):** **IV: ETH-Cons + BTC-Aggr** — Sharpe **0.690**, MaxDD **25.2%**, APR 26.70%. Weights: 41% ETH / 59% BTC.
  - **Best single (full-period):** ETH-Conservative — Sharpe 0.638, MaxDD 36.1%, APR 34.28%.
  - **Rolling window:** IV: ETH-Cons + BTC-Aggr mean Sharpe **0.862** (highest), 11.8% negative-Sharpe frequency (tied lowest). Paired vs BTC-Aggressive: t=0.18, not significant (6/17 wins).
  - **Efficient frontier:** Optimal weight **40% ETH-Cons / 60% BTC-Aggr** → Sharpe 0.690, MaxDD 25.1%.
  - **Dynamic Sharpe-weighting:** Destructive — Sharpe 0.506, MaxDD 39.2% (worst portfolio).
- **Key Findings:**
  1. **ETH-Cons + BTC-Aggr is the only combo that improves both Sharpe and MaxDD simultaneously.** +0.051 Sharpe (+8.1%) and −0.8pp MaxDD vs best single-asset. All other combos degrade one or both metrics. The benefit comes from low cross-correlation (0.236) between Conservative's selective, low-delta ETH trades and Aggressive's frequent BTC trades.
  2. **Inverse-vol weighting marginally outperforms equal weighting.** +0.004 Sharpe, −0.4pp MaxDD. ETH's higher annualised vol (31.25% vs 21.48%) makes it naturally overweight at 50/50; IV weighting corrects this to 41/59.
  3. **Diversification does NOT hedge bear market risk.** 2022 bear: portfolio Sharpe −1.163 vs ETH-Cons alone −0.817. Crash-period correlations spike to 0.915. Diversification is a fair-weather benefit — it smooths the equity curve in normal markets but fails during the moments it would be most valuable.
  4. **Dynamic allocation is destructive, static weights dominate.** Trailing Sharpe-weighted allocation produces the worst MaxDD (39.2%) and lowest Sharpe (0.506) of any multi-asset portfolio. Consistent with Exp 14's finding that signal-based deployment decisions reduce performance vs the regime filter alone.
  5. **Four-leg portfolios add noise, not diversification.** EW All 4 Legs matches EW ETH-C+B-A on rolling Sharpe (0.826 each) despite including two weaker legs. Including sub-optimal legs dilutes returns without meaningful correlation benefit.
  6. **Portfolio improvement is not statistically significant on per-window basis.** t=0.18 with 16 degrees of freedom. The signal is real but small relative to per-window variance. This is a N=17 power limitation — with 50+ windows the effect might reach significance.
  7. **Complementary win patterns confirmed.** ETH-Conservative dominates bull/early-bear windows (1–3, 5). BTC-Aggressive dominates recovery/recent windows (6–7, 13–16). Portfolios win recovery-to-mixed transition windows (8–12). This temporal complementarity drives the full-period Sharpe improvement.
- **Conclusion:** **Deploy 40% ETH-Conservative / 60% BTC-Aggressive for the smoothest equity curve and lowest MaxDD.** The portfolio improves risk-adjusted returns by +8.1% Sharpe and −0.8pp MaxDD vs the best individual asset-strategy. The benefit is modest and driven by low cross-correlation (0.236) between decorrelated trade timing. Avoid dynamic allocation (destroys value) and four-leg portfolios (dilutive). No engine changes needed — portfolio construction is external to the strategy engine. Bear markets remain the portfolio's weakness — crash-period correlations spike to near 1.0, eliminating diversification precisely when it would matter most.
- **Action Taken:** Full analysis in `research/sweep26/SWEEP26_ANALYSIS.md`. No code changes. Optimal portfolio allocation identified: 40/60 ETH-Cons/BTC-Aggr (inverse-vol weighted).

### Experiment 27: Sized Strategy Cost Sensitivity on Real Data
- **Goal:** Confirm break-even friction levels for the shipped sized presets on real historical data. Re-run Exp 13's cost sweep (bid-ask spread, per-trade fee) on the final configurations (Conservative VS-40/45+CS-50/45, Aggressive VS-40/45) against ETH and BTC data.
- **Data Source:** ETH-PERPETUAL + ETH DVOL (1,812 days, 2021-03-24 → 2026-03-09) from Exp 16 cache. BTC-PERPETUAL + BTC DVOL (1,814 days, 2021-03-24 → 2026-03-11) from Exp 24 cache.
- **Approach:** `bidAskSpreadPct` ∈ {1%, 3%, 5%, 8%, 12%} × `feePerTrade` ∈ {$0.25, $0.50, $1.00, $2.00} × 2 strategies × 2 assets. Full-period + 17 rolling 365d windows (stride 90d). 80 sized combos + 16 unsized comparison runs. 0.82s execution.
- **Results:**
  - **Zero-Crossing:** None found. All 80/80 combos maintain rolling-window mean Sharpe ≥ 0.20 — including worst-case (12% spread, $2.00 fee).
  - **Optimistic (5%/$0.50):** ETH Cons RW mean 0.964, ETH Aggr 0.601, BTC Cons 1.118, BTC Aggr 1.043. All MaxDD < 40%.
  - **Worst-case (12%/$2.00):** ETH Cons RW mean 0.637, ETH Aggr 0.334, BTC Cons 1.067, BTC Aggr 0.848.
  - **Sensitivity slopes:** BTC Cons −0.0093 Sharpe/pp (nearly friction-immune), ETH Cons −0.0347, BTC Aggr −0.0265, ETH Aggr −0.0210.
  - **Sizing × cost interaction:** Ratios 0.88×–1.16× (all near 1.0). Sizing does not amplify cost sensitivity.
- **Key Findings:**
  1. **All four strategy × asset combos are fully cost-resilient.** Every shipped preset is deployment-grade at any realistic Deribit cost.
  2. **BTC is 2–4× more cost-insensitive than ETH.** BTC Conservative's slope (−0.0093) is 3.7× less steep than ETH Conservative (−0.0347). BTC Conservative with 6 puts in 5yr is essentially friction-immune.
  3. **Position sizing does not amplify cost sensitivity.** Sizing × cost interaction ratios near 1.0.
  4. **MaxDD stays below 40% target across all cost levels for sized strategies.** Exception: ETH Aggressive rolling MaxMaxDD reaches 41.2% at worst-case costs only.
  5. **Strategy ranking does not reverse at any cost level.** Conservative dominates on rolling Sharpe at all tested friction.
  6. **Spread dominates fee as the cost driver** (confirming Exp 13). Spread is 1.6× more impactful than fee.
  7. **Aggressive's higher trade count dilutes per-trade cost impact.** Conservative loses −0.035 Sharpe/put vs Aggressive's −0.002 Sharpe/put — 16× less per trade.
- **Conclusion:** **Cost sensitivity question closed.** Framework fully deployment-ready at any realistic Deribit friction. Exp 13's MC-based conclusions validated on 5yr historical data with position sizing enabled.
- **Action Taken:** Full analysis in `research/sweep27/SWEEP27_ANALYSIS.md`. No code or preset changes.

---

<!-- NOTE: Keep this section at the end of the file. New experiments append above this section; new follow-up ideas append to the list below. -->
## Recommended Next Experiments

*Research status after 27 experiments: Both Conservative and Aggressive ship with position sizing (VS-40/45). Conservative includes cold-start cap (CS-50/45). Both achieve max MaxDD < 40% with positive Sharpe on 5yr historical ETH and BTC data. Moderate removed (non-viable). Framework validated for multi-asset deployment (BTC + ETH). SOL validation blocked — DVOL discontinued after 206 days (Nov 2022). Strategy ranking is asset-dependent: Conservative dominates ETH, tied with Aggressive on BTC. Optimal cross-asset portfolio: 40% ETH-Conservative / 60% BTC-Aggressive (IV-weighted), Sharpe 0.690, MaxDD 25.2%. Portfolio diversification benefit is modest (+8.1% Sharpe, −0.8pp MaxDD) and not statistically significant per-window — static allocation outperforms dynamic. Cost sensitivity confirmed as non-threatening — all presets remain profitable at worst-case Deribit friction (12% spread, $2.00 fee) on both assets with sizing enabled (Exp 27). All `improvements-for-later.md` items closed.*

### Low — Nice to have

- **Experiment 28: BTC Conservative Trade Frequency** — *(Opened by Exp 24.)* BTC Conservative executed only 6 puts in 5yr (skip rate 98.8%, 2.6 puts/window avg), far fewer than ETH Conservative (11 puts, 3.0/window). Full-period Sharpe suffered (0.127 vs 0.537 ETH) despite strong rolling-window mean (1.118). Sweep `skipBelowRatio` ∈ {0.9, 1.0, 1.05, 1.1} and `cycleDays` ∈ {14, 21, 30} on BTC data to test whether relaxing the IV/RV filter increases Conservative trade frequency without degrading rolling Sharpe. Could justify BTC-specific preset params. No engine changes needed.

- **Experiment 29: Adaptive Strategy Switching** — Test regime-dependent switching between Conservative and Aggressive based on trailing market metrics (e.g., 60d return, RV level, IV/RV ratio trend). Exp 20 showed complementary win patterns on ETH; Exp 24 showed strategies are tied on BTC with Aggressive winning bear periods (2025 BTC: Aggr +0.163 Sharpe vs Cons −0.775). Exp 26 confirmed the temporal complementarity (ETH-Cons wins early, BTC-Aggr wins late) but dynamic Sharpe-weighting was destructive. A smarter switching signal (e.g., trailing 60d return direction, not trailing Sharpe) might work but is speculative — regime detection accuracy is hard to validate. No engine changes needed.

- **Experiment 30: Portfolio Rebalancing Frequency** — *(Opened by Exp 26.)* The optimal 40/60 ETH-Cons/BTC-Aggr allocation uses static weights over 5 years. Test monthly, quarterly, and annual rebalancing (reset weights to target) to see whether drift from target allocation significantly impacts portfolio Sharpe or MaxDD. Also test if rebalancing can capture the crash-correlation spike (sell whichever asset dropped less, buy the other). No engine changes needed — apply rebalancing logic externally to equity curves.

---

## Addendum — 2026-03-13 Rerun After Roll Accounting Fix

The `OPTION_ROLLED` accounting bug for non-unit contract sizes was fixed on 2026-03-13 and the affected sizing-era experiments were rerun: Exps 21, 22, 23, 24, 25, 26, and 27.

### What Changed

- The bug only affected runs where `rollPut` and non-unit sizing occurred together, so the impact is concentrated on the sized Conservative strategy.
- Earlier one-contract / non-sized conclusions remain unchanged in direction.
- The previous "deployment-ready" conclusion for both sized presets is no longer supported as written.

### Corrected Rerun Highlights

- **Exp 21:** Conservative `VS-40/45` reran at mean Sharpe `0.786` vs baseline `0.846`, mean MaxDD `22.5%`, worst-window MaxDD `71.7%`. Active `VS-40/45` remained broadly intact at mean Sharpe `0.601`, worst-window MaxDD `38.0%`.
- **Exp 22:** No Conservative cold-start configuration met both targets of `Max MaxDD < 45%` and `Sharpe >= 90%` of baseline. Example: `VS+CS-50/45` reran at mean Sharpe `0.620`, max MaxDD `43.9%`.
- **Exp 23:** Conservative sized reran to mean Sharpe `0.620`, rolling max MaxDD `43.9%`, full-period Sharpe `0.439`, full-period MaxDD `38.6%`. Active sized reran to mean Sharpe `0.601`, rolling max MaxDD `38.0%`, full-period Sharpe `0.365`, full-period MaxDD `30.2%`.
- **Exp 24:** BTC Conservative sized reran weaker than previously reported: full-period Sharpe `0.060`, max MaxDD `35.9%`, rolling mean Sharpe `0.766`. BTC Aggressive sized remained strong: rolling mean Sharpe `1.043`, max MaxDD `32.7%`.
- **Exp 25:** SOL remains underpowered and non-decisive. Rerun stayed negative in the 2022 bear slice: Conservative `-1.869` Sharpe / `31.9%` MaxDD, Aggressive `-2.708` / `61.6%`.
- **Exp 26:** Cross-asset diversification still helps somewhat, but with lower absolute strength. Best full-period portfolio reran as inverse-vol `ETH-Conservative + BTC-Aggressive` at Sharpe `0.630`, MaxDD `27.6%`.
- **Exp 27:** Cost sensitivity conclusions remain directionally intact: rolling-window mean Sharpe stayed positive across tested frictions. At the baseline `5% / $0.50`, ETH Conservative sized reran at full-period Sharpe `0.439` and rolling mean Sharpe `0.620`.

### Revised Conclusion

- **Active sized remains viable** on the research's original deployment criteria.
- **Conservative sized no longer supports the prior "pure improvement" claim.**
- **The statement "both strategies now achieve max MaxDD < 40%" is no longer generally true** under the corrected reruns.
- The research record above should therefore be read as historical narrative; the corrected sizing-era numbers in this addendum are authoritative unless and until the per-experiment analysis files are updated.
