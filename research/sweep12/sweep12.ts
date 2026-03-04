import { defaultMarketValues, defaultStrategyValues } from "../../src/components/presets.ts";
import { runMonteCarlo } from "../../src/components/monte-carlo.ts";
import type { PriceModel } from "../../src/components/price-gen.ts";

interface StrategyProfile {
  name: string;
  delta: number;
  cycle: number;
  lookback: number;
  adaptiveCalls: boolean;
  putRollEnabled: boolean;
  putRollInitialDTE: number;
  putRollWhenBelow: number;
}

interface HorizonResult {
  model: PriceModel;
  drift: number;
  vrp: number;
  days: number;
  horizon: string;
  strategy: string;
  configLabel: string;
  meanAPR: number;
  medianAPR: number;
  p5APR: number;
  sharpe: number;
  sortino: number;
  maxDD: number;
  winRate: number;
  benchAPR: number;
  alpha: number;
  avgSkippedCycles: number;
  avgTotalCycles: number;
  skipPct: number;
  avgStopLosses: number;
  avgPutRolls: number;
  avgExecCycles: number;
}

function buildConfigs(
  strat: StrategyProfile,
  vol: number,
  drift: number,
  model: PriceModel,
  vrpPremiumPct: number,
  days: number,
  rfEnabled: boolean,
  baseMarket: ReturnType<typeof defaultMarketValues>,
) {
  const annualVolDec = vol / 100;
  const base = defaultStrategyValues();

  const marketConfig: any = {
    ...baseMarket,
    startPrice: baseMarket.startPrice,
    annualVol: annualVolDec,
    annualDrift: drift / 100,
    model,
    days,
    numSimulations: 1000,
    jump: {
      lambda: baseMarket.lambda,
      muJ: baseMarket.muJ,
      sigmaJ: baseMarket.sigmaJ,
    },
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
    impliedVol: impliedVol,
    riskFreeRate: baseMarket.riskFreeRate / 100,
    contracts: base.contracts,
    bidAskSpreadPct: baseMarket.bidAskSpreadPct / 100,
    feePerTrade: baseMarket.feePerTrade,

    ...(strat.adaptiveCalls ? {
      adaptiveCalls: {
        minDelta: base.minCallDelta,
        maxDelta: base.maxCallDelta,
        skipThresholdPct: 0,
        minStrikeAtCost: base.minStrikeAtCost,
      },
    } : {}),

    ivRvSpread: {
      lookbackDays: strat.lookback,
      minMultiplier: 0.8,
      maxMultiplier: 1.3,
      ...(rfEnabled ? {
        skipBelowRatio,
        skipSide: "put" as const,
      } : {}),
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

function runCombo(
  marketConfig: any,
  strategyConfig: any,
  numSims: number,
): { runs: any[]; medianAPR: number; p5APR: number } {
  const result = runMonteCarlo(marketConfig, strategyConfig, numSims);
  return { runs: result.runs, medianAPR: result.medianAPR, p5APR: result.p5APR };
}

function extractResult(
  model: PriceModel,
  drift: number,
  vrp: number,
  days: number,
  horizon: string,
  stratName: string,
  configLabel: string,
  result: { runs: any[]; medianAPR: number; p5APR: number },
): HorizonResult {
  const { runs, medianAPR, p5APR } = result;
  const count = runs.length;

  const avgAPR = runs.reduce((acc: number, r: any) => acc + (isNaN(r.apr) ? 0 : r.apr), 0) / count;
  const validSharpes = runs.filter((r: any) => !isNaN(r.sharpe));
  const avgSharpe = validSharpes.length > 0
    ? validSharpes.reduce((acc: number, r: any) => acc + r.sharpe, 0) / validSharpes.length
    : 0;
  const validSortinos = runs.filter((r: any) => !isNaN(r.sortino));
  const avgSortino = validSortinos.length > 0
    ? validSortinos.reduce((acc: number, r: any) => acc + r.sortino, 0) / validSortinos.length
    : 0;
  const avgMaxDD = runs.reduce((acc: number, r: any) => acc + (isNaN(r.maxDrawdown) ? 0 : r.maxDrawdown), 0) / count;
  const winRate = runs.filter((r: any) => r.isWin).length / count;
  const avgBenchAPR = runs.reduce((acc: number, r: any) => acc + (isNaN(r.benchmarkAPR) ? 0 : r.benchmarkAPR), 0) / count;
  const avgSkipped = runs.reduce((acc: number, r: any) => acc + r.skippedCycles, 0) / count;
  const avgFullCycles = runs.reduce((acc: number, r: any) => acc + r.fullCycles, 0) / count;
  const avgStopLosses = runs.reduce((acc: number, r: any) => acc + r.totalStopLosses, 0) / count;
  const avgPutRolls = runs.reduce((acc: number, r: any) => acc + r.totalPutRolls, 0) / count;
  const totalCycles = avgSkipped + avgFullCycles;
  const skipPct = totalCycles > 0 ? (avgSkipped / totalCycles) * 100 : 0;

  return {
    model,
    drift,
    vrp,
    days,
    horizon,
    strategy: stratName,
    configLabel,
    meanAPR: avgAPR,
    medianAPR,
    p5APR,
    sharpe: avgSharpe,
    sortino: avgSortino,
    maxDD: avgMaxDD,
    winRate,
    benchAPR: avgBenchAPR,
    alpha: avgAPR - avgBenchAPR,
    avgSkippedCycles: avgSkipped,
    avgTotalCycles: totalCycles,
    skipPct,
    avgStopLosses,
    avgPutRolls,
    avgExecCycles: avgFullCycles,
  };
}

function fmt(n: number, decimals: number = 2): string {
  return n.toFixed(decimals);
}

function fmtSign(n: number, decimals: number = 2): string {
  return (n > 0 ? "+" : "") + n.toFixed(decimals);
}

function fmtDrift(d: number): string {
  return (d >= 0 ? "+" : "") + d;
}

function avgField(rows: HorizonResult[], field: keyof HorizonResult): number {
  const vals = rows.map(r => r[field] as number).filter(v => !isNaN(v));
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

async function main() {
  console.log("=== Experiment 12: Multi-Year Horizon ===");
  console.log("Goal: Test whether Exp 6 optimal configs remain viable over 2-year and 5-year");
  console.log("      horizons. All prior experiments used 365-day simulations.");
  console.log("      Key questions: Does Active's drift immunity survive sustained decline?");
  console.log("      Does the regime filter's ~94-97% skip rate compound differently?");
  console.log("      Are skipBelowRatio thresholds stable? How does MaxDD evolve?\n");

  const baseMarket = defaultMarketValues();
  const numSims = 1000;

  const strategies: StrategyProfile[] = [
    {
      name: "Conservative (δ0.10/30d)",
      delta: 0.10, cycle: 30, lookback: 45,
      adaptiveCalls: true,
      putRollEnabled: true, putRollInitialDTE: 30, putRollWhenBelow: 14,
    },
    {
      name: "Moderate (δ0.20/14d)",
      delta: 0.20, cycle: 14, lookback: 20,
      adaptiveCalls: false,
      putRollEnabled: true, putRollInitialDTE: 14, putRollWhenBelow: 7,
    },
    {
      name: "Active (δ0.20/3d)",
      delta: 0.20, cycle: 3, lookback: 20,
      adaptiveCalls: false,
      putRollEnabled: false, putRollInitialDTE: 0, putRollWhenBelow: 0,
    },
  ];

  const horizons = [
    { days: 365, label: "1yr" },
    { days: 730, label: "2yr" },
    { days: 1825, label: "5yr" },
  ];
  const driftLevels = [0, 5, -30];
  const vrpLevels = [10, 15];
  const models: PriceModel[] = ["gbm", "jump"];
  const volLevel = 60;

  const totalCombos = horizons.length * driftLevels.length * vrpLevels.length
    * models.length * strategies.length * 2;

  console.log(`Strategies: ${strategies.map(s => s.name).join(", ")}`);
  console.log(`Horizons: ${horizons.map(h => `${h.label} (${h.days}d)`).join(", ")}`);
  console.log(`Drift levels: ${driftLevels.map(d => fmtDrift(d) + "%").join(", ")}`);
  console.log(`VRP levels: ${vrpLevels.map(v => v + "%").join(", ")}`);
  console.log(`Models: ${models.join(", ")}`);
  console.log(`Vol: ${volLevel}% (Exp 3 sweet spot)`);
  console.log(`Configs per combo: 2 (RF ON optimal + RF OFF baseline)`);
  console.log(`Total combinations: ${totalCombos}`);
  console.log(`Paths per combo: ${numSims} | VRP: variable`);
  console.log(`Lookbacks: Conservative=45d (Exp 10), Moderate/Active=20d`);
  console.log(`skipSide: "put" | skipBelowRatio: Conservative=1.0, Moderate/Active=1.2\n`);

  const allResults: HorizonResult[] = [];
  let completed = 0;

  for (const hz of horizons) {
    for (const drift of driftLevels) {
      for (const vrp of vrpLevels) {
        for (const model of models) {
          for (const strat of strategies) {
            for (const rfEnabled of [true, false]) {
              const configLabel = rfEnabled ? "RF ON" : "RF OFF";
              const { marketConfig, strategyConfig } = buildConfigs(
                strat, volLevel, drift, model, vrp, hz.days, rfEnabled, baseMarket,
              );
              const result = runCombo(marketConfig, strategyConfig, numSims);
              const row = extractResult(
                model, drift, vrp, hz.days, hz.label,
                strat.name, configLabel, result,
              );
              allResults.push(row);

              completed++;
              if (completed % 5 === 0 || completed === totalCombos) {
                process.stdout.write(`  Progress: ${completed}/${totalCombos} (${(completed / totalCombos * 100).toFixed(0)}%)\r`);
              }
            }
          }
        }
      }
    }
  }

  console.log(`\nSweep complete: ${allResults.length} result rows.\n`);

  const rfOn = allResults.filter(r => r.configLabel === "RF ON");
  const rfOff = allResults.filter(r => r.configLabel === "RF OFF");

  // =======================================================
  // SECTION 1: Full Results Table
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 1: FULL RESULTS TABLE (RF ON — Optimal Configs) ===");
  console.log("=".repeat(120));
  console.log("All RF ON rows sorted by strategy → horizon → drift → VRP → model.\n");

  for (const strat of strategies) {
    console.log(`\n  ${strat.name} (lookback=${strat.lookback}d):`);
    const rows: any[] = [];
    for (const hz of horizons) {
      for (const drift of driftLevels) {
        for (const vrp of vrpLevels) {
          for (const model of models) {
            const r = rfOn.find(x =>
              x.strategy === strat.name && x.days === hz.days
              && x.drift === drift && x.vrp === vrp && x.model === model
            );
            if (r) {
              rows.push({
                "Horizon": hz.label,
                "Drift%": fmtDrift(drift),
                "VRP%": vrp,
                "Model": model,
                "Sharpe": fmt(r.sharpe, 3),
                "APR%": fmt(r.meanAPR),
                "p5APR%": fmt(r.p5APR),
                "MaxDD%": fmt(r.maxDD * 100, 1),
                "WinRate%": fmt(r.winRate * 100, 1),
                "Alpha%": fmtSign(r.alpha),
                "Skip%": fmt(r.skipPct, 1),
                "Cycles": fmt(r.avgExecCycles, 1),
              });
            }
          }
        }
      }
    }
    console.table(rows);
  }

  // =======================================================
  // SECTION 2: Horizon Stability
  // =======================================================
  console.log("\n" + "=".repeat(120));
  console.log("=== SECTION 2: HORIZON STABILITY ===");
  console.log("=".repeat(120));
  console.log("Sharpe, APR, MaxDD averaged across all drift × VRP × model combos at each horizon.");
  console.log("Core question: do metrics extrapolate linearly from 1yr?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const hz of horizons) {
      const subset = rfOn.filter(x =>
        x.strategy === strat.name && x.days === hz.days
      );
      const avgSharpe = avgField(subset, "sharpe");
      const avgAPR = avgField(subset, "meanAPR");
      const avgMaxDD = avgField(subset, "maxDD") * 100;
      const avgWin = avgField(subset, "winRate") * 100;
      const avgAlpha = avgField(subset, "alpha");
      const avgSkip = avgField(subset, "skipPct");
      const posCnt = subset.filter(r => r.sharpe > 0).length;

      rows.push({
        "Horizon": hz.label,
        "Avg Sharpe": fmt(avgSharpe, 3),
        "Avg APR%": fmt(avgAPR),
        "Avg MaxDD%": fmt(avgMaxDD, 1),
        "Avg WinRate%": fmt(avgWin, 1),
        "Avg Alpha%": fmtSign(avgAlpha),
        "Avg Skip%": fmt(avgSkip, 1),
        "Positive": `${posCnt}/${subset.length}`,
      });
    }
    console.table(rows);

    // Sharpe ratio: 1yr vs 5yr
    const yr1 = rfOn.filter(x => x.strategy === strat.name && x.days === 365);
    const yr5 = rfOn.filter(x => x.strategy === strat.name && x.days === 1825);
    const s1 = avgField(yr1, "sharpe");
    const s5 = avgField(yr5, "sharpe");
    const decay = s1 !== 0 ? ((s5 - s1) / Math.abs(s1)) * 100 : 0;
    console.log(`  Sharpe 1yr→5yr: ${fmt(s1, 3)} → ${fmt(s5, 3)} (${fmtSign(decay, 1)}% change)\n`);
  }

  // =======================================================
  // SECTION 3: Drift Immunity Over Time
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 3: DRIFT IMMUNITY OVER TIME ===");
  console.log("=".repeat(120));
  console.log("Active at −30% drift across horizons. Does compounding drawdown overwhelm premium?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const hz of horizons) {
      for (const drift of driftLevels) {
        const subset = rfOn.filter(x =>
          x.strategy === strat.name && x.days === hz.days && x.drift === drift
        );
        const avgSharpe = avgField(subset, "sharpe");
        const avgAPR = avgField(subset, "meanAPR");
        const avgMaxDD = avgField(subset, "maxDD") * 100;
        const avgWin = avgField(subset, "winRate") * 100;
        const avgAlpha = avgField(subset, "alpha");
        const posCnt = subset.filter(r => r.sharpe > 0).length;

        rows.push({
          "Horizon": hz.label,
          "Drift%": fmtDrift(drift),
          "Avg Sharpe": fmt(avgSharpe, 3),
          "Avg APR%": fmt(avgAPR),
          "Avg MaxDD%": fmt(avgMaxDD, 1),
          "Avg WinRate%": fmt(avgWin, 1),
          "Avg Alpha%": fmtSign(avgAlpha),
          "Positive": `${posCnt}/${subset.length}`,
        });
      }
    }
    console.table(rows);

    // Specific −30% drift analysis
    const bear1 = rfOn.filter(x => x.strategy === strat.name && x.days === 365 && x.drift === -30);
    const bear5 = rfOn.filter(x => x.strategy === strat.name && x.days === 1825 && x.drift === -30);
    const bs1 = avgField(bear1, "sharpe");
    const bs5 = avgField(bear5, "sharpe");
    const bd1 = avgField(bear1, "maxDD") * 100;
    const bd5 = avgField(bear5, "maxDD") * 100;
    console.log(`  Bear market (−30%) Sharpe: 1yr=${fmt(bs1, 3)} → 5yr=${fmt(bs5, 3)}`);
    console.log(`  Bear market (−30%) MaxDD: 1yr=${fmt(bd1, 1)}% → 5yr=${fmt(bd5, 1)}%`);
    if (bs5 > 0) {
      console.log(`  → SURVIVES: Positive Sharpe at 5yr even under sustained −30% drift.\n`);
    } else {
      console.log(`  → FAILS: Sharpe turns negative by 5yr under sustained −30% drift.\n`);
    }
  }

  // =======================================================
  // SECTION 4: VRP Sensitivity Over Time
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 4: VRP SENSITIVITY OVER TIME ===");
  console.log("=".repeat(120));
  console.log("Does the VRP=10% deployment floor hold at 5 years?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const hz of horizons) {
      for (const vrp of vrpLevels) {
        const subset = rfOn.filter(x =>
          x.strategy === strat.name && x.days === hz.days && x.vrp === vrp
        );
        const avgSharpe = avgField(subset, "sharpe");
        const avgAPR = avgField(subset, "meanAPR");
        const avgMaxDD = avgField(subset, "maxDD") * 100;
        const posCnt = subset.filter(r => r.sharpe > 0).length;

        rows.push({
          "Horizon": hz.label,
          "VRP%": vrp,
          "Avg Sharpe": fmt(avgSharpe, 3),
          "Avg APR%": fmt(avgAPR),
          "Avg MaxDD%": fmt(avgMaxDD, 1),
          "Positive": `${posCnt}/${subset.length}`,
        });
      }
    }
    console.table(rows);

    // VRP=10% at 5yr
    const vrp10_5yr = rfOn.filter(x =>
      x.strategy === strat.name && x.days === 1825 && x.vrp === 10
    );
    const vrp10s = avgField(vrp10_5yr, "sharpe");
    const posCnt = vrp10_5yr.filter(r => r.sharpe > 0).length;
    console.log(`  VRP=10% at 5yr: Sharpe=${fmt(vrp10s, 3)}, ${posCnt}/${vrp10_5yr.length} positive`);
    if (posCnt === vrp10_5yr.length) {
      console.log(`  → VRP=10% floor HOLDS at 5yr.\n`);
    } else if (vrp10s > 0) {
      console.log(`  → VRP=10% floor PARTIALLY holds (avg positive, some combos negative).\n`);
    } else {
      console.log(`  → VRP=10% floor BREAKS at 5yr.\n`);
    }
  }

  // =======================================================
  // SECTION 5: Model Stability (GBM vs Jump)
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 5: MODEL STABILITY (GBM vs Jump) ===");
  console.log("=".repeat(120));
  console.log("Do jump processes accumulate damage over 5 years?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const hz of horizons) {
      for (const model of models) {
        const subset = rfOn.filter(x =>
          x.strategy === strat.name && x.days === hz.days && x.model === model
        );
        const avgSharpe = avgField(subset, "sharpe");
        const avgAPR = avgField(subset, "meanAPR");
        const avgMaxDD = avgField(subset, "maxDD") * 100;

        rows.push({
          "Horizon": hz.label,
          "Model": model,
          "Avg Sharpe": fmt(avgSharpe, 3),
          "Avg APR%": fmt(avgAPR),
          "Avg MaxDD%": fmt(avgMaxDD, 1),
        });
      }
    }
    console.table(rows);

    // GBM-Jump gap at 1yr vs 5yr
    const gbm1 = rfOn.filter(x => x.strategy === strat.name && x.days === 365 && x.model === "gbm");
    const jump1 = rfOn.filter(x => x.strategy === strat.name && x.days === 365 && x.model === "jump");
    const gbm5 = rfOn.filter(x => x.strategy === strat.name && x.days === 1825 && x.model === "gbm");
    const jump5 = rfOn.filter(x => x.strategy === strat.name && x.days === 1825 && x.model === "jump");
    const gap1 = avgField(gbm1, "sharpe") - avgField(jump1, "sharpe");
    const gap5 = avgField(gbm5, "sharpe") - avgField(jump5, "sharpe");
    console.log(`  GBM-Jump Sharpe gap: 1yr=${fmtSign(gap1, 3)} → 5yr=${fmtSign(gap5, 3)}`);
    if (Math.abs(gap5) > Math.abs(gap1) * 1.5) {
      console.log(`  → Jump damage ACCELERATES over time.\n`);
    } else {
      console.log(`  → Jump damage is STABLE — gap does not widen materially.\n`);
    }
  }

  // =======================================================
  // SECTION 6: Regime Filter Durability
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 6: REGIME FILTER DURABILITY ===");
  console.log("=".repeat(120));
  console.log("RF ON vs OFF ΔSharpe by horizon. Does RF's advantage grow, shrink, or remain constant?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const hz of horizons) {
      const onSubset = rfOn.filter(x =>
        x.strategy === strat.name && x.days === hz.days
      );
      const offSubset = rfOff.filter(x =>
        x.strategy === strat.name && x.days === hz.days
      );
      const onSharpe = avgField(onSubset, "sharpe");
      const offSharpe = avgField(offSubset, "sharpe");
      const delta = onSharpe - offSharpe;

      const onWins = onSubset.filter((r, i) => {
        const matchOff = offSubset.find(x =>
          x.drift === r.drift && x.vrp === r.vrp && x.model === r.model
        );
        return matchOff ? r.sharpe > matchOff.sharpe : false;
      }).length;

      rows.push({
        "Horizon": hz.label,
        "RF ON Sharpe": fmt(onSharpe, 3),
        "RF OFF Sharpe": fmt(offSharpe, 3),
        "ΔSharpe": fmtSign(delta, 4),
        "RF Wins": `${onWins}/${onSubset.length}`,
      });
    }
    console.table(rows);

    // Trend analysis
    const deltas = horizons.map(hz => {
      const on = rfOn.filter(x => x.strategy === strat.name && x.days === hz.days);
      const off = rfOff.filter(x => x.strategy === strat.name && x.days === hz.days);
      return avgField(on, "sharpe") - avgField(off, "sharpe");
    });
    const trend = deltas[2] > deltas[0] * 1.1 ? "INCREASES"
      : deltas[2] < deltas[0] * 0.9 ? "DECREASES"
      : "STABLE";
    console.log(`  RF advantage trend: ${trend} (1yr=${fmtSign(deltas[0], 4)} → 5yr=${fmtSign(deltas[2], 4)})\n`);
  }

  // =======================================================
  // SECTION 7: MaxDD Evolution
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 7: MaxDD EVOLUTION ===");
  console.log("=".repeat(120));
  console.log("MaxDD vs horizon length. Linear growth? Saturating? Unbounded?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const hz of horizons) {
      for (const drift of driftLevels) {
        const subset = rfOn.filter(x =>
          x.strategy === strat.name && x.days === hz.days && x.drift === drift
        );
        const avgMaxDD = avgField(subset, "maxDD") * 100;
        const maxMaxDD = Math.max(...subset.map(r => r.maxDD * 100));

        rows.push({
          "Horizon": hz.label,
          "Drift%": fmtDrift(drift),
          "Avg MaxDD%": fmt(avgMaxDD, 1),
          "Worst MaxDD%": fmt(maxMaxDD, 1),
        });
      }
    }
    console.table(rows);

    // Growth analysis
    const dd1 = avgField(rfOn.filter(x => x.strategy === strat.name && x.days === 365), "maxDD") * 100;
    const dd2 = avgField(rfOn.filter(x => x.strategy === strat.name && x.days === 730), "maxDD") * 100;
    const dd5 = avgField(rfOn.filter(x => x.strategy === strat.name && x.days === 1825), "maxDD") * 100;
    const ratio2_1 = dd1 > 0 ? dd2 / dd1 : 0;
    const ratio5_1 = dd1 > 0 ? dd5 / dd1 : 0;
    console.log(`  MaxDD growth: 1yr=${fmt(dd1, 1)}% → 2yr=${fmt(dd2, 1)}% (${fmt(ratio2_1, 2)}×) → 5yr=${fmt(dd5, 1)}% (${fmt(ratio5_1, 2)}×)`);
    if (ratio5_1 < 1.5) {
      console.log(`  → SATURATING: MaxDD grows sub-linearly. Premium income offsets tail events.\n`);
    } else if (ratio5_1 < 3.0) {
      console.log(`  → LINEAR: MaxDD grows roughly linearly with horizon.\n`);
    } else {
      console.log(`  → ACCELERATING: MaxDD grows faster than linearly. Compounding risk.\n`);
    }
  }

  // =======================================================
  // SECTION 8: Skip Rate Stability
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 8: SKIP RATE STABILITY ===");
  console.log("=".repeat(120));
  console.log("Do skip rates drift over longer simulations?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const hz of horizons) {
      const subset = rfOn.filter(x =>
        x.strategy === strat.name && x.days === hz.days
      );
      const avgSkip = avgField(subset, "skipPct");
      const avgCycles = avgField(subset, "avgTotalCycles");
      const avgExec = avgField(subset, "avgExecCycles");

      rows.push({
        "Horizon": hz.label,
        "Avg Skip%": fmt(avgSkip, 1),
        "Avg Total Cycles": fmt(avgCycles, 1),
        "Avg Exec Cycles": fmt(avgExec, 1),
      });
    }
    console.table(rows);

    // Skip rate variance
    const s1 = avgField(rfOn.filter(x => x.strategy === strat.name && x.days === 365), "skipPct");
    const s5 = avgField(rfOn.filter(x => x.strategy === strat.name && x.days === 1825), "skipPct");
    console.log(`  Skip rate: 1yr=${fmt(s1, 1)}% → 5yr=${fmt(s5, 1)}% (Δ=${fmtSign(s5 - s1, 1)}pp)\n`);
  }

  // =======================================================
  // SECTION 9: Recommendations
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 9: RECOMMENDATIONS ===");
  console.log("=".repeat(120) + "\n");

  console.log("--- HORIZON VERDICT BY STRATEGY ---\n");

  for (const strat of strategies) {
    console.log(`  ${strat.name}:`);

    // Check all horizons
    for (const hz of horizons) {
      const subset = rfOn.filter(x => x.strategy === strat.name && x.days === hz.days);
      const avgSharpe = avgField(subset, "sharpe");
      const posCnt = subset.filter(r => r.sharpe > 0).length;
      const avgMaxDD = avgField(subset, "maxDD") * 100;
      const avgAPR = avgField(subset, "meanAPR");

      const bearSubset = subset.filter(x => x.drift === -30);
      const bearSharpe = avgField(bearSubset, "sharpe");
      const bearPos = bearSubset.filter(r => r.sharpe > 0).length;

      console.log(`    ${hz.label}: Sharpe=${fmt(avgSharpe, 3)}, APR=${fmt(avgAPR)}%, MaxDD=${fmt(avgMaxDD, 1)}%, Positive=${posCnt}/${subset.length}`);
      console.log(`      Bear (−30%): Sharpe=${fmt(bearSharpe, 3)}, Positive=${bearPos}/${bearSubset.length}`);
    }

    // Overall verdict
    const yr5 = rfOn.filter(x => x.strategy === strat.name && x.days === 1825);
    const yr5Sharpe = avgField(yr5, "sharpe");
    const yr5Pos = yr5.filter(r => r.sharpe > 0).length;

    if (yr5Pos === yr5.length) {
      console.log(`    → VERDICT: ✓ FULLY VIABLE at 5yr. All conditions positive.\n`);
    } else if (yr5Sharpe > 0) {
      console.log(`    → VERDICT: ~ MOSTLY VIABLE at 5yr. Avg Sharpe positive, ${yr5Pos}/${yr5.length} combos.\n`);
    } else {
      console.log(`    → VERDICT: ✗ NOT VIABLE at 5yr. Avg Sharpe negative.\n`);
    }
  }

  // Active drift immunity check
  console.log("--- ACTIVE DRIFT IMMUNITY CHECK ---\n");
  const activeBear5 = rfOn.filter(x =>
    x.strategy === "Active (δ0.20/3d)" && x.days === 1825 && x.drift === -30
  );
  const abSharpe = avgField(activeBear5, "sharpe");
  const abAPR = avgField(activeBear5, "meanAPR");
  const abMaxDD = avgField(activeBear5, "maxDD") * 100;
  const abPos = activeBear5.filter(r => r.sharpe > 0).length;

  console.log(`  Active at −30% drift / 5yr:`);
  console.log(`    Sharpe: ${fmt(abSharpe, 3)}`);
  console.log(`    APR: ${fmt(abAPR)}%`);
  console.log(`    MaxDD: ${fmt(abMaxDD, 1)}%`);
  console.log(`    Positive: ${abPos}/${activeBear5.length}`);

  if (abSharpe > 0) {
    console.log(`    → Active's drift immunity SURVIVES sustained 5yr bear market.\n`);
  } else {
    console.log(`    → Active's drift immunity BREAKS under sustained 5yr decline.\n`);
  }

  // Overall summary
  console.log("--- OVERALL FINDINGS ---\n");

  const allPositive = rfOn.filter(r => r.sharpe > 0).length;
  console.log(`  Total positive Sharpe combos: ${allPositive}/${rfOn.length} (${fmt(allPositive / rfOn.length * 100, 1)}%)\n`);

  // RF universality check
  let rfWins = 0;
  let rfTotal = 0;
  for (const r of rfOn) {
    const matchOff = rfOff.find(x =>
      x.strategy === r.strategy && x.days === r.days && x.drift === r.drift
      && x.vrp === r.vrp && x.model === r.model
    );
    if (matchOff) {
      rfTotal++;
      if (r.sharpe > matchOff.sharpe) rfWins++;
    }
  }
  console.log(`  RF wins: ${rfWins}/${rfTotal} (${fmt(rfWins / rfTotal * 100, 1)}%)`);
  if (rfWins === rfTotal) {
    console.log(`  → RF is UNIVERSALLY BENEFICIAL across all horizons.\n`);
  } else if (rfWins > rfTotal * 0.9) {
    console.log(`  → RF is NEARLY UNIVERSAL — a few edge cases where RF OFF is better.\n`);
  } else {
    console.log(`  → RF advantage is HORIZON-DEPENDENT.\n`);
  }

  console.log("\n=== END OF EXPERIMENT 12 ===\n");
}

main().catch(console.error);
