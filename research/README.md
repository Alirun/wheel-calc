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

### Recommended Next Experiments

- **Experiment 2: Defined-Risk Spreads** — Same grid but with vertical spreads (5-wide, 10-wide) to cap max loss per cycle and improve Sharpe by truncating drawdown tails.
- **Experiment 3: Normal-Vol Regime** — Run identical sweep on 20–30% annual vol (typical equity market) to find where the wheel actually generates alpha.
- **Experiment 4: Regime Filter** — Only sell premium when realized vol > implied vol (positive variance risk premium). Cash otherwise.
- **Experiment 5: Kelly Sizing** — Replace fixed 1-contract sizing with fractional Kelly to see if bankroll management rescues the aggressive parameterizations.
