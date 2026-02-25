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

### Experiment 1: [Pending]
- **Goal:**
- **Market Baseline:**
- **Approach:**
- **Results:**
- **Action Taken:**

