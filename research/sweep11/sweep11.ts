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

interface ThresholdResult {
  model: PriceModel;
  drift: number;
  vol: number;
  strategy: string;
  threshold: number;
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
  skipBelowRatio: number | null,
  baseMarket: ReturnType<typeof defaultMarketValues>,
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
      lookbackDays: strat.lookback,
      minMultiplier: 0.8,
      maxMultiplier: 1.3,
      ...(skipBelowRatio !== null ? {
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
  vol: number,
  stratName: string,
  threshold: number,
  configLabel: string,
  result: { runs: any[]; medianAPR: number; p5APR: number },
): ThresholdResult {
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
    threshold,
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
  console.log("=== Experiment 11: Heston Skip Threshold Recalibration ===");
  console.log("Goal: Last Heston recovery attempt. Test whether recalibrating skipBelowRatio");
  console.log("      under Heston-specific IV/RV distributions restores positive Sharpe.");
  console.log("      If this fails, close the Heston investigation — the failure is structural.\n");

  const baseMarket = defaultMarketValues();
  const numSims = 1000;

  const strategies: StrategyProfile[] = [
    {
      name: "Conservative (δ0.10/30d)",
      delta: 0.10, cycle: 30, lookback: 60,
      adaptiveCalls: true,
      putRollEnabled: true, putRollInitialDTE: 30, putRollWhenBelow: 14,
    },
    {
      name: "Moderate (δ0.20/14d)",
      delta: 0.20, cycle: 14, lookback: 30,
      adaptiveCalls: false,
      putRollEnabled: true, putRollInitialDTE: 14, putRollWhenBelow: 7,
    },
    {
      name: "Active (δ0.20/3d)",
      delta: 0.20, cycle: 3, lookback: 30,
      adaptiveCalls: false,
      putRollEnabled: false, putRollInitialDTE: 0, putRollWhenBelow: 0,
    },
  ];

  const thresholdValues = [0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2.0];
  const volLevels = [40, 60];
  const driftLevels = [0, 5];

  // Phase 1: Heston primary sweep
  const hestonRFCombos = thresholdValues.length * driftLevels.length * volLevels.length * strategies.length;
  const hestonBaselineCombos = driftLevels.length * volLevels.length * strategies.length;
  const totalHestonCombos = hestonRFCombos + hestonBaselineCombos;

  console.log("--- PHASE 1: HESTON PRIMARY SWEEP ---\n");
  console.log(`Strategies: ${strategies.map(s => s.name).join(", ")}`);
  console.log(`Model: Heston only`);
  console.log(`Skip thresholds: ${thresholdValues.join(", ")}`);
  console.log(`Lookbacks: Conservative=60d (Exp 10 best), Moderate/Active=30d (Exp 10 best)`);
  console.log(`Vol levels: ${volLevels.map(v => v + "%").join(", ")}`);
  console.log(`Drift levels: ${driftLevels.map(d => (d >= 0 ? "+" : "") + d + "%").join(", ")}`);
  console.log(`RF ON combos: ${hestonRFCombos} | RF OFF baseline combos: ${hestonBaselineCombos}`);
  console.log(`Total Heston combinations: ${totalHestonCombos}`);
  console.log(`Paths per combo: ${numSims} | Days: 365 | VRP: 15%`);
  console.log(`Heston params: κ=${baseMarket.kappa}, σ=${baseMarket.sigma}, ρ=${baseMarket.rho}, θ=vol² (dynamic)`);
  console.log(`skipSide: "put" (standard from Exp 5)\n`);

  let completed = 0;
  const allResults: ThresholdResult[] = [];

  // RF ON at each threshold
  for (const drift of driftLevels) {
    for (const vol of volLevels) {
      for (const strat of strategies) {
        for (const threshold of thresholdValues) {
          const { marketConfig, strategyConfig } = buildConfigs(
            strat, vol, drift, "heston", threshold, baseMarket,
          );
          const result = runCombo(marketConfig, strategyConfig, numSims);
          const row = extractResult("heston", drift, vol, strat.name, threshold, "RF ON", result);
          allResults.push(row);

          completed++;
          if (completed % 10 === 0 || completed === totalHestonCombos) {
            process.stdout.write(`  Heston progress: ${completed}/${totalHestonCombos} (${(completed / totalHestonCombos * 100).toFixed(0)}%)\r`);
          }
        }

        // RF OFF baseline (threshold irrelevant — use 0 as marker)
        const { marketConfig, strategyConfig } = buildConfigs(
          strat, vol, drift, "heston", null, baseMarket,
        );
        const result = runCombo(marketConfig, strategyConfig, numSims);
        const row = extractResult("heston", drift, vol, strat.name, 0, "RF OFF", result);
        allResults.push(row);

        completed++;
        if (completed % 10 === 0 || completed === totalHestonCombos) {
          process.stdout.write(`  Heston progress: ${completed}/${totalHestonCombos} (${(completed / totalHestonCombos * 100).toFixed(0)}%)\r`);
        }
      }
    }
  }

  console.log(`\nHeston sweep complete: ${allResults.length} result rows.\n`);

  // Determine best Heston thresholds per strategy for GBM cross-validation
  const bestHestonThresholds: Map<string, number> = new Map();
  for (const strat of strategies) {
    const rfRows = allResults.filter(x =>
      x.strategy === strat.name && x.configLabel === "RF ON"
    );
    let bestThreshold = thresholdValues[0];
    let bestSharpe = -Infinity;
    for (const t of thresholdValues) {
      const subset = rfRows.filter(x => x.threshold === t);
      const avgSharpe = subset.reduce((a, r) => a + r.sharpe, 0) / subset.length;
      if (avgSharpe > bestSharpe) {
        bestSharpe = avgSharpe;
        bestThreshold = t;
      }
    }
    bestHestonThresholds.set(strat.name, bestThreshold);
  }

  // Phase 2: GBM cross-validation with best Heston thresholds + original thresholds
  console.log("--- PHASE 2: GBM CROSS-VALIDATION ---\n");

  const originalThresholds: Map<string, number> = new Map([
    ["Conservative (δ0.10/30d)", 1.0],
    ["Moderate (δ0.20/14d)", 1.2],
    ["Active (δ0.20/3d)", 1.2],
  ]);

  const gbmThresholdsToTest: Map<string, number[]> = new Map();
  for (const strat of strategies) {
    const best = bestHestonThresholds.get(strat.name)!;
    const orig = originalThresholds.get(strat.name)!;
    const unique = [...new Set([orig, best])].sort((a, b) => a - b);
    gbmThresholdsToTest.set(strat.name, unique);
  }

  const gbmCombos = strategies.reduce((acc, strat) => {
    return acc + gbmThresholdsToTest.get(strat.name)!.length * driftLevels.length * volLevels.length;
  }, 0) + hestonBaselineCombos; // + RF OFF baselines

  console.log("Testing best Heston thresholds under GBM to measure degradation:");
  for (const strat of strategies) {
    const best = bestHestonThresholds.get(strat.name)!;
    const orig = originalThresholds.get(strat.name)!;
    console.log(`  ${strat.name}: Heston-best=${best}, Original=${orig}`);
  }
  console.log(`GBM combos: ${gbmCombos}\n`);

  const gbmResults: ThresholdResult[] = [];
  let gbmCompleted = 0;

  for (const drift of driftLevels) {
    for (const vol of volLevels) {
      for (const strat of strategies) {
        const thresholds = gbmThresholdsToTest.get(strat.name)!;
        for (const threshold of thresholds) {
          const { marketConfig, strategyConfig } = buildConfigs(
            strat, vol, drift, "gbm", threshold, baseMarket,
          );
          const result = runCombo(marketConfig, strategyConfig, numSims);
          const row = extractResult("gbm", drift, vol, strat.name, threshold, "RF ON", result);
          gbmResults.push(row);
          gbmCompleted++;
        }

        // RF OFF baseline
        const { marketConfig, strategyConfig } = buildConfigs(
          strat, vol, drift, "gbm", null, baseMarket,
        );
        const result = runCombo(marketConfig, strategyConfig, numSims);
        const row = extractResult("gbm", drift, vol, strat.name, 0, "RF OFF", result);
        gbmResults.push(row);
        gbmCompleted++;

        process.stdout.write(`  GBM progress: ${gbmCompleted}/${gbmCombos} (${(gbmCompleted / gbmCombos * 100).toFixed(0)}%)\r`);
      }
    }
  }

  console.log(`\nGBM cross-validation complete: ${gbmResults.length} result rows.\n`);

  // =======================================================
  // SECTION 1: Full Heston Results Table
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 1: FULL HESTON RESULTS TABLE ===");
  console.log("=".repeat(120));
  console.log("All RF ON rows sorted by strategy → drift → vol → threshold.\n");

  for (const strat of strategies) {
    console.log(`\n  ${strat.name} (lookback=${strat.lookback}d):`);
    const rows: any[] = [];
    for (const drift of driftLevels) {
      for (const vol of volLevels) {
        // RF OFF baseline first
        const baseline = allResults.find(x =>
          x.strategy === strat.name && x.drift === drift
          && x.vol === vol && x.configLabel === "RF OFF"
        );
        if (baseline) {
          rows.push({
            "Drift%": (drift >= 0 ? "+" : "") + drift,
            "Vol%": vol,
            "Threshold": "OFF",
            "Sharpe": baseline.sharpe.toFixed(3),
            "APR%": baseline.meanAPR.toFixed(2),
            "MaxDD%": (baseline.maxDD * 100).toFixed(1),
            "WinRate%": (baseline.winRate * 100).toFixed(1),
            "Alpha%": (baseline.alpha > 0 ? "+" : "") + baseline.alpha.toFixed(2),
            "Skip%": baseline.skipPct.toFixed(1),
            "ExecCycles": baseline.avgExecCycles.toFixed(1),
          });
        }

        for (const threshold of thresholdValues) {
          const r = allResults.find(x =>
            x.strategy === strat.name && x.drift === drift
            && x.vol === vol && x.threshold === threshold && x.configLabel === "RF ON"
          );
          if (r) {
            rows.push({
              "Drift%": (drift >= 0 ? "+" : "") + drift,
              "Vol%": vol,
              "Threshold": threshold.toFixed(2),
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

  // =======================================================
  // SECTION 2: Threshold Impact by Strategy
  // =======================================================
  console.log("\n" + "=".repeat(120));
  console.log("=== SECTION 2: THRESHOLD IMPACT BY STRATEGY ===");
  console.log("=".repeat(120));
  console.log("Sharpe averaged across drift × vol at each threshold. Find optimal per strategy.\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);

    // RF OFF baseline avg
    const rfOffRows = allResults.filter(x =>
      x.strategy === strat.name && x.configLabel === "RF OFF"
    );
    const rfOffSharpe = rfOffRows.reduce((a, r) => a + r.sharpe, 0) / rfOffRows.length;

    const rows: any[] = [];
    rows.push({
      "Threshold": "OFF",
      "Avg Sharpe": rfOffSharpe.toFixed(3),
      "Δ vs OFF": "—",
      "Avg APR%": (rfOffRows.reduce((a, r) => a + r.meanAPR, 0) / rfOffRows.length).toFixed(2),
      "Avg MaxDD%": (rfOffRows.reduce((a, r) => a + r.maxDD, 0) / rfOffRows.length * 100).toFixed(1),
      "Avg WinRate%": (rfOffRows.reduce((a, r) => a + r.winRate, 0) / rfOffRows.length * 100).toFixed(1),
      "Avg Skip%": (rfOffRows.reduce((a, r) => a + r.skipPct, 0) / rfOffRows.length).toFixed(1),
      "Positive": `${rfOffRows.filter(r => r.sharpe > 0).length}/${rfOffRows.length}`,
    });

    for (const threshold of thresholdValues) {
      const subset = allResults.filter(x =>
        x.strategy === strat.name && x.threshold === threshold && x.configLabel === "RF ON"
      );
      const avgSharpe = subset.reduce((a, r) => a + r.sharpe, 0) / subset.length;
      const delta = avgSharpe - rfOffSharpe;
      const posCount = subset.filter(r => r.sharpe > 0).length;

      rows.push({
        "Threshold": threshold.toFixed(2),
        "Avg Sharpe": avgSharpe.toFixed(3),
        "Δ vs OFF": (delta > 0 ? "+" : "") + delta.toFixed(4),
        "Avg APR%": (subset.reduce((a, r) => a + r.meanAPR, 0) / subset.length).toFixed(2),
        "Avg MaxDD%": (subset.reduce((a, r) => a + r.maxDD, 0) / subset.length * 100).toFixed(1),
        "Avg WinRate%": (subset.reduce((a, r) => a + r.winRate, 0) / subset.length * 100).toFixed(1),
        "Avg Skip%": (subset.reduce((a, r) => a + r.skipPct, 0) / subset.length).toFixed(1),
        "Positive": `${posCount}/${subset.length}`,
      });
    }
    console.table(rows);

    const bestRow = rows.slice(1).reduce((a, b) =>
      parseFloat(a["Avg Sharpe"]) > parseFloat(b["Avg Sharpe"]) ? a : b
    );
    console.log(`  → Best Heston threshold: ${bestRow["Threshold"]} (Sharpe ${bestRow["Avg Sharpe"]}, ${bestRow["Positive"]} positive)`);
    console.log(`  → RF OFF baseline: Sharpe ${rfOffSharpe.toFixed(3)}\n`);
  }

  // =======================================================
  // SECTION 3: Recovery Assessment
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 3: RECOVERY ASSESSMENT ===");
  console.log("=".repeat(120));
  console.log("At the optimal Heston threshold, how many combos have positive Sharpe?");
  console.log("Exp 9 baselines: Active 0/9, Moderate 0/9, Conservative 5/9.\n");

  for (const strat of strategies) {
    const bestThreshold = bestHestonThresholds.get(strat.name)!;
    const bestRows = allResults.filter(x =>
      x.strategy === strat.name && x.threshold === bestThreshold && x.configLabel === "RF ON"
    );
    const rfOffRows = allResults.filter(x =>
      x.strategy === strat.name && x.configLabel === "RF OFF"
    );
    const bestPosCnt = bestRows.filter(r => r.sharpe > 0).length;
    const rfOffPosCnt = rfOffRows.filter(r => r.sharpe > 0).length;

    console.log(`--- ${strat.name} ---`);
    console.log(`  Best threshold: ${bestThreshold}`);
    console.log(`  Positive Sharpe: ${bestPosCnt}/${bestRows.length} (RF ON at best threshold)`);
    console.log(`  RF OFF positive:  ${rfOffPosCnt}/${rfOffRows.length}`);

    console.log(`\n  Per-condition detail at threshold=${bestThreshold}:`);
    const detailRows: any[] = [];
    for (const drift of driftLevels) {
      for (const vol of volLevels) {
        const rf = bestRows.find(x => x.drift === drift && x.vol === vol);
        const off = rfOffRows.find(x => x.drift === drift && x.vol === vol);
        if (rf && off) {
          const recovered = rf.sharpe > 0;
          detailRows.push({
            "Drift%": (drift >= 0 ? "+" : "") + drift,
            "Vol%": vol,
            "RF ON Sharpe": rf.sharpe.toFixed(3),
            "RF OFF Sharpe": off.sharpe.toFixed(3),
            "ΔSharpe": ((rf.sharpe - off.sharpe) > 0 ? "+" : "") + (rf.sharpe - off.sharpe).toFixed(4),
            "RF ON APR%": rf.meanAPR.toFixed(2),
            "RF OFF APR%": off.meanAPR.toFixed(2),
            "RECOVERED?": recovered ? "✓ YES" : "✗ NO",
          });
        }
      }
    }
    console.table(detailRows);
    console.log();
  }

  // Recovery verdict
  console.log("--- RECOVERY VERDICT ---\n");
  let anyFullRecovery = false;
  for (const strat of strategies) {
    const bestThreshold = bestHestonThresholds.get(strat.name)!;
    const bestRows = allResults.filter(x =>
      x.strategy === strat.name && x.threshold === bestThreshold && x.configLabel === "RF ON"
    );
    const posCnt = bestRows.filter(r => r.sharpe > 0).length;
    const fullRecovery = posCnt === bestRows.length;
    if (fullRecovery) anyFullRecovery = true;

    const avgSharpe = bestRows.reduce((a, r) => a + r.sharpe, 0) / bestRows.length;

    console.log(`  ${strat.name}:`);
    console.log(`    Best threshold: ${bestThreshold}`);
    console.log(`    Positive: ${posCnt}/${bestRows.length}`);
    console.log(`    Avg Sharpe: ${avgSharpe.toFixed(3)}`);
    if (fullRecovery) {
      console.log(`    Verdict: ✓ FULL RECOVERY — Threshold recalibration restores positive Sharpe under Heston.`);
    } else if (posCnt > 0) {
      console.log(`    Verdict: ~ PARTIAL RECOVERY — Some conditions positive, but not all.`);
    } else {
      console.log(`    Verdict: ✗ NO RECOVERY — Threshold recalibration cannot restore positive Sharpe.`);
    }
    console.log();
  }

  // =======================================================
  // SECTION 4: Conservative RF OFF Test
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 4: CONSERVATIVE RF OFF TEST ===");
  console.log("=".repeat(120));
  console.log("Exp 10 found RF hurts Conservative under Heston at most lookbacks.");
  console.log("Does threshold recalibration fix this, or is RF OFF still better?\n");

  const conservName = strategies[0].name;
  const conservBestThreshold = bestHestonThresholds.get(conservName)!;

  const conservRows: any[] = [];
  for (const drift of driftLevels) {
    for (const vol of volLevels) {
      const rfOff = allResults.find(x =>
        x.strategy === conservName && x.drift === drift
        && x.vol === vol && x.configLabel === "RF OFF"
      );
      const rfBest = allResults.find(x =>
        x.strategy === conservName && x.drift === drift
        && x.vol === vol && x.threshold === conservBestThreshold && x.configLabel === "RF ON"
      );
      // Also get original threshold (1.0)
      const rfOrig = allResults.find(x =>
        x.strategy === conservName && x.drift === drift
        && x.vol === vol && x.threshold === 1.0 && x.configLabel === "RF ON"
      );

      if (rfOff && rfBest && rfOrig) {
        const bestWinner = rfBest.sharpe > rfOff.sharpe ? "RF ON" : "RF OFF";
        conservRows.push({
          "Drift%": (drift >= 0 ? "+" : "") + drift,
          "Vol%": vol,
          "RF OFF Sharpe": rfOff.sharpe.toFixed(3),
          "RF ON (1.0) Sharpe": rfOrig.sharpe.toFixed(3),
          [`RF ON (${conservBestThreshold}) Sharpe`]: rfBest.sharpe.toFixed(3),
          "Winner": bestWinner,
          "Δ (Best RF − OFF)": ((rfBest.sharpe - rfOff.sharpe) > 0 ? "+" : "") + (rfBest.sharpe - rfOff.sharpe).toFixed(4),
        });
      }
    }
  }
  console.table(conservRows);

  const rfOffWins = conservRows.filter(r => r["Winner"] === "RF OFF").length;
  const rfOnWins = conservRows.filter(r => r["Winner"] === "RF ON").length;
  console.log(`\n  RF OFF wins: ${rfOffWins}/${conservRows.length} | RF ON wins: ${rfOnWins}/${conservRows.length}`);
  if (rfOffWins > rfOnWins) {
    console.log(`  → Recommendation: Conservative should use RF OFF under Heston. Exp 10 finding CONFIRMED.`);
  } else {
    console.log(`  → Recommendation: Conservative RF ON at threshold=${conservBestThreshold} is viable under Heston. Exp 10 finding OVERTURNED.`);
  }
  console.log();

  // =======================================================
  // SECTION 5: Skip Rate & Win Rate by Threshold
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 5: SKIP RATE & WIN RATE BY THRESHOLD ===");
  console.log("=".repeat(120));
  console.log("How skip% and accepted-trade win rate change with threshold under Heston.\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    // RF OFF baseline
    const rfOffSubset = allResults.filter(x =>
      x.strategy === strat.name && x.configLabel === "RF OFF"
    );
    rows.push({
      "Threshold": "OFF",
      "Avg Skip%": (rfOffSubset.reduce((a, r) => a + r.skipPct, 0) / rfOffSubset.length).toFixed(1),
      "Avg ExecCycles": (rfOffSubset.reduce((a, r) => a + r.avgExecCycles, 0) / rfOffSubset.length).toFixed(1),
      "Avg WinRate%": (rfOffSubset.reduce((a, r) => a + r.winRate, 0) / rfOffSubset.length * 100).toFixed(1),
      "Avg MaxDD%": (rfOffSubset.reduce((a, r) => a + r.maxDD, 0) / rfOffSubset.length * 100).toFixed(1),
    });

    for (const threshold of thresholdValues) {
      const subset = allResults.filter(x =>
        x.strategy === strat.name && x.threshold === threshold && x.configLabel === "RF ON"
      );
      rows.push({
        "Threshold": threshold.toFixed(2),
        "Avg Skip%": (subset.reduce((a, r) => a + r.skipPct, 0) / subset.length).toFixed(1),
        "Avg ExecCycles": (subset.reduce((a, r) => a + r.avgExecCycles, 0) / subset.length).toFixed(1),
        "Avg WinRate%": (subset.reduce((a, r) => a + r.winRate, 0) / subset.length * 100).toFixed(1),
        "Avg MaxDD%": (subset.reduce((a, r) => a + r.maxDD, 0) / subset.length * 100).toFixed(1),
      });
    }
    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 6: GBM Cross-Validation
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 6: GBM CROSS-VALIDATION ===");
  console.log("=".repeat(120));
  console.log("Would Heston-optimal thresholds degrade GBM performance?\n");

  for (const strat of strategies) {
    const bestHeston = bestHestonThresholds.get(strat.name)!;
    const orig = originalThresholds.get(strat.name)!;

    console.log(`--- ${strat.name} ---`);
    console.log(`  Original threshold: ${orig} | Heston-best: ${bestHeston}`);

    const gbmOff = gbmResults.filter(x =>
      x.strategy === strat.name && x.configLabel === "RF OFF"
    );
    const gbmOffSharpe = gbmOff.reduce((a, r) => a + r.sharpe, 0) / gbmOff.length;

    const rows: any[] = [];
    rows.push({
      "Config": "RF OFF",
      "Avg Sharpe": gbmOffSharpe.toFixed(3),
      "Δ vs Original": "—",
    });

    const thresholds = gbmThresholdsToTest.get(strat.name)!;
    for (const t of thresholds) {
      const subset = gbmResults.filter(x =>
        x.strategy === strat.name && x.threshold === t && x.configLabel === "RF ON"
      );
      const avgSharpe = subset.reduce((a, r) => a + r.sharpe, 0) / subset.length;

      // Compare to original threshold
      const origSubset = gbmResults.filter(x =>
        x.strategy === strat.name && x.threshold === orig && x.configLabel === "RF ON"
      );
      const origSharpe = origSubset.length > 0
        ? origSubset.reduce((a, r) => a + r.sharpe, 0) / origSubset.length
        : avgSharpe;
      const delta = avgSharpe - origSharpe;

      rows.push({
        "Config": `RF ON (${t})${t === orig ? " [ORIG]" : t === bestHeston ? " [HESTON-BEST]" : ""}`,
        "Avg Sharpe": avgSharpe.toFixed(3),
        "Δ vs Original": t === orig ? "—" : (delta > 0 ? "+" : "") + delta.toFixed(4),
      });
    }
    console.table(rows);

    // Per-condition GBM detail
    console.log(`\n  Per-condition GBM Sharpe:`);
    for (const drift of driftLevels) {
      for (const vol of volLevels) {
        const label = `drift=${drift >= 0 ? "+" : ""}${drift}%, vol=${vol}%`;
        const vals = thresholds.map(t => {
          const r = gbmResults.find(x =>
            x.strategy === strat.name && x.drift === drift && x.vol === vol
            && x.threshold === t && x.configLabel === "RF ON"
          );
          return r ? `t=${t}→${r.sharpe.toFixed(3)}` : "n/a";
        });
        console.log(`    ${label}: ${vals.join(" | ")}`);
      }
    }
    console.log();
  }

  // =======================================================
  // SECTION 7: Model-Adaptive Configuration
  // =======================================================
  console.log("=".repeat(120));
  console.log("=== SECTION 7: MODEL-ADAPTIVE CONFIGURATION ===");
  console.log("=".repeat(120) + "\n");

  const configRows: any[] = [];
  for (const strat of strategies) {
    const origT = originalThresholds.get(strat.name)!;
    const hestonT = bestHestonThresholds.get(strat.name)!;

    // Heston performance at best threshold
    const hestonBestRows = allResults.filter(x =>
      x.strategy === strat.name && x.threshold === hestonT && x.configLabel === "RF ON"
    );
    const hestonBestSharpe = hestonBestRows.reduce((a, r) => a + r.sharpe, 0) / hestonBestRows.length;
    const hestonPosCnt = hestonBestRows.filter(r => r.sharpe > 0).length;

    // GBM performance at original threshold
    const gbmOrigRows = gbmResults.filter(x =>
      x.strategy === strat.name && x.threshold === origT && x.configLabel === "RF ON"
    );
    const gbmOrigSharpe = gbmOrigRows.length > 0
      ? gbmOrigRows.reduce((a, r) => a + r.sharpe, 0) / gbmOrigRows.length
      : 0;

    // GBM performance if we used Heston threshold
    const gbmHestonRows = gbmResults.filter(x =>
      x.strategy === strat.name && x.threshold === hestonT && x.configLabel === "RF ON"
    );
    const gbmCrossSharpe = gbmHestonRows.length > 0
      ? gbmHestonRows.reduce((a, r) => a + r.sharpe, 0) / gbmHestonRows.length
      : gbmOrigSharpe;

    configRows.push({
      "Strategy": strat.name.split("(")[0].trim(),
      "GBM Threshold": origT,
      "Heston Threshold": hestonT,
      "Heston Sharpe": hestonBestSharpe.toFixed(3),
      "Heston Pos": `${hestonPosCnt}/${hestonBestRows.length}`,
      "GBM Sharpe (orig)": gbmOrigSharpe.toFixed(3),
      "GBM Sharpe (heston-t)": gbmCrossSharpe.toFixed(3),
      "GBM Degradation": (gbmCrossSharpe - gbmOrigSharpe < -0.01)
        ? `${(gbmCrossSharpe - gbmOrigSharpe).toFixed(3)} ⚠️`
        : "None",
    });
  }
  console.table(configRows);

  // =======================================================
  // SECTION 8: Recommendations
  // =======================================================
  console.log("\n" + "=".repeat(120));
  console.log("=== SECTION 8: RECOMMENDATIONS ===");
  console.log("=".repeat(120) + "\n");

  // Overall recovery assessment
  console.log("--- HESTON RECOVERY FINAL VERDICT ---\n");

  let totalPositive = 0;
  let totalCombos = 0;

  for (const strat of strategies) {
    const bestThreshold = bestHestonThresholds.get(strat.name)!;
    const bestRows = allResults.filter(x =>
      x.strategy === strat.name && x.threshold === bestThreshold && x.configLabel === "RF ON"
    );
    const posCnt = bestRows.filter(r => r.sharpe > 0).length;
    totalPositive += posCnt;
    totalCombos += bestRows.length;

    const avgSharpe = bestRows.reduce((a, r) => a + r.sharpe, 0) / bestRows.length;
    const avgAPR = bestRows.reduce((a, r) => a + r.meanAPR, 0) / bestRows.length;

    const rfOffRows = allResults.filter(x =>
      x.strategy === strat.name && x.configLabel === "RF OFF"
    );
    const rfOffSharpe = rfOffRows.reduce((a, r) => a + r.sharpe, 0) / rfOffRows.length;

    console.log(`  ${strat.name}:`);
    console.log(`    Optimal Heston threshold: ${bestThreshold}`);
    console.log(`    Avg Sharpe: ${avgSharpe.toFixed(3)} (RF OFF: ${rfOffSharpe.toFixed(3)})`);
    console.log(`    Avg APR: ${avgAPR.toFixed(2)}%`);
    console.log(`    Positive combos: ${posCnt}/${bestRows.length}`);

    if (posCnt === bestRows.length) {
      console.log(`    Status: ✓ FULL RECOVERY`);
    } else if (posCnt > 0 && avgSharpe > 0) {
      console.log(`    Status: ~ PARTIAL RECOVERY (avg Sharpe positive)`);
    } else if (posCnt > 0) {
      console.log(`    Status: ~ WEAK PARTIAL (some positive, avg negative)`);
    } else {
      console.log(`    Status: ✗ NO RECOVERY`);
    }
    console.log();
  }

  console.log(`  OVERALL: ${totalPositive}/${totalCombos} combos positive across all strategies.\n`);

  if (totalPositive === totalCombos) {
    console.log("  CONCLUSION: Threshold recalibration FULLY RECOVERS Heston performance.");
    console.log("  ACTION: Implement model-adaptive skipBelowRatio in presets.\n");
  } else if (totalPositive > totalCombos * 0.5) {
    console.log("  CONCLUSION: Threshold recalibration PARTIALLY RECOVERS Heston performance.");
    console.log("  ACTION: Consider model-adaptive thresholds for strategies with full recovery.\n");
  } else {
    console.log("  CONCLUSION: Threshold recalibration FAILS to recover Heston performance.");
    console.log("  ACTION: CLOSE the Heston investigation. The failure is structural —");
    console.log("          stochastic variance dynamics break the IV/RV spread signal");
    console.log("          regardless of threshold calibration.\n");
  }

  // Optimal config summary
  console.log("--- OPTIMAL CONFIGURATION SUMMARY ---\n");
  for (const strat of strategies) {
    const origT = originalThresholds.get(strat.name)!;
    const hestonT = bestHestonThresholds.get(strat.name)!;

    console.log(`  ${strat.name}:`);
    console.log(`    GBM: skipBelowRatio=${origT} (unchanged)`);

    const hestonBestRows = allResults.filter(x =>
      x.strategy === strat.name && x.threshold === hestonT && x.configLabel === "RF ON"
    );
    const hestonPosCnt = hestonBestRows.filter(r => r.sharpe > 0).length;

    if (hestonPosCnt === hestonBestRows.length) {
      console.log(`    Heston: skipBelowRatio=${hestonT} (model-adaptive)`);
    } else if (strat.name.includes("Conservative")) {
      const rfOffRows = allResults.filter(x =>
        x.strategy === strat.name && x.configLabel === "RF OFF"
      );
      const rfOffSharpe = rfOffRows.reduce((a, r) => a + r.sharpe, 0) / rfOffRows.length;
      const hestonSharpe = hestonBestRows.reduce((a, r) => a + r.sharpe, 0) / hestonBestRows.length;
      if (rfOffSharpe > hestonSharpe) {
        console.log(`    Heston: RF OFF recommended (RF degrades Conservative under Heston)`);
      } else {
        console.log(`    Heston: skipBelowRatio=${hestonT} (partial recovery)`);
      }
    } else {
      console.log(`    Heston: NOT VIABLE — no threshold restores positive Sharpe`);
    }
    console.log();
  }

  console.log("\n=== END OF EXPERIMENT 11 ===\n");
}

main().catch(console.error);
