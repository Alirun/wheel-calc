---
title: Wheel Strategy Simulator
toc: false
---

# Wheel Strategy Simulator

Generate random ETH price series and Monte Carlo the Wheel strategy across many simulations.

```js
import {runMonteCarlo, rerunSingle} from "./components/monte-carlo.js";
```

<div class="grid grid-cols-3">
  <div class="card">
    <h3>Market</h3>

```js
const marketParams = view(Inputs.form({
  startPrice: Inputs.range([500, 8000], {value: 2500, step: 50, label: "Start price (USD)"}),
  days: Inputs.range([30, 365], {value: 30, step: 1, label: "Days to simulate"}),
  annualVol: Inputs.range([10, 200], {value: 80, step: 5, label: "Annual volatility (%)"}),
  annualDrift: Inputs.range([-100, 100], {value: 0, step: 5, label: "Annual drift (%)"}),
  numSimulations: Inputs.range([10, 2000], {value: 200, step: 10, label: "Simulations"})
}));
```

<hr style="margin:0.5rem 0;border:0;border-top:1px solid var(--theme-foreground-faintest)">
<h3 style="margin-top:0.5rem">Costs</h3>

```js
const costParams = view(Inputs.form({
  riskFreeRate: Inputs.range([0, 10], {value: 5, step: 0.5, label: "Risk-free rate (%)"}),
  bidAskSpreadPct: Inputs.range([0, 20], {value: 5, step: 1, label: "Bid-ask spread (%)"}),
  feePerTrade: Inputs.range([0, 10], {value: 0.50, step: 0.10, label: "Fee per trade (USD)"})
}));
```

  </div>
  <div class="card">
    <h3>Strategy</h3>

```js
const strategyParams = view(Inputs.form({
  targetDelta: Inputs.range([0.05, 0.50], {value: 0.30, step: 0.01, label: "Target delta (puts)"}),
  ivPremiumPct: Inputs.range([0, 50], {value: 15, step: 1, label: "IV premium over RV (%)"}),
  cycleLengthDays: Inputs.range([1, 30], {value: 7, step: 1, label: "Cycle length (days)"}),
  contracts: Inputs.range([1, 20], {value: 1, step: 1, label: "Contracts (1 = 1 ETH)"}),
  adaptiveCalls: Inputs.toggle({label: "Adaptive call delta", value: true}),
  minCallDelta: Inputs.range([0.05, 0.40], {value: 0.10, step: 0.01, label: "Min call delta (underwater)"}),
  maxCallDelta: Inputs.range([0.20, 0.70], {value: 0.50, step: 0.01, label: "Max call delta (profitable)"}),
  skipThresholdPct: Inputs.range([0, 2], {value: 0.1, step: 0.05, label: "Skip threshold (%)"})
}));
```

  </div>
  <div class="card" style="min-height:420px">
    <h3>Strategy Rules</h3>

```js
const rulesHtml = html`<ol style="margin:0;padding-left:1.2rem;line-height:1.7;font-size:0.85rem">
  <li><strong>Sell PUT</strong> at <code>${strategyParams.targetDelta.toFixed(2)}</code>Δ, <code>${strategyParams.cycleLengthDays}</code>d expiry, IV = <code>${(impliedVol * 100).toFixed(0)}%</code></li>
  <li>PUT expires OTM (spot &ge; strike) &rarr; collect premium, go to 1</li>
  <li>PUT assigned (spot &lt; strike) &rarr; buy ETH at strike. Sell CALLs.</li>
  ${strategyParams.adaptiveCalls
    ? html`<li><strong>Sell CALL</strong> &mdash; adaptive delta:
        <ul style="margin:0.15rem 0;padding-left:1rem">
          <li>Underwater &rarr; Δ &asymp; <code>${strategyParams.minCallDelta.toFixed(2)}</code></li>
          <li>Breakeven &rarr; Δ &asymp; <code>${((strategyParams.minCallDelta + strategyParams.maxCallDelta) / 2).toFixed(2)}</code></li>
          <li>Profitable &rarr; Δ &asymp; <code>${strategyParams.maxCallDelta.toFixed(2)}</code></li>
          <li>Premium &lt; <code>${strategyParams.skipThresholdPct.toFixed(1)}%</code> of position &rarr; <strong>SKIP</strong></li>
        </ul>
      </li>`
    : html`<li><strong>Sell CALL</strong> at <code>${strategyParams.targetDelta.toFixed(2)}</code>Δ, <code>${strategyParams.cycleLengthDays}</code>d expiry</li>`
  }
  <li>CALL expires OTM &rarr; collect premium, go to 4</li>
  <li>CALL assigned &rarr; sell ETH at strike. Return to 1.</li>
