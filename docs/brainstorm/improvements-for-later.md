# Wheel Strategy — Future Improvements

> **Closed.** All items assessed against the research program (Exps 1–24). Everything is either implemented, solved by a different mechanism, or not worth pursuing. This file is kept for historical reference only.

---

## Implemented / Solved by Research

- [x] **Put spread / naked put protection** — Solved by position sizing (VS-40/45 + cold-start cap). Exps 21–22. MaxDD 72% → 37%.
- [x] **Event-aware cycle skipping** — Superseded by regime filter (per-trade IV/RV check). Exps 4–5. Exp 14 proved additional signals are destructive.
- [x] **Collar strategy when underwater** — Solved by position sizing. Exps 21–22.
- [x] **Trend-based call skipping** — Implemented as Adaptive Calls. Exp 6 validated: helps Conservative, hurts others.
- [x] **Transaction cost sensitivity** — Fully swept. Exp 13. Active Sharpe ≥ 0.39 even at 12% spread / $2.00 fee.
- [x] **Optimal parameter grid search** — Exhaustively swept. Exps 1–7, 19–20. Presets optimized and validated on rolling windows.
- [x] **Strategy P/L vs underlying return** — Alpha vs buy-and-hold computed in every experiment.

---

## Not Worth Pursuing

- [x] **Portfolio-level delta management** — Requires multi-contract engine. Single-contract wheel has one position at a time; delta is binary (0 or 1 ETH). Not applicable until multi-contract support is built, which is not planned.
- [x] **Staggered covered calls** — Requires multi-contract engine. Exp 6 showed call rolling has zero impact at δ0.10–0.20 because calls never go ITM. Staggering zero-impact calls at different strikes won't change outcomes.
- [x] **Assignment cost averaging** — Contradicts 24 experiments of evidence. Conservative wins because it minimizes assignments (δ0.10, 95% skip, 11 puts in 5yr). Exp 18 showed Moderate's 92% assignment rate caused a blow-up. "Double down after assignment" goes the wrong direction.
- [x] **IV skew awareness** — Needs strike-level historical IV data (not just ATM DVOL). Conservative executes ~11 trades in 5 years — optimizing strike selection on 11 trades is noise, not signal.
- [x] **Volatility term structure** — Would improve MC realism, but research moved past MC in Exps 18–24 with real ETH+BTC data validation. Making a synthetic model marginally more realistic is pointless when real data is available.
- [x] **Greeks evolution over time** — Pure visualization. Doesn't change what trades the strategy makes or improve Sharpe/MaxDD. Nice-to-have dashboard, not a strategy improvement.
- [x] **Capital efficiency tracking** — Pure analytics metric. Doesn't change trade decisions. Could be added as a UI feature but is not a research item.
