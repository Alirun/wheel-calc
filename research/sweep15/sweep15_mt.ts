import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { writeFileSync, unlinkSync } from "node:fs";
import { buildSync } from "esbuild";
import os from "node:os";
import path from "node:path";
import { defaultMarketValues, defaultStrategyValues } from "../../src/components/presets.ts";
import type { PriceModel } from "../../src/components/price-gen.ts";

// ─── CLI ───

const threadArg = process.argv.find(a => a.startsWith("--threads="));
const numThreads = threadArg
  ? parseInt(threadArg.split("=")[1])
  : Math.max(1, os.cpus().length - 1);

// ─── Compile worker to JS (tsx doesn't propagate hooks to worker_threads) ───

const WORKER_TS = fileURLToPath(new URL("./sweep15_worker.ts", import.meta.url));
const WORKER_JS = path.join(path.dirname(WORKER_TS), "sweep15_worker.compiled.mjs");

const compiled = buildSync({
  entryPoints: [WORKER_TS],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: WORKER_JS,
  sourcemap: false,
  external: [],
});

if (compiled.errors.length > 0) {
  console.error("esbuild errors:", compiled.errors);
  process.exit(1);
}

process.on("exit", () => { try { unlinkSync(WORKER_JS); } catch {} });

// ─── Worker Pool ───

class WorkerPool {
  private workers: Worker[] = [];
  private pending = new Map<Worker, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private queue: Array<{ task: any; resolve: (v: any) => void; reject: (e: Error) => void }> = [];

  constructor(workerPath: string, size: number) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(workerPath);
      this.workers.push(w);

      w.on("message", (msg: { result?: any; error?: string }) => {
        const p = this.pending.get(w);
        if (!p) return;
        this.pending.delete(w);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.result);
        this.dispatch(w);
      });

      w.on("error", (err) => {
        const p = this.pending.get(w);
        if (p) { this.pending.delete(w); p.reject(err); }
      });

      w.on("exit", (code) => {
        if (code !== 0) {
          const p = this.pending.get(w);
          if (p) { this.pending.delete(w); p.reject(new Error(`Worker exited with code ${code}`)); }
        }
      });
    }
  }

  private dispatch(worker: Worker) {
    if (this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.pending.set(worker, { resolve: item.resolve, reject: item.reject });
      worker.postMessage(item.task);
    }
  }

  submit(task: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const idle = this.workers.find(w => !this.pending.has(w));
      if (idle) {
        this.pending.set(idle, { resolve, reject });
        idle.postMessage(task);
      } else {
        this.queue.push({ task, resolve, reject });
      }
    });
  }

  async close() {
    await Promise.all(this.workers.map(w => w.terminate()));
  }
}

// ─── Types ───

interface StrategyProfile {
  name: string; delta: number; cycle: number; lookback: number;
  adaptiveCalls: boolean;
  putRollEnabled: boolean; putRollInitialDTE: number; putRollWhenBelow: number;
}

interface MCResult {
  avgAPR: number; avgSharpe: number; avgSortino: number; avgMaxDD: number;
  winRate: number; avgBenchAPR: number; avgSkipped: number; avgFullCycles: number;
  avgStopLosses: number; avgPutRolls: number; count: number;
}

interface SweepResult {
  strategy: string; vol: number; drift: number; vrp: number;
  model: PriceModel; days: number; horizon: string; config: string;
  sharpe: number; sortino: number; meanAPR: number; maxDD: number;
  winRate: number; benchAPR: number; alpha: number;
  avgSkipped: number; avgFullCycles: number; skipPct: number;
  avgStopLosses: number; avgPutRolls: number; execCycles: number;
}

interface ComboMeta {
  strategy: string; vol: number; drift: number; vrp: number;
  model: PriceModel; days: number; horizon: string; config: string;
}

// ─── Helpers ───

function fmt(n: number, decimals = 2): string { return n.toFixed(decimals); }
function fmtSign(n: number, decimals = 2): string { return (n > 0 ? "+" : "") + n.toFixed(decimals); }
function fmtDrift(d: number): string { return (d >= 0 ? "+" : "") + d; }