</ol>`;
```

${rulesHtml}

  </div>
</div>

```js
const annualVol = marketParams.annualVol / 100;
const impliedVol = annualVol * (1 + strategyParams.ivPremiumPct / 100);

const market = {
  startPrice: marketParams.startPrice,
  days: marketParams.days,
  annualVol: annualVol,
  annualDrift: marketParams.annualDrift / 100
};

const wheelConfig = {
  targetDelta: strategyParams.targetDelta,
  impliedVol: impliedVol,
  riskFreeRate: costParams.riskFreeRate / 100,
  cycleLengthDays: strategyParams.cycleLengthDays,
  contracts: strategyParams.contracts,
  bidAskSpreadPct: costParams.bidAskSpreadPct / 100,
  feePerTrade: costParams.feePerTrade,
  ...(strategyParams.adaptiveCalls ? {
    adaptiveCalls: {
      minDelta: strategyParams.minCallDelta,
      maxDelta: strategyParams.maxCallDelta,
      skipThresholdPct: strategyParams.skipThresholdPct / 100
    }
  } : {})
};

const mc = runMonteCarlo(market, wheelConfig, marketParams.numSimulations);
```

## Monte Carlo Summary

<div style="display:flex;flex-wrap:wrap;gap:0.75rem;">
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Win Rate</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold;color:${mc.winRate >= 0.5 ? '#2ca02c' : '#d62728'}">
      ${(mc.winRate * 100).toFixed(1)}%
    </p>
  </div>
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Mean APR</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold;color:${mc.meanAPR >= 0 ? '#2ca02c' : '#d62728'}">
      ${mc.meanAPR >= 0 ? '+' : ''}${mc.meanAPR.toFixed(1)}%
    </p>
  </div>
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Median APR</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold;color:${mc.medianAPR >= 0 ? '#2ca02c' : '#d62728'}">
      ${mc.medianAPR >= 0 ? '+' : ''}${mc.medianAPR.toFixed(1)}%
    </p>
  </div>
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Mean P/L</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold;color:${mc.meanPL >= 0 ? '#2ca02c' : '#d62728'}">
      ${mc.meanPL >= 0 ? '+' : ''}$${mc.meanPL.toFixed(2)}
    </p>
  </div>
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Mean Max Drawdown</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold;color:#d62728">
      -$${mc.meanMaxDrawdown.toFixed(2)}
    </p>
  </div>
</div>

## Outcome Distribution

```js
const winRuns = mc.runs.filter((r) => r.isWin);
const loseRuns = mc.runs.filter((r) => !r.isWin);
```

<div class="grid grid-cols-2">
  <div class="card">
    ${resize((width) =>
      Plot.plot({
        title: "APR Distribution",
        width,
        height: 260,
        x: {label: "APR (%)", grid: true},
        y: {label: "Count"},
        marks: [
          Plot.rectY(winRuns, Plot.binX({y: "count"}, {x: "apr", fill: "#2ca02c", fillOpacity: 0.7})),
          Plot.rectY(loseRuns, Plot.binX({y: "count"}, {x: "apr", fill: "#d62728", fillOpacity: 0.7})),
          Plot.ruleX([0], {stroke: "#333", strokeDasharray: "4,4"})
        ]
      })
    )}
  </div>
  <div class="card">
    ${resize((width) =>
      Plot.plot({
        title: "Total P/L Distribution",
        width,
        height: 260,
        x: {label: "Total P/L (USD)", grid: true},
        y: {label: "Count"},
        marks: [
          Plot.rectY(winRuns, Plot.binX({y: "count"}, {x: "totalPL", fill: "#2ca02c", fillOpacity: 0.7})),
          Plot.rectY(loseRuns, Plot.binX({y: "count"}, {x: "totalPL", fill: "#d62728", fillOpacity: 0.7})),
          Plot.ruleX([0], {stroke: "#333", strokeDasharray: "4,4"})
        ]
      })
    )}
  </div>
