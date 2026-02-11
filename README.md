# Wheel Calc

Options wheel strategy simulator for ETH with Monte Carlo analysis.

## Quick Start

```bash
npm install
npm run dev       # localhost:3000
```

## Pages

| Page | What it does |
|------|-------------|
| **Wheel Simulator** (`/simulator`) | Configure market + strategy params, run Monte Carlo, inspect individual runs with price charts and trade logs |
| **Payout Charts** (`/`) | Interactive short call / short put payout diagrams |
| **Deribit Data** (`/volatility`) | Live index prices and historical volatility from Deribit API |

## Documentation

See [`docs/README.md`](docs/README.md) for architecture, strategy, and simulation docs.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build to `dist/` |
| `npm run clean` | Clear Observable cache |
