---
title: Wheel Strategy Simulator
toc: false
---

# Wheel Strategy Simulator

Generate random ETH price series and Monte Carlo the Wheel strategy across many simulations.

```js
import {runMonteCarlo, rerunSingle} from "./components/monte-carlo.js";
import {defaultRules} from "./components/strategy/rules.js";
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
const activeRules = defaultRules();
const rulesHtml = html`<div style="font-size:0.82rem;line-height:1.5">
  ${activeRules.map((r, i) => html`
    <div style="margin-bottom:0.6rem;padding:0.4rem 0.5rem;border-radius:4px;border:1px solid var(--theme-foreground-faintest)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.2rem">
        <strong>${r.name}</strong>
        <span style="font-size:0.7rem;color:var(--theme-foreground-muted)">P${r.priority} · ${r.phase}</span>
      </div>
      <div style="color:var(--theme-foreground-muted);font-size:0.78rem">${r.description}</div>
    </div>
  `)}
</div>`;
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

const strategyConfig = {
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

const mc = runMonteCarlo(market, strategyConfig, marketParams.numSimulations);
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
const selected = rerunSingle(market, strategyConfig, detailSeed);
const selectedPrices = selected.prices;
const selectedResult = selected.result;

const selectedFullCycles = selectedResult.signalLog.filter(
  (entry) => entry.events.some((e) => e.type === "OPTION_EXPIRED" && e.optionType === "call" && e.assigned)
).length;
const capitalAtRisk = marketParams.startPrice * strategyParams.contracts;
const yearsElapsed = marketParams.days / 365;
const selectedAPR = yearsElapsed > 0 ? (selectedResult.summary.totalRealizedPL / capitalAtRisk) / yearsElapsed * 100 : 0;
```

## Run Detail: Seed ${detailSeed}

<div style="display:flex;flex-wrap:wrap;gap:0.75rem;">
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Realized P/L</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold;color:${selectedResult.summary.totalRealizedPL >= 0 ? '#2ca02c' : '#d62728'}">
      ${selectedResult.summary.totalRealizedPL >= 0 ? '+' : ''}$${selectedResult.summary.totalRealizedPL.toFixed(2)}
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
      +$${selectedResult.summary.totalPremiumCollected.toFixed(2)}
    </p>
  </div>
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Assignments</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold">${selectedResult.summary.totalAssignments}</p>
  </div>
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Full Cycles</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold">${selectedFullCycles}</p>
  </div>
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Skipped Cycles</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold">${selectedResult.summary.totalSkippedCycles}</p>
  </div>
</div>

### State Machine

```js
const lastPhase = selectedResult.dailyStates[selectedResult.dailyStates.length - 1]?.phase ?? "idle_cash";

const smNodes = [
  {id: "idle_cash", label: "IDLE CASH", x: 0, y: 0},
  {id: "short_put", label: "SHORT PUT", x: 260, y: 0},
  {id: "holding_eth", label: "HOLDING ETH", x: 260, y: 160},
  {id: "short_call", label: "SHORT CALL", x: 0, y: 160}
];

const smEdges = [
  {from: "idle_cash", to: "short_put", label: "sell put"},
  {from: "short_put", to: "idle_cash", label: "expired OTM"},
  {from: "short_put", to: "holding_eth", label: "assigned"},
  {from: "holding_eth", to: "short_call", label: "sell call"},
  {from: "holding_eth", to: "holding_eth", label: "skip"},
  {from: "short_call", to: "holding_eth", label: "expired OTM"},
  {from: "short_call", to: "idle_cash", label: "assigned"}
];

const phaseColors = {
  idle_cash: "#2ca02c",
  short_put: "#d62728",
  holding_eth: "#ff7f0e",
  short_call: "#1f77b4"
};
```