</div>

## Simulation Runs

```js
const runsTable = mc.runs.map((r) => ({
  Seed: r.seed,
  "Total P/L": r.totalPL,
  "APR (%)": r.apr,
  Premiums: r.premiumCollected,
  Assignments: r.assignments,
  Cycles: r.fullCycles,
  Skipped: r.skippedCycles,
  "Max DD": -r.maxDrawdown,
  Win: r.isWin ? "Yes" : "No"
}));
```

<div style="max-width: none;">
  ${Inputs.table(runsTable, {
    sort: "Seed",
    reverse: false,
    layout: "auto",
    format: {
      "Total P/L": (d) => `${d >= 0 ? "+" : ""}$${d.toFixed(2)}`,
      "APR (%)": (d) => `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`,
      Premiums: (d) => `$${d.toFixed(2)}`,
      "Max DD": (d) => `$${d.toFixed(2)}`
    }
  })}
</div>

```js
const detailSeed = view(Inputs.range([1, marketParams.numSimulations], {
  value: 1,
  step: 1,
  label: "Select seed for detail view",
  width: 480
}));
```

```js
const selected = rerunSingle(market, wheelConfig, detailSeed);
const selectedPrices = selected.prices;
const selectedResult = selected.result;

const selectedFullCycles = selectedResult.trades.filter((t) => t.type === "call" && t.assigned).length;
const capitalAtRisk = marketParams.startPrice * strategyParams.contracts;
const yearsElapsed = marketParams.days / 365;
const selectedAPR = yearsElapsed > 0 ? (selectedResult.totalRealizedPL / capitalAtRisk) / yearsElapsed * 100 : 0;
```

## Run Detail: Seed ${detailSeed}

<div style="display:flex;flex-wrap:wrap;gap:0.75rem;">
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Realized P/L</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold;color:${selectedResult.totalRealizedPL >= 0 ? '#2ca02c' : '#d62728'}">
      ${selectedResult.totalRealizedPL >= 0 ? '+' : ''}$${selectedResult.totalRealizedPL.toFixed(2)}
    </p>
  </div>
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">APR</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold;color:${selectedAPR >= 0 ? '#2ca02c' : '#d62728'}">
      ${selectedAPR >= 0 ? '+' : ''}${selectedAPR.toFixed(1)}%
    </p>
  </div>
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Premiums Collected</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold;color:#2ca02c">
      +$${selectedResult.totalPremiumCollected.toFixed(2)}
    </p>
  </div>
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Assignments</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold">${selectedResult.totalAssignments}</p>
  </div>
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Full Cycles</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold">${selectedFullCycles}</p>
  </div>
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Skipped Cycles</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold">${selectedResult.totalSkippedCycles}</p>
  </div>
</div>

### Price & Position

```js
const cycleBands = selectedResult.trades.map((t) => ({
  x1: t.startDay,
  x2: t.endDay,
  type: t.type,
  strike: t.strike
}));

const assignments = selectedResult.trades.filter((t) => t.assigned).map((t) => ({
  day: t.endDay,
  price: selectedPrices[t.endDay],
  type: t.type
}));
```

<div class="card">
  ${resize((width) =>
    Plot.plot({
      title: "ETH Price with Wheel Cycles",
      width,
      height: 400,
      x: {label: "Day"},
      y: {label: "Price (USD)", grid: true},
      color: {legend: true},
      marks: [
        ...cycleBands.map((b) =>
          Plot.rectY([b], {
            x1: "x1",
            x2: "x2",
            y1: () => Math.min(...selectedPrices) * 0.95,
            y2: () => Math.max(...selectedPrices) * 1.05,
            fill: b.type === "put" ? "#d6272810" : "#1f77b410"
          })
        ),
        ...cycleBands.map((b) =>
          Plot.ruleY([b.strike], {
            x1: b.x1,
            x2: b.x2,
            stroke: b.type === "put" ? "#d62728" : "#1f77b4",
            strokeDasharray: "4,4",
            strokeOpacity: 0.5
          })
        ),
        Plot.line(selectedPrices.map((p, i) => ({day: i, price: p})), {
          x: "day",
          y: "price",
          stroke: "#333",
          strokeWidth: 1.5,
          tip: true
        }),
        Plot.dot(assignments, {
          x: "day",
          y: "price",
          fill: (d) => d.type === "put" ? "#d62728" : "#1f77b4",
          r: 6,
          symbol: "diamond2",
          tip: true,
          title: (d) => `${d.type.toUpperCase()} assigned @ day ${d.day}`
        })
      ]
    })
  )}
