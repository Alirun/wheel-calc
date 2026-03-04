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

interface LookbackResult {
  model: PriceModel;
  drift: number;
  vol: number;
  strategy: string;
  lookback: number;
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
  execWinRate: number;
}

function buildConfigs(
  strat: StrategyProfile,
  vol: number,
  drift: number,
  model: PriceModel,
  lookback: number,
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
      lookbackDays: lookback,
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
  lookback: number,
  configLabel: string,
  result: { runs: any[]; medianAPR: number; p5APR: number },
): LookbackResult {
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

  const winsCount = runs.filter((r: any) => r.isWin).length;
  const execWinRate = avgFullCycles > 0 ? winsCount / count : 0;

  return {
    model,
    drift,
    vol,
    strategy: stratName,
    lookback,
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
    execWinRate,
  };
}

async function main() {
  console.log("=== Experiment 10: Lookback × Cycle Interaction ===");
  console.log("Goal: Determine whether tuning IV/RV lookbackDays (currently hardcoded at 20) can:");
  console.log("      (a) Improve risk-adjusted returns under GBM");
  console.log("      (b) Recover positive Sharpe under Heston (critical path from Exp 9)\n");

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

  const models: PriceModel[] = ["gbm", "heston"];
  const lookbackValues = [5, 10, 15, 20, 30, 45, 60];
  const volLevels = [40, 60];
  const driftLevels = [0, -30];

  const totalCombos = models.length * lookbackValues.length * volLevels.length * driftLevels.length * strategies.length * 2;

  console.log(`Strategies: ${strategies.map(s => s.name).join(", ")}`);
  console.log(`Models: ${models.join(", ")}`);
  console.log(`Lookback values: ${lookbackValues.join(", ")} days`);
  console.log(`Vol levels: ${volLevels.map(v => v + "%").join(", ")}`);
  console.log(`Drift levels: ${driftLevels.map(d => (d >= 0 ? "+" : "") + d + "%").join(", ")}`);
  console.log(`Configs per strategy: Optimal (RF ON) + Baseline (RF OFF) = 2`);
  console.log(`Total unique combinations: ${totalCombos}`);
  console.log(`Paths per combo: ${numSims} | Days: 365 | VRP: 15%`);
  console.log(`Heston params: κ=${baseMarket.kappa}, σ=${baseMarket.sigma}, ρ=${baseMarket.rho}, θ=vol² (dynamic)`);
  console.log(`GBM IV model: Stochastic OU (κ=${baseMarket.ivMeanReversion}, ξ=${baseMarket.ivVolOfVol}, VRP=15%)`);
  console.log(`Heston IV model: From variance process √v\n`);

  let completed = 0;
  const allResults: LookbackResult[] = [];

  for (const model of models) {
    for (const drift of driftLevels) {
      for (const vol of volLevels) {
        for (const strat of strategies) {
          for (const lookback of lookbackValues) {
            for (const useRF of [true, false]) {
              const configLabel = useRF ? "Optimal" : "No-RF Baseline";

              const { marketConfig, strategyConfig } = buildConfigs(
                strat, vol, drift, model, lookback, baseMarket, useRF,
              );

              const result = runCombo(marketConfig, strategyConfig, numSims);
              const row = extractResult(model, drift, vol, strat.name, lookback, configLabel, result);
              allResults.push(row);

              completed++;
              if (completed % 20 === 0 || completed === totalCombos) {
                process.stdout.write(`  Progress: ${completed}/${totalCombos} (${(completed / totalCombos * 100).toFixed(0)}%)\r`);
              }
            }
          }
        }
      }
    }
  }

  console.log(`\nSweep complete: ${allResults.length} result rows.\n`);

  // =======================================================
  // SECTION 1: Full Results Table
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 1: FULL RESULTS TABLE ===");
  console.log("=".repeat(120));
  console.log("All 336 rows sorted by model → strategy → drift → vol → lookback. RF ON (Optimal) configs only.\n");

  for (const model of models) {
    console.log(`\n--- Model: ${model.toUpperCase()} ---\n`);
    for (const strat of strategies) {
      console.log(`  ${strat.name}:`);
      const rows: any[] = [];
      for (const drift of driftLevels) {
        for (const vol of volLevels) {
          for (const lookback of lookbackValues) {
            const r = allResults.find(x =>
              x.strategy === strat.name && x.model === model && x.drift === drift
              && x.vol === vol && x.lookback === lookback && x.configLabel === "Optimal"
            );
            if (r) {
              rows.push({
                "Drift%": (drift >= 0 ? "+" : "") + drift,
                "Vol%": vol,
                "Lookback": lookback,
                "Sharpe": r.sharpe.toFixed(3),
                "APR%": r.meanAPR.toFixed(2),
                "MaxDD%": (r.maxDD * 100).toFixed(1),
                "WinRate%": (r.winRate * 100).toFixed(1),
                "Alpha%": (r.alpha > 0 ? "+" : "") + r.alpha.toFixed(2),
                "Skip%": r.skipPct.toFixed(1),
                "ExecCycles": r.avgExecCycles.toFixed(1),
              });
            }
          }
        }
      }
      console.table(rows);
    }
  }

  // =======================================================
  // SECTION 2: Lookback Impact by Model
  // =======================================================
  console.log("\n" + "=".repeat(120));
  console.log("=== SECTION 2: LOOKBACK IMPACT BY MODEL ===");
  console.log("=".repeat(120));
  console.log("For each model × strategy, Sharpe averaged across drift × vol at each lookback.\n");

  for (const model of models) {
    console.log(`--- Model: ${model.toUpperCase()} ---\n`);
    for (const strat of strategies) {
      console.log(`  ${strat.name}:`);
      const rows: any[] = [];
      for (const lookback of lookbackValues) {
        const subset = allResults.filter(x =>
          x.strategy === strat.name && x.model === model
          && x.lookback === lookback && x.configLabel === "Optimal"
        );
        const avgSharpe = subset.reduce((a, r) => a + r.sharpe, 0) / subset.length;
        const avgAPR = subset.reduce((a, r) => a + r.meanAPR, 0) / subset.length;
        const avgMaxDD = subset.reduce((a, r) => a + r.maxDD, 0) / subset.length;
        const avgWinRate = subset.reduce((a, r) => a + r.winRate, 0) / subset.length;
        const avgSkipPct = subset.reduce((a, r) => a + r.skipPct, 0) / subset.length;
        const avgAlpha = subset.reduce((a, r) => a + r.alpha, 0) / subset.length;
        const posCount = subset.filter(r => r.sharpe > 0).length;

        rows.push({
          "Lookback": lookback,
          "Avg Sharpe": avgSharpe.toFixed(3),
          "Avg APR%": avgAPR.toFixed(2),
          "Avg MaxDD%": (avgMaxDD * 100).toFixed(1),
          "Avg WinRate%": (avgWinRate * 100).toFixed(1),
          "Avg Alpha%": (avgAlpha > 0 ? "+" : "") + avgAlpha.toFixed(2),
          "Avg Skip%": avgSkipPct.toFixed(1),
          "Positive": `${posCount}/${subset.length}`,
        });
      }
      console.table(rows);

      const bestRow = rows.reduce((a, b) =>
        parseFloat(a["Avg Sharpe"]) > parseFloat(b["Avg Sharpe"]) ? a : b
      );
      console.log(`  → Best lookback: ${bestRow["Lookback"]}d (Sharpe ${bestRow["Avg Sharpe"]})\n`);
    }
  }

  // =======================================================
  // SECTION 3: GBM Optimal Lookback
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 3: GBM OPTIMAL LOOKBACK ===");
  console.log("=".repeat(120));
  console.log("Does anything beat the default 20-day lookback under GBM?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);

    const baseline20 = allResults.filter(x =>
      x.strategy === strat.name && x.model === "gbm"
      && x.lookback === 20 && x.configLabel === "Optimal"
    );
    const baseline20Sharpe = baseline20.reduce((a, r) => a + r.sharpe, 0) / baseline20.length;

    const rows: any[] = [];
    for (const lookback of lookbackValues) {
      const subset = allResults.filter(x =>
        x.strategy === strat.name && x.model === "gbm"
        && x.lookback === lookback && x.configLabel === "Optimal"
      );
      const avgSharpe = subset.reduce((a, r) => a + r.sharpe, 0) / subset.length;
      const delta = avgSharpe - baseline20Sharpe;

      rows.push({
        "Lookback": lookback,
        "Avg Sharpe": avgSharpe.toFixed(3),
        "Δ vs 20d": (delta > 0 ? "+" : "") + delta.toFixed(4),
        "Better": avgSharpe > baseline20Sharpe ? "YES" : "no",
      });
    }
    console.table(rows);
    console.log(`  Baseline (20d): Sharpe ${baseline20Sharpe.toFixed(3)}\n`);

    // Per-drift×vol detail
    console.log(`  Per-condition GBM Sharpe by lookback:`);
    for (const drift of driftLevels) {
      for (const vol of volLevels) {
        const label = `drift=${drift >= 0 ? "+" : ""}${drift}%, vol=${vol}%`;
        const vals = lookbackValues.map(lb => {
          const r = allResults.find(x =>
            x.strategy === strat.name && x.model === "gbm"
            && x.drift === drift && x.vol === vol
            && x.lookback === lb && x.configLabel === "Optimal"
          );
          return r ? r.sharpe.toFixed(3) : "n/a";
        });
        console.log(`    ${label}: ${lookbackValues.map((lb, i) => `${lb}d=${vals[i]}`).join(" | ")}`);
      }
    }
    console.log();
  }

  // =======================================================
  // SECTION 4: Heston Recovery Assessment
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 4: HESTON RECOVERY ASSESSMENT ===");
  console.log("=".repeat(120));
  console.log("Critical question: Does short lookback (5-10d) recover positive Sharpe under Heston?");
  console.log("Exp 9 baseline (lookback=20): Active 0/9 positive, Moderate 0/9, Conservative 5/9.\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const lookback of lookbackValues) {
      const subset = allResults.filter(x =>
        x.strategy === strat.name && x.model === "heston"
        && x.lookback === lookback && x.configLabel === "Optimal"
      );
      const avgSharpe = subset.reduce((a, r) => a + r.sharpe, 0) / subset.length;
      const avgAPR = subset.reduce((a, r) => a + r.meanAPR, 0) / subset.length;
      const avgMaxDD = subset.reduce((a, r) => a + r.maxDD, 0) / subset.length;
      const avgWinRate = subset.reduce((a, r) => a + r.winRate, 0) / subset.length;
      const posCount = subset.filter(r => r.sharpe > 0).length;

      rows.push({
        "Lookback": lookback,
        "Avg Sharpe": avgSharpe.toFixed(3),
        "Avg APR%": avgAPR.toFixed(2),
        "Avg MaxDD%": (avgMaxDD * 100).toFixed(1),
        "Avg WinRate%": (avgWinRate * 100).toFixed(1),
        "Positive": `${posCount}/${subset.length}`,
        "RECOVERED?": posCount === subset.length ? "✓ ALL" : posCount > 0 ? `PARTIAL (${posCount})` : "✗ NONE",
      });
    }
    console.table(rows);

    // Highlight best lookback for Heston
    const bestRow = rows.reduce((a, b) =>
      parseFloat(a["Avg Sharpe"]) > parseFloat(b["Avg Sharpe"]) ? a : b
    );
    console.log(`  → Best Heston lookback: ${bestRow["Lookback"]}d (Sharpe ${bestRow["Avg Sharpe"]}, ${bestRow["RECOVERED?"]})`);

    // Per-condition detail
    console.log(`\n  Per-condition Heston Sharpe by lookback:`);
    for (const drift of driftLevels) {
      for (const vol of volLevels) {
        const label = `drift=${drift >= 0 ? "+" : ""}${drift}%, vol=${vol}%`;
        const vals = lookbackValues.map(lb => {
          const r = allResults.find(x =>
            x.strategy === strat.name && x.model === "heston"
            && x.drift === drift && x.vol === vol
            && x.lookback === lb && x.configLabel === "Optimal"
          );
          return r ? r.sharpe.toFixed(3) : "n/a";
        });
        console.log(`    ${label}: ${lookbackValues.map((lb, i) => `${lb}d=${vals[i]}`).join(" | ")}`);
      }
    }
    console.log();
  }

  // Recovery summary
  console.log("--- HESTON RECOVERY SUMMARY ---\n");
  for (const strat of strategies) {
    const allHeston = allResults.filter(x =>
      x.strategy === strat.name && x.model === "heston" && x.configLabel === "Optimal"
    );

    const byLookback = lookbackValues.map(lb => {
      const s = allHeston.filter(x => x.lookback === lb);
      const pos = s.filter(r => r.sharpe > 0).length;
      return { lb, pos, total: s.length, avgSharpe: s.reduce((a, r) => a + r.sharpe, 0) / s.length };
    });

    const bestLb = byLookback.reduce((a, b) => a.avgSharpe > b.avgSharpe ? a : b);
    const lb20 = byLookback.find(x => x.lb === 20)!;

    console.log(`  ${strat.name}:`);
    console.log(`    Default (20d): ${lb20.pos}/${lb20.total} positive, Sharpe ${lb20.avgSharpe.toFixed(3)}`);
    console.log(`    Best (${bestLb.lb}d):    ${bestLb.pos}/${bestLb.total} positive, Sharpe ${bestLb.avgSharpe.toFixed(3)}`);
    console.log(`    ΔSharpe: ${(bestLb.avgSharpe - lb20.avgSharpe) > 0 ? "+" : ""}${(bestLb.avgSharpe - lb20.avgSharpe).toFixed(4)}`);
    console.log(`    Verdict: ${bestLb.pos === bestLb.total ? "FULL RECOVERY" : bestLb.pos > lb20.pos ? "PARTIAL RECOVERY" : bestLb.avgSharpe > lb20.avgSharpe ? "IMPROVED BUT NOT RECOVERED" : "NO RECOVERY"}`);
    console.log();
  }

  // =======================================================
  // SECTION 5: Lookback × Cycle Interaction
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 5: LOOKBACK × CYCLE INTERACTION ===");
  console.log("=".repeat(120));
  console.log("Hypothesis: optimal lookback scales with cycle length (e.g., lookback ≈ 2×cycle).\n");

  for (const model of models) {
    console.log(`--- Model: ${model.toUpperCase()} ---\n`);

    const interactionRows: any[] = [];
    for (const strat of strategies) {
      const subset = allResults.filter(x =>
        x.strategy === strat.name && x.model === model && x.configLabel === "Optimal"
      );

      const byLookback = lookbackValues.map(lb => {
        const s = subset.filter(x => x.lookback === lb);
        return {
          lb,
          avgSharpe: s.reduce((a, r) => a + r.sharpe, 0) / s.length,
        };
      });

      const bestLb = byLookback.reduce((a, b) => a.avgSharpe > b.avgSharpe ? a : b);
      const ratio = bestLb.lb / strat.cycle;

      interactionRows.push({
        "Strategy": strat.name,
        "Cycle (d)": strat.cycle,
        "Best Lookback (d)": bestLb.lb,
        "Ratio (LB/Cycle)": ratio.toFixed(2),
        "Best Sharpe": bestLb.avgSharpe.toFixed(3),
      });
    }
    console.table(interactionRows);

    // Full lookback/cycle ratio analysis
    console.log(`\n  Sharpe by lookback/cycle ratio (${model.toUpperCase()}):`);
    for (const strat of strategies) {
      const subset = allResults.filter(x =>
        x.strategy === strat.name && x.model === model && x.configLabel === "Optimal"
      );
      const line = lookbackValues.map(lb => {
        const s = subset.filter(x => x.lookback === lb);
        const avgSharpe = s.reduce((a, r) => a + r.sharpe, 0) / s.length;
        return `${(lb / strat.cycle).toFixed(1)}×=${avgSharpe.toFixed(3)}`;
      });
      console.log(`    ${strat.name.split("(")[0].trim()} (cycle=${strat.cycle}d): ${line.join(" | ")}`);
    }
    console.log();
  }

  // =======================================================
  // SECTION 6: RF Value by Lookback
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 6: REGIME FILTER VALUE BY LOOKBACK ===");
  console.log("=".repeat(120));
  console.log("ΔSharpe (RF ON − RF OFF) at each lookback. Does lookback affect RF's value?\n");

  for (const model of models) {
    console.log(`--- Model: ${model.toUpperCase()} ---\n`);
    for (const strat of strategies) {
      console.log(`  ${strat.name}:`);
      const rows: any[] = [];

      for (const lookback of lookbackValues) {
        let rfWins = 0, totalCombosRF = 0, sumDelta = 0;

        for (const drift of driftLevels) {
          for (const vol of volLevels) {
            const opt = allResults.find(x =>
              x.strategy === strat.name && x.model === model
              && x.drift === drift && x.vol === vol
              && x.lookback === lookback && x.configLabel === "Optimal"
            );
            const base = allResults.find(x =>
              x.strategy === strat.name && x.model === model
              && x.drift === drift && x.vol === vol
              && x.lookback === lookback && x.configLabel === "No-RF Baseline"
            );
            if (opt && base) {
              const d = opt.sharpe - base.sharpe;
              if (d > 0) rfWins++;
              sumDelta += d;
              totalCombosRF++;
            }
          }
        }

        const avgDelta = totalCombosRF > 0 ? sumDelta / totalCombosRF : 0;
        rows.push({
          "Lookback": lookback,
          "RF Wins": `${rfWins}/${totalCombosRF}`,
          "Mean ΔSharpe": (avgDelta > 0 ? "+" : "") + avgDelta.toFixed(4),
          "RF Universal?": rfWins === totalCombosRF ? "YES" : "no",
        });
      }
      console.table(rows);
    }
    console.log();
  }

  // =======================================================
  // SECTION 7: Skip Rate & Win Rate by Lookback
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 7: SKIP RATE & WIN RATE BY LOOKBACK ===");
  console.log("=".repeat(120));
  console.log("How skip% and win rate change with lookback. Under Heston: does shorter lookback");
  console.log("restore the ~78% win rate seen under GBM?\n");

  for (const model of models) {
    console.log(`--- Model: ${model.toUpperCase()} ---\n`);
    for (const strat of strategies) {
      console.log(`  ${strat.name} (Optimal / RF ON):`);
      const rows: any[] = [];

      for (const lookback of lookbackValues) {
        const subset = allResults.filter(x =>
          x.strategy === strat.name && x.model === model
          && x.lookback === lookback && x.configLabel === "Optimal"
        );
        const avgSkipPct = subset.reduce((a, r) => a + r.skipPct, 0) / subset.length;
        const avgWinRate = subset.reduce((a, r) => a + r.winRate, 0) / subset.length;
        const avgExecCycles = subset.reduce((a, r) => a + r.avgExecCycles, 0) / subset.length;
        const avgTotalCycles = subset.reduce((a, r) => a + r.avgTotalCycles, 0) / subset.length;

        rows.push({
          "Lookback": lookback,
          "Avg Skip%": avgSkipPct.toFixed(1),
          "Avg Exec Cycles": avgExecCycles.toFixed(1),
          "Avg Total Cycles": avgTotalCycles.toFixed(1),
          "Avg Win Rate%": (avgWinRate * 100).toFixed(1),
        });
      }
      console.table(rows);
    }
    console.log();
  }

  // GBM vs Heston win rate comparison at each lookback
  console.log("--- GBM vs HESTON WIN RATE BY LOOKBACK ---\n");
  for (const strat of strategies) {
    console.log(`  ${strat.name}:`);
    const rows: any[] = [];
    for (const lookback of lookbackValues) {
      const gbm = allResults.filter(x =>
        x.strategy === strat.name && x.model === "gbm"
        && x.lookback === lookback && x.configLabel === "Optimal"
      );
      const heston = allResults.filter(x =>
        x.strategy === strat.name && x.model === "heston"
        && x.lookback === lookback && x.configLabel === "Optimal"
      );
      const gbmWR = (gbm.reduce((a, r) => a + r.winRate, 0) / gbm.length * 100);
      const hestonWR = (heston.reduce((a, r) => a + r.winRate, 0) / heston.length * 100);

      rows.push({
        "Lookback": lookback,
        "GBM WinRate%": gbmWR.toFixed(1),
        "Heston WinRate%": hestonWR.toFixed(1),
        "Δ (Heston−GBM)": ((hestonWR - gbmWR) > 0 ? "+" : "") + (hestonWR - gbmWR).toFixed(1) + "pp",
        "Gap Closing?": Math.abs(hestonWR - gbmWR) < 5 ? "YES" : "no",
      });
    }
    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 8: Recommendations
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 8: RECOMMENDATIONS ===");
  console.log("=".repeat(120) + "\n");

  // Optimal lookback per model × strategy
  console.log("--- OPTIMAL LOOKBACK PER MODEL × STRATEGY ---\n");
  const recRows: any[] = [];
  for (const model of models) {
    for (const strat of strategies) {
      const byLookback = lookbackValues.map(lb => {
        const s = allResults.filter(x =>
          x.strategy === strat.name && x.model === model
          && x.lookback === lb && x.configLabel === "Optimal"
        );
        return {
          lb,
          avgSharpe: s.reduce((a, r) => a + r.sharpe, 0) / s.length,
          posCount: s.filter(r => r.sharpe > 0).length,
          total: s.length,
        };
      });

      const best = byLookback.reduce((a, b) => a.avgSharpe > b.avgSharpe ? a : b);
      const at20 = byLookback.find(x => x.lb === 20)!;
      const improvement = best.avgSharpe - at20.avgSharpe;

      recRows.push({
        "Model": model,
        "Strategy": strat.name.split("(")[0].trim(),
        "Best Lookback": `${best.lb}d`,
        "Best Sharpe": best.avgSharpe.toFixed(3),
        "Default (20d)": at20.avgSharpe.toFixed(3),
        "Improvement": (improvement > 0 ? "+" : "") + improvement.toFixed(4),
        "Positive": `${best.posCount}/${best.total}`,
      });
    }
  }
  console.table(recRows);

  // Should we change the default?
  console.log("\n--- SHOULD DEFAULT LOOKBACK CHANGE? ---\n");
  for (const strat of strategies) {
    const gbmByLb = lookbackValues.map(lb => {
      const s = allResults.filter(x =>
        x.strategy === strat.name && x.model === "gbm"
        && x.lookback === lb && x.configLabel === "Optimal"
      );
      return { lb, avgSharpe: s.reduce((a, r) => a + r.sharpe, 0) / s.length };
    });
    const gbmBest = gbmByLb.reduce((a, b) => a.avgSharpe > b.avgSharpe ? a : b);
    const gbm20 = gbmByLb.find(x => x.lb === 20)!;
    const gbmDelta = gbmBest.avgSharpe - gbm20.avgSharpe;

    console.log(`  ${strat.name}:`);
    console.log(`    GBM best: ${gbmBest.lb}d (Δ vs 20d: ${gbmDelta > 0 ? "+" : ""}${gbmDelta.toFixed(4)})`);
    console.log(`    Recommendation: ${Math.abs(gbmDelta) < 0.02 ? "KEEP 20d (improvement < 0.02)" : `CHANGE to ${gbmBest.lb}d`}`);
    console.log();
  }

  // Heston recovery final verdict
  console.log("--- HESTON RECOVERY FINAL VERDICT ---\n");
  for (const strat of strategies) {
    const hestonByLb = lookbackValues.map(lb => {
      const s = allResults.filter(x =>
        x.strategy === strat.name && x.model === "heston"
        && x.lookback === lb && x.configLabel === "Optimal"
      );
      return {
        lb,
        avgSharpe: s.reduce((a, r) => a + r.sharpe, 0) / s.length,
        posCount: s.filter(r => r.sharpe > 0).length,
        total: s.length,
      };
    });
    const best = hestonByLb.reduce((a, b) => a.avgSharpe > b.avgSharpe ? a : b);
    const at20 = hestonByLb.find(x => x.lb === 20)!;

    const recovered = best.posCount === best.total;
    const improved = best.avgSharpe > at20.avgSharpe;

    console.log(`  ${strat.name}:`);
    console.log(`    Best Heston lookback: ${best.lb}d → Sharpe ${best.avgSharpe.toFixed(3)}, ${best.posCount}/${best.total} positive`);
    console.log(`    Default (20d): Sharpe ${at20.avgSharpe.toFixed(3)}, ${at20.posCount}/${at20.total} positive`);
    if (recovered) {
      console.log(`    Verdict: ✓ FULL RECOVERY — Lookback tuning solves Heston.`);
    } else if (improved && best.posCount > at20.posCount) {
      console.log(`    Verdict: ~ PARTIAL RECOVERY — Improvement but not full. Exp 11 (threshold recalibration) needed.`);
    } else if (improved) {
      console.log(`    Verdict: ~ MARGINAL IMPROVEMENT — Better Sharpe but same positive count. Structural issue remains.`);
    } else {
      console.log(`    Verdict: ✗ NO RECOVERY — Lookback tuning cannot solve Heston. Issue is structural, not parametric.`);
    }
    console.log();
  }

  // Overall conclusion
  console.log("--- OVERALL CONCLUSIONS ---\n");

  const gbmChanges: string[] = [];
  const hestonRecoveries: string[] = [];

  for (const strat of strategies) {
    const gbmByLb = lookbackValues.map(lb => {
      const s = allResults.filter(x =>
        x.strategy === strat.name && x.model === "gbm"
        && x.lookback === lb && x.configLabel === "Optimal"
      );
      return { lb, avgSharpe: s.reduce((a, r) => a + r.sharpe, 0) / s.length };
    });
    const gbmBest = gbmByLb.reduce((a, b) => a.avgSharpe > b.avgSharpe ? a : b);
    const gbm20 = gbmByLb.find(x => x.lb === 20)!;
    if (Math.abs(gbmBest.avgSharpe - gbm20.avgSharpe) >= 0.02) {
      gbmChanges.push(`${strat.name.split("(")[0].trim()}: ${gbmBest.lb}d`);
    }

    const hestonByLb = lookbackValues.map(lb => {
      const s = allResults.filter(x =>
        x.strategy === strat.name && x.model === "heston"
        && x.lookback === lb && x.configLabel === "Optimal"
      );
      return {
        lb,
        avgSharpe: s.reduce((a, r) => a + r.sharpe, 0) / s.length,
        posCount: s.filter(r => r.sharpe > 0).length,
        total: s.length,
      };
    });
    const hestonBest = hestonByLb.reduce((a, b) => a.avgSharpe > b.avgSharpe ? a : b);
    if (hestonBest.posCount === hestonBest.total) {
      hestonRecoveries.push(`${strat.name.split("(")[0].trim()}: ${hestonBest.lb}d`);
    }
  }

  if (gbmChanges.length === 0) {
    console.log("  GBM: Default lookback of 20d is confirmed optimal (or near-optimal). No changes needed.");
  } else {
    console.log(`  GBM: Lookback changes recommended: ${gbmChanges.join(", ")}`);
  }

  if (hestonRecoveries.length === 0) {
    console.log("  Heston: Lookback tuning alone does NOT recover positive Sharpe. The Heston failure");
    console.log("          is structural, not a lookback calibration issue. Proceed to Exp 11 (threshold");
    console.log("          recalibration) as the next recovery attempt.");
  } else {
    console.log(`  Heston: Lookback tuning RECOVERS: ${hestonRecoveries.join(", ")}`);
    console.log("          Model-adaptive lookback configuration viable for these strategies.");
  }

  console.log("\n=== END OF EXPERIMENT 10 ===\n");
}

main().catch(console.error);