```js
const stateMachineSvg = (() => {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", "-90 -60 480 290");
  s.style.maxWidth = "500px";
  s.style.fontFamily = "var(--sans-serif)";
  s.style.fontSize = "11px";

  const defs = document.createElementNS(ns, "defs");
  defs.innerHTML = `<marker id="ah" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--theme-foreground-muted)"/></marker>`;
  s.appendChild(defs);

  for (const n of smNodes) {
    const active = n.id === lastPhase;
    const g = document.createElementNS(ns, "g");
    g.setAttribute("transform", `translate(${n.x},${n.y})`);
    const rect = document.createElementNS(ns, "rect");
    Object.entries({x: -35, y: -14, width: 110, height: 28, rx: 6,
      fill: active ? phaseColors[n.id] : "var(--theme-background-alt)",
      stroke: phaseColors[n.id], "stroke-width": active ? 2.5 : 1.5,
      opacity: active ? 1 : 0.6
    }).forEach(([k, v]) => rect.setAttribute(k, String(v)));
    g.appendChild(rect);
    const text = document.createElementNS(ns, "text");
    Object.entries({"text-anchor": "middle", dy: 4, x: 20,
      fill: active ? "white" : "var(--theme-foreground)",
      "font-weight": active ? "bold" : "normal", "font-size": 10
    }).forEach(([k, v]) => text.setAttribute(k, String(v)));
    text.textContent = n.label;
    g.appendChild(text);
    s.appendChild(g);
  }

  const edges = `
    <!-- sell put: idle_cash → short_put (horizontal top, upper track) -->
    <line x1="80" y1="-5" x2="220" y2="-5" stroke="var(--theme-foreground-muted)" marker-end="url(#ah)"/>
    <text x="150" y="-12" text-anchor="middle" fill="var(--theme-foreground-muted)" font-size="9">sell put</text>

    <!-- expired OTM: short_put → idle_cash (horizontal top, lower track) -->
    <line x1="220" y1="8" x2="80" y2="8" stroke="var(--theme-foreground-muted)" marker-end="url(#ah)"/>
    <text x="150" y="22" text-anchor="middle" fill="var(--theme-foreground-muted)" font-size="9">expired OTM</text>

    <!-- assigned: short_put → holding_eth (vertical right side) -->
    <line x1="310" y1="20" x2="310" y2="140" stroke="var(--theme-foreground-muted)" marker-end="url(#ah)"/>
    <text x="324" y="82" fill="var(--theme-foreground-muted)" font-size="9">assigned</text>

    <!-- sell call: holding_eth → short_call (horizontal bottom, upper track) -->
    <line x1="220" y1="155" x2="80" y2="155" stroke="var(--theme-foreground-muted)" marker-end="url(#ah)"/>
    <text x="150" y="148" text-anchor="middle" fill="var(--theme-foreground-muted)" font-size="9">sell call</text>

    <!-- skip: holding_eth self-loop (right side) -->
    <path d="M340,150 C370,140 370,180 340,170" fill="none" stroke="var(--theme-foreground-muted)" marker-end="url(#ah)"/>
    <text x="378" y="162" fill="var(--theme-foreground-muted)" font-size="9">skip</text>

    <!-- expired OTM: short_call → holding_eth (horizontal bottom, lower track) -->
    <line x1="80" y1="168" x2="220" y2="168" stroke="var(--theme-foreground-muted)" marker-end="url(#ah)"/>
    <text x="150" y="184" text-anchor="middle" fill="var(--theme-foreground-muted)" font-size="9">expired OTM</text>

    <!-- assigned: short_call → idle_cash (straight vertical, left side) -->
    <line x1="-45" y1="140" x2="-45" y2="20" stroke="var(--theme-foreground-muted)" marker-end="url(#ah)"/>
    <text x="-58" y="82" fill="var(--theme-foreground-muted)" font-size="9" text-anchor="end">assigned</text>
  `;
  const edgeGroup = document.createElementNS(ns, "g");
  edgeGroup.innerHTML = edges;
  s.appendChild(edgeGroup);

  return s;
})();
```

<div class="grid grid-cols-2">
  <div class="card">
    <h3 style="margin-top:0">State Machine</h3>
    ${stateMachineSvg}
  </div>
  <div class="card" style="overflow-y:auto;max-height:340px">
    <h3 style="margin-top:0">Signal Log</h3>

```js
const signalLogRows = selectedResult.signalLog.map((entry) => {
  const sig = entry.signal;
  const actionColors = {
    SELL_PUT: "#d62728", SELL_CALL: "#1f77b4", SKIP: "#ff7f0e",
    CLOSE_POSITION: "#9467bd", HOLD: "var(--theme-foreground-muted)", ROLL: "#8c564b"
  };
  const color = actionColors[sig.action] ?? "var(--theme-foreground)";
  const rule = sig.action !== "HOLD" && "rule" in sig ? sig.rule : "";
  const reason = sig.action !== "HOLD" && "reason" in sig ? sig.reason : "";
  const phaseBefore = entry.portfolioBefore.phase;
  const phaseAfter = entry.portfolioAfter.phase;
  const transition = phaseBefore !== phaseAfter ? `${phaseBefore} → ${phaseAfter}` : phaseBefore;

  return html`<tr style="font-size:0.78rem">
    <td>${entry.day}</td>
    <td style="color:${color};font-weight:600">${sig.action}</td>
    <td>${rule}</td>
    <td style="color:var(--theme-foreground-muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${reason}">${reason}</td>
    <td style="font-size:0.72rem">${transition}</td>
  </tr>`;
});
```

${signalLogRows.length === 0
  ? html`<p style="color:var(--theme-foreground-muted)">No signals yet</p>`
  : html`<table style="width:100%;border-collapse:collapse">
      <thead><tr style="font-size:0.72rem;color:var(--theme-foreground-muted);border-bottom:1px solid var(--theme-foreground-faintest)">
        <th style="text-align:left;padding:2px 4px">Day</th>
        <th style="text-align:left;padding:2px 4px">Signal</th>
        <th style="text-align:left;padding:2px 4px">Rule</th>
        <th style="text-align:left;padding:2px 4px">Reason</th>
        <th style="text-align:left;padding:2px 4px">Phase</th>
      </tr></thead>
      <tbody>${signalLogRows}</tbody>
    </table>`
}

  </div>
</div>

### Price & Position

```js
const cycleBands = [];
const signalMarkers = [];
for (const entry of selectedResult.signalLog) {
  for (const e of entry.events) {
    if (e.type === "OPTION_SOLD") {
      cycleBands.push({
        x1: e.openDay,
        x2: e.expiryDay,
        type: e.optionType,
        strike: e.strike
      });
    }
  }
  if (entry.signal.action !== "HOLD") {
    signalMarkers.push({
      day: entry.day,
      price: entry.market.spot,
      action: entry.signal.action,
      rule: entry.signal.action !== "HOLD" ? entry.signal.rule : ""
    });
  }
}