</div>

### Inventory & Unrealized P/L

```js
const inventoryEvents = [];
let invQty = 0;
let invCostBasis = null;
for (const t of selectedResult.trades) {
  if (t.type === "put" && t.assigned) {
    invQty = strategyParams.contracts;
    invCostBasis = t.strike;
    inventoryEvents.push({day: t.endDay, event: "PUT assigned", qty: invQty, costBasis: invCostBasis, spot: t.spotAtExpiration});
  } else if (t.type === "call" && t.assigned) {
    inventoryEvents.push({day: t.endDay, event: "CALL assigned", qty: 0, costBasis: invCostBasis, spot: t.spotAtExpiration});
    invQty = 0;
    invCostBasis = null;
  }
}
```

<div class="grid grid-cols-2">
  <div class="card">
    <h3>Inventory Events</h3>
    ${inventoryEvents.length === 0
      ? html`<p style="color:var(--theme-foreground-muted)">No assignments yet — not holding ETH</p>`
      : html`<table style="width:100%">
          <thead><tr><th>Day</th><th>Event</th><th>ETH Held</th><th>Cost Basis</th><th>Spot</th><th>Unrealized</th></tr></thead>
          <tbody>${inventoryEvents.map((e) => {
            const unrealized = e.qty > 0 ? (e.spot - e.costBasis) * e.qty : 0;
            return html`<tr>
              <td>${e.day}</td>
              <td><strong>${e.event}</strong></td>
              <td>${e.qty}</td>
              <td>${e.costBasis !== null ? `$${e.costBasis.toFixed(0)}` : "—"}</td>
              <td>$${e.spot.toFixed(0)}</td>
              <td style="color:${unrealized >= 0 ? '#2ca02c' : '#d62728'};font-weight:bold">${e.qty > 0 ? `${unrealized >= 0 ? '+' : ''}$${unrealized.toFixed(2)}` : "—"}</td>
            </tr>`;
          })}</tbody>
        </table>`
    }
  </div>
  <div class="card">
    <h3>Final Position</h3>
    ${(() => {
      const last = selectedResult.dailyState[selectedResult.dailyState.length - 1];
      if (!last.holdingETH) return html`<p>No ETH held — fully in cash</p><p>Phase: <strong>Selling PUT</strong></p>`;
      const lastTrade = [...selectedResult.trades].reverse().find((t) => t.type === "put" && t.assigned);
      const cb = lastTrade ? lastTrade.strike : 0;
      return html`
        <p>Holding: <strong>${strategyParams.contracts} ETH</strong></p>
        <p>Cost basis: <strong>$${cb.toFixed(0)}</strong></p>
        <p>Current spot: <strong>$${last.price.toFixed(0)}</strong></p>
        <p>Unrealized: <span style="font-weight:bold;color:${last.unrealizedPL >= 0 ? '#2ca02c' : '#d62728'}">${last.unrealizedPL >= 0 ? '+' : ''}$${last.unrealizedPL.toFixed(2)}</span></p>
        <p>Phase: <strong>Selling CALL</strong></p>
      `;
    })()}
  </div>
</div>

<div class="card">
  ${resize((width) =>
    Plot.plot({
      title: "Unrealized P/L (when holding ETH)",
      width,
      height: 200,
      x: {label: "Day"},
      y: {label: "Unrealized P/L (USD)", grid: true},
      marks: [
        Plot.ruleY([0]),
        Plot.areaY(selectedResult.dailyState, {
          x: "day",
          y: "unrealizedPL",
          fill: (d) => d.unrealizedPL >= 0 ? "#2ca02c" : "#d62728",
          fillOpacity: 0.2
        }),
        Plot.line(selectedResult.dailyState, {
          x: "day",
          y: "unrealizedPL",
          stroke: "#ff7f0e",
          strokeWidth: 1.5,
          tip: true
        })
      ]
    })
  )}
</div>

