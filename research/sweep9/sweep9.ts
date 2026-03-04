import { defaultMarketValues, defaultStrategyValues } from "../../src/components/presets.ts";
import { runMonteCarlo } from "../../src/components/monte-carlo.ts";
import type { PriceModel } from "../../src/components/price-gen.ts";

interface StrategyProfile {
  name: string;
  delta: number;
  cycle: number;
  skipThreshold: number;
  adaptiveCalls: boolean;
  putRollEnabled: boolean;
  putRollInitialDTE: number;
  putRollWhenBelow: number;
}

interface ModelResult {
  model: PriceModel;
  drift: number;
  vol: number;
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
}

function buildConfigs(
  strat: StrategyProfile,
  vol: number,
  drift: number,
  model: PriceModel,
  baseMarket: ReturnType<typeof defaultMarketValues>,
  useRegimeFilter: boolean,
) {
  const annualVolDec = vol / 100;
  const vrpPremiumPct = 15;
  const base = defaultStrategyValues();

  const hestonTheta = annualVolDec * annualVolDec;

  const marketConfig: any = {
    ...baseMarket,
    startPrice: baseMarket.startPrice,
    annualVol: annualVolDec,
    annualDrift: drift / 100,
    model,
    days: 365,
    numSimulations: 1000,
    heston: {
      kappa: baseMarket.kappa,
      theta: hestonTheta,
      sigma: baseMarket.sigma,
      rho: baseMarket.rho,
      v0: hestonTheta,
    },
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
      lookbackDays: 20,
      minMultiplier: 0.8,
      maxMultiplier: 1.3,
      ...(useRegimeFilter ? {
        skipBelowRatio: strat.skipThreshold,
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
  vol: number,
  stratName: string,
  configLabel: string,
  result: { runs: any[]; medianAPR: number; p5APR: number },
): ModelResult {
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
    vol,
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
  };
}

async function main() {
  console.log("=== Experiment 9: Model Robustness ===");
  console.log("Goal: Test whether the Exp 6 optimal configs remain viable across all 4 price models.");
  console.log("      All prior experiments used GBM only. This is the single largest remaining blind spot.\n");

  const baseMarket = defaultMarketValues();
  const numSims = 1000;

  const strategies: StrategyProfile[] = [
    {
      name: "Conservative (δ0.10/30d)",
      delta: 0.10, cycle: 30, skipThreshold: 1.0,
      adaptiveCalls: true,
      putRollEnabled: true, putRollInitialDTE: 30, putRollWhenBelow: 14,
    },
    {
      name: "Moderate (δ0.20/14d)",
      delta: 0.20, cycle: 14, skipThreshold: 1.2,
      adaptiveCalls: false,
      putRollEnabled: true, putRollInitialDTE: 14, putRollWhenBelow: 7,
    },
    {
      name: "Active (δ0.20/3d)",
      delta: 0.20, cycle: 3, skipThreshold: 1.2,
      adaptiveCalls: false,
      putRollEnabled: false, putRollInitialDTE: 0, putRollWhenBelow: 0,
    },
  ];

  const models: PriceModel[] = ["gbm", "heston", "jump", "heston-jump"];
  const volLevels = [40, 60, 80];
  const driftLevels = [5, 0, -30];

  const totalCombos = models.length * volLevels.length * driftLevels.length * strategies.length * 2;

  console.log(`Strategies: ${strategies.map(s => s.name).join(", ")}`);
  console.log(`Models: ${models.join(", ")}`);
  console.log(`Vol levels: ${volLevels.map(v => v + "%").join(", ")}`);
  console.log(`Drift levels: ${driftLevels.map(d => (d >= 0 ? "+" : "") + d + "%").join(", ")}`);
  console.log(`Configs per strategy: Optimal (RF ON) + Baseline (RF OFF) = 2`);
  console.log(`Total unique combinations: ${totalCombos}`);
  console.log(`Paths per combo: ${numSims} | Days: 365 | VRP: 15%`);
  console.log(`Heston params: κ=${baseMarket.kappa}, σ=${baseMarket.sigma}, ρ=${baseMarket.rho}, θ=vol² (dynamic)`);
  console.log(`Jump params: λ=${baseMarket.lambda}, μJ=${baseMarket.muJ}, σJ=${baseMarket.sigmaJ}`);
  console.log(`IV model (GBM/Jump): Stochastic OU (κ=${baseMarket.ivMeanReversion}, ξ=${baseMarket.ivVolOfVol}, VRP=15%)`);
  console.log(`IV model (Heston/Heston-Jump): From variance process √v\n`);

  let completed = 0;
  const allResults: ModelResult[] = [];

  for (const model of models) {
    for (const drift of driftLevels) {
      for (const vol of volLevels) {
        for (const strat of strategies) {
          for (const useRF of [true, false]) {
            const configLabel = useRF ? "Optimal" : "No-RF Baseline";

            const { marketConfig, strategyConfig } = buildConfigs(
              strat, vol, drift, model, baseMarket, useRF,
            );

            const result = runCombo(marketConfig, strategyConfig, numSims);
            const row = extractResult(model, drift, vol, strat.name, configLabel, result);
            allResults.push(row);

            completed++;
            if (completed % 10 === 0 || completed === totalCombos) {
              process.stdout.write(`  Progress: ${completed}/${totalCombos} (${(completed / totalCombos * 100).toFixed(0)}%)\r`);
            }
          }
        }
      }
    }
  }

  console.log(`\nSweep complete: ${allResults.length} result rows.\n`);

  // =======================================================
  // SECTION 1: Model × Strategy Sharpe Heatmap
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 1: MODEL × STRATEGY SHARPE HEATMAP ===");
  console.log("=".repeat(110));
  console.log("Sharpe averaged over vol and drift for each model × strategy (Optimal config). Quick overview.\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const model of models) {
      const row: any = { "Model": model };
      let totalSharpe = 0, totalAPR = 0, totalMaxDD = 0, totalWinRate = 0, count = 0;

      for (const drift of driftLevels) {
        for (const vol of volLevels) {
          const r = allResults.find(x =>
            x.strategy === strat.name && x.model === model && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
          );
          if (r) {
            totalSharpe += r.sharpe;
            totalAPR += r.meanAPR;
            totalMaxDD += r.maxDD;
            totalWinRate += r.winRate;
            count++;
          }
        }
      }

      row["Avg Sharpe"] = count > 0 ? (totalSharpe / count).toFixed(3) : "n/a";
      row["Avg APR%"] = count > 0 ? (totalAPR / count).toFixed(2) : "n/a";
      row["Avg MaxDD%"] = count > 0 ? ((totalMaxDD / count) * 100).toFixed(1) : "n/a";
      row["Avg WinRate%"] = count > 0 ? ((totalWinRate / count) * 100).toFixed(1) : "n/a";
      rows.push(row);
    }

    console.table(rows);
  }
  console.log();

  // =======================================================
  // SECTION 2: Model × Vol Breakdown (at drift=+5%)
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 2: MODEL × VOL BREAKDOWN (DRIFT=+5%) ===");
  console.log("=".repeat(110));
  console.log("Per-strategy Sharpe at each vol level by model. Tests vol boundary shifts under different dynamics.\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const model of models) {
      const row: any = { "Model": model };
      for (const vol of volLevels) {
        const r = allResults.find(x =>
          x.strategy === strat.name && x.model === model && x.drift === 5 && x.vol === vol && x.configLabel === "Optimal"
        );
        row[`Sharpe@${vol}%`] = r ? r.sharpe.toFixed(3) : "n/a";
        row[`APR@${vol}%`] = r ? r.meanAPR.toFixed(2) + "%" : "n/a";
        row[`MaxDD@${vol}%`] = r ? (r.maxDD * 100).toFixed(1) + "%" : "n/a";
      }
      rows.push(row);
    }
    console.table(rows);
  }
  console.log();

  // =======================================================
  // SECTION 3: Regime Filter Value by Model
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 3: REGIME FILTER VALUE BY MODEL ===");
  console.log("=".repeat(110));
  console.log("ΔSharpe (Optimal − Baseline) per model × strategy. Does Heston's bursty vol degrade RF?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    let totalRFWins = 0, totalRFLosses = 0, totalCombosRF = 0;

    for (const model of models) {
      const row: any = { "Model": model };
      let rfWins = 0, rfLosses = 0, sumDelta = 0, combos = 0;

      for (const drift of driftLevels) {
        for (const vol of volLevels) {
          const optimal = allResults.find(x =>
            x.strategy === strat.name && x.model === model && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
          );
          const baseline = allResults.find(x =>
            x.strategy === strat.name && x.model === model && x.drift === drift && x.vol === vol && x.configLabel === "No-RF Baseline"
          );
          if (!optimal || !baseline) continue;

          const d = optimal.sharpe - baseline.sharpe;
          if (d > 0) { rfWins++; totalRFWins++; }
          else { rfLosses++; totalRFLosses++; }
          sumDelta += d;
          combos++;
          totalCombosRF++;
        }
      }

      row["RF Wins"] = `${rfWins}/${combos}`;
      row["Mean ΔSharpe"] = combos > 0 ? `${(sumDelta / combos) > 0 ? "+" : ""}${(sumDelta / combos).toFixed(4)}` : "n/a";
      rows.push(row);
    }

    console.table(rows);
    console.log(`  Total RF wins: ${totalRFWins}/${totalCombosRF} (${((totalRFWins / totalCombosRF) * 100).toFixed(0)}%)\n`);
  }

  // Detail: RF ΔSharpe by model × drift × vol
  console.log("--- DETAILED RF ΔSharpe BY MODEL × DRIFT × VOL ---\n");
  for (const strat of strategies) {
    console.log(`${strat.name}:`);
    for (const drift of driftLevels) {
      const rows: any[] = [];
      for (const model of models) {
        const row: any = { "Model": model };
        for (const vol of volLevels) {
          const optimal = allResults.find(x =>
            x.strategy === strat.name && x.model === model && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
          );
          const baseline = allResults.find(x =>
            x.strategy === strat.name && x.model === model && x.drift === drift && x.vol === vol && x.configLabel === "No-RF Baseline"
          );
          if (optimal && baseline) {
            const d = optimal.sharpe - baseline.sharpe;
            row[`Δ@${vol}%`] = `${d > 0 ? "+" : ""}${d.toFixed(3)}`;
          }
        }
        rows.push(row);
      }
      console.log(`  Drift: ${drift >= 0 ? "+" : ""}${drift}%`);
      console.table(rows);
    }
    console.log();
  }

  // =======================================================
  // SECTION 4: Drift Immunity Under Non-GBM Models
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 4: DRIFT IMMUNITY UNDER NON-GBM MODELS ===");
  console.log("=".repeat(110));
  console.log("Does Active remain Sharpe-positive at drift=−30% across all models?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const model of models) {
      const row: any = { "Model": model };
      let posCount = 0, totalCount = 0;

      for (const vol of volLevels) {
        const r = allResults.find(x =>
          x.strategy === strat.name && x.model === model && x.drift === -30 && x.vol === vol && x.configLabel === "Optimal"
        );
        if (r) {
          row[`Sharpe@${vol}%`] = r.sharpe.toFixed(3);
          row[`APR@${vol}%`] = r.meanAPR.toFixed(2) + "%";
          row[`Alpha@${vol}%`] = (r.alpha > 0 ? "+" : "") + r.alpha.toFixed(2) + "%";
          if (r.sharpe > 0) posCount++;
          totalCount++;
        }
      }
      row["Positive"] = `${posCount}/${totalCount}`;
      rows.push(row);
    }
    console.table(rows);

    const allModels = allResults.filter(x =>
      x.strategy === strat.name && x.drift === -30 && x.configLabel === "Optimal"
    );
    const totalPos = allModels.filter(r => r.sharpe > 0).length;
    console.log(`  Drift immunity: ${totalPos}/${allModels.length} combos with Sharpe > 0 at drift=−30%\n`);
  }

  // Per-drift × per-model breakdown for all strategies
  console.log("--- FULL DRIFT × MODEL SHARPE TABLE ---\n");
  for (const strat of strategies) {
    console.log(`${strat.name}:`);
    for (const drift of driftLevels) {
      const rows: any[] = [];
      for (const model of models) {
        const row: any = { "Model": model };
        for (const vol of volLevels) {
          const r = allResults.find(x =>
            x.strategy === strat.name && x.model === model && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
          );
          row[`Sharpe@${vol}%`] = r ? r.sharpe.toFixed(3) : "n/a";
        }
        rows.push(row);
      }
      console.log(`  Drift: ${drift >= 0 ? "+" : ""}${drift}%`);
      console.table(rows);
    }
    console.log();
  }

  // =======================================================
  // SECTION 5: Cycle Behavior by Model
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 5: CYCLE BEHAVIOR BY MODEL ===");
  console.log("=".repeat(110));
  console.log("Skip rate, executed cycles, win rate, put rolls by model. Does Heston cause burst-skipping?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} (Optimal / RF ON) ---`);
    const rows: any[] = [];

    for (const model of models) {
      const subset = allResults.filter(x =>
        x.strategy === strat.name && x.model === model && x.configLabel === "Optimal"
      );
      const avgSkipPct = subset.reduce((a, r) => a + r.skipPct, 0) / subset.length;
      const avgExecCycles = subset.reduce((a, r) => a + (r.avgTotalCycles - r.avgSkippedCycles), 0) / subset.length;
      const avgTotalCycles = subset.reduce((a, r) => a + r.avgTotalCycles, 0) / subset.length;
      const avgWinRate = subset.reduce((a, r) => a + r.winRate, 0) / subset.length;
      const avgPutRolls = subset.reduce((a, r) => a + r.avgPutRolls, 0) / subset.length;

      rows.push({
        "Model": model,
        "Avg Skip%": avgSkipPct.toFixed(1),
        "Avg Exec Cycles": avgExecCycles.toFixed(1),
        "Avg Total Cycles": avgTotalCycles.toFixed(1),
        "Avg Win Rate%": (avgWinRate * 100).toFixed(1),
        "Avg Put Rolls": avgPutRolls.toFixed(2),
      });
    }
    console.table(rows);
  }

  // Per-vol detail
  console.log("\n--- SKIP RATE BY MODEL × VOL (Drift=+5%) ---\n");
  for (const strat of strategies) {
    console.log(`${strat.name}:`);
    const rows: any[] = [];
    for (const model of models) {
      const row: any = { "Model": model };
      for (const vol of volLevels) {
        const r = allResults.find(x =>
          x.strategy === strat.name && x.model === model && x.drift === 5 && x.vol === vol && x.configLabel === "Optimal"
        );
        if (r) {
          row[`Skip@${vol}%`] = r.skipPct.toFixed(1) + "%";
          row[`Exec@${vol}%`] = (r.avgTotalCycles - r.avgSkippedCycles).toFixed(1);
        }
      }
      rows.push(row);
    }
    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 6: Drawdown Analysis
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 6: DRAWDOWN ANALYSIS BY MODEL ===");
  console.log("=".repeat(110));
  console.log("MaxDD by model × vol × strategy. Do jump processes create deeper drawdown tails?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} (Optimal) ---`);
    for (const drift of driftLevels) {
      const rows: any[] = [];
      for (const model of models) {
        const row: any = { "Model": model };
        for (const vol of volLevels) {
          const r = allResults.find(x =>
            x.strategy === strat.name && x.model === model && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
          );
          row[`MaxDD@${vol}%`] = r ? (r.maxDD * 100).toFixed(1) + "%" : "n/a";
        }
        rows.push(row);
      }
      console.log(`  Drift: ${drift >= 0 ? "+" : ""}${drift}%`);
      console.table(rows);
    }
    console.log();
  }

  // Avg MaxDD per model across all combos
  console.log("--- AVG MAX DRAWDOWN BY MODEL (Optimal, across all drift×vol) ---\n");
  const ddRows: any[] = [];
  for (const model of models) {
    const row: any = { "Model": model };
    for (const strat of strategies) {
      const subset = allResults.filter(x =>
        x.strategy === strat.name && x.model === model && x.configLabel === "Optimal"
      );
      const avgDD = subset.reduce((a, r) => a + r.maxDD, 0) / subset.length;
      row[strat.name.split("(")[0].trim()] = (avgDD * 100).toFixed(1) + "%";
    }
    ddRows.push(row);
  }
  console.table(ddRows);
  console.log();

  // =======================================================
  // SECTION 7: GBM Validation (Control)
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 7: GBM VALIDATION (CONTROL) ===");
  console.log("=".repeat(110));
  console.log("GBM results should approximately match Exp 7 at drift=+5%/0%/−30% and Exp 3 at drift=+5%.\n");

  console.log("--- GBM Results (Optimal) ---\n");
  for (const strat of strategies) {
    console.log(`${strat.name}:`);
    const rows: any[] = [];
    for (const drift of driftLevels) {
      for (const vol of volLevels) {
        const r = allResults.find(x =>
          x.strategy === strat.name && x.model === "gbm" && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
        );
        if (r) {
          rows.push({
            "Drift%": (drift >= 0 ? "+" : "") + drift,
            "Vol%": vol,
            "Sharpe": r.sharpe.toFixed(3),
            "APR%": r.meanAPR.toFixed(2),
            "MaxDD%": (r.maxDD * 100).toFixed(1),
            "WinRate%": (r.winRate * 100).toFixed(1),
            "Alpha%": (r.alpha > 0 ? "+" : "") + r.alpha.toFixed(2),
            "Skip%": r.skipPct.toFixed(1),
          });
        }
      }
    }
    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 8: Summary & Deployment Impact
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 8: SUMMARY & DEPLOYMENT IMPACT ===");
  console.log("=".repeat(110) + "\n");

  // Overall model comparison
  console.log("--- OVERALL MODEL COMPARISON (Optimal configs) ---\n");
  for (const strat of strategies) {
    console.log(`${strat.name}:`);
    for (const model of models) {
      const subset = allResults.filter(r =>
        r.strategy === strat.name && r.model === model && r.configLabel === "Optimal"
      );
      const avgSharpe = subset.reduce((a, r) => a + r.sharpe, 0) / subset.length;
      const avgAPR = subset.reduce((a, r) => a + r.meanAPR, 0) / subset.length;
      const avgMaxDD = subset.reduce((a, r) => a + r.maxDD, 0) / subset.length;
      const avgWinRate = subset.reduce((a, r) => a + r.winRate, 0) / subset.length;
      const posCount = subset.filter(r => r.sharpe > 0).length;

      console.log(`  ${model.padEnd(12)}: Sharpe=${avgSharpe.toFixed(3)}, APR=${avgAPR.toFixed(2)}%, MaxDD=${(avgMaxDD * 100).toFixed(1)}%, WinRate=${(avgWinRate * 100).toFixed(1)}%, Positive=${posCount}/${subset.length}`);
    }
    console.log();
  }

  // Model ranking by Sharpe
  console.log("--- MODEL RANKING BY AVG SHARPE (across all strategies) ---\n");
  const modelAvgs = models.map(model => {
    const subset = allResults.filter(r => r.model === model && r.configLabel === "Optimal");
    const avgSharpe = subset.reduce((a, r) => a + r.sharpe, 0) / subset.length;
    const posCount = subset.filter(r => r.sharpe > 0).length;
    return { model, avgSharpe, posCount, total: subset.length };
  }).sort((a, b) => b.avgSharpe - a.avgSharpe);

  for (const m of modelAvgs) {
    console.log(`  ${m.model.padEnd(12)}: Avg Sharpe=${m.avgSharpe.toFixed(3)}, Positive=${m.posCount}/${m.total}`);
  }

  // GBM vs each model delta
  console.log("\n--- SHARPE DELTA VS GBM (per strategy × model) ---\n");
  for (const strat of strategies) {
    const gbmSubset = allResults.filter(r =>
      r.strategy === strat.name && r.model === "gbm" && r.configLabel === "Optimal"
    );
    const gbmAvgSharpe = gbmSubset.reduce((a, r) => a + r.sharpe, 0) / gbmSubset.length;

    console.log(`${strat.name} (GBM baseline Sharpe: ${gbmAvgSharpe.toFixed(3)}):`);

    for (const model of models) {
      if (model === "gbm") continue;
      const subset = allResults.filter(r =>
        r.strategy === strat.name && r.model === model && r.configLabel === "Optimal"
      );
      const avgSharpe = subset.reduce((a, r) => a + r.sharpe, 0) / subset.length;
      const delta = avgSharpe - gbmAvgSharpe;
      console.log(`  ${model.padEnd(12)}: Sharpe=${avgSharpe.toFixed(3)}, ΔvsGBM=${delta > 0 ? "+" : ""}${delta.toFixed(3)} (${((delta / Math.abs(gbmAvgSharpe)) * 100).toFixed(1)}%)`);
    }
    console.log();
  }

  // RF universality check across models
  console.log("--- RF UNIVERSALITY CHECK ACROSS MODELS ---\n");
  for (const model of models) {
    let wins = 0, losses = 0;
    for (const strat of strategies) {
      for (const drift of driftLevels) {
        for (const vol of volLevels) {
          const opt = allResults.find(x =>
            x.strategy === strat.name && x.model === model && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
          );
          const base = allResults.find(x =>
            x.strategy === strat.name && x.model === model && x.drift === drift && x.vol === vol && x.configLabel === "No-RF Baseline"
          );
          if (opt && base) {
            if (opt.sharpe > base.sharpe) wins++;
            else losses++;
          }
        }
      }
    }
    console.log(`  ${model.padEnd(12)}: RF wins ${wins}/${wins + losses} (${((wins / (wins + losses)) * 100).toFixed(0)}%)`);
  }

  // Active drift immunity per model
  console.log("\n--- ACTIVE DRIFT IMMUNITY PER MODEL ---\n");
  console.log("Exp 7 showed Active is drift-immune at VRP=15% under GBM. Per-model check:\n");
  for (const model of models) {
    const subset = allResults.filter(x =>
      x.strategy === "Active (δ0.20/3d)" && x.model === model && x.configLabel === "Optimal"
    );
    const posCount = subset.filter(r => r.sharpe > 0).length;
    const allPos = subset.every(r => r.sharpe > 0);
    const driftNeg30 = subset.filter(r => r.drift === -30);
    const negDriftPos = driftNeg30.filter(r => r.sharpe > 0).length;

    console.log(`  ${model.padEnd(12)}: ${allPos ? "DRIFT-IMMUNE ✓" : `NOT IMMUNE ✗ (${posCount}/${subset.length})`} | At drift=−30%: ${negDriftPos}/${driftNeg30.length} positive`);

    if (!allPos) {
      const negatives = subset.filter(r => r.sharpe <= 0);
      for (const n of negatives) {
        console.log(`    FAIL: drift=${n.drift >= 0 ? "+" : ""}${n.drift}%, vol=${n.vol}% → Sharpe=${n.sharpe.toFixed(3)}, APR=${n.meanAPR.toFixed(2)}%`);
      }
    }
  }

  // "All-weather" claim validation
  console.log("\n--- 'ALL-WEATHER' CLAIM VALIDATION ---\n");
  console.log("For the Active strategy to be all-weather, it must have Sharpe > 0 at ALL model × drift × vol combos.\n");

  const activeOptimal = allResults.filter(r =>
    r.strategy === "Active (δ0.20/3d)" && r.configLabel === "Optimal"
  );
  const activeAllPositive = activeOptimal.every(r => r.sharpe > 0);
  const activePositiveCount = activeOptimal.filter(r => r.sharpe > 0).length;

  console.log(`  Active: ${activePositiveCount}/${activeOptimal.length} combos with Sharpe > 0`);
  console.log(`  Verdict: ${activeAllPositive ? "ALL-WEATHER CONFIRMED ✓" : "ALL-WEATHER REQUIRES QUALIFICATION ✗"}`);

  if (!activeAllPositive) {
    console.log("\n  Failing conditions:");
    const failures = activeOptimal.filter(r => r.sharpe <= 0)
      .sort((a, b) => a.sharpe - b.sharpe);
    for (const f of failures) {
      console.log(`    ${f.model} / drift=${f.drift >= 0 ? "+" : ""}${f.drift}% / vol=${f.vol}% → Sharpe=${f.sharpe.toFixed(3)}, APR=${f.meanAPR.toFixed(2)}%`);
    }
  }

  // Worst-case analysis per model
  console.log("\n--- WORST-CASE ANALYSIS PER MODEL (Optimal configs) ---\n");
  for (const strat of strategies) {
    console.log(`${strat.name}:`);
    for (const model of models) {
      const subset = allResults.filter(r =>
        r.strategy === strat.name && r.model === model && r.configLabel === "Optimal"
      );
      const worst = subset.reduce((a, b) => a.sharpe < b.sharpe ? a : b);
      const best = subset.reduce((a, b) => a.sharpe > b.sharpe ? a : b);

      console.log(`  ${model.padEnd(12)}: Worst=${worst.sharpe.toFixed(3)} (drift=${worst.drift >= 0 ? "+" : ""}${worst.drift}%, vol=${worst.vol}%) | Best=${best.sharpe.toFixed(3)} (drift=${best.drift >= 0 ? "+" : ""}${best.drift}%, vol=${best.vol}%)`);
    }
    console.log();
  }

  console.log("=== END OF EXPERIMENT 9 ===\n");
}

main().catch(console.error);