const assignments = selectedResult.signalLog.flatMap((entry) =>
  entry.events
    .filter((e) => e.type === "OPTION_EXPIRED" && e.assigned)
    .map((e) => ({day: entry.day, price: e.spot, type: e.optionType}))
);
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
        Plot.dot(signalMarkers, {
          x: "day",
          y: "price",
          fill: (d) => ({
            SELL_PUT: "#d62728",
            SELL_CALL: "#1f77b4",
            SKIP: "#ff7f0e",
            CLOSE_POSITION: "#9467bd",
            ROLL: "#8c564b"
          })[d.action] ?? "#999",
          r: 4,
          symbol: "circle",
          tip: true,
          title: (d) => `${d.action} (${d.rule}) @ day ${d.day}`
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

<p><small>
  <span style="color:#d62728">&#9679;</span> Sell Put &nbsp;
  <span style="color:#1f77b4">&#9679;</span> Sell Call &nbsp;
  <span style="color:#ff7f0e">&#9679;</span> Skip &nbsp;
  <span style="color:#d62728">&#9670;</span> Put Assigned &nbsp;
  <span style="color:#1f77b4">&#9670;</span> Call Assigned
</small></p>

### Inventory & Unrealized P/L

```js
const inventoryEvents = [];
for (const entry of selectedResult.signalLog) {
  for (const e of entry.events) {
    if (e.type === "ETH_BOUGHT") {
      inventoryEvents.push({day: entry.day, event: "PUT assigned", qty: e.size, costBasis: e.price, spot: entry.market.spot});
    } else if (e.type === "ETH_SOLD") {
      inventoryEvents.push({day: entry.day, event: "CALL assigned", qty: 0, costBasis: null, spot: entry.market.spot});
    } else if (e.type === "POSITION_CLOSED") {
      inventoryEvents.push({day: entry.day, event: "POSITION CLOSED", qty: 0, costBasis: null, spot: e.price});
    }
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
            const unrealized = e.qty > 0 && e.costBasis !== null ? (e.spot - e.costBasis) * e.qty : 0;
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
      const last = selectedResult.dailyStates[selectedResult.dailyStates.length - 1];
      if (!last.holdingETH) return html`<p>No ETH held — fully in cash</p><p>Phase: <strong>${last.phase}</strong></p>`;
      const costBasis = (() => {
        for (let i = inventoryEvents.length - 1; i >= 0; i--) {
          if (inventoryEvents[i].costBasis !== null) return inventoryEvents[i].costBasis;
        }
        return 0;
      })();
      return html`
        <p>Holding: <strong>${strategyParams.contracts} ETH</strong></p>
        <p>Cost basis: <strong>$${costBasis.toFixed(0)}</strong></p>
        <p>Current spot: <strong>$${last.price.toFixed(0)}</strong></p>
        <p>Unrealized: <span style="font-weight:bold;color:${last.unrealizedPL >= 0 ? '#2ca02c' : '#d62728'}">${last.unrealizedPL >= 0 ? '+' : ''}$${last.unrealizedPL.toFixed(2)}</span></p>
        <p>Phase: <strong>${last.phase}</strong></p>
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
        Plot.areaY(selectedResult.dailyStates, {
          x: "day",
          y: "unrealizedPL",
          fill: (d) => d.unrealizedPL >= 0 ? "#2ca02c" : "#d62728",
          fillOpacity: 0.2
        }),
        Plot.line(selectedResult.dailyStates, {
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
        Plot.areaY(selectedResult.dailyStates, {
          x: "day",
          y: "cumulativePL",
          fill: "#2ca02c",
          fillOpacity: 0.15
        }),
        Plot.line(selectedResult.dailyStates, {
          x: "day",
          y: "cumulativePL",
          stroke: "#2ca02c",
          strokeWidth: 2,
          tip: true
        }),
        Plot.line(selectedResult.dailyStates, {
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
for (const entry of selectedResult.signalLog) {
  rowNum++;
  const sig = entry.signal;
  const rule = sig.action !== "HOLD" ? sig.rule : "";
  const reason = sig.action !== "HOLD" && "reason" in sig ? sig.reason : "";

  let strike = null;
  let delta = null;
  let iv = null;
  let premium = null;
  let dPNL = null;

  if (sig.action === "SELL_PUT" || sig.action === "SELL_CALL") {
    strike = sig.strike;
    delta = Math.abs(sig.delta);
    iv = strategyConfig.impliedVol;
    premium = sig.premium;
  }

  for (const e of entry.events) {
    if (e.type === "PREMIUM_COLLECTED") {
      dPNL = (dPNL ?? 0) + e.netAmount;
      runningPL += e.netAmount;
    }
    if (e.type === "ETH_SOLD") {
      dPNL = (dPNL ?? 0) + e.pl;
      runningPL += e.pl;
    }
    if (e.type === "POSITION_CLOSED") {
      dPNL = (dPNL ?? 0) + e.pl;
      runningPL += e.pl;
    }
  }

  tradeRows.push({
    "#": rowNum,
    Day: entry.day,
    Rule: rule,
    Signal: sig.action,
    Strike: strike,
    Spot: entry.market.spot,
    Delta: delta,
    IV: iv,
    Premium: premium,
    Reason: reason,
    "dPNL": dPNL,
    "Total PNL": runningPL
  });
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
      Delta: (d) => d != null ? d.toFixed(2) : "—",
      IV: (d) => d != null ? `${(d * 100).toFixed(0)}%` : "—",
      Premium: (d) => d != null ? `$${d.toFixed(2)}` : "—",
      "dPNL": (d) => d != null ? `${d >= 0 ? "+" : ""}$${d.toFixed(2)}` : "—",
      "Total PNL": (d) => `${d >= 0 ? "+" : ""}$${d.toFixed(2)}`
    }
  })}
</div>