### Cumulative P/L

<div class="card">
  ${resize((width) =>
    Plot.plot({
      title: "Realized vs Unrealized P/L Over Time",
      width,
      height: 300,
      x: {label: "Day"},
      y: {label: "P/L (USD)", grid: true},
      marks: [
        Plot.ruleY([0]),
        Plot.areaY(selectedResult.dailyState, {
          x: "day",
          y: "cumulativePL",
          fill: "#2ca02c",
          fillOpacity: 0.15
        }),
        Plot.line(selectedResult.dailyState, {
          x: "day",
          y: "cumulativePL",
          stroke: "#2ca02c",
          strokeWidth: 2,
          tip: true
        }),
        Plot.line(selectedResult.dailyState, {
          x: "day",
          y: (d) => d.cumulativePL + d.unrealizedPL,
          stroke: "#ff7f0e",
          strokeWidth: 1.5,
          strokeDasharray: "4,4",
          tip: true
        })
      ]
    })
  )}
</div>

<p><small><span style="color:#2ca02c">&#9644;</span> Realized P/L &nbsp; <span style="color:#ff7f0e">- - -</span> Realized + Unrealized</small></p>

### Trade Log

```js
const tradeRows = [];
let rowNum = 0;
let runningPL = 0;
let costBasis = null;
const feePerContract = costParams.feePerTrade * strategyParams.contracts;
for (const t of selectedResult.trades) {
  // 1. Option sale event
  rowNum++;
  const optionPL = t.premium * strategyParams.contracts - feePerContract;
  runningPL += optionPL;
  tradeRows.push({
    "#": rowNum,
    Day: t.startDay,
    Event: `SELL ${t.type.toUpperCase()}`,
    Strike: t.strike,
    Spot: t.spotAtOpen,
    "Entry": costBasis,
    Delta: Math.abs(t.delta),
    IV: t.impliedVol,
    Premium: t.premium,
    "dPNL": optionPL,
    "Total PNL": runningPL
  });

  // 2. Expiration / assignment event
  rowNum++;
  if (!t.assigned) {
    tradeRows.push({
      "#": rowNum,
      Day: t.endDay,
      Event: `${t.type.toUpperCase()} EXPIRED`,
      Strike: null,
      Spot: t.spotAtExpiration,
      "Entry": costBasis,
      Delta: null,
      IV: null,
      Premium: null,
      "dPNL": null,
      "Total PNL": runningPL
    });
  } else if (t.type === "put") {
    costBasis = t.strike;
    tradeRows.push({
      "#": rowNum,
      Day: t.endDay,
      Event: "BUY ETH",
      Strike: t.strike,
      Spot: t.spotAtExpiration,
      "Entry": costBasis,
      Delta: null,
      IV: null,
      Premium: null,
      "dPNL": null,
      "Total PNL": runningPL
    });
  } else {
    // call assigned → sell ETH
    const ethPL = (t.strike - (t.entryPrice ?? 0)) * strategyParams.contracts;
    runningPL += ethPL;
    tradeRows.push({
      "#": rowNum,
      Day: t.endDay,
      Event: "SELL ETH",
      Strike: t.strike,
      Spot: t.spotAtExpiration,
      "Entry": costBasis,
      Delta: null,
      IV: null,
      Premium: null,
      "dPNL": ethPL,
      "Total PNL": runningPL
    });
    costBasis = null;
  }
}
```

<div style="max-width: none;">
  ${Inputs.table(tradeRows, {
    sort: "#",
    reverse: false,
    layout: "auto",
    format: {
      Strike: (d) => d != null ? `$${d.toFixed(0)}` : "—",
      Spot: (d) => `$${d.toFixed(0)}`,
      "Entry": (d) => d != null ? `$${d.toFixed(0)}` : "—",
      Delta: (d) => d != null ? d.toFixed(2) : "—",
      IV: (d) => d != null ? `${(d * 100).toFixed(0)}%` : "—",
      Premium: (d) => d != null ? `$${d.toFixed(2)}` : "—",
      "dPNL": (d) => d != null ? `${d >= 0 ? "+" : ""}$${d.toFixed(2)}` : "—",
      "Total PNL": (d) => `${d >= 0 ? "+" : ""}$${d.toFixed(2)}`
    }
  })}
</div>
