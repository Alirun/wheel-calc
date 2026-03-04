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

interface VRPResult {
  vrp: number;
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
  vrpPremiumPct: number,
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
  vrp: number,
  drift: number,
  vol: number,
  stratName: string,
  configLabel: string,
  result: { runs: any[]; medianAPR: number; p5APR: number },
): VRPResult {
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
    vrp,
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
  console.log("=== Experiment 8: VRP Sensitivity ===");
  console.log("Goal: Test whether the regime filter and strategy viability depend on VRP level.");
  console.log("      All prior experiments assumed VRP=15%. Is the framework overfitted to that?\n");

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

  const vrpLevels = [0, 5, 10, 15, 25];
  const driftLevels = [0, -30];
  const volLevels = [40, 60, 80, 100];

  const totalCombos = strategies.length * vrpLevels.length * driftLevels.length * volLevels.length * 2;

  console.log(`Strategies: ${strategies.map(s => s.name).join(", ")}`);
  console.log(`VRP levels: ${vrpLevels.map(v => v + "%").join(", ")}`);
  console.log(`Drift levels: ${driftLevels.map(d => (d >= 0 ? "+" : "") + d + "%").join(", ")}`);
  console.log(`Vol levels: ${volLevels.map(v => v + "%").join(", ")}`);
  console.log(`Configs per strategy: Optimal (RF ON) + Baseline (RF OFF) = 2`);
  console.log(`Total unique combinations: ${totalCombos}`);
  console.log(`Paths per combo: ${numSims} | Days: 365 | Model: GBM`);
  console.log(`IV model: Stochastic OU (κ=${baseMarket.ivMeanReversion}, ξ=${baseMarket.ivVolOfVol})\n`);

  let completed = 0;
  const allResults: VRPResult[] = [];

  for (const vrp of vrpLevels) {
    for (const drift of driftLevels) {
      for (const vol of volLevels) {
        for (const strat of strategies) {
          for (const useRF of [true, false]) {
            const configLabel = useRF ? "Optimal" : "No-RF Baseline";

            const { marketConfig, strategyConfig } = buildConfigs(
              strat, vol, drift, vrp, baseMarket, configLabel, useRF,
            );

            const result = runCombo(marketConfig, strategyConfig, numSims);
            const row = extractResult(vrp, drift, vol, strat.name, configLabel, result);
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
  // SECTION 1: VRP × Strategy Heatmap (Sharpe)
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 1: VRP × STRATEGY SHARPE HEATMAP ===");
  console.log("=".repeat(110));
  console.log("Sharpe at each VRP level, averaged over vol levels. Split by drift.\n");

  for (const drift of driftLevels) {
    console.log(`--- Drift: ${drift >= 0 ? "+" : ""}${drift}% ---`);

    for (const strat of strategies) {
      console.log(`  ${strat.name} (Optimal)`);
      const rows: any[] = [];

      for (const vrp of vrpLevels) {
        const row: any = { "VRP%": vrp };
        let totalSharpe = 0;
        let count = 0;
        for (const vol of volLevels) {
          const r = allResults.find(x =>
            x.strategy === strat.name && x.vrp === vrp && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
          );
          row[`${vol}% vol`] = r ? r.sharpe.toFixed(3) : "n/a";
          if (r) { totalSharpe += r.sharpe; count++; }
        }
        row["Avg"] = count > 0 ? (totalSharpe / count).toFixed(3) : "n/a";
        rows.push(row);
      }
      console.table(rows);
    }
    console.log();
  }

  // =======================================================
  // SECTION 2: RF Value by VRP Level
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 2: REGIME FILTER VALUE BY VRP LEVEL ===");
  console.log("=".repeat(110));
  console.log("ΔSharpe from RF (Optimal − Baseline) at each VRP level. Does RF still help at VRP=0%?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);

    for (const drift of driftLevels) {
      console.log(`  Drift: ${drift >= 0 ? "+" : ""}${drift}%`);
      const rows: any[] = [];

      let rfWins = 0, rfLosses = 0, totalDelta = 0, combos = 0;

      for (const vrp of vrpLevels) {
        const row: any = { "VRP%": vrp };
        for (const vol of volLevels) {
          const optimal = allResults.find(x =>
            x.strategy === strat.name && x.vrp === vrp && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
          );
          const baseline = allResults.find(x =>
            x.strategy === strat.name && x.vrp === vrp && x.drift === drift && x.vol === vol && x.configLabel === "No-RF Baseline"
          );
          if (!optimal || !baseline) continue;

          const d = optimal.sharpe - baseline.sharpe;
          row[`Δ@${vol}%`] = `${d > 0 ? "+" : ""}${d.toFixed(3)}`;
          if (d > 0) rfWins++; else rfLosses++;
          totalDelta += d;
          combos++;
        }
        rows.push(row);
      }
      console.table(rows);
      console.log(`    RF wins: ${rfWins}/${combos}, RF losses: ${rfLosses}/${combos}, Mean ΔSharpe: ${combos > 0 ? (totalDelta / combos).toFixed(4) : "n/a"}`);
    }
    console.log();
  }

  // =======================================================
  // SECTION 3: VRP Zero-Crossing (Sharpe = 0)
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 3: VRP ZERO-CROSSING — MINIMUM VRP FLOOR ===");
  console.log("=".repeat(110));
  console.log("For each strategy × drift × vol, find the VRP level where Sharpe crosses zero.\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);

    for (const drift of driftLevels) {
      console.log(`  Drift: ${drift >= 0 ? "+" : ""}${drift}%`);
      const rows: any[] = [];

      for (const vol of volLevels) {
        const points = vrpLevels.map(vrp => {
          const r = allResults.find(x =>
            x.strategy === strat.name && x.vrp === vrp && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
          );
          return { vrp, sharpe: r?.sharpe ?? 0 };
        });

        const allPositive = points.every(p => p.sharpe > 0);
        const allNegative = points.every(p => p.sharpe <= 0);

        let crossover = "n/a";
        if (allPositive) {
          crossover = `Always positive (min ${Math.min(...points.map(p => p.sharpe)).toFixed(3)} @ VRP=${points.reduce((a, b) => a.sharpe < b.sharpe ? a : b).vrp}%)`;
        } else if (allNegative) {
          crossover = `Always negative (max ${Math.max(...points.map(p => p.sharpe)).toFixed(3)} @ VRP=${points.reduce((a, b) => a.sharpe > b.sharpe ? a : b).vrp}%)`;
        } else {
          for (let i = 0; i < points.length - 1; i++) {
            if ((points[i].sharpe <= 0 && points[i + 1].sharpe > 0) ||
                (points[i].sharpe > 0 && points[i + 1].sharpe <= 0)) {
              const a = points[i], b = points[i + 1];
              const interpVRP = a.vrp + (0 - a.sharpe) * (b.vrp - a.vrp) / (b.sharpe - a.sharpe);
              crossover = `~${interpVRP.toFixed(1)}% VRP (between ${a.vrp}% and ${b.vrp}%)`;
              break;
            }
          }
        }

        rows.push({
          "Vol%": vol,
          "Crossover": crossover,
          ...Object.fromEntries(points.map(p => [
            `S@VRP${p.vrp}%`,
            p.sharpe.toFixed(3),
          ])),
        });
      }
      console.table(rows);
    }
    console.log();
  }

  // =======================================================
  // SECTION 4: Drift × VRP Interaction
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 4: DRIFT × VRP INTERACTION ===");
  console.log("=".repeat(110));
  console.log("Does Active's drift immunity (Exp 7) hold at VRP=0% and 5%?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const vrp of vrpLevels) {
      const row: any = { "VRP%": vrp };

      for (const drift of driftLevels) {
        const subset = allResults.filter(x =>
          x.strategy === strat.name && x.vrp === vrp && x.drift === drift && x.configLabel === "Optimal"
        );
        const avgSharpe = subset.reduce((a, r) => a + r.sharpe, 0) / subset.length;
        const avgAPR = subset.reduce((a, r) => a + r.meanAPR, 0) / subset.length;
        const avgAlpha = subset.reduce((a, r) => a + r.alpha, 0) / subset.length;
        const posCount = subset.filter(r => r.sharpe > 0).length;

        row[`Sharpe@${drift >= 0 ? "+" : ""}${drift}%`] = avgSharpe.toFixed(3);
        row[`APR@${drift >= 0 ? "+" : ""}${drift}%`] = avgAPR.toFixed(2) + "%";
        row[`Pos@${drift >= 0 ? "+" : ""}${drift}%`] = `${posCount}/${subset.length}`;
      }

      const drift0 = allResults.filter(x =>
        x.strategy === strat.name && x.vrp === vrp && x.drift === 0 && x.configLabel === "Optimal"
      );
      const driftNeg = allResults.filter(x =>
        x.strategy === strat.name && x.vrp === vrp && x.drift === -30 && x.configLabel === "Optimal"
      );
      const sharpe0 = drift0.reduce((a, r) => a + r.sharpe, 0) / drift0.length;
      const sharpeNeg = driftNeg.reduce((a, r) => a + r.sharpe, 0) / driftNeg.length;
      row["ΔSharpe (0% vs -30%)"] = (sharpe0 - sharpeNeg).toFixed(3);

      rows.push(row);
    }
    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 5: Skip Rate by VRP
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 5: SKIP RATE BY VRP LEVEL ===");
  console.log("=".repeat(110));
  console.log("How does the fraction of skipped cycles change with VRP? At VRP=0%, RF may skip everything.\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} (Optimal / RF ON) ---`);

    for (const drift of driftLevels) {
      console.log(`  Drift: ${drift >= 0 ? "+" : ""}${drift}%`);
      const rows: any[] = [];

      for (const vrp of vrpLevels) {
        const row: any = { "VRP%": vrp };
        for (const vol of volLevels) {
          const r = allResults.find(x =>
            x.strategy === strat.name && x.vrp === vrp && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
          );
          if (r) {
            row[`Skip@${vol}%`] = r.skipPct.toFixed(1) + "%";
            row[`Exec@${vol}%`] = (r.avgTotalCycles - r.avgSkippedCycles).toFixed(1);
          }
        }
        rows.push(row);
      }
      console.table(rows);
    }
    console.log();
  }

  // =======================================================
  // SECTION 6: VRP Floor Determination
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 6: VRP FLOOR — DEPLOYMENT ZONE ===");
  console.log("=".repeat(110));
  console.log("Minimum VRP for each strategy to maintain Sharpe > 0 at each drift × vol.\n");

  console.log("Key: ✓ = Sharpe > 0 | ✗ = Sharpe ≤ 0\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const drift of driftLevels) {
      for (const vol of volLevels) {
        const row: any = {
          "Drift%": (drift >= 0 ? "+" : "") + drift,
          "Vol%": vol,
        };

        let floorVRP = "None needed";
        for (const vrp of vrpLevels) {
          const r = allResults.find(x =>
            x.strategy === strat.name && x.vrp === vrp && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
          );
          const s = r ? r.sharpe : 0;
          row[`VRP${vrp}%`] = s > 0 ? "✓" : "✗";
        }

        const firstPositive = vrpLevels.find(vrp => {
          const r = allResults.find(x =>
            x.strategy === strat.name && x.vrp === vrp && x.drift === drift && x.vol === vol && x.configLabel === "Optimal"
          );
          return r && r.sharpe > 0;
        });
        row["Floor"] = firstPositive !== undefined ? `≥${firstPositive}%` : "Not viable";
        rows.push(row);
      }
    }
    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 7: skipBelowRatio Sensitivity Check
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 7: skipBelowRatio SENSITIVITY AT DIFFERENT VRP ===");
  console.log("=".repeat(110));
  console.log("Comparing Optimal (RF ON) vs No-RF at each VRP. If RF hurts at low VRP,");
  console.log("the skipBelowRatio threshold may need recalibration.\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} (skipBelowRatio=${strat.skipThreshold}) ---`);
    const rows: any[] = [];

    for (const vrp of vrpLevels) {
      const optimal = allResults.filter(x =>
        x.strategy === strat.name && x.vrp === vrp && x.configLabel === "Optimal"
      );
      const baseline = allResults.filter(x =>
        x.strategy === strat.name && x.vrp === vrp && x.configLabel === "No-RF Baseline"
      );

      const avgOptSharpe = optimal.reduce((a, r) => a + r.sharpe, 0) / optimal.length;
      const avgBaseSharpe = baseline.reduce((a, r) => a + r.sharpe, 0) / baseline.length;
      const avgOptAPR = optimal.reduce((a, r) => a + r.meanAPR, 0) / optimal.length;
      const avgBaseAPR = baseline.reduce((a, r) => a + r.meanAPR, 0) / baseline.length;
      const avgSkipPct = optimal.reduce((a, r) => a + r.skipPct, 0) / optimal.length;

      const rfDelta = avgOptSharpe - avgBaseSharpe;
      const rfWins = optimal.filter((r, i) => r.sharpe > baseline[i]?.sharpe).length;

      rows.push({
        "VRP%": vrp,
        "RF Sharpe": avgOptSharpe.toFixed(3),
        "NoRF Sharpe": avgBaseSharpe.toFixed(3),
        "ΔSharpe": `${rfDelta > 0 ? "+" : ""}${rfDelta.toFixed(3)}`,
        "RF APR%": avgOptAPR.toFixed(2),
        "NoRF APR%": avgBaseAPR.toFixed(2),
        "Avg Skip%": avgSkipPct.toFixed(1),
        "RF Wins": `${rfWins}/${optimal.length}`,
        "Verdict": rfDelta > 0.01 ? "RF HELPS" : rfDelta < -0.01 ? "RF HURTS" : "NEUTRAL",
      });
    }
    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 8: Summary & Conclusions
  // =======================================================
  console.log("=".repeat(110));
  console.log("=== SECTION 8: SUMMARY & CONCLUSIONS ===");
  console.log("=".repeat(110) + "\n");

  console.log("--- OVERALL VRP SENSITIVITY ---\n");
  for (const strat of strategies) {
    const optimal = allResults.filter(r => r.strategy === strat.name && r.configLabel === "Optimal");

    console.log(`${strat.name}:`);

    for (const vrp of vrpLevels) {
      const subset = optimal.filter(r => r.vrp === vrp);
      const avgSharpe = subset.reduce((a, r) => a + r.sharpe, 0) / subset.length;
      const avgAPR = subset.reduce((a, r) => a + r.meanAPR, 0) / subset.length;
      const avgMaxDD = subset.reduce((a, r) => a + r.maxDD, 0) / subset.length;
      const avgWinRate = subset.reduce((a, r) => a + r.winRate, 0) / subset.length;
      const posCount = subset.filter(r => r.sharpe > 0).length;

      console.log(`  VRP=${vrp}%: Sharpe=${avgSharpe.toFixed(3)}, APR=${avgAPR.toFixed(2)}%, MaxDD=${(avgMaxDD * 100).toFixed(1)}%, WinRate=${(avgWinRate * 100).toFixed(1)}%, Positive=${posCount}/${subset.length}`);
    }
    console.log();
  }

  console.log("--- VRP DEPLOYMENT FLOOR SUMMARY ---\n");

  for (const strat of strategies) {
    const stalls: string[] = [];

    for (const drift of driftLevels) {
      let floorVRP: number | null = null;

      for (const vrp of vrpLevels) {
        const subset = allResults.filter(x =>
          x.strategy === strat.name && x.vrp === vrp && x.drift === drift && x.configLabel === "Optimal"
        );
        const allPositive = subset.every(r => r.sharpe > 0);
        if (allPositive && floorVRP === null) {
          floorVRP = vrp;
        }
      }

      const label = `drift=${drift >= 0 ? "+" : ""}${drift}%`;
      if (floorVRP !== null) {
        stalls.push(`${label}: VRP≥${floorVRP}%`);
      } else {
        stalls.push(`${label}: Not viable at any tested VRP`);
      }
    }

    console.log(`  ${strat.name}: ${stalls.join(" | ")}`);
  }

  console.log("\n--- ACTIVE DRIFT IMMUNITY CHECK ---\n");
  console.log("Exp 7 showed Active is drift-immune at VRP=15%. Does this hold at VRP=0%?\n");

  for (const vrp of [0, 5, 10, 15, 25]) {
    const subset = allResults.filter(x =>
      x.strategy === "Active (δ0.20/3d)" && x.vrp === vrp && x.configLabel === "Optimal"
    );
    const posCount = subset.filter(r => r.sharpe > 0).length;
    const avgSharpe = subset.reduce((a, r) => a + r.sharpe, 0) / subset.length;
    const allPos = subset.every(r => r.sharpe > 0);

    console.log(`  VRP=${vrp}%: ${allPos ? "DRIFT-IMMUNE ✓" : `NOT IMMUNE ✗ (${posCount}/${subset.length} positive)`} | Avg Sharpe=${avgSharpe.toFixed(3)}`);

    if (!allPos) {
      const negatives = subset.filter(r => r.sharpe <= 0);
      for (const n of negatives) {
        console.log(`    FAIL: drift=${n.drift >= 0 ? "+" : ""}${n.drift}%, vol=${n.vol}% → Sharpe=${n.sharpe.toFixed(3)}, APR=${n.meanAPR.toFixed(2)}%`);
      }
    }
  }

  console.log("\n--- RF UNIVERSALITY CHECK ---\n");
  console.log("Exp 7: RF wins 72/72 across drift. Does that hold at low VRP?\n");

  for (const vrp of vrpLevels) {
    let wins = 0, losses = 0;
    for (const strat of strategies) {
      const opt = allResults.filter(x => x.strategy === strat.name && x.vrp === vrp && x.configLabel === "Optimal");
      const base = allResults.filter(x => x.strategy === strat.name && x.vrp === vrp && x.configLabel === "No-RF Baseline");

      for (let i = 0; i < opt.length; i++) {
        const matchBase = base.find(b => b.drift === opt[i].drift && b.vol === opt[i].vol);
        if (matchBase) {
          if (opt[i].sharpe > matchBase.sharpe) wins++;
          else losses++;
        }
      }
    }
    console.log(`  VRP=${vrp}%: RF wins ${wins}/${wins + losses} (${((wins / (wins + losses)) * 100).toFixed(0)}%)`);
  }

  console.log();
}

main().catch(console.error);
