import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { writeFileSync, unlinkSync } from "node:fs";
import { buildSync } from "esbuild";
import os from "node:os";
import path from "node:path";
import { defaultMarketValues, defaultStrategyValues } from "../../src/components/presets.ts";

// ─── CLI ───

const threadArg = process.argv.find(a => a.startsWith("--threads="));
const numThreads = threadArg
  ? parseInt(threadArg.split("=")[1])
  : Math.max(1, os.cpus().length - 1);

// ─── Compile worker to JS (tsx doesn't propagate hooks to worker_threads) ───

const WORKER_TS = fileURLToPath(new URL("./sweep14_worker.ts", import.meta.url));
const WORKER_JS = path.join(path.dirname(WORKER_TS), "sweep14_worker.compiled.mjs");

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

const WORKER_PATH = WORKER_JS;

// ─── Worker Pool ───

class WorkerPool {
  private workers: Worker[] = [];
  private pending = new Map<Worker, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private queue: Array<{ task: any; resolve: (v: any) => void; reject: (e: Error) => void }> = [];

  constructor(path: string, size: number) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(path);
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

// ─── Interfaces (same as sweep14.ts) ───

interface SignalAccuracyResult {
  trueVRP: number; vol: number; drift: number; window: number;
  meanEstVRP: number; stdEstVRP: number; rmse: number; bias: number;
  meanACF: number; stdACF: number;
}

interface DeploymentResult {
  strategy: string; vrpWindow: number; vrpThreshold: number;
  trueVRP: number; drift: number; vol: number; days: number;
  horizon: string; model: string;
  sharpe: number; meanAPR: number; maxDD: number; winRate: number; alpha: number;
  avgSkipped: number; avgTotalCycles: number; skipPct: number;
  avgDeploySkips: number; avgExecCycles: number; deltaSharpe: number;
}

interface ACFResult {
  strategy: string; acfWindow: number; acfThreshold: number;
  kappa: number; trueVRP: number; drift: number; vol: number;
  sharpe: number; meanAPR: number; maxDD: number; winRate: number;
  avgDeploySkips: number; avgExecCycles: number; deltaSharpe: number;
}

interface CombinedResult {
  strategy: string; vrpWindow: number; vrpThreshold: number;
  acfWindow: number; acfThreshold: number;
  trueVRP: number; drift: number; vol: number; model: string;
  horizon: string;
  sharpe: number; meanAPR: number; maxDD: number; winRate: number;
  avgDeploySkips: number; avgExecCycles: number; deltaSharpe: number;
}

interface MCResult {
  avgAPR: number; avgSharpe: number; avgMaxDD: number; winRate: number;
  avgBenchAPR: number; avgSkipped: number; avgFullCycles: number;
  avgDeploySkips: number; count: number;
}

// ─── Strategy Profile ───

interface StrategyProfile {
  name: string; delta: number; cycle: number; lookback: number;
  adaptiveCalls: boolean;
  putRollEnabled: boolean; putRollInitialDTE: number; putRollWhenBelow: number;
}

// ─── Helpers ───

function fmt(n: number, decimals = 2): string { return n.toFixed(decimals); }
function fmtSign(n: number, decimals = 2): string { return (n > 0 ? "+" : "") + n.toFixed(decimals); }

function avgField<T>(rows: T[], field: keyof T): number {
  const vals = rows.map(r => r[field] as number).filter(v => !isNaN(v));
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function buildConfigs(
  strat: StrategyProfile, vol: number, drift: number, vrpPremiumPct: number,
  days: number, baseMarket: ReturnType<typeof defaultMarketValues>,
  deploymentSignal?: { vrpWindow?: number; vrpFloor?: number; rvLookback?: number; acfWindow?: number; acfCeiling?: number },
  modelOverride?: "gbm" | "jump", kappaOverride?: number,
) {
  const annualVolDec = vol / 100;
  const base = defaultStrategyValues();
  const marketConfig: any = {
    ...baseMarket,
    startPrice: baseMarket.startPrice,
    annualVol: annualVolDec,
    annualDrift: drift / 100,
    model: modelOverride ?? ("gbm" as const),
    days,
    numSimulations: 1000,
    jump: { lambda: baseMarket.lambda, muJ: baseMarket.muJ, sigmaJ: baseMarket.sigmaJ },
    ivParams: {
      meanReversion: kappaOverride ?? baseMarket.ivMeanReversion,
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
    bidAskSpreadPct: 0.05,
    feePerTrade: 0.50,
    ...(strat.adaptiveCalls ? {
      adaptiveCalls: {
        minDelta: base.minCallDelta, maxDelta: base.maxCallDelta,
        skipThresholdPct: 0, minStrikeAtCost: base.minStrikeAtCost,
      },
    } : {}),
    ivRvSpread: {
      lookbackDays: strat.lookback, minMultiplier: 0.8, maxMultiplier: 1.3,
      skipBelowRatio, skipSide: "put" as const,
    },
    ...(strat.putRollEnabled ? {
      rollPut: {
        initialDTE: strat.putRollInitialDTE,
        rollWhenDTEBelow: strat.putRollWhenBelow,
        requireNetCredit: true,
      },
    } : {}),
    ...(deploymentSignal ? { deploymentSignal } : {}),
  };
  return { marketConfig, strategyConfig };
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

// ─── Main ───

async function main() {
  console.log("=== Experiment 14: Deployment Signal Estimation (multi-threaded) ===");
  console.log(`Threads: ${numThreads} | CPUs: ${os.cpus().length}`);
  console.log("Goal: Test whether trailing VRP estimates and IV/RV autocorrelation can");
  console.log("      reliably drive deploy/pause decisions for the Active strategy.\n");

  const pool = new WorkerPool(WORKER_PATH, numThreads);
  const baseMarket = defaultMarketValues();
  const numSims = 1000;
  const t0 = Date.now();

  const strategies: StrategyProfile[] = [
    { name: "Active (δ0.20/3d)", delta: 0.20, cycle: 3, lookback: 20,
      adaptiveCalls: false, putRollEnabled: false, putRollInitialDTE: 0, putRollWhenBelow: 0 },
    { name: "Moderate (δ0.20/14d)", delta: 0.20, cycle: 14, lookback: 20,
      adaptiveCalls: false, putRollEnabled: true, putRollInitialDTE: 14, putRollWhenBelow: 7 },
    { name: "Conservative (δ0.10/30d)", delta: 0.10, cycle: 30, lookback: 45,
      adaptiveCalls: true, putRollEnabled: true, putRollInitialDTE: 30, putRollWhenBelow: 14 },
  ];
  const bStrat = strategies[0];

  // =======================================================
  // SUB-EXPERIMENT A: Signal Accuracy Validation
  // =======================================================
  console.log("=".repeat(130));
  console.log("=== SUB-EXPERIMENT A: SIGNAL ACCURACY VALIDATION ===");
  console.log("=".repeat(130));
  console.log("Validate trailing VRP estimation accuracy and ACF distinguishability.\n");

  const accuracyVRPs = [5, 10, 15];
  const accuracyVols = [40, 60];
  const accuracyDrifts = [0, 5];
  const accuracyWindows = [20, 40, 60];
  const checkDays = [180, 360];

  const aTasks: { type: string; params: any }[] = [];
  for (const trueVRP of accuracyVRPs) {
    for (const vol of accuracyVols) {
      for (const drift of accuracyDrifts) {
        aTasks.push({
          type: "accuracy",
          params: {
            trueVRP, vol, drift,
            windows: accuracyWindows,
            checkDays,
            numSims,
            startPrice: baseMarket.startPrice,
            ivMeanReversion: baseMarket.ivMeanReversion,
            ivVolOfVol: baseMarket.ivVolOfVol,
          },
        });
      }
    }
  }

  console.log(`Testing ${accuracyVRPs.map(v => v + "%").join(", ")} VRP × ${accuracyVols.map(v => v + "%").join(", ")} vol × `
    + `${accuracyDrifts.map(d => d + "%").join(", ")} drift × ${accuracyWindows.map(w => w + "d").join(", ")} windows`);
  console.log(`Check points: day ${checkDays.join(", ")} | ${numSims} paths per combo`);
  console.log(`Tasks: ${aTasks.length} (parallelized across ${numThreads} threads)\n`);

  const aResultBatches = await runBatch<SignalAccuracyResult[]>(pool, aTasks, "Signal accuracy");
  const accuracyResults = aResultBatches.flat();
  console.log(`Signal accuracy: ${accuracyResults.length} result rows.\n`);

  console.log("--- VRP Estimation Accuracy ---");
  console.log("True VRP (decimal) vs Mean Estimated VRP ± Std, RMSE, Bias\n");

  for (const vol of accuracyVols) {
    for (const drift of accuracyDrifts) {
      console.log(`  Vol=${vol}% | Drift=${drift}%:`);
      const rows: any[] = [];
      for (const trueVRP of accuracyVRPs) {
        for (const window of accuracyWindows) {
          const subset = accuracyResults.filter(r =>
            r.trueVRP === trueVRP && r.vol === vol && r.drift === drift && r.window === window
          );
          if (subset.length === 0) continue;
          const avg = (field: keyof SignalAccuracyResult) =>
            subset.reduce((a, r) => a + (r[field] as number), 0) / subset.length;
          rows.push({
            "TrueVRP%": trueVRP, "Window": `${window}d`,
            "MeanEst": fmt(avg("meanEstVRP") * 100, 2) + "%",
            "Std": fmt(avg("stdEstVRP") * 100, 2) + "%",
            "RMSE": fmt(avg("rmse") * 100, 2) + "%",
            "Bias": fmtSign(avg("bias") * 100, 2) + "%",
            "MeanACF": fmt(avg("meanACF"), 3),
            "StdACF": fmt(avg("stdACF"), 3),
          });
        }
      }
      console.table(rows);
    }
  }

  // =======================================================
  // SUB-EXPERIMENT B: VRP-Based Deployment
  // =======================================================
  console.log("\n" + "=".repeat(130));
  console.log("=== SUB-EXPERIMENT B: VRP-BASED DEPLOYMENT ===");
  console.log("=".repeat(130));
  console.log("Test deployment signal with VRP threshold against always-on baseline.\n");

  const bVRPWindows = [20, 40, 60];
  const bVRPThresholds = [0, 5, 8, 10];
  const bTrueVRPs = [5, 10, 15];
  const bDrifts = [0, 5, -30];
  const bVol = 60;
  const bHorizons = [
    { days: 365, label: "1yr" },
    { days: 1825, label: "5yr" },
  ];

  interface BMeta {
    vrpWindow: number; vrpThreshold: number; trueVRP: number;
    drift: number; days: number; horizon: string;
  }

  const bTasks: { type: string; params: any }[] = [];
  const bMetas: BMeta[] = [];

  for (const hz of bHorizons) {
    for (const trueVRP of bTrueVRPs) {
      for (const drift of bDrifts) {
        for (const vrpWindow of bVRPWindows) {
          for (const vrpThreshold of bVRPThresholds) {
            const dsConfig = vrpThreshold > 0
              ? { vrpWindow, vrpFloor: vrpThreshold / 100, rvLookback: 20 }
              : undefined;
            const { marketConfig, strategyConfig } = buildConfigs(
              bStrat, bVol, drift, trueVRP, hz.days, baseMarket, dsConfig,
            );
            bTasks.push({ type: "mc", params: { marketConfig, strategyConfig, numSims } });
            bMetas.push({ vrpWindow, vrpThreshold, trueVRP, drift, days: hz.days, horizon: hz.label });
          }
        }
      }
    }
  }

  console.log(`Strategy: ${bStrat.name}`);
  console.log(`VRP windows: ${bVRPWindows.map(w => w + "d").join(", ")}`);
  console.log(`VRP thresholds: ${bVRPThresholds.map(t => t + "%").join(", ")}`);
  console.log(`True VRPs: ${bTrueVRPs.map(v => v + "%").join(", ")}`);
  console.log(`Drifts: ${bDrifts.map(d => (d > 0 ? "+" : "") + d + "%").join(", ")}`);
  console.log(`Vol: ${bVol}% | Horizons: ${bHorizons.map(h => h.label).join(", ")}`);
  console.log(`Total combos: ${bTasks.length} × ${numSims} paths (parallelized across ${numThreads} threads)\n`);

  const bResults = await runBatch<MCResult>(pool, bTasks, "VRP deployment");

  const baselines = new Map<string, number>();
  for (let i = 0; i < bResults.length; i++) {
    const m = bMetas[i];
    if (m.vrpThreshold === 0 && m.vrpWindow === bVRPWindows[0]) {
      baselines.set(`${m.trueVRP}|${m.drift}|${m.days}`, bResults[i].avgSharpe);
    }
  }

  const deployResults: DeploymentResult[] = [];
  for (let i = 0; i < bResults.length; i++) {
    const m = bMetas[i];
    const r = bResults[i];
    const blSharpe = baselines.get(`${m.trueVRP}|${m.drift}|${m.days}`) ?? 0;
    const totalCycles = r.avgSkipped + r.avgFullCycles;
    deployResults.push({
      strategy: bStrat.name, vrpWindow: m.vrpWindow, vrpThreshold: m.vrpThreshold,
      trueVRP: m.trueVRP, drift: m.drift, vol: bVol, days: m.days,
      horizon: m.horizon, model: "gbm",
      sharpe: r.avgSharpe, meanAPR: r.avgAPR, maxDD: r.avgMaxDD, winRate: r.winRate,
      alpha: r.avgAPR - r.avgBenchAPR,
      avgSkipped: r.avgSkipped, avgTotalCycles: totalCycles,
      skipPct: totalCycles > 0 ? (r.avgSkipped / totalCycles) * 100 : 0,
      avgDeploySkips: r.avgDeploySkips, avgExecCycles: r.avgFullCycles,
      deltaSharpe: r.avgSharpe - blSharpe,
    });
  }

  console.log(`VRP deployment: ${deployResults.length} result rows.\n`);

  console.log("--- ΔSharpe vs Baseline (VRP Deploy ON vs Always-On) ---\n");
  for (const hz of bHorizons) {
    console.log(`  ${hz.label}:`);
    for (const trueVRP of bTrueVRPs) {
      console.log(`\n    True VRP=${trueVRP}%:`);
      const rows: any[] = [];
      for (const drift of bDrifts) {
        for (const vrpWindow of bVRPWindows) {
          for (const vrpThreshold of bVRPThresholds) {
            if (vrpThreshold === 0) continue;
            const r = deployResults.find(x =>
              x.horizon === hz.label && x.trueVRP === trueVRP && x.drift === drift
              && x.vrpWindow === vrpWindow && x.vrpThreshold === vrpThreshold
            );
            if (!r) continue;
            rows.push({
              "Drift": `${drift > 0 ? "+" : ""}${drift}%`,
              "Window": `${vrpWindow}d`, "Threshold": `${vrpThreshold}%`,
              "Sharpe": fmt(r.sharpe, 3), "ΔSharpe": fmtSign(r.deltaSharpe, 3),
              "APR%": fmt(r.meanAPR), "MaxDD%": fmt(r.maxDD * 100, 1),
              "WinRate%": fmt(r.winRate * 100, 1),
              "DeploySkips": fmt(r.avgDeploySkips, 1), "ExecCyc": fmt(r.avgExecCycles, 1),
            });
          }
        }
      }
      console.table(rows);
    }
  }

  console.log("\n--- Best VRP Configs (by mean ΔSharpe across conditions) ---\n");
  const vrpConfigScores = new Map<string, number[]>();
  for (const r of deployResults) {
    if (r.vrpThreshold === 0) continue;
    const key = `w=${r.vrpWindow}d|t=${r.vrpThreshold}%`;
    if (!vrpConfigScores.has(key)) vrpConfigScores.set(key, []);
    vrpConfigScores.get(key)!.push(r.deltaSharpe);
  }
  const vrpRanking = [...vrpConfigScores.entries()]
    .map(([key, vals]) => ({
      config: key,
      meanDelta: vals.reduce((a, b) => a + b, 0) / vals.length,
      winRate: vals.filter(v => v > 0).length / vals.length,
      count: vals.length,
    }))
    .sort((a, b) => b.meanDelta - a.meanDelta);

  console.table(vrpRanking.map(r => ({
    "Config": r.config,
    "Mean ΔSharpe": fmtSign(r.meanDelta, 4),
    "Win Rate": fmt(r.winRate * 100, 1) + "%",
    "N": r.count,
  })));

  const bestVRPConfig = vrpRanking[0];
  const bestVRPMatch = bestVRPConfig.config.match(/w=(\d+)d\|t=(\d+)%/);
  const bestVRPWindow = bestVRPMatch ? parseInt(bestVRPMatch[1]) : 40;
  const bestVRPThreshold = bestVRPMatch ? parseInt(bestVRPMatch[2]) : 10;
  console.log(`\n  Best VRP config: window=${bestVRPWindow}d, threshold=${bestVRPThreshold}%`);
  console.log(`  Mean ΔSharpe: ${fmtSign(bestVRPConfig.meanDelta, 4)}, win rate: ${fmt(bestVRPConfig.winRate * 100, 1)}%\n`);

  // =======================================================
  // SUB-EXPERIMENT C: ACF-Based Guard
  // =======================================================
  console.log("\n" + "=".repeat(130));
  console.log("=== SUB-EXPERIMENT C: ACF-BASED GUARD ===");
  console.log("=".repeat(130));
  console.log("Test ACF guard with varying OU persistence (κ=1 high-clustering, κ=5 normal).\n");

  const cACFWindows = [30, 60];
  const cACFThresholds = [0.3, 0.5, 0.7];
  const cKappas = [1, 5];
  const cTrueVRPs = [10, 15];
  const cDrifts = [0, -30];
  const cVol = 60;
  const cDays = 365;

  interface CMeta {
    isBaseline: boolean; kappa: number; trueVRP: number; drift: number;
    acfWindow: number; acfThreshold: number;
  }

  const cTasks: { type: string; params: any }[] = [];
  const cMetas: CMeta[] = [];

  for (const kappa of cKappas) {
    for (const trueVRP of cTrueVRPs) {
      for (const drift of cDrifts) {
        const { marketConfig, strategyConfig } = buildConfigs(
          bStrat, cVol, drift, trueVRP, cDays, baseMarket, undefined, "gbm", kappa,
        );
        cTasks.push({ type: "mc", params: { marketConfig, strategyConfig, numSims } });
        cMetas.push({ isBaseline: true, kappa, trueVRP, drift, acfWindow: 0, acfThreshold: 0 });
      }
    }
  }
  for (const kappa of cKappas) {
    for (const trueVRP of cTrueVRPs) {
      for (const drift of cDrifts) {
        for (const acfWindow of cACFWindows) {
          for (const acfThreshold of cACFThresholds) {
            const dsConfig = { acfWindow, acfCeiling: acfThreshold, rvLookback: 20 };
            const { marketConfig, strategyConfig } = buildConfigs(
              bStrat, cVol, drift, trueVRP, cDays, baseMarket, dsConfig, "gbm", kappa,
            );
            cTasks.push({ type: "mc", params: { marketConfig, strategyConfig, numSims } });
            cMetas.push({ isBaseline: false, kappa, trueVRP, drift, acfWindow, acfThreshold });
          }
        }
      }
    }
  }

  console.log(`Strategy: ${bStrat.name}`);
  console.log(`ACF windows: ${cACFWindows.map(w => w + "d").join(", ")}`);
  console.log(`ACF thresholds: ${cACFThresholds.join(", ")}`);
  console.log(`OU κ values: ${cKappas.join(", ")} (lower = more clustering)`);
  console.log(`True VRPs: ${cTrueVRPs.map(v => v + "%").join(", ")}`);
  console.log(`Drifts: ${cDrifts.map(d => (d > 0 ? "+" : "") + d + "%").join(", ")}`);
  console.log(`Vol: ${cVol}% | Horizon: 1yr`);
  console.log(`Total combos: ${cTasks.length} × ${numSims} paths (parallelized across ${numThreads} threads)\n`);

  const cResults = await runBatch<MCResult>(pool, cTasks, "ACF guard");

  const acfBaselines = new Map<string, number>();
  for (let i = 0; i < cResults.length; i++) {
    const m = cMetas[i];
    if (m.isBaseline) {
      acfBaselines.set(`${m.kappa}|${m.trueVRP}|${m.drift}`, cResults[i].avgSharpe);
    }
  }

  const acfResults: ACFResult[] = [];
  for (let i = 0; i < cResults.length; i++) {
    const m = cMetas[i];
    if (m.isBaseline) continue;
    const r = cResults[i];
    const blSharpe = acfBaselines.get(`${m.kappa}|${m.trueVRP}|${m.drift}`) ?? 0;
    acfResults.push({
      strategy: bStrat.name, acfWindow: m.acfWindow, acfThreshold: m.acfThreshold,
      kappa: m.kappa, trueVRP: m.trueVRP, drift: m.drift, vol: cVol,
      sharpe: r.avgSharpe, meanAPR: r.avgAPR, maxDD: r.avgMaxDD, winRate: r.winRate,
      avgDeploySkips: r.avgDeploySkips, avgExecCycles: r.avgFullCycles,
      deltaSharpe: r.avgSharpe - blSharpe,
    });
  }

  console.log(`ACF guard: ${acfResults.length} result rows.\n`);
  console.log("--- ACF Guard Results ---\n");

  for (const kappa of cKappas) {
    console.log(`  OU κ=${kappa} (${kappa === 1 ? "HIGH clustering" : "normal"}):`);
    const rows: any[] = [];
    for (const trueVRP of cTrueVRPs) {
      for (const drift of cDrifts) {
        const blSharpe = acfBaselines.get(`${kappa}|${trueVRP}|${drift}`) ?? 0;
        for (const acfWindow of cACFWindows) {
          for (const acfThreshold of cACFThresholds) {
            const r = acfResults.find(x =>
              x.kappa === kappa && x.trueVRP === trueVRP && x.drift === drift
              && x.acfWindow === acfWindow && x.acfThreshold === acfThreshold
            );
            if (!r) continue;
            rows.push({
              "VRP": `${trueVRP}%`, "Drift": `${drift > 0 ? "+" : ""}${drift}%`,
              "ACFWin": `${acfWindow}d`, "ACFThresh": acfThreshold,
              "Baseline": fmt(blSharpe, 3), "Sharpe": fmt(r.sharpe, 3),
              "ΔSharpe": fmtSign(r.deltaSharpe, 3),
              "DeploySkips": fmt(r.avgDeploySkips, 1), "ExecCyc": fmt(r.avgExecCycles, 1),
            });
          }
        }
      }
    }
    console.table(rows);
  }

  console.log("\n--- Best ACF Configs (by mean ΔSharpe) ---\n");
  const acfConfigScores = new Map<string, number[]>();
  for (const r of acfResults) {
    const key = `w=${r.acfWindow}d|t=${r.acfThreshold}`;
    if (!acfConfigScores.has(key)) acfConfigScores.set(key, []);
    acfConfigScores.get(key)!.push(r.deltaSharpe);
  }
  const acfRanking = [...acfConfigScores.entries()]
    .map(([key, vals]) => ({
      config: key,
      meanDelta: vals.reduce((a, b) => a + b, 0) / vals.length,
      winRate: vals.filter(v => v > 0).length / vals.length,
      count: vals.length,
    }))
    .sort((a, b) => b.meanDelta - a.meanDelta);

  console.table(acfRanking.map(r => ({
    "Config": r.config,
    "Mean ΔSharpe": fmtSign(r.meanDelta, 4),
    "Win Rate": fmt(r.winRate * 100, 1) + "%",
    "N": r.count,
  })));

  const bestACFConfig = acfRanking[0];
  const bestACFMatch = bestACFConfig?.config.match(/w=(\d+)d\|t=(.+)/);
  const bestACFWindow = bestACFMatch ? parseInt(bestACFMatch[1]) : 60;
  const bestACFThreshold = bestACFMatch ? parseFloat(bestACFMatch[2]) : 0.5;
  console.log(`\n  Best ACF config: window=${bestACFWindow}d, threshold=${bestACFThreshold}`);
  console.log(`  Mean ΔSharpe: ${fmtSign(bestACFConfig.meanDelta, 4)}, win rate: ${fmt(bestACFConfig.winRate * 100, 1)}%\n`);

  // =======================================================
  // SUB-EXPERIMENT D: Combined Signal
  // =======================================================
  console.log("\n" + "=".repeat(130));
  console.log("=== SUB-EXPERIMENT D: COMBINED SIGNAL ===");
  console.log("=".repeat(130));
  console.log("Test combined VRP + ACF deployment signal vs individual signals.\n");

  const dVRPWindow = bestVRPWindow;
  const dVRPThreshold = bestVRPThreshold;
  const dACFWindow = bestACFWindow;
  const dACFThreshold = bestACFThreshold;

  const dTrueVRPs = [5, 10, 15];
  const dDrifts = [0, 5, -30];
  const dVols = [40, 60];
  const dModels: Array<"gbm" | "jump"> = ["gbm", "jump"];
  const dHorizons = [
    { days: 365, label: "1yr" },
    { days: 1825, label: "5yr" },
  ];

  const configVariants = [
    { label: "Baseline (no signal)", vrpFloor: 0, acfCeiling: undefined as number | undefined },
    { label: `VRP only (w=${dVRPWindow}d, t=${dVRPThreshold}%)`, vrpFloor: dVRPThreshold / 100, acfCeiling: undefined as number | undefined },
    { label: `ACF only (w=${dACFWindow}d, t=${dACFThreshold})`, vrpFloor: 0, acfCeiling: dACFThreshold },
    { label: `Combined (VRP=${dVRPThreshold}% + ACF=${dACFThreshold})`, vrpFloor: dVRPThreshold / 100, acfCeiling: dACFThreshold },
  ];

  interface DMeta {
    trueVRP: number; drift: number; vol: number; model: string;
    horizon: string; days: number;
    variantLabel: string; vrpFloor: number; acfCeiling: number | undefined;
  }

  const dTasks: { type: string; params: any }[] = [];
  const dMetas: DMeta[] = [];

  for (const hz of dHorizons) {
    for (const model of dModels) {
      for (const vol of dVols) {
        for (const trueVRP of dTrueVRPs) {
          for (const drift of dDrifts) {
            for (const variant of configVariants) {
              const dsConfig = (variant.vrpFloor > 0 || variant.acfCeiling !== undefined)
                ? {
                    ...(variant.vrpFloor > 0 ? { vrpWindow: dVRPWindow, vrpFloor: variant.vrpFloor } : {}),
                    ...(variant.acfCeiling !== undefined ? { acfWindow: dACFWindow, acfCeiling: variant.acfCeiling } : {}),
                    rvLookback: 20,
                  }
                : undefined;
              const { marketConfig, strategyConfig } = buildConfigs(
                bStrat, vol, drift, trueVRP, hz.days, baseMarket, dsConfig, model,
              );
              dTasks.push({ type: "mc", params: { marketConfig, strategyConfig, numSims } });
              dMetas.push({
                trueVRP, drift, vol, model, horizon: hz.label, days: hz.days,
                variantLabel: variant.label, vrpFloor: variant.vrpFloor,
                acfCeiling: variant.acfCeiling,
              });
            }
          }
        }
      }
    }
  }

  console.log(`Strategy: ${bStrat.name}`);
  console.log(`Configs: ${configVariants.map(c => c.label).join(" | ")}`);
  console.log(`True VRPs: ${dTrueVRPs.map(v => v + "%").join(", ")}`);
  console.log(`Drifts: ${dDrifts.map(d => (d > 0 ? "+" : "") + d + "%").join(", ")}`);
  console.log(`Vols: ${dVols.map(v => v + "%").join(", ")} | Models: ${dModels.join(", ")}`);
  console.log(`Horizons: ${dHorizons.map(h => h.label).join(", ")}`);
  console.log(`Total combos: ${dTasks.length} × ${numSims} paths (parallelized across ${numThreads} threads)\n`);

  const dResults = await runBatch<MCResult>(pool, dTasks, "Combined signal");

  const dBaselines = new Map<string, number>();
  const combinedResults: CombinedResult[] = [];

  for (let i = 0; i < dResults.length; i++) {
    const m = dMetas[i];
    const r = dResults[i];
    const blKey = `${m.trueVRP}|${m.drift}|${m.vol}|${m.model}|${m.days}`;

    if (m.variantLabel.includes("Baseline")) {
      dBaselines.set(blKey, r.avgSharpe);
    }
  }

  for (let i = 0; i < dResults.length; i++) {
    const m = dMetas[i];
    const r = dResults[i];
    const blKey = `${m.trueVRP}|${m.drift}|${m.vol}|${m.model}|${m.days}`;
    const blSharpe = dBaselines.get(blKey) ?? r.avgSharpe;

    combinedResults.push({
      strategy: bStrat.name,
      vrpWindow: m.vrpFloor > 0 ? dVRPWindow : 0,
      vrpThreshold: m.vrpFloor * 100,
      acfWindow: m.acfCeiling !== undefined ? dACFWindow : 0,
      acfThreshold: m.acfCeiling ?? 0,
      trueVRP: m.trueVRP, drift: m.drift, vol: m.vol, model: m.model,
      horizon: m.horizon,
      sharpe: r.avgSharpe, meanAPR: r.avgAPR, maxDD: r.avgMaxDD, winRate: r.winRate,
      avgDeploySkips: r.avgDeploySkips, avgExecCycles: r.avgFullCycles,
      deltaSharpe: r.avgSharpe - blSharpe,
    });
  }

  console.log(`Combined signal: ${combinedResults.length} result rows.\n`);
  console.log("--- Combined Signal Results ---\n");

  for (const hz of dHorizons) {
    for (const model of dModels) {
      console.log(`  ${hz.label} | Model=${model}:`);
      const rows: any[] = [];
      for (const vol of dVols) {
        for (const trueVRP of dTrueVRPs) {
          for (const drift of dDrifts) {
            const condLabel = `Vol=${vol}% VRP=${trueVRP}% Drift=${drift > 0 ? "+" : ""}${drift}%`;
            for (const variant of configVariants) {
              const isVRP = variant.vrpFloor > 0;
              const isACF = variant.acfCeiling !== undefined;
              const match = combinedResults.find(x =>
                x.vol === vol && x.trueVRP === trueVRP && x.drift === drift
                && x.model === model && x.horizon === hz.label
                && ((isVRP && x.vrpThreshold === variant.vrpFloor * 100) || (!isVRP && x.vrpThreshold === 0))
                && ((isACF && x.acfThreshold === variant.acfCeiling) || (!isACF && x.acfThreshold === 0))
              );
              if (!match) continue;
              rows.push({
                "Condition": condLabel,
                "Signal": variant.label.split(" (")[0],
                "Sharpe": fmt(match.sharpe, 3), "ΔSharpe": fmtSign(match.deltaSharpe, 3),
                "APR%": fmt(match.meanAPR), "MaxDD%": fmt(match.maxDD * 100, 1),
                "DeploySkips": fmt(match.avgDeploySkips, 1),
              });
            }
          }
        }
      }
      console.table(rows);
    }
  }

  // =======================================================
  // SUMMARY & RECOMMENDATIONS
  // =======================================================
  console.log("\n" + "=".repeat(130));
  console.log("=== SUMMARY & RECOMMENDATIONS ===");
  console.log("=".repeat(130) + "\n");

  console.log("--- VRP Signal ---");
  console.log(`  Best config: window=${bestVRPWindow}d, threshold=${bestVRPThreshold}%`);
  console.log(`  Mean ΔSharpe: ${fmtSign(bestVRPConfig.meanDelta, 4)}`);
  console.log(`  Win rate (improves Sharpe): ${fmt(bestVRPConfig.winRate * 100, 1)}%`);
  const vrpPositive = deployResults.filter(r => r.vrpThreshold > 0 && r.deltaSharpe > 0).length;
  const vrpTotal = deployResults.filter(r => r.vrpThreshold > 0).length;
  console.log(`  Positive ΔSharpe: ${vrpPositive}/${vrpTotal} combos (${fmt(vrpPositive / vrpTotal * 100, 1)}%)\n`);

  console.log("--- ACF Signal ---");
  console.log(`  Best config: window=${bestACFWindow}d, threshold=${bestACFThreshold}`);
  console.log(`  Mean ΔSharpe: ${fmtSign(bestACFConfig.meanDelta, 4)}`);
  console.log(`  Win rate (improves Sharpe): ${fmt(bestACFConfig.winRate * 100, 1)}%`);
  const acfPositive = acfResults.filter(r => r.deltaSharpe > 0).length;
  console.log(`  Positive ΔSharpe: ${acfPositive}/${acfResults.length} combos (${fmt(acfPositive / acfResults.length * 100, 1)}%)\n`);

  console.log("--- Combined Signal ---");
  const combinedOnly = combinedResults.filter(r => r.vrpThreshold > 0 && r.acfThreshold > 0);
  const vrpOnlyD = combinedResults.filter(r => r.vrpThreshold > 0 && r.acfThreshold === 0);
  const acfOnlyD = combinedResults.filter(r => r.vrpThreshold === 0 && r.acfThreshold > 0);

  const avgDeltaCombined = avgField(combinedOnly, "deltaSharpe");
  const avgDeltaVRPOnly = avgField(vrpOnlyD, "deltaSharpe");
  const avgDeltaACFOnly = avgField(acfOnlyD, "deltaSharpe");

  console.log(`  Combined mean ΔSharpe: ${fmtSign(avgDeltaCombined, 4)}`);
  console.log(`  VRP-only mean ΔSharpe: ${fmtSign(avgDeltaVRPOnly, 4)}`);
  console.log(`  ACF-only mean ΔSharpe: ${fmtSign(avgDeltaACFOnly, 4)}`);

  if (avgDeltaCombined > avgDeltaVRPOnly && avgDeltaCombined > avgDeltaACFOnly) {
    console.log(`  → Combined signal OUTPERFORMS individual signals.\n`);
  } else if (avgDeltaVRPOnly >= avgDeltaCombined && avgDeltaVRPOnly >= avgDeltaACFOnly) {
    console.log(`  → VRP-only is sufficient. ACF adds no incremental value.\n`);
  } else {
    console.log(`  → ACF-only outperforms. VRP adds no incremental value.\n`);
  }

  console.log("--- KEY FINDINGS ---\n");
  const allDeployDelta = [
    ...deployResults.filter(r => r.vrpThreshold > 0).map(r => r.deltaSharpe),
    ...acfResults.map(r => r.deltaSharpe),
  ];
  const overallPositive = allDeployDelta.filter(v => v > 0).length;
  const overallTotal = allDeployDelta.length;
  const overallMean = allDeployDelta.reduce((a, b) => a + b, 0) / allDeployDelta.length;

  console.log(`  1. Deployment signal positive rate: ${overallPositive}/${overallTotal} (${fmt(overallPositive / overallTotal * 100, 1)}%)`);
  console.log(`  2. Mean ΔSharpe across all signal combos: ${fmtSign(overallMean, 4)}`);

  if (overallMean > 0.02) {
    console.log(`  3. VERDICT: Deployment signal provides meaningful improvement. Integrate into presets.`);
  } else if (overallMean > 0) {
    console.log(`  3. VERDICT: Deployment signal provides marginal improvement. Consider for risk-averse deployers.`);
  } else {
    console.log(`  3. VERDICT: Deployment signal does NOT improve performance. Active's existing RF is sufficient.`);
  }

  console.log("\n--- Whipsaw Analysis ---");
  console.log("  Avg deployment skips per path (proxy for deploy/pause transitions):\n");
  for (const hz of bHorizons) {
    const hzResults = deployResults.filter(r => r.horizon === hz.label && r.vrpThreshold > 0);
    const avgDS = hzResults.length > 0 ? avgField(hzResults, "avgDeploySkips") : 0;
    const avgEC = hzResults.length > 0 ? avgField(hzResults, "avgExecCycles") : 0;
    console.log(`  ${hz.label}: avg deployment skips = ${fmt(avgDS, 1)}, avg executed cycles = ${fmt(avgEC, 1)}`);
    if (avgDS > 0) {
      console.log(`    Skip/Execute ratio: ${fmt(avgDS / (avgEC || 1), 2)}`);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n\nCompleted in ${elapsed}s using ${numThreads} threads.`);
  console.log("\n=== END OF EXPERIMENT 14 ===\n");

  await pool.close();
}

main().catch(console.error);
