import { defaultMarketValues, defaultStrategyValues } from "../../src/components/presets.ts";
import { runMonteCarlo } from "../../src/components/monte-carlo.ts";

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

interface DriftResult {
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
  baseMarket: ReturnType<typeof defaultMarketValues>,
  configLabel: string,
  useRegimeFilter: boolean,
) {
  const annualVolDec = vol / 100;
  const base = defaultStrategyValues();

  const marketConfig: any = {
    ...baseMarket,
    startPrice: baseMarket.startPrice,
    annualVol: annualVolDec,
    annualDrift: drift / 100,
    model: "gbm",
    days: 365,
    numSimulations: 1000,
    heston: {
      kappa: baseMarket.kappa,
      theta: baseMarket.theta,
      sigma: baseMarket.sigma,
      rho: baseMarket.rho,
    },
    jump: {
      lambda: baseMarket.lambda,
      muJ: baseMarket.muJ,
      sigmaJ: baseMarket.sigmaJ,
    },
    ivParams: {
      meanReversion: baseMarket.ivMeanReversion,
      volOfVol: baseMarket.ivVolOfVol,
      vrpOffset: annualVolDec * baseMarket.vrpPremiumPct / 100,
    },
  };

  const impliedVol = annualVolDec * (1 + baseMarket.vrpPremiumPct / 100);
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

  return { marketConfig, strategyConfig, configLabel };
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
  drift: number,
  vol: number,
  stratName: string,
  configLabel: string,
  result: { runs: any[]; medianAPR: number; p5APR: number },
): DriftResult {
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
  console.log("=== Experiment 7: Drift Sensitivity ===");
  console.log("Goal: Test Exp 6 optimal configs across drift regimes.");
  console.log("      Does the regime filter fail in bear markets?\n");

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

  const driftLevels = [-30, -10, 0, 5, 20, 50];
  const volLevels = [40, 60, 80, 100];

  const totalCombos = strategies.length * driftLevels.length * volLevels.length * 2;

  console.log(`Strategies: ${strategies.map(s => s.name).join(", ")}`);
  console.log(`Drift levels: ${driftLevels.map(d => (d >= 0 ? "+" : "") + d + "%").join(", ")}`);
  console.log(`Vol levels: ${volLevels.map(v => v + "%").join(", ")}`);
  console.log(`Configs per strategy: Optimal (RF ON) + Baseline (RF OFF) = 2`);
  console.log(`Total unique combinations: ${totalCombos}`);
  console.log(`Paths per combo: ${numSims} | Days: 365 | Model: GBM`);
  console.log(`IV model: Stochastic OU (κ=${baseMarket.ivMeanReversion}, ξ=${baseMarket.ivVolOfVol}, VRP=${baseMarket.vrpPremiumPct}%)\n`);

  let completed = 0;
  const allResults: DriftResult[] = [];

  for (const drift of driftLevels) {
    for (const vol of volLevels) {
      for (const strat of strategies) {
        for (const useRF of [true, false]) {
          const configLabel = useRF ? "Optimal" : "No-RF Baseline";

          const { marketConfig, strategyConfig } = buildConfigs(
            strat, vol, drift, baseMarket, configLabel, useRF,
          );

          const result = runCombo(marketConfig, strategyConfig, numSims);
          const row = extractResult(drift, vol, strat.name, configLabel, result);
          allResults.push(row);

          completed++;
          if (completed % 5 === 0 || completed === totalCombos) {
            process.stdout.write(`  Progress: ${completed}/${totalCombos} (${(completed / totalCombos * 100).toFixed(0)}%)\r`);
          }
        }
      }
    }
  }

  console.log(`\nSweep complete: ${allResults.length} result rows.\n`);

  // =======================================================
  // SECTION 1: Full Ranking by Sharpe (Optimal configs only)
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 1: FULL RANKING — OPTIMAL CONFIGS BY SHARPE ===");
  console.log("=".repeat(110));

  for (const strat of strategies) {
    const subset = allResults
      .filter(r => r.strategy === strat.name && r.configLabel === "Optimal")
      .sort((a, b) => b.sharpe - a.sharpe);

    console.log(`\n${"─".repeat(90)}`);
    console.log(`  ${strat.name}`);
    console.log(`${"─".repeat(90)}`);

    const rows = subset.map((r, i) => ({
      "#": i + 1,
      "Drift%": (r.drift >= 0 ? "+" : "") + r.drift,
      "Vol%": r.vol,
      "Sharpe": r.sharpe.toFixed(3),
      "Sortino": r.sortino.toFixed(3),
      "APR%": r.meanAPR.toFixed(2),
      "P5%": r.p5APR.toFixed(2),
      "MaxDD%": (r.maxDD * 100).toFixed(1),
      "WinRate%": (r.winRate * 100).toFixed(1),
      "Alpha%": r.alpha.toFixed(2),
      "Skip%": r.skipPct.toFixed(1),
    }));
    console.table(rows);
  }

  // =======================================================
  // SECTION 2: Drift Impact on Sharpe (Heatmap)
  // =======================================================
  console.log("\n" + "=".repeat(110));
  console.log("=== SECTION 2: DRIFT IMPACT ON SHARPE — HEATMAP ===");
  console.log("=".repeat(110));
  console.log("Rows = drift levels, Columns = vol levels. Cells = Sharpe.\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} (Optimal) ---`);
    const rows: any[] = [];

    for (const drift of driftLevels) {
      const row: any = { "Drift%": (drift >= 0 ? "+" : "") + drift };
      for (const vol of volLevels) {
        const r = allResults.find(x =>
          x.strategy === strat.name && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
        );
        row[`${vol}% vol`] = r ? r.sharpe.toFixed(3) : "n/a";
      }
      rows.push(row);
    }
    console.table(rows);

    console.log(`  ${strat.name} (No-RF Baseline) ---`);
    const baseRows: any[] = [];
    for (const drift of driftLevels) {
      const row: any = { "Drift%": (drift >= 0 ? "+" : "") + drift };
      for (const vol of volLevels) {
        const r = allResults.find(x =>
          x.strategy === strat.name && x.drift === drift && x.vol === vol && x.configLabel === "No-RF Baseline"
        );
        row[`${vol}% vol`] = r ? r.sharpe.toFixed(3) : "n/a";
      }
      baseRows.push(row);
    }
    console.table(baseRows);
    console.log();
  }

  // =======================================================
  // SECTION 3: Regime Filter Behavior Under Drift
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 3: REGIME FILTER BEHAVIOR UNDER DRIFT ===");
  console.log("=".repeat(110));
  console.log("Does the regime filter skip too many cycles in bear markets?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const drift of driftLevels) {
      for (const vol of volLevels) {
        const optimal = allResults.find(x =>
          x.strategy === strat.name && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
        );
        const baseline = allResults.find(x =>
          x.strategy === strat.name && x.drift === drift && x.vol === vol && x.configLabel === "No-RF Baseline"
        );
        if (!optimal || !baseline) continue;

        const rfDelta = optimal.sharpe - baseline.sharpe;
        rows.push({
          "Drift%": (drift >= 0 ? "+" : "") + drift,
          "Vol%": vol,
          "Skipped": optimal.avgSkippedCycles.toFixed(1),
          "Total": optimal.avgTotalCycles.toFixed(1),
          "Skip%": optimal.skipPct.toFixed(1),
          "RF Sharpe": optimal.sharpe.toFixed(3),
          "NoRF Sharpe": baseline.sharpe.toFixed(3),
          "ΔSharpe (RF)": `${rfDelta > 0 ? "+" : ""}${rfDelta.toFixed(3)}`,
          "RF APR%": optimal.meanAPR.toFixed(2),
          "NoRF APR%": baseline.meanAPR.toFixed(2),
        });
      }
    }
    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 4: Sharpe Zero Crossover by Drift
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 4: SHARPE ZERO CROSSOVER — DEPLOYMENT ZONE ===");
  console.log("=".repeat(110));
  console.log("For each strategy × vol, find the drift level where Sharpe crosses zero.\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const vol of volLevels) {
      const points = driftLevels.map(drift => {
        const r = allResults.find(x =>
          x.strategy === strat.name && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
        );
        return { drift, sharpe: r?.sharpe ?? 0 };
      });

      const allPositive = points.every(p => p.sharpe > 0);
      const allNegative = points.every(p => p.sharpe <= 0);

      let crossover = "n/a";
      if (allPositive) {
        crossover = `Always positive (min ${Math.min(...points.map(p => p.sharpe)).toFixed(3)} @ ${points.reduce((a, b) => a.sharpe < b.sharpe ? a : b).drift}%)`;
      } else if (allNegative) {
        crossover = `Always negative (max ${Math.max(...points.map(p => p.sharpe)).toFixed(3)} @ ${points.reduce((a, b) => a.sharpe > b.sharpe ? a : b).drift}%)`;
      } else {
        for (let i = 0; i < points.length - 1; i++) {
          if ((points[i].sharpe <= 0 && points[i + 1].sharpe > 0) ||
              (points[i].sharpe > 0 && points[i + 1].sharpe <= 0)) {
            const a = points[i], b = points[i + 1];
            const interpDrift = a.drift + (0 - a.sharpe) * (b.drift - a.drift) / (b.sharpe - a.sharpe);
            crossover = `~${interpDrift.toFixed(0)}% (between ${a.drift}% and ${b.drift}%)`;
            break;
          }
        }
      }

      rows.push({
        "Vol%": vol,
        "Crossover": crossover,
        ...Object.fromEntries(points.map(p => [
          `S@${p.drift >= 0 ? "+" : ""}${p.drift}%`,
          p.sharpe.toFixed(3),
        ])),
      });
    }
    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 5: Alpha vs Buy-and-Hold
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 5: ALPHA VS BUY-AND-HOLD ACROSS DRIFT ===");
  console.log("=".repeat(110));
  console.log("Wheel alpha should increase in bear markets (B&H loses, premium cushions).\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} (Optimal) ---`);
    const rows: any[] = [];

    for (const drift of driftLevels) {
      const row: any = { "Drift%": (drift >= 0 ? "+" : "") + drift };
      for (const vol of volLevels) {
        const r = allResults.find(x =>
          x.strategy === strat.name && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
        );
        if (r) {
          row[`α@${vol}%`] = `${r.alpha > 0 ? "+" : ""}${r.alpha.toFixed(2)}%`;
        }
      }
      rows.push(row);
    }
    console.table(rows);

    const alphaRows: any[] = [];
    for (const drift of driftLevels) {
      const row: any = { "Drift%": (drift >= 0 ? "+" : "") + drift };
      for (const vol of volLevels) {
        const r = allResults.find(x =>
          x.strategy === strat.name && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
        );
        if (r) {
          row[`APR@${vol}%`] = r.meanAPR.toFixed(2) + "%";
          row[`BH@${vol}%`] = r.benchAPR.toFixed(2) + "%";
        }
      }
      alphaRows.push(row);
    }
    console.log("  Detail (APR vs Benchmark):");
    console.table(alphaRows);
    console.log();
  }

  // =======================================================
  // SECTION 6: Config Stability — Do optimal features change?
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 6: CONFIG STABILITY — RF VALUE ACROSS DRIFT ===");
  console.log("=".repeat(110));
  console.log("ΔSharpe from regime filter across all drift × vol. Is RF always beneficial?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);

    const heatRows: any[] = [];
    let rfWins = 0;
    let rfLosses = 0;
    let totalDelta = 0;
    let combos = 0;

    for (const drift of driftLevels) {
      const row: any = { "Drift%": (drift >= 0 ? "+" : "") + drift };
      for (const vol of volLevels) {
        const optimal = allResults.find(x =>
          x.strategy === strat.name && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
        );
        const baseline = allResults.find(x =>
          x.strategy === strat.name && x.drift === drift && x.vol === vol && x.configLabel === "No-RF Baseline"
        );
        if (!optimal || !baseline) continue;

        const d = optimal.sharpe - baseline.sharpe;
        row[`Δ@${vol}%`] = `${d > 0 ? "+" : ""}${d.toFixed(3)}`;
        if (d > 0) rfWins++;
        else rfLosses++;
        totalDelta += d;
        combos++;
      }
      heatRows.push(row);
    }
    console.table(heatRows);
    console.log(`  RF wins: ${rfWins}/${combos}, RF losses: ${rfLosses}/${combos}, Mean ΔSharpe: ${(totalDelta / combos).toFixed(4)}`);
    console.log();
  }

  // =======================================================
  // SECTION 7: Summary & Deployment Rules
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 7: SUMMARY & DEPLOYMENT RECOMMENDATIONS ===");
  console.log("=".repeat(110) + "\n");

  for (const strat of strategies) {
    const optimal = allResults.filter(r => r.strategy === strat.name && r.configLabel === "Optimal");

    const sortedBySharpe = [...optimal].sort((a, b) => b.sharpe - a.sharpe);
    const top1 = sortedBySharpe[0];
    const worst = sortedBySharpe[sortedBySharpe.length - 1];

    const positiveCount = optimal.filter(r => r.sharpe > 0).length;
    const totalCount = optimal.length;

    console.log(`${strat.name}:`);
    console.log(`  Best:  drift=${top1.drift >= 0 ? "+" : ""}${top1.drift}%, vol=${top1.vol}% → Sharpe=${top1.sharpe.toFixed(3)}, APR=${top1.meanAPR.toFixed(2)}%, Alpha=${top1.alpha.toFixed(2)}%`);
    console.log(`  Worst: drift=${worst.drift >= 0 ? "+" : ""}${worst.drift}%, vol=${worst.vol}% → Sharpe=${worst.sharpe.toFixed(3)}, APR=${worst.meanAPR.toFixed(2)}%, Alpha=${worst.alpha.toFixed(2)}%`);
    console.log(`  Positive Sharpe: ${positiveCount}/${totalCount} combos (${(positiveCount/totalCount*100).toFixed(0)}%)`);

    const byDrift: any[] = [];
    for (const drift of driftLevels) {
      const driftSubset = optimal.filter(r => r.drift === drift);
      const avgSharpe = driftSubset.reduce((a, r) => a + r.sharpe, 0) / driftSubset.length;
      const avgAlpha = driftSubset.reduce((a, r) => a + r.alpha, 0) / driftSubset.length;
      const avgSkipPct = driftSubset.reduce((a, r) => a + r.skipPct, 0) / driftSubset.length;
      const posCount = driftSubset.filter(r => r.sharpe > 0).length;
      byDrift.push({
        "Drift%": (drift >= 0 ? "+" : "") + drift,
        "Avg Sharpe": avgSharpe.toFixed(3),
        "Avg Alpha%": `${avgAlpha > 0 ? "+" : ""}${avgAlpha.toFixed(2)}`,
        "Avg Skip%": avgSkipPct.toFixed(1),
        "Pos/Total": `${posCount}/${driftSubset.length}`,
      });
    }
    console.log("  Performance by drift:");
    console.table(byDrift);
    console.log();
  }

  // Drift deployment zone summary
  console.log("--- DRIFT DEPLOYMENT ZONE SUMMARY ---\n");
  console.log("Key: ✓ = Sharpe > 0 at all tested vol levels | ~ = Mixed | ✗ = Sharpe ≤ 0 at all vol levels\n");

  const zoneRows: any[] = [];
  for (const drift of driftLevels) {
    const row: any = { "Drift%": (drift >= 0 ? "+" : "") + drift };
    for (const strat of strategies) {
      const subset = allResults.filter(r =>
        r.strategy === strat.name && r.drift === drift && r.configLabel === "Optimal"
      );
      const posCount = subset.filter(r => r.sharpe > 0).length;
      if (posCount === subset.length) row[strat.name.split(" ")[0]] = "✓";
      else if (posCount === 0) row[strat.name.split(" ")[0]] = "✗";
      else row[strat.name.split(" ")[0]] = `~ (${posCount}/${subset.length})`;
    }
    zoneRows.push(row);
  }
  console.table(zoneRows);

  console.log("\n--- DOES ACTIVE'S 1.044 SHARPE DEPEND ON POSITIVE DRIFT? ---\n");
  const activeAt40 = allResults.filter(r =>
    r.strategy === "Active (δ0.20/3d)" && r.vol === 40 && r.configLabel === "Optimal"
  ).sort((a, b) => a.drift - b.drift);

  const activeRows = activeAt40.map(r => ({
    "Drift%": (r.drift >= 0 ? "+" : "") + r.drift,
    "Sharpe": r.sharpe.toFixed(3),
    "APR%": r.meanAPR.toFixed(2),
    "MaxDD%": (r.maxDD * 100).toFixed(1),
    "WinRate%": (r.winRate * 100).toFixed(1),
    "Alpha%": r.alpha.toFixed(2),
    "Skip%": r.skipPct.toFixed(1),
  }));
  console.table(activeRows);
}

main().catch(console.error);
