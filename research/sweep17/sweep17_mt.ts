import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { unlinkSync } from "node:fs";
import { buildSync } from "esbuild";
import os from "node:os";
import path from "node:path";
import { defaultMarketValues, defaultStrategyValues } from "../../src/components/presets.ts";
import type { IVParams, IVJumpParams } from "../../src/components/price-gen.ts";

// ─── CLI ───

const threadArg = process.argv.find(a => a.startsWith("--threads="));
const numThreads = threadArg
  ? parseInt(threadArg.split("=")[1])
  : Math.max(1, os.cpus().length - 1);

// ─── Compile worker ───

const WORKER_TS = fileURLToPath(new URL("./sweep17_worker.ts", import.meta.url));
const WORKER_JS = path.join(path.dirname(WORKER_TS), "sweep17_worker.compiled.mjs");

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

interface CalibResult {
  deltaIVStd: number; deltaIVKurt: number; sqACF1: number;
  ratioMean: number; ratioStd: number; skipRate: number;
}

interface CalibRow {
  label: string; volOfVol: number;
  ivJumps: IVJumpParams | undefined;
  deltaIVStd: number; deltaIVKurt: number; sqACF1: number;
  ratioMean: number; ratioStd: number; skipRate: number;
  score: number;
}

interface MCResult {
  avgAPR: number; avgSharpe: number; avgSortino: number; avgMaxDD: number;
  winRate: number; avgBenchAPR: number; avgSkipped: number; avgFullCycles: number;
  avgStopLosses: number; avgPutRolls: number; count: number;
}

interface StrategyProfile {
  name: string; delta: number; cycle: number; lookback: number;
  adaptiveCalls: boolean;
  putRollEnabled: boolean; putRollInitialDTE: number; putRollWhenBelow: number;
}

interface SweepResult {
  strategy: string; vol: number; model: string; config: string;
  sharpe: number; sortino: number; meanAPR: number; maxDD: number;
  winRate: number; benchAPR: number; alpha: number;
  avgSkipped: number; avgFullCycles: number; skipPct: number;
  execCycles: number;
}

// ─── Helpers ───

function fmt(n: number, decimals = 2): string { return n.toFixed(decimals); }
function fmtSign(n: number, decimals = 2): string { return (n > 0 ? "+" : "") + n.toFixed(decimals); }