function avgField(rows: SweepResult[], field: keyof SweepResult): number {
  const vals = rows.map(r => r[field] as number).filter(v => !isNaN(v));
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function buildConfigs(
  strat: StrategyProfile, vol: number, drift: number, model: PriceModel,
  vrpPremiumPct: number, days: number, rfEnabled: boolean,
  baseMarket: ReturnType<typeof defaultMarketValues>,
) {
  const annualVolDec = vol / 100;
  const base = defaultStrategyValues();

  const marketConfig: any = {
    ...baseMarket,
    annualVol: annualVolDec,
    annualDrift: drift / 100,
    model,
    days,
    numSimulations: 1000,
    jump: { lambda: baseMarket.lambda, muJ: baseMarket.muJ, sigmaJ: baseMarket.sigmaJ },
    ivParams: {
      meanReversion: baseMarket.ivMeanReversion,
      volOfVol: baseMarket.ivVolOfVol,
      vrpOffset: annualVolDec * vrpPremiumPct / 100,
    },
  };

  const impliedVol = annualVolDec * (1 + vrpPremiumPct / 100);
  const skipBelowRatio = strat.name.includes("Conservative") ? 1.0 : 1.2;

  const strategyConfig: any = {
    targetDelta: strat.delta,
    cycleLengthDays: strat.cycle,
    impliedVol,
    riskFreeRate: baseMarket.riskFreeRate / 100,
    contracts: base.contracts,
    bidAskSpreadPct: baseMarket.bidAskSpreadPct / 100,
    feePerTrade: baseMarket.feePerTrade,

    ...(strat.adaptiveCalls ? {
      adaptiveCalls: {
        minDelta: base.minCallDelta, maxDelta: base.maxCallDelta,
        skipThresholdPct: 0, minStrikeAtCost: base.minStrikeAtCost,
      },
    } : {}),

    ivRvSpread: {
      lookbackDays: strat.lookback,
      minMultiplier: 0.8,
      maxMultiplier: 1.3,
      ...(rfEnabled ? { skipBelowRatio, skipSide: "put" as const } : {}),
    },

    ...(strat.putRollEnabled ? {
      rollPut: {
        initialDTE: strat.putRollInitialDTE,
        rollWhenDTEBelow: strat.putRollWhenBelow,
        requireNetCredit: true,
      },
    } : {}),
  };

  return { marketConfig, strategyConfig };
}

async function runBatch(
  pool: WorkerPool,
  tasks: Array<{ type: string; params: any }>,
  label: string,
): Promise<MCResult[]> {
  let done = 0;
  const total = tasks.length;
  const tick = Math.max(1, Math.floor(total / 40));
  const promises = tasks.map(task =>
    pool.submit(task).then((result: MCResult) => {
      done++;
      if (done % tick === 0 || done === total) {
        process.stdout.write(`  ${label}: ${done}/${total} (${(done / total * 100).toFixed(0)}%)\r`);
      }
      return result;
    }),
  );
  const results = await Promise.all(promises);
  console.log();
  return results;
}

// ─── Main ───

async function main() {
  console.log("=== Experiment 15: Multi-Year Vol Sensitivity (multi-threaded) ===");
  console.log(`Threads: ${numThreads} | CPUs: ${os.cpus().length}`);
  console.log("Goal: Test whether Active's multi-year viability (confirmed at 60% vol in Exp 12)");
  console.log("      extends to 80%+ vol. Does MaxDD saturate? Does drift immunity hold?\n");

  const pool = new WorkerPool(WORKER_JS, numThreads);
  const baseMarket = defaultMarketValues();
  const numSims = 1000;
  const t0 = Date.now();

  const strategies: StrategyProfile[] = [
    { name: "Conservative (δ0.10/30d)", delta: 0.10, cycle: 30, lookback: 45,
      adaptiveCalls: true, putRollEnabled: true, putRollInitialDTE: 30, putRollWhenBelow: 14 },
    { name: "Moderate (δ0.20/14d)", delta: 0.20, cycle: 14, lookback: 20,
      adaptiveCalls: false, putRollEnabled: true, putRollInitialDTE: 14, putRollWhenBelow: 7 },
    { name: "Active (δ0.20/3d)", delta: 0.20, cycle: 3, lookback: 20,
      adaptiveCalls: false, putRollEnabled: false, putRollInitialDTE: 0, putRollWhenBelow: 0 },
  ];

  const horizons = [
    { days: 365, label: "1yr" },
    { days: 730, label: "2yr" },
    { days: 1825, label: "5yr" },
  ];
  const volLevels = [40, 60, 80, 100];
  const driftLevels = [0, 5, -30];
  const vrpLevels = [10, 15];
  const models: PriceModel[] = ["gbm", "jump"];

  // Build all tasks
  const tasks: { type: string; params: any }[] = [];
  const metas: ComboMeta[] = [];

  for (const hz of horizons) {
    for (const vol of volLevels) {
      for (const drift of driftLevels) {
        for (const vrp of vrpLevels) {
          for (const model of models) {
            for (const strat of strategies) {
              for (const rfEnabled of [true, false]) {
                const config = rfEnabled ? "RF ON" : "RF OFF";
                const { marketConfig, strategyConfig } = buildConfigs(
                  strat, vol, drift, model, vrp, hz.days, rfEnabled, baseMarket,
                );
                tasks.push({ type: "mc", params: { marketConfig, strategyConfig, numSims } });
                metas.push({
                  strategy: strat.name, vol, drift, vrp,
                  model, days: hz.days, horizon: hz.label, config,
                });
              }
            }
          }
        }
      }
    }
  }

  const totalCombos = tasks.length;
  console.log(`Strategies: ${strategies.map(s => s.name).join(", ")}`);
  console.log(`Horizons: ${horizons.map(h => `${h.label} (${h.days}d)`).join(", ")}`);
  console.log(`Vol levels: ${volLevels.map(v => v + "%").join(", ")}`);
  console.log(`Drift levels: ${driftLevels.map(d => fmtDrift(d) + "%").join(", ")}`);
  console.log(`VRP: ${vrpLevels.map(v => v + "%").join(", ")}`);
  console.log(`Models: ${models.join(", ")}`);
  console.log(`Configs: RF ON (optimal) + RF OFF (baseline)`);
  console.log(`Total: ${totalCombos} combos × ${numSims} paths = ${(totalCombos * numSims).toLocaleString()} simulation paths`);
  console.log(`Lookbacks: Conservative=45d, Moderate/Active=20d`);
  console.log(`skipSide: "put" | skipBelowRatio: Conservative=1.0, Moderate/Active=1.2\n`);

  // Run all combos
  const results = await runBatch(pool, tasks, "Sweep");

  // Build result rows
  const allResults: SweepResult[] = [];
  for (let i = 0; i < results.length; i++) {
    const m = metas[i];
    const r = results[i];
    const totalCycles = r.avgSkipped + r.avgFullCycles;
    const skipPct = totalCycles > 0 ? (r.avgSkipped / totalCycles) * 100 : 0;
    allResults.push({
      ...m,
      sharpe: r.avgSharpe,
      sortino: r.avgSortino,
      meanAPR: r.avgAPR,
      maxDD: r.avgMaxDD,
      winRate: r.winRate,
      benchAPR: r.avgBenchAPR,
      alpha: r.avgAPR - r.avgBenchAPR,
      avgSkipped: r.avgSkipped,
      avgFullCycles: r.avgFullCycles,
      skipPct,
      avgStopLosses: r.avgStopLosses,
      avgPutRolls: r.avgPutRolls,
      execCycles: r.avgFullCycles,
    });
  }

  console.log(`Sweep complete: ${allResults.length} result rows.\n`);

  const rfOn = allResults.filter(r => r.config === "RF ON");
  const rfOff = allResults.filter(r => r.config === "RF OFF");

  // =======================================================
  // SECTION 1: Full Results Table (RF ON)
  // =======================================================
  console.log("=".repeat(140));
  console.log("=== SECTION 1: FULL RESULTS TABLE (RF ON — Optimal Configs) ===");
  console.log("=".repeat(140));

  for (const strat of strategies) {
    console.log(`\n  ${strat.name}:`);
    const rows: any[] = [];
    for (const hz of horizons) {
      for (const vol of volLevels) {
        for (const drift of driftLevels) {
          for (const vrp of vrpLevels) {
            for (const model of models) {
              const r = rfOn.find(x =>
                x.strategy === strat.name && x.days === hz.days && x.vol === vol
                && x.drift === drift && x.vrp === vrp && x.model === model
              );
              if (r) {
                rows.push({
                  "Hz": hz.label, "Vol%": vol, "Drift%": fmtDrift(drift),
                  "VRP%": vrp, "Model": model,
                  "Sharpe": fmt(r.sharpe, 3), "APR%": fmt(r.meanAPR),
                  "MaxDD%": fmt(r.maxDD * 100, 1), "Win%": fmt(r.winRate * 100, 1),
                  "Alpha%": fmtSign(r.alpha), "Skip%": fmt(r.skipPct, 1),
                  "Cycles": fmt(r.execCycles, 1),
                });
              }
            }
          }
        }
      }
    }
    console.table(rows);
  }

  // =======================================================
  // SECTION 2: Vol × Horizon Interaction
  // =======================================================
  console.log("\n" + "=".repeat(140));
  console.log("=== SECTION 2: VOL × HORIZON INTERACTION ===");
  console.log("=".repeat(140));
  console.log("Avg Sharpe at each vol × horizon (across all drift × VRP × model). Core question:\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const vol of volLevels) {
      const row: any = { "Vol%": vol };
      for (const hz of horizons) {
        const subset = rfOn.filter(x =>
          x.strategy === strat.name && x.vol === vol && x.days === hz.days
        );
        const avgSharpe = avgField(subset, "sharpe");
        const posCnt = subset.filter(r => r.sharpe > 0).length;
        row[`${hz.label} Sharpe`] = fmt(avgSharpe, 3);
        row[`${hz.label} +`] = `${posCnt}/${subset.length}`;
      }
      // 1yr→5yr decay
      const s1 = avgField(rfOn.filter(x => x.strategy === strat.name && x.vol === vol && x.days === 365), "sharpe");
      const s5 = avgField(rfOn.filter(x => x.strategy === strat.name && x.vol === vol && x.days === 1825), "sharpe");
      const decay = s1 !== 0 ? ((s5 - s1) / Math.abs(s1)) * 100 : 0;
      row["Decay%"] = fmtSign(decay, 0);
      rows.push(row);
    }
    console.table(rows);

    // Summary
    for (const vol of volLevels) {
      const yr5 = rfOn.filter(x => x.strategy === strat.name && x.vol === vol && x.days === 1825);
      const yr5Sharpe = avgField(yr5, "sharpe");
      const yr5Pos = yr5.filter(r => r.sharpe > 0).length;
      const symbol = yr5Sharpe > 0.1 ? "✓" : yr5Sharpe > 0 ? "~" : "✗";
      console.log(`  ${vol}% vol at 5yr: ${symbol} Sharpe=${fmt(yr5Sharpe, 3)}, ${yr5Pos}/${yr5.length} positive`);
    }
    console.log();
  }

  // =======================================================
  // SECTION 3: MaxDD Evolution by Vol
  // =======================================================
  console.log("=".repeat(140));
  console.log("=== SECTION 3: MaxDD EVOLUTION BY VOL ===");
  console.log("=".repeat(140));
  console.log("Does MaxDD saturate at high vol over multi-year horizons?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const vol of volLevels) {
      const row: any = { "Vol%": vol };
      for (const hz of horizons) {
        const subset = rfOn.filter(x =>
          x.strategy === strat.name && x.vol === vol && x.days === hz.days
        );
        row[`${hz.label} MaxDD%`] = fmt(avgField(subset, "maxDD") * 100, 1);
      }
      // Growth ratio 5yr/1yr
      const dd1 = avgField(rfOn.filter(x => x.strategy === strat.name && x.vol === vol && x.days === 365), "maxDD");
      const dd5 = avgField(rfOn.filter(x => x.strategy === strat.name && x.vol === vol && x.days === 1825), "maxDD");
      const ratio = dd1 > 0 ? dd5 / dd1 : 0;
      row["5yr/1yr"] = fmt(ratio, 2) + "×";
      rows.push(row);
    }
    console.table(rows);

    // Growth trend
    const ratios = volLevels.map(vol => {
      const dd1 = avgField(rfOn.filter(x => x.strategy === strat.name && x.vol === vol && x.days === 365), "maxDD");
      const dd5 = avgField(rfOn.filter(x => x.strategy === strat.name && x.vol === vol && x.days === 1825), "maxDD");
      return dd1 > 0 ? dd5 / dd1 : 0;
    });
    const maxRatio = Math.max(...ratios);
    const minRatio = Math.min(...ratios.filter(r => r > 0));
    if (maxRatio < 1.5) {
      console.log(`  → MaxDD growth SATURATING across all vol levels (max ratio ${fmt(maxRatio, 2)}×)`);
    } else if (maxRatio < 2.5) {
      console.log(`  → MaxDD growth MODERATE (ratio range ${fmt(minRatio, 2)}×–${fmt(maxRatio, 2)}×)`);
    } else {
      console.log(`  → MaxDD growth ACCELERATING at high vol (ratio up to ${fmt(maxRatio, 2)}×)`);
    }
    console.log();
  }

  // =======================================================
  // SECTION 4: Active Vol Ceiling at Multi-Year
  // =======================================================
  console.log("=".repeat(140));
  console.log("=== SECTION 4: ACTIVE VOL CEILING AT MULTI-YEAR ===");
  console.log("=".repeat(140));
  console.log("At what vol does Active's Sharpe cross zero at each horizon?\n");

  {
    const strat = strategies[2]; // Active
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const hz of horizons) {
      const row: any = { "Horizon": hz.label };
      for (const vol of volLevels) {
        const subset = rfOn.filter(x =>
          x.strategy === strat.name && x.vol === vol && x.days === hz.days
        );
        const s = avgField(subset, "sharpe");
        const pos = subset.filter(r => r.sharpe > 0).length;
        row[`${vol}% Sharpe`] = fmt(s, 3);
        row[`${vol}% +`] = `${pos}/${subset.length}`;
      }
      rows.push(row);
    }
    console.table(rows);

    // Determine effective ceiling at each horizon
    for (const hz of horizons) {
      let ceiling = "none";
      for (const vol of volLevels) {
        const subset = rfOn.filter(x =>
          x.strategy === strat.name && x.vol === vol && x.days === hz.days
        );
        const s = avgField(subset, "sharpe");
        if (s <= 0) {
          ceiling = `<${vol}%`;
          break;
        }
      }
      if (ceiling === "none") {
        console.log(`  ${hz.label}: Active Sharpe positive at all tested vol levels (≤100%)`);
      } else {
        console.log(`  ${hz.label}: Active vol ceiling at ${ceiling}`);
      }
    }
    console.log();

    // Compare all strategies
    console.log("  --- All Strategies: 5yr Sharpe by Vol ---");
    const cmpRows: any[] = [];
    for (const vol of volLevels) {
      const row: any = { "Vol%": vol };
      for (const s of strategies) {
        const subset = rfOn.filter(x => x.strategy === s.name && x.vol === vol && x.days === 1825);
        const sharpe = avgField(subset, "sharpe");
        const pos = subset.filter(r => r.sharpe > 0).length;
        row[s.name.split(" ")[0]] = `${fmt(sharpe, 3)} (${pos}/${subset.length})`;
      }
      cmpRows.push(row);
    }
    console.table(cmpRows);
    console.log();
  }

  // =======================================================
  // SECTION 5: Drift Immunity by Vol
  // =======================================================
  console.log("=".repeat(140));
  console.log("=== SECTION 5: DRIFT IMMUNITY BY VOL ===");
  console.log("=".repeat(140));
  console.log("Active at −30% drift: does drift immunity hold at high vol over multi-year?\n");

  {
    const strat = strategies[2]; // Active
    console.log(`--- ${strat.name} at −30% drift ---`);
    const rows: any[] = [];

    for (const vol of volLevels) {
      for (const hz of horizons) {
        const subset = rfOn.filter(x =>
          x.strategy === strat.name && x.vol === vol && x.drift === -30 && x.days === hz.days
        );
        const s = avgField(subset, "sharpe");
        const apr = avgField(subset, "meanAPR");
        const dd = avgField(subset, "maxDD") * 100;
        const win = avgField(subset, "winRate") * 100;
        const alpha = avgField(subset, "alpha");
        const pos = subset.filter(r => r.sharpe > 0).length;

        rows.push({
          "Vol%": vol, "Horizon": hz.label,
          "Sharpe": fmt(s, 3), "APR%": fmt(apr),
          "MaxDD%": fmt(dd, 1), "Win%": fmt(win, 1),
          "Alpha%": fmtSign(alpha), "Positive": `${pos}/${subset.length}`,
        });
      }
    }
    console.table(rows);

    // Summary verdict
    for (const vol of volLevels) {
      const bear5 = rfOn.filter(x =>
        x.strategy === strat.name && x.vol === vol && x.drift === -30 && x.days === 1825
      );
      const s = avgField(bear5, "sharpe");
      const pos = bear5.filter(r => r.sharpe > 0).length;
      if (s > 0) {
        console.log(`  ${vol}% vol: ✓ Drift immunity SURVIVES 5yr bear (Sharpe=${fmt(s, 3)}, ${pos}/${bear5.length})`);
      } else {
        console.log(`  ${vol}% vol: ✗ Drift immunity BREAKS at 5yr (Sharpe=${fmt(s, 3)}, ${pos}/${bear5.length})`);
      }
    }

    // Also check all strategies at −30% drift
    console.log("\n  --- All Strategies at −30% drift / 5yr ---");
    const cmpRows: any[] = [];
    for (const vol of volLevels) {
      const row: any = { "Vol%": vol };
      for (const s of strategies) {
        const subset = rfOn.filter(x =>
          x.strategy === s.name && x.vol === vol && x.drift === -30 && x.days === 1825
        );
        const sharpe = avgField(subset, "sharpe");
        row[s.name.split(" ")[0]] = fmt(sharpe, 3);
      }
      cmpRows.push(row);
    }
    console.table(cmpRows);
    console.log();
  }

  // =======================================================
  // SECTION 6: Regime Filter Durability
  // =======================================================
  console.log("=".repeat(140));
  console.log("=== SECTION 6: REGIME FILTER DURABILITY ===");
  console.log("=".repeat(140));
  console.log("RF ON vs OFF: win rate and ΔSharpe at each vol × horizon.\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const vol of volLevels) {
      for (const hz of horizons) {
        const onSubset = rfOn.filter(x =>
          x.strategy === strat.name && x.vol === vol && x.days === hz.days
        );
        const offSubset = rfOff.filter(x =>
          x.strategy === strat.name && x.vol === vol && x.days === hz.days
        );
        const onSharpe = avgField(onSubset, "sharpe");
        const offSharpe = avgField(offSubset, "sharpe");
        const delta = onSharpe - offSharpe;

        let wins = 0;
        for (const r of onSubset) {
          const matchOff = offSubset.find(x =>
            x.drift === r.drift && x.vrp === r.vrp && x.model === r.model
          );
          if (matchOff && r.sharpe > matchOff.sharpe) wins++;
        }

        rows.push({
          "Vol%": vol, "Hz": hz.label,
          "RF ON": fmt(onSharpe, 3), "RF OFF": fmt(offSharpe, 3),
          "ΔSharpe": fmtSign(delta, 4),
          "RF Wins": `${wins}/${onSubset.length}`,
        });
      }
    }
    console.table(rows);

    // Overall RF wins
    let totalWins = 0, totalPairs = 0;
    for (const r of rfOn.filter(x => x.strategy === strat.name)) {
      const matchOff = rfOff.find(x =>
        x.strategy === r.strategy && x.vol === r.vol && x.days === r.days
        && x.drift === r.drift && x.vrp === r.vrp && x.model === r.model
      );
      if (matchOff) {
        totalPairs++;
        if (r.sharpe > matchOff.sharpe) totalWins++;
      }
    }
    console.log(`  RF wins overall: ${totalWins}/${totalPairs} (${fmt(totalWins / totalPairs * 100, 1)}%)\n`);
  }

  // =======================================================
  // SECTION 7: Model Stability (GBM vs Jump)
  // =======================================================
  console.log("=".repeat(140));
  console.log("=== SECTION 7: MODEL STABILITY (GBM vs Jump) ===");
  console.log("=".repeat(140));
  console.log("Does the GBM-Jump gap widen at high vol over multi-year?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const vol of volLevels) {
      for (const hz of horizons) {
        const gbm = rfOn.filter(x =>
          x.strategy === strat.name && x.vol === vol && x.days === hz.days && x.model === "gbm"
        );
        const jump = rfOn.filter(x =>
          x.strategy === strat.name && x.vol === vol && x.days === hz.days && x.model === "jump"
        );
        const gS = avgField(gbm, "sharpe");
        const jS = avgField(jump, "sharpe");

        rows.push({
          "Vol%": vol, "Hz": hz.label,
          "GBM Sharpe": fmt(gS, 3), "Jump Sharpe": fmt(jS, 3),
          "Gap": fmtSign(gS - jS, 3),
        });
      }
    }
    console.table(rows);

    // Gap trend
    for (const vol of volLevels) {
      const gbm1 = rfOn.filter(x => x.strategy === strat.name && x.vol === vol && x.days === 365 && x.model === "gbm");
      const jump1 = rfOn.filter(x => x.strategy === strat.name && x.vol === vol && x.days === 365 && x.model === "jump");
      const gbm5 = rfOn.filter(x => x.strategy === strat.name && x.vol === vol && x.days === 1825 && x.model === "gbm");
      const jump5 = rfOn.filter(x => x.strategy === strat.name && x.vol === vol && x.days === 1825 && x.model === "jump");
      const gap1 = avgField(gbm1, "sharpe") - avgField(jump1, "sharpe");
      const gap5 = avgField(gbm5, "sharpe") - avgField(jump5, "sharpe");
      const trend = Math.abs(gap5) > Math.abs(gap1) * 1.5 ? "WIDENS" : "STABLE";
      console.log(`  ${vol}% vol: gap 1yr=${fmtSign(gap1, 3)} → 5yr=${fmtSign(gap5, 3)} → ${trend}`);
    }
    console.log();
  }

  // =======================================================
  // SECTION 8: VRP Floor by Vol
  // =======================================================
  console.log("=".repeat(140));
  console.log("=== SECTION 8: VRP FLOOR BY VOL ===");
  console.log("=".repeat(140));
  console.log("Does VRP=10% floor hold at high vol × 5yr?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const vol of volLevels) {
      for (const vrp of vrpLevels) {
        const yr1 = rfOn.filter(x =>
          x.strategy === strat.name && x.vol === vol && x.vrp === vrp && x.days === 365
        );
        const yr5 = rfOn.filter(x =>
          x.strategy === strat.name && x.vol === vol && x.vrp === vrp && x.days === 1825
        );
        const s1 = avgField(yr1, "sharpe");
        const s5 = avgField(yr5, "sharpe");
        const pos5 = yr5.filter(r => r.sharpe > 0).length;

        rows.push({
          "Vol%": vol, "VRP%": vrp,
          "1yr Sharpe": fmt(s1, 3), "5yr Sharpe": fmt(s5, 3),
          "5yr Positive": `${pos5}/${yr5.length}`,
        });
      }
    }
    console.table(rows);

    // VRP=10% at 5yr verdict per vol
    for (const vol of volLevels) {
      const subset = rfOn.filter(x =>
        x.strategy === strat.name && x.vol === vol && x.vrp === 10 && x.days === 1825
      );
      const s = avgField(subset, "sharpe");
      const pos = subset.filter(r => r.sharpe > 0).length;
      const symbol = pos === subset.length ? "✓" : s > 0 ? "~" : "✗";
      console.log(`  ${vol}% vol, VRP=10%, 5yr: ${symbol} Sharpe=${fmt(s, 3)}, ${pos}/${subset.length}`);
    }
    console.log();
  }

  // =======================================================
  // SECTION 9: Recommendations
  // =======================================================
  console.log("=".repeat(140));
  console.log("=== SECTION 9: RECOMMENDATIONS ===");
  console.log("=".repeat(140) + "\n");

  // --- Strategy Verdicts ---
  console.log("--- STRATEGY × VOL × HORIZON VERDICT ---\n");

  for (const strat of strategies) {
    console.log(`  ${strat.name}:`);

    for (const vol of volLevels) {
      for (const hz of horizons) {
        const subset = rfOn.filter(x =>
          x.strategy === strat.name && x.vol === vol && x.days === hz.days
        );
        const s = avgField(subset, "sharpe");
        const pos = subset.filter(r => r.sharpe > 0).length;
        const dd = avgField(subset, "maxDD") * 100;
        const apr = avgField(subset, "meanAPR");

        const symbol = pos === subset.length ? "✓" : s > 0 ? "~" : "✗";
        console.log(`    ${vol}%/${hz.label}: ${symbol} Sharpe=${fmt(s, 3)}, APR=${fmt(apr)}%, MaxDD=${fmt(dd, 1)}%, ${pos}/${subset.length}`);
      }
    }
    console.log();
  }

  // --- Active Multi-Year Vol Ceiling ---
  console.log("--- ACTIVE MULTI-YEAR VOL CEILING ---\n");

  for (const hz of horizons) {
    const row: string[] = [];
    for (const vol of volLevels) {
      const subset = rfOn.filter(x =>
        x.strategy === strategies[2].name && x.vol === vol && x.days === hz.days
      );
      const s = avgField(subset, "sharpe");
      const pos = subset.filter(r => r.sharpe > 0).length;
      row.push(`${vol}%: ${fmt(s, 3)} (${pos}/${subset.length})`);
    }
    console.log(`  ${hz.label}: ${row.join(" | ")}`);
  }
  console.log();

  // --- RF Universality ---
  let rfWins = 0, rfTotal = 0;
  for (const r of rfOn) {
    const matchOff = rfOff.find(x =>
      x.strategy === r.strategy && x.vol === r.vol && x.days === r.days
      && x.drift === r.drift && x.vrp === r.vrp && x.model === r.model
    );
    if (matchOff) {
      rfTotal++;
      if (r.sharpe > matchOff.sharpe) rfWins++;
    }
  }
  console.log(`--- RF UNIVERSALITY ---`);
  console.log(`  RF wins: ${rfWins}/${rfTotal} (${fmt(rfWins / rfTotal * 100, 1)}%)`);
  if (rfWins === rfTotal) {
    console.log(`  → RF is UNIVERSALLY BENEFICIAL across all vol × horizon × drift × VRP × model combos.\n`);
  } else if (rfWins > rfTotal * 0.95) {
    console.log(`  → RF is NEARLY UNIVERSAL (>${fmt(rfWins / rfTotal * 100, 0)}%).\n`);
  } else {
    console.log(`  → RF advantage varies by condition.\n`);
  }

  // --- Exp 12 Comparison ---
  console.log("--- EXP 12 COMPARISON (60% vol baseline) ---\n");
  console.log("  Exp 12 used 60% vol only. Validate consistency:\n");

  for (const strat of strategies) {
    const yr1 = rfOn.filter(x => x.strategy === strat.name && x.vol === 60 && x.days === 365);
    const yr5 = rfOn.filter(x => x.strategy === strat.name && x.vol === 60 && x.days === 1825);
    const s1 = avgField(yr1, "sharpe");
    const s5 = avgField(yr5, "sharpe");
    const dd5 = avgField(yr5, "maxDD") * 100;
    const pos5 = yr5.filter(r => r.sharpe > 0).length;
    console.log(`  ${strat.name}: 1yr=${fmt(s1, 3)} → 5yr=${fmt(s5, 3)}, MaxDD=${fmt(dd5, 1)}%, ${pos5}/${yr5.length} positive`);
  }

  // --- Overall Summary ---
  console.log("\n--- OVERALL FINDINGS ---\n");

  const allPositive = rfOn.filter(r => r.sharpe > 0).length;
  console.log(`  Total positive Sharpe combos (RF ON): ${allPositive}/${rfOn.length} (${fmt(allPositive / rfOn.length * 100, 1)}%)`);

  for (const strat of strategies) {
    const pos = rfOn.filter(r => r.strategy === strat.name && r.sharpe > 0).length;
    const total = rfOn.filter(r => r.strategy === strat.name).length;
    console.log(`    ${strat.name}: ${pos}/${total} (${fmt(pos / total * 100, 1)}%)`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n\nCompleted in ${elapsed}s using ${numThreads} threads.`);
  console.log("\n=== END OF EXPERIMENT 15 ===\n");

  await pool.close();
}

main().catch(console.error);
