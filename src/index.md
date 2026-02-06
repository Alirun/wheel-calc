---
title: ETH Wheel Payout Charts
toc: false
---

# ETH Wheel Payout Charts

Short Call and Short Put payout at expiration with ETH-oriented defaults.

```js
const params = view(Inputs.form({
  strike: Inputs.range([1000, 6000], {value: 3000, step: 50, label: "Strike (USD)"}),
  callPremium: Inputs.range([5, 600], {value: 70, step: 1, label: "Call premium (USD per ETH)"}),
  putPremium: Inputs.range([5, 600], {value: 125, step: 1, label: "Put premium (USD per ETH)"}),
  contracts: Inputs.range([1, 20], {value: 1, step: 1, label: "Contracts (1 contract = 1 ETH)"}),
  spanPct: Inputs.range([10, 60], {value: 30, step: 5, label: "Price range (+/- %)"})
}));
```

```js
const strike = Number(params.strike);
const callPremium = Number(params.callPremium);
const putPremium = Number(params.putPremium);
const contracts = Number(params.contracts);
const spanPct = Number(params.spanPct);

const minPrice = Math.max(0, Math.floor(strike * (1 - spanPct / 100)));
const maxPrice = Math.ceil(strike * (1 + spanPct / 100));
const prices = d3.range(minPrice, maxPrice + 1, 10);

const shortCall = prices.map((s) => ({
  stock: s,
  payout: (callPremium - Math.max(s - strike, 0)) * contracts
}));

const shortPut = prices.map((s) => ({
  stock: s,
  payout: (putPremium - Math.max(strike - s, 0)) * contracts
}));

const breakevenCall = strike + callPremium;
const breakevenPut = Math.max(0, strike - putPremium);
```

<div class="grid grid-cols-2">
  <div class="card">
    <h2>Break-even (Short)</h2>
    <p><strong>Short Call:</strong> ${breakevenCall.toFixed(2)}</p>
    <p><strong>Short Put:</strong> ${breakevenPut.toFixed(2)}</p>
  </div>
  <div class="card">
    <h2>Current Inputs</h2>
    <p><strong>Strike:</strong> ${strike.toFixed(0)}</p>
    <p><strong>Call premium:</strong> ${callPremium.toFixed(0)}</p>
    <p><strong>Put premium:</strong> ${putPremium.toFixed(0)}</p>
    <p><strong>Contracts:</strong> ${contracts.toFixed(0)}</p>
  </div>
</div>

<div class="grid grid-cols-2">
  <div class="card">
    ${resize((width) =>
      Plot.plot({
        title: "Short Call Payout (ETH)",
        width,
        height: 340,
        x: {label: "ETH price at expiration (USD)"},
        y: {label: "P/L (USD)", grid: true},
        marks: [
          Plot.ruleY([0]),
          Plot.ruleX([strike], {stroke: "#777", strokeDasharray: "4,4"}),
          Plot.ruleX([breakevenCall], {stroke: "#d62728", strokeDasharray: "4,4"}),
          Plot.line(shortCall, {x: "stock", y: "payout", stroke: "#d62728", tip: true})
        ]
      })
    )}
  </div>
  <div class="card">
    ${resize((width) =>
      Plot.plot({
        title: "Short Put Payout (ETH)",
        width,
        height: 340,
        x: {label: "ETH price at expiration (USD)"},
        y: {label: "P/L (USD)", grid: true},
        marks: [
          Plot.ruleY([0]),
          Plot.ruleX([strike], {stroke: "#777", strokeDasharray: "4,4"}),
          Plot.ruleX([breakevenPut], {stroke: "#1f77b4", strokeDasharray: "4,4"}),
          Plot.line(shortPut, {x: "stock", y: "payout", stroke: "#1f77b4", tip: true})
        ]
      })
    )}
  </div>
</div>