function avgField(rows: SweepResult[], field: keyof SweepResult): number {
  const vals = rows.map(r => r[field] as number).filter(v => !isNaN(v));
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

async function runBatch<T>(
  pool: WorkerPool,
  tasks: Array<{ type: string; params: any }>,
  label: string,
): Promise<T[]> {
  let done = 0;
  const total = tasks.length;
  const tick = Math.max(1, Math.floor(total / 40));
  const promises = tasks.map(task =>
    pool.submit(task).then((result: T) => {
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

// ─── Strategy configs builder ───

const strategies: StrategyProfile[] = [
  { name: "Conservative (δ0.10/30d)", delta: 0.10, cycle: 30, lookback: 45,
    adaptiveCalls: true, putRollEnabled: true, putRollInitialDTE: 30, putRollWhenBelow: 14 },
  { name: "Moderate (δ0.20/14d)", delta: 0.20, cycle: 14, lookback: 20,
    adaptiveCalls: false, putRollEnabled: true, putRollInitialDTE: 14, putRollWhenBelow: 7 },
  { name: "Active (δ0.20/3d)", delta: 0.20, cycle: 3, lookback: 20,
    adaptiveCalls: false, putRollEnabled: false, putRollInitialDTE: 0, putRollWhenBelow: 0 },
];

function buildMCConfigs(
  strat: StrategyProfile, vol: number, vrpPct: number,
  rfEnabled: boolean, ivJumps: IVJumpParams | undefined,
  volOfVol: number,
) {
  const baseMarket = defaultMarketValues();
  const base = defaultStrategyValues();
  const annualVolDec = vol / 100;

  const ivParams: IVParams = {
    meanReversion: 5.5,
    volOfVol,
    vrpOffset: annualVolDec * vrpPct / 100,
  };
  if (ivJumps) ivParams.ivJumps = ivJumps;

  const marketConfig: any = {
    ...baseMarket,
    annualVol: annualVolDec,
    annualDrift: 0.05,
    model: "gbm",
    days: 365,
    numSimulations: 1000,
    jump: { lambda: baseMarket.lambda, muJ: baseMarket.muJ, sigmaJ: baseMarket.sigmaJ },
    ivParams,
  };

  const impliedVol = annualVolDec * (1 + vrpPct / 100);
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

function buildMCConfigsWithThreshold(
  strat: StrategyProfile, vol: number, vrpPct: number,
  threshold: number, ivJumps: IVJumpParams | undefined,
  volOfVol: number,
) {
  const { marketConfig, strategyConfig } = buildMCConfigs(strat, vol, vrpPct, true, ivJumps, volOfVol);
  strategyConfig.ivRvSpread.skipBelowRatio = threshold;
  return { marketConfig, strategyConfig };
}

// ─── Real data targets (from Exp 16) ───

const REAL = {
  deltaIVStd: 3.926,
  deltaIVKurt: 27.07,
  sqACF1: 0.351,
  ratioMean: 1.171,
  ratioStd: 0.322,
  skipRate: 61.8,
};

function calibScore(r: CalibResult): number {
  const w = { std: 3, kurt: 2, sqACF: 2, skipRate: 3 };
  const errStd = Math.abs(r.deltaIVStd - REAL.deltaIVStd) / REAL.deltaIVStd;
  const errKurt = Math.abs(r.deltaIVKurt - REAL.deltaIVKurt) / REAL.deltaIVKurt;
  const errACF = Math.abs(r.sqACF1 - REAL.sqACF1) / (Math.abs(REAL.sqACF1) + 0.01);
  const errSkip = Math.abs(r.skipRate - REAL.skipRate) / REAL.skipRate;
  return (w.std * errStd + w.kurt * errKurt + w.sqACF * errACF + w.skipRate * errSkip)
    / (w.std + w.kurt + w.sqACF + w.skipRate);
}

// ─── Main ───

async function main() {
  console.log("═══ Experiment 17: OU Recalibration & Re-validation (multi-threaded) ═══");
  console.log(`Threads: ${numThreads} | CPUs: ${os.cpus().length}`);
  console.log("Goal: Recalibrate OU IV model to match real DVOL dynamics, re-validate strategy conclusions.\n");

  const pool = new WorkerPool(WORKER_JS, numThreads);
  const t0 = Date.now();
  const numSims = 1000;
  const calibDays = 1812; // Match Exp 16 aligned data length
  const calibPaths = 1000;

  // ═══════════════════════════════════════════════════════════
  // SUB-EXP A: Model Calibration Diagnostic
  // ═══════════════════════════════════════════════════════════
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  SUB-EXP A: MODEL CALIBRATION DIAGNOSTIC         ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  console.log("Real data targets (from Exp 16):");
  console.log(`  ΔIV std:      ${REAL.deltaIVStd}%p`);
  console.log(`  ΔIV kurtosis: ${REAL.deltaIVKurt}`);
  console.log(`  Sq ΔIV ACF1:  ${REAL.sqACF1}`);
  console.log(`  IV/RV mean:   ${REAL.ratioMean}`);
  console.log(`  IV/RV std:    ${REAL.ratioStd}`);
  console.log(`  Skip rate:    ${REAL.skipRate}% (at t=1.2)\n`);

  // Model variants to test
  interface CalibConfig {
    label: string;
    volOfVol: number;
    ivJumps?: IVJumpParams;
  }

  const calibConfigs: CalibConfig[] = [
    // Pure OU at various volOfVol levels
    { label: "OU ξ=0.50 (baseline)", volOfVol: 0.50 },
    { label: "OU ξ=0.75", volOfVol: 0.75 },
    { label: "OU ξ=1.00", volOfVol: 1.00 },
    { label: "OU ξ=1.50", volOfVol: 1.50 },
    { label: "OU ξ=2.00", volOfVol: 2.00 },
    { label: "OU ξ=3.00", volOfVol: 3.00 },

    // OU + Jumps: varying lambda and sigmaJ at moderate ξ
    { label: "OU+J ξ=0.50 λ=5  σJ=0.10", volOfVol: 0.50, ivJumps: { lambda: 5, muJ: 0, sigmaJ: 0.10 } },
    { label: "OU+J ξ=0.50 λ=10 σJ=0.10", volOfVol: 0.50, ivJumps: { lambda: 10, muJ: 0, sigmaJ: 0.10 } },
    { label: "OU+J ξ=0.50 λ=20 σJ=0.10", volOfVol: 0.50, ivJumps: { lambda: 20, muJ: 0, sigmaJ: 0.10 } },
    { label: "OU+J ξ=0.50 λ=10 σJ=0.05", volOfVol: 0.50, ivJumps: { lambda: 10, muJ: 0, sigmaJ: 0.05 } },
    { label: "OU+J ξ=0.50 λ=10 σJ=0.15", volOfVol: 0.50, ivJumps: { lambda: 10, muJ: 0, sigmaJ: 0.15 } },
    { label: "OU+J ξ=0.50 λ=10 σJ=0.20", volOfVol: 0.50, ivJumps: { lambda: 10, muJ: 0, sigmaJ: 0.20 } },

    // Higher ξ + moderate jumps
    { label: "OU+J ξ=0.75 λ=10 σJ=0.10", volOfVol: 0.75, ivJumps: { lambda: 10, muJ: 0, sigmaJ: 0.10 } },
    { label: "OU+J ξ=0.75 λ=15 σJ=0.10", volOfVol: 0.75, ivJumps: { lambda: 15, muJ: 0, sigmaJ: 0.10 } },
    { label: "OU+J ξ=0.75 λ=10 σJ=0.15", volOfVol: 0.75, ivJumps: { lambda: 10, muJ: 0, sigmaJ: 0.15 } },
    { label: "OU+J ξ=1.00 λ=10 σJ=0.10", volOfVol: 1.00, ivJumps: { lambda: 10, muJ: 0, sigmaJ: 0.10 } },
    { label: "OU+J ξ=1.00 λ=5  σJ=0.15", volOfVol: 1.00, ivJumps: { lambda: 5, muJ: 0, sigmaJ: 0.15 } },

    // Asymmetric jumps (positive skew like real data)
    { label: "OU+J ξ=0.50 λ=10 μJ=+0.02 σJ=0.10", volOfVol: 0.50, ivJumps: { lambda: 10, muJ: 0.02, sigmaJ: 0.10 } },
    { label: "OU+J ξ=0.75 λ=10 μJ=+0.02 σJ=0.10", volOfVol: 0.75, ivJumps: { lambda: 10, muJ: 0.02, sigmaJ: 0.10 } },

    // High-jump intensity combos
    { label: "OU+J ξ=0.50 λ=30 σJ=0.08", volOfVol: 0.50, ivJumps: { lambda: 30, muJ: 0, sigmaJ: 0.08 } },
    { label: "OU+J ξ=0.75 λ=20 σJ=0.08", volOfVol: 0.75, ivJumps: { lambda: 20, muJ: 0, sigmaJ: 0.08 } },
  ];

  const annualVol = 0.60; // Real mean DVOL ≈ 76%, but RV ≈ 69%. Use 60% as base vol (conservative).
  const vrpOffset = 0.06 * annualVol; // VRP ≈ 6% of vol → ~3.6% absolute

  const calibTasks = calibConfigs.map(c => ({
    type: "calibration",
    params: {
      ivParams: {
        meanReversion: 5.5,
        volOfVol: c.volOfVol,
        vrpOffset,
        ...(c.ivJumps ? { ivJumps: c.ivJumps } : {}),
      },
      annualVol,
      days: calibDays,
      nPaths: calibPaths,
      baseSeed: 42,
    },
  }));

  console.log(`Testing ${calibConfigs.length} model variants × ${calibPaths} paths × ${calibDays} days`);
  const calibResults = await runBatch<CalibResult>(pool, calibTasks, "Calibration");

  // Build ranked table
  const calibRows: CalibRow[] = calibConfigs.map((c, i) => ({
    label: c.label,
    volOfVol: c.volOfVol,
    ivJumps: c.ivJumps,
    ...calibResults[i],
    score: calibScore(calibResults[i]),
  }));
  calibRows.sort((a, b) => a.score - b.score);

  console.log("\nCalibration Results (ranked by weighted distance from real data):\n");
  console.log("  " + [
    "Rank", "Label".padEnd(42), "ΔIV Std", "ΔIV Kurt", "SqACF1",
    "Ratio μ", "Ratio σ", "Skip%", "Score",
  ].join(" | "));
  console.log("  " + "-".repeat(140));
  console.log("  " + [
    "REAL", "Real ETH DVOL (Exp 16)".padEnd(42),
    fmt(REAL.deltaIVStd, 3), fmt(REAL.deltaIVKurt, 2).padStart(8),
    fmt(REAL.sqACF1, 3).padStart(6), fmt(REAL.ratioMean, 3).padStart(7),
    fmt(REAL.ratioStd, 3).padStart(7), fmt(REAL.skipRate, 1).padStart(5), "0.000",
  ].join(" | "));
  console.log("  " + "-".repeat(140));

  for (let i = 0; i < calibRows.length; i++) {
    const r = calibRows[i];
    console.log("  " + [
      String(i + 1).padStart(4),
      r.label.padEnd(42),
      fmt(r.deltaIVStd, 3),
      fmt(r.deltaIVKurt, 2).padStart(8),
      fmt(r.sqACF1, 3).padStart(6),
      fmt(r.ratioMean, 3).padStart(7),
      fmt(r.ratioStd, 3).padStart(7),
      fmt(r.skipRate, 1).padStart(5),
      fmt(r.score, 3),
    ].join(" | "));
  }

  // Select best 2 models
  const best1 = calibRows[0];
  const best2 = calibRows.find(r =>
    (r.ivJumps !== undefined) !== (best1.ivJumps !== undefined)
  ) || calibRows[1];

  console.log(`\n  Best model: ${best1.label} (score ${fmt(best1.score, 3)})`);
  console.log(`  Second: ${best2.label} (score ${fmt(best2.score, 3)})\n`);

  // Also show how far baseline is
  const baseline = calibRows.find(r => r.label.includes("baseline"))!;
  console.log(`  Baseline (ξ=0.50): score=${fmt(baseline.score, 3)}, ΔIV std=${fmt(baseline.deltaIVStd, 3)}, skip=${fmt(baseline.skipRate, 1)}%`);
  console.log(`  Improvement: ${fmt((1 - best1.score / baseline.score) * 100, 1)}% reduction in calibration error\n`);

  // ═══════════════════════════════════════════════════════════
  // SUB-EXP B: Feature Stack Re-test (Exp 6 replay)
  // ═══════════════════════════════════════════════════════════
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  SUB-EXP B: FEATURE STACK RE-TEST (EXP 6 REPLAY) ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  const bestModel = best1;
  const volLevels = [40, 60, 80, 100];
  const vrpLevels = [6, 15]; // Real VRP vs original assumption

  // Feature toggles: RF, AC, CR, PR, SL
  // For simplicity we test: RF OFF, RF only, full optimal (from Exp 6), and all-on
  const featureSets: { label: string; rf: boolean; ac: boolean; pr: boolean }[] = [
    { label: "Baseline (no RF)", rf: false, ac: false, pr: false },
    { label: "RF only", rf: true, ac: false, pr: false },
    { label: "RF+AC", rf: true, ac: true, pr: false },
    { label: "RF+PR", rf: true, ac: false, pr: true },
    { label: "RF+AC+PR", rf: true, ac: true, pr: true },
  ];

  type FeatureMeta = { strategy: string; vol: number; vrp: number; features: string };
  const bTasks: Array<{ type: string; params: any }> = [];
  const bMetas: FeatureMeta[] = [];

  for (const vol of volLevels) {
    for (const vrp of vrpLevels) {
      for (const strat of strategies) {
        for (const fs of featureSets) {
          // Skip AC for Active (no adaptive calls), Skip PR for Active (no put rolling per Exp 6)
          if (strat.name.includes("Active") && fs.ac) continue;
          if (strat.name.includes("Active") && fs.pr) continue;

          const profile: StrategyProfile = {
            ...strat,
            adaptiveCalls: fs.ac && strat.adaptiveCalls,
            putRollEnabled: fs.pr && strat.putRollEnabled,
          };

          const { marketConfig, strategyConfig } = buildMCConfigs(
            profile, vol, vrp, fs.rf, bestModel.ivJumps, bestModel.volOfVol,
          );

          bTasks.push({ type: "mc", params: { marketConfig, strategyConfig, numSims } });
          bMetas.push({ strategy: strat.name, vol, vrp, features: fs.label });
        }
      }
    }
  }

  console.log(`Testing ${bTasks.length} combos (best model: ${bestModel.label})`);
  console.log(`Vol levels: ${volLevels.join(", ")}%`);
  console.log(`VRP levels: ${vrpLevels.join(", ")}%`);
  console.log(`Feature sets: ${featureSets.map(f => f.label).join(", ")}\n`);

  const bResults = await runBatch<MCResult>(pool, bTasks, "Feature Stack");

  // Build result rows
  const bRows: (FeatureMeta & { sharpe: number; apr: number; maxDD: number; winRate: number; skipPct: number; execCycles: number })[] = [];
  for (let i = 0; i < bResults.length; i++) {
    const r = bResults[i];
    const totalCycles = r.avgSkipped + r.avgFullCycles;
    bRows.push({
      ...bMetas[i],
      sharpe: r.avgSharpe,
      apr: r.avgAPR,
      maxDD: r.avgMaxDD,
      winRate: r.winRate,
      skipPct: totalCycles > 0 ? (r.avgSkipped / totalCycles) * 100 : 0,
      execCycles: r.avgFullCycles,
    });
  }

  // Print results by strategy
  for (const strat of strategies) {
    console.log(`\n  --- ${strat.name} ---`);
    const rows = bRows.filter(r => r.strategy === strat.name);

    for (const vrp of vrpLevels) {
      console.log(`\n    VRP=${vrp}%:`);
      const header: any[] = [];
      for (const vol of volLevels) {
        for (const fs of featureSets) {
          const row = rows.find(r => r.vol === vol && r.vrp === vrp && r.features === fs.label);
          if (row) {
            header.push({
              "Vol%": vol, "Features": fs.label,
              "Sharpe": fmt(row.sharpe, 3), "APR%": fmt(row.apr),
              "MaxDD%": fmt(row.maxDD * 100, 1), "Win%": fmt(row.winRate * 100, 1),
              "Skip%": fmt(row.skipPct, 1), "Cycles": fmt(row.execCycles, 1),
            });
          }
        }
      }
      console.table(header);
    }
  }

  // RF universality check
  console.log("\n  RF Universality Check:");
  let rfWins = 0;
  let rfTotal = 0;
  for (const strat of strategies) {
    for (const vol of volLevels) {
      for (const vrp of vrpLevels) {
        const baseRow = bRows.find(r =>
          r.strategy === strat.name && r.vol === vol && r.vrp === vrp && r.features === "Baseline (no RF)"
        );
        const rfRow = bRows.find(r =>
          r.strategy === strat.name && r.vol === vol && r.vrp === vrp && r.features === "RF only"
        );
        if (baseRow && rfRow) {
          rfTotal++;
          if (rfRow.sharpe > baseRow.sharpe) rfWins++;
        }
      }
    }
  }
  console.log(`  RF wins ${rfWins}/${rfTotal} combos (${fmt(rfWins / rfTotal * 100, 1)}%)`);

  // Best config per strategy summary
  console.log("\n  Best Feature Config per Strategy (averaged across vol × VRP):");
  for (const strat of strategies) {
    const byFeature = new Map<string, number[]>();
    for (const row of bRows.filter(r => r.strategy === strat.name)) {
      const arr = byFeature.get(row.features) || [];
      arr.push(row.sharpe);
      byFeature.set(row.features, arr);
    }
    const ranked = [...byFeature.entries()]
      .map(([f, sharpes]) => ({ features: f, avgSharpe: sharpes.reduce((a, b) => a + b, 0) / sharpes.length }))
      .sort((a, b) => b.avgSharpe - a.avgSharpe);

    console.log(`  ${strat.name}: ${ranked[0].features} (avg Sharpe ${fmt(ranked[0].avgSharpe, 3)})`);
    for (const r of ranked) {
      console.log(`    ${r.features.padEnd(20)} → ${fmt(r.avgSharpe, 3)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SUB-EXP C: skipBelowRatio Re-sweep
  // ═══════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  SUB-EXP C: skipBelowRatio RE-SWEEP               ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  const thresholds = [0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.5, 1.8];
  const cVolLevels = [40, 60, 80];
  const cVRP = 6; // Real VRP

  type ThreshMeta = { strategy: string; vol: number; threshold: number };
  const cTasks: Array<{ type: string; params: any }> = [];
  const cMetas: ThreshMeta[] = [];

  for (const vol of cVolLevels) {
    for (const strat of strategies) {
      for (const t of thresholds) {
        const profile: StrategyProfile = { ...strat };
        // Use optimal feature config from Exp 6 for each strategy
        if (strat.name.includes("Active")) {
          profile.adaptiveCalls = false;
          profile.putRollEnabled = false;
        } else if (strat.name.includes("Moderate")) {
          profile.adaptiveCalls = false;
        }

        const { marketConfig, strategyConfig } = buildMCConfigsWithThreshold(
          profile, vol, cVRP, t, bestModel.ivJumps, bestModel.volOfVol,
        );

        cTasks.push({ type: "mc", params: { marketConfig, strategyConfig, numSims } });
        cMetas.push({ strategy: strat.name, vol, threshold: t });
      }
    }
  }

  // Also include RF OFF baselines
  const cBaselineTasks: Array<{ type: string; params: any }> = [];
  const cBaselineMetas: ThreshMeta[] = [];
  for (const vol of cVolLevels) {
    for (const strat of strategies) {
      const { marketConfig, strategyConfig } = buildMCConfigs(
        strat, vol, cVRP, false, bestModel.ivJumps, bestModel.volOfVol,
      );
      cBaselineTasks.push({ type: "mc", params: { marketConfig, strategyConfig, numSims } });
      cBaselineMetas.push({ strategy: strat.name, vol, threshold: 0 });
    }
  }

  console.log(`Testing ${cTasks.length + cBaselineTasks.length} combos (${thresholds.length} thresholds + baselines)`);
  console.log(`Vol levels: ${cVolLevels.join(", ")}%`);
  console.log(`VRP: ${cVRP}%`);
  console.log(`Thresholds: ${thresholds.join(", ")}\n`);

  const [cResults, cBaselineResults] = await Promise.all([
    runBatch<MCResult>(pool, cTasks, "Threshold sweep"),
    runBatch<MCResult>(pool, cBaselineTasks, "Baselines"),
  ]);

  // Build result rows
  type ThreshRow = ThreshMeta & { sharpe: number; apr: number; maxDD: number; winRate: number; skipPct: number; execCycles: number };
  const cRows: ThreshRow[] = [];
  for (let i = 0; i < cResults.length; i++) {
    const r = cResults[i];
    const total = r.avgSkipped + r.avgFullCycles;
    cRows.push({
      ...cMetas[i],
      sharpe: r.avgSharpe, apr: r.avgAPR, maxDD: r.avgMaxDD,
      winRate: r.winRate, skipPct: total > 0 ? (r.avgSkipped / total) * 100 : 0,
      execCycles: r.avgFullCycles,
    });
  }
  const cBaseRows: ThreshRow[] = [];
  for (let i = 0; i < cBaselineResults.length; i++) {
    const r = cBaselineResults[i];
    const total = r.avgSkipped + r.avgFullCycles;
    cBaseRows.push({
      ...cBaselineMetas[i],
      sharpe: r.avgSharpe, apr: r.avgAPR, maxDD: r.avgMaxDD,
      winRate: r.winRate, skipPct: total > 0 ? (r.avgSkipped / total) * 100 : 0,
      execCycles: r.avgFullCycles,
    });
  }

  // Print results by strategy
  for (const strat of strategies) {
    console.log(`\n  --- ${strat.name} ---`);
    const rows: any[] = [];

    for (const vol of cVolLevels) {
      const baseline = cBaseRows.find(r => r.strategy === strat.name && r.vol === vol);
      rows.push({
        "Vol%": vol, "Thresh": "OFF",
        "Sharpe": fmt(baseline?.sharpe ?? 0, 3), "APR%": fmt(baseline?.apr ?? 0),
        "MaxDD%": fmt((baseline?.maxDD ?? 0) * 100, 1), "Win%": fmt((baseline?.winRate ?? 0) * 100, 1),
        "Skip%": fmt(baseline?.skipPct ?? 0, 1), "Cycles": fmt(baseline?.execCycles ?? 0, 1),
        "ΔSharpe": "—",
      });

      for (const t of thresholds) {
        const row = cRows.find(r => r.strategy === strat.name && r.vol === vol && r.threshold === t);
        if (row) {
          const delta = baseline ? row.sharpe - baseline.sharpe : 0;
          rows.push({
            "Vol%": vol, "Thresh": fmt(t, 1),
            "Sharpe": fmt(row.sharpe, 3), "APR%": fmt(row.apr),
            "MaxDD%": fmt(row.maxDD * 100, 1), "Win%": fmt(row.winRate * 100, 1),
            "Skip%": fmt(row.skipPct, 1), "Cycles": fmt(row.execCycles, 1),
            "ΔSharpe": fmtSign(delta, 3),
          });
        }
      }
    }
    console.table(rows);

    // Find optimal threshold per vol
    console.log("  Optimal thresholds:");
    for (const vol of cVolLevels) {
      const volRows = cRows.filter(r => r.strategy === strat.name && r.vol === vol);
      const best = volRows.reduce((a, b) => a.sharpe > b.sharpe ? a : b);
      const baseline = cBaseRows.find(r => r.strategy === strat.name && r.vol === vol);
      const delta = baseline ? best.sharpe - baseline.sharpe : 0;
      console.log(`    ${vol}% vol: t=${fmt(best.threshold, 1)} → Sharpe ${fmt(best.sharpe, 3)} (ΔSharpe ${fmtSign(delta, 3)})`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════
  console.log("\n" + "═".repeat(80));
  console.log("SUMMARY");
  console.log("═".repeat(80));
  console.log(`\nBest calibrated model: ${bestModel.label}`);
  console.log(`  Score: ${fmt(bestModel.score, 3)} (baseline ξ=0.50: ${fmt(baseline.score, 3)})`);
  console.log(`  ΔIV std: ${fmt(bestModel.deltaIVStd, 3)} (real: ${REAL.deltaIVStd})`);
  console.log(`  ΔIV kurtosis: ${fmt(bestModel.deltaIVKurt, 2)} (real: ${REAL.deltaIVKurt})`);
  console.log(`  Sq ACF1: ${fmt(bestModel.sqACF1, 3)} (real: ${REAL.sqACF1})`);
  console.log(`  Skip rate: ${fmt(bestModel.skipRate, 1)}% (real: ${REAL.skipRate}%)`);

  console.log(`\nRF universality: ${rfWins}/${rfTotal} (${fmt(rfWins / rfTotal * 100, 1)}%)`);

  // Overall strategy ranking with calibrated model
  console.log("\nStrategy ranking (calibrated model, VRP=6%, avg across vol):");
  for (const strat of strategies) {
    const rfOnly = bRows.filter(r =>
      r.strategy === strat.name && r.vrp === 6
      && (r.features === "RF only" || (strat.name.includes("Conservative") && r.features === "RF+AC+PR"))
    );
    if (rfOnly.length > 0) {
      const avgSharpe = rfOnly.reduce((a, r) => a + r.sharpe, 0) / rfOnly.length;
      const avgAPR = rfOnly.reduce((a, r) => a + r.apr, 0) / rfOnly.length;
      console.log(`  ${strat.name}: avg Sharpe ${fmt(avgSharpe, 3)}, avg APR ${fmt(avgAPR)}%`);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nTotal elapsed: ${elapsed}s`);

  await pool.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
