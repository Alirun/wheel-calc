### Experiment 1: High-Vol Sideways Grid Search
- **Goal:** Maximize Sharpe Ratio (Risk-Adjusted Return)
- **Market Baseline:** High-Vol Sideways (0% drift, 150% vol, Heston)
- **Approach:** Iterative Grid Search sweeping `targetDelta` (0.10 to 0.40) and `cycleLengthDays` (3 to 30) across 1,000 Monte Carlo paths over 365 days. (Rolling disabled).
- **Full Results Data:** 
  - *Data generated via `npx tsx research/sweep1.ts` on 1,000 unique paths (seed 1-1000).*
- **Key Findings:**
  - **Highest Sharpe (Safest):** `delta: 0.1, cycle: 30, skip: 0`. Generated a 0.013 Sharpe, 0.54% Mean APR, 35.54% Max DD.
  - **Highest Return (Riskiest):** `delta: 0.3, cycle: 30, skip: 0`. Generated an 8.92% Mean APR but had a worse Sharpe (-0.245) due to a massive 50.66% Max DD.
  - **Worst Strategy (Account Destroyer):** High delta (0.4) combined with short duration (3 days) or high skip threshold (10%). `delta: 0.4, cycle: 3, skip: 0.1` had a -0.440 Sharpe and 61.53% Max DD.
- **Action Taken/Takeaway:**
  1. **The "Sell Weeklies" Myth is Dead (in extreme volatility):** Shorter duration cycles (3, 7 DTE) performed significantly worse in high-volatility sideways markets than longer (30 DTE) options. Short DTE options suffer from explosive Gamma risk in choppy markets, causing frequent assignments. 30 DTE allows the chop to mean-revert before expiration.
  2. **Low Delta Preserves Capital:** Selling 0.3 or 0.4 delta generates the highest raw profit (nearly 9% APR), but guarantees 50-60% drawdowns. Selling 0.1 delta is the only way to keep drawdowns in the 30% range in a 150% vol environment.
  3. **Always Be In The Market:** The `skipThreshold` mechanic hurt performance. The Wheel relies on continuous, relentless premium collection to offset drawdowns. `skip: 0` (always having a position open) had a 56.8% win rate vs 46.6% for `skip: 0.1`. Waiting for "fat premiums" mathematically loses to continuous compounding.