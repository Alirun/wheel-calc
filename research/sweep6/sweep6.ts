import { defaultMarketValues, defaultStrategyValues } from "../../src/components/presets.ts";
import { runMonteCarlo } from "../../src/components/monte-carlo.ts";

interface StrategyProfile {
  name: string;
  delta: number;
  cycle: number;
  skipThreshold: number;
  putRollEnabled: boolean;
  putRollInitialDTE: number;
  putRollWhenBelow: number;
}

interface FeatureSet {
  regimeFilter: boolean;
  adaptiveCalls: boolean;
  callRolling: boolean;
  putRolling: boolean;
  stopLoss: boolean;
}

interface StackResult {
  vol: number;
  strategy: string;
  features: FeatureSet;
  featureLabel: string;
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
  avgStopLosses: number;
  avgPutRolls: number;
}

function featureLabel(f: FeatureSet): string {
  const parts: string[] = [];
  if (f.regimeFilter) parts.push("RF");
  if (f.adaptiveCalls) parts.push("AC");
  if (f.callRolling) parts.push("CR");
  if (f.putRolling) parts.push("PR");
  if (f.stopLoss) parts.push("SL");
  return parts.length === 0 ? "NONE" : parts.join("+");
}

function featureCount(f: FeatureSet): number {
  return [f.regimeFilter, f.adaptiveCalls, f.callRolling, f.putRolling, f.stopLoss]
    .filter(Boolean).length;
}

function generateFeatureCombos(includePutRoll: boolean): FeatureSet[] {
  const combos: FeatureSet[] = [];
  const bools = [false, true];
  for (const rf of bools) {
    for (const ac of bools) {
      for (const cr of bools) {
        const prOptions = includePutRoll ? bools : [false];
        for (const pr of prOptions) {
          for (const sl of bools) {
            combos.push({
              regimeFilter: rf,
              adaptiveCalls: ac,
              callRolling: cr,
              putRolling: pr,
              stopLoss: sl,
            });
          }
        }
      }
    }
  }
  return combos;
}

async function main() {
  console.log("=== Experiment 6: Combined Feature Stack ===");
  console.log("Goal: Test full combination of best settings from Experiments 2-5.");
  console.log("      Do features stack additively or interfere?\n");

  const baseMarket = defaultMarketValues();
  const annualDrift = 5;
  const model = "gbm";
  const numSims = 1000;
  const days = 365;

  const strategies: StrategyProfile[] = [
    { name: "Conservative (δ0.10/30d)", delta: 0.10, cycle: 30, skipThreshold: 1.0,
      putRollEnabled: true, putRollInitialDTE: 30, putRollWhenBelow: 14 },
    { name: "Moderate (δ0.20/14d)", delta: 0.20, cycle: 14, skipThreshold: 1.2,
      putRollEnabled: true, putRollInitialDTE: 14, putRollWhenBelow: 7 },
    { name: "Active (δ0.20/3d)", delta: 0.20, cycle: 3, skipThreshold: 1.2,
      putRollEnabled: false, putRollInitialDTE: 0, putRollWhenBelow: 0 },
  ];

  const volLevels = [40, 60, 80, 100];

  let totalCombos = 0;
  for (const strat of strategies) {
    totalCombos += generateFeatureCombos(strat.putRollEnabled).length * volLevels.length;
  }

  console.log(`Strategies: ${strategies.map(s => s.name).join(", ")}`);
  console.log(`Vol levels: ${volLevels.map(v => v + "%").join(", ")}`);
  console.log(`Total unique combinations: ${totalCombos}`);
  console.log(`Paths per combo: ${numSims} | Days: ${days} | Drift: ${annualDrift}% | Model: ${model}`);
  console.log(`IV model: Stochastic OU (κ=${baseMarket.ivMeanReversion}, ξ=${baseMarket.ivVolOfVol}, VRP=${baseMarket.vrpPremiumPct}%)\n`);

  let completed = 0;
  const allResults: StackResult[] = [];

  for (const vol of volLevels) {
    for (const strat of strategies) {
      const combos = generateFeatureCombos(strat.putRollEnabled);

      for (const features of combos) {
        const annualVolDec = vol / 100;

        const marketConfig: any = {
          ...baseMarket,
          startPrice: baseMarket.startPrice,
          annualVol: annualVolDec,
          annualDrift: annualDrift / 100,
          model: model,
          days: days,
          numSimulations: numSims,
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
          }
        };

        const base = defaultStrategyValues();
        const impliedVol = annualVolDec * (1 + baseMarket.vrpPremiumPct / 100);
        const strategyConfig: any = {
          targetDelta: strat.delta,
          cycleLengthDays: strat.cycle,
          impliedVol: impliedVol,
          riskFreeRate: baseMarket.riskFreeRate / 100,
          contracts: base.contracts,
          bidAskSpreadPct: baseMarket.bidAskSpreadPct / 100,
          feePerTrade: baseMarket.feePerTrade,

          ...(features.adaptiveCalls ? {
            adaptiveCalls: {
              minDelta: base.minCallDelta,
              maxDelta: base.maxCallDelta,
              skipThresholdPct: 0,
              minStrikeAtCost: base.minStrikeAtCost,
            }
          } : {}),

          ...(features.regimeFilter || features.adaptiveCalls ? {
            ivRvSpread: {
              lookbackDays: 20,
              minMultiplier: 0.8,
              maxMultiplier: 1.3,
              ...(features.regimeFilter ? {
                skipBelowRatio: strat.skipThreshold,
                skipSide: "put" as const,
              } : {}),
            }
          } : {}),

          ...(features.callRolling ? {
            rollCall: {
              itmThresholdPct: 5,
              requireNetCredit: true,
            }
          } : {}),

          ...(features.putRolling && strat.putRollEnabled ? {
            rollPut: {
              initialDTE: strat.putRollInitialDTE,
              rollWhenDTEBelow: strat.putRollWhenBelow,
              requireNetCredit: true,
            }
          } : {}),

          ...(features.stopLoss ? {
            stopLoss: {
              drawdownPct: 25,
              cooldownDays: 7,
            }
          } : {}),
        };

        const result = runMonteCarlo(marketConfig as any, strategyConfig, numSims);
        const runs = result.runs;
        const count = runs.length;

        const avgAPR = runs.reduce((acc, r) => acc + (isNaN(r.apr) ? 0 : r.apr), 0) / count;
        const validSharpes = runs.filter(r => !isNaN(r.sharpe));
        const avgSharpe = validSharpes.length > 0
          ? validSharpes.reduce((acc, r) => acc + r.sharpe, 0) / validSharpes.length
          : 0;
        const validSortinos = runs.filter(r => !isNaN(r.sortino));
        const avgSortino = validSortinos.length > 0
          ? validSortinos.reduce((acc, r) => acc + r.sortino, 0) / validSortinos.length
          : 0;
        const avgMaxDD = runs.reduce((acc, r) => acc + (isNaN(r.maxDrawdown) ? 0 : r.maxDrawdown), 0) / count;
        const winRate = runs.filter(r => r.isWin).length / count;
        const avgBenchAPR = runs.reduce((acc, r) => acc + (isNaN(r.benchmarkAPR) ? 0 : r.benchmarkAPR), 0) / count;
        const avgSkipped = runs.reduce((acc, r) => acc + r.skippedCycles, 0) / count;
        const avgStopLosses = runs.reduce((acc, r) => acc + r.totalStopLosses, 0) / count;
        const avgPutRolls = runs.reduce((acc, r) => acc + r.totalPutRolls, 0) / count;

        allResults.push({
          vol,
          strategy: strat.name,
          features,
          featureLabel: featureLabel(features),
          meanAPR: avgAPR,
          medianAPR: result.medianAPR,
          p5APR: result.p5APR,
          sharpe: avgSharpe,
          sortino: avgSortino,
          maxDD: avgMaxDD,
          winRate,
          benchAPR: avgBenchAPR,
          alpha: avgAPR - avgBenchAPR,
          avgSkippedCycles: avgSkipped,
          avgStopLosses,
          avgPutRolls,
        });

        completed++;
        if (completed % 10 === 0 || completed === totalCombos) {
          process.stdout.write(`  Progress: ${completed}/${totalCombos} (${(completed / totalCombos * 100).toFixed(0)}%)\r`);
        }
      }
    }
  }

  console.log(`\nSweep complete: ${allResults.length} result rows.\n`);

  // =======================================================
  // SECTION 1: Feature Stacking — Best configs ranked by Sharpe
  // =======================================================
  console.log("=".repeat(100));
  console.log("=== SECTION 1: FULL RANKING — ALL COMBOS BY SHARPE ===");
  console.log("=".repeat(100));

  for (const strat of strategies) {
    for (const vol of volLevels) {
      const subset = allResults
        .filter(r => r.strategy === strat.name && r.vol === vol)
        .sort((a, b) => b.sharpe - a.sharpe);

      console.log(`\n${"─".repeat(80)}`);
      console.log(`  ${strat.name} @ ${vol}% vol`);
      console.log(`${"─".repeat(80)}`);

      const rows = subset.map((r, i) => ({
        "#": i + 1,
        "Features": r.featureLabel,
        "Sharpe": r.sharpe.toFixed(3),
        "APR%": r.meanAPR.toFixed(2),
        "P5%": r.p5APR.toFixed(2),
        "MaxDD%": (r.maxDD * 100).toFixed(1),
        "WinRate%": (r.winRate * 100).toFixed(1),
        "Alpha%": r.alpha.toFixed(2),
        "SL#": r.avgStopLosses.toFixed(2),
        "Roll#": r.avgPutRolls.toFixed(1),
        "Skip#": r.avgSkippedCycles.toFixed(1),
      }));
      console.table(rows);
    }
  }

  // =======================================================
  // SECTION 2: Marginal Feature Contributions
  // =======================================================
  console.log("\n" + "=".repeat(100));
  console.log("=== SECTION 2: MARGINAL FEATURE CONTRIBUTION (ΔSharpe) ===");
  console.log("=".repeat(100));
  console.log("Average Sharpe improvement when turning ON a feature, averaged across all other feature toggles.\n");

  const featureNames: (keyof FeatureSet)[] = ["regimeFilter", "adaptiveCalls", "callRolling", "putRolling", "stopLoss"];
  const featureLabels: Record<string, string> = {
    regimeFilter: "Regime Filter",
    adaptiveCalls: "Adaptive Calls",
    callRolling: "Call Rolling",
    putRolling: "Put Rolling",
    stopLoss: "Stop-Loss",
  };

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const vol of volLevels) {
      const subset = allResults.filter(r => r.strategy === strat.name && r.vol === vol);
      const row: any = { "Vol%": vol };

      for (const feat of featureNames) {
        if (feat === "putRolling" && !strat.putRollEnabled) {
          row[featureLabels[feat]] = "n/a";
          continue;
        }

        const withFeat = subset.filter(r => r.features[feat]);
        const withoutFeat = subset.filter(r => !r.features[feat]);

        if (withFeat.length === 0 || withoutFeat.length === 0) {
          row[featureLabels[feat]] = "n/a";
          continue;
        }

        const avgWith = withFeat.reduce((a, r) => a + r.sharpe, 0) / withFeat.length;
        const avgWithout = withoutFeat.reduce((a, r) => a + r.sharpe, 0) / withoutFeat.length;
        const delta = avgWith - avgWithout;
        row[featureLabels[feat]] = `${delta > 0 ? "+" : ""}${delta.toFixed(3)}`;
      }
      rows.push(row);
    }
    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 3: Feature Interaction Detection
  // =======================================================
  console.log("=".repeat(100));
  console.log("=== SECTION 3: FEATURE INTERACTION DETECTION ===");
  console.log("=".repeat(100));
  console.log("Interaction = (AB together) - (A alone) - (B alone) + (neither)");
  console.log("Positive = synergy, Negative = interference. Flagged if |interaction| > 0.02.\n");

  const featurePairs: [keyof FeatureSet, keyof FeatureSet][] = [
    ["regimeFilter", "stopLoss"],
    ["regimeFilter", "callRolling"],
    ["regimeFilter", "putRolling"],
    ["regimeFilter", "adaptiveCalls"],
    ["callRolling", "stopLoss"],
    ["putRolling", "stopLoss"],
    ["adaptiveCalls", "stopLoss"],
    ["callRolling", "putRolling"],
    ["adaptiveCalls", "callRolling"],
    ["adaptiveCalls", "putRolling"],
  ];

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const [featA, featB] of featurePairs) {
      if ((featA === "putRolling" || featB === "putRolling") && !strat.putRollEnabled) continue;

      let totalInteraction = 0;
      let count = 0;

      for (const vol of volLevels) {
        const subset = allResults.filter(r => r.strategy === strat.name && r.vol === vol);

        const both = subset.filter(r => r.features[featA] && r.features[featB]);
        const onlyA = subset.filter(r => r.features[featA] && !r.features[featB]);
        const onlyB = subset.filter(r => !r.features[featA] && r.features[featB]);
        const neither = subset.filter(r => !r.features[featA] && !r.features[featB]);

        if (both.length === 0 || onlyA.length === 0 || onlyB.length === 0 || neither.length === 0) continue;

        const avgBoth = both.reduce((a, r) => a + r.sharpe, 0) / both.length;
        const avgA = onlyA.reduce((a, r) => a + r.sharpe, 0) / onlyA.length;
        const avgB = onlyB.reduce((a, r) => a + r.sharpe, 0) / onlyB.length;
        const avgNeither = neither.reduce((a, r) => a + r.sharpe, 0) / neither.length;

        totalInteraction += (avgBoth - avgA - avgB + avgNeither);
        count++;
      }

      if (count === 0) continue;
      const avgInteraction = totalInteraction / count;
      const flag = Math.abs(avgInteraction) > 0.02 ? " ⚠️" : "";

      rows.push({
        "Pair": `${featureLabels[featA]} × ${featureLabels[featB]}`,
        "Interaction": `${avgInteraction > 0 ? "+" : ""}${avgInteraction.toFixed(4)}${flag}`,
        "Type": avgInteraction > 0.005 ? "SYNERGY" : avgInteraction < -0.005 ? "CONFLICT" : "NEUTRAL",
      });
    }
    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 4: Stop-Loss Redundancy Test
  // =======================================================
  console.log("=".repeat(100));
  console.log("=== SECTION 4: STOP-LOSS REDUNDANCY TEST ===");
  console.log("=".repeat(100));
  console.log("Does regime filter make stop-loss redundant?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const vol of volLevels) {
      const subset = allResults.filter(r => r.strategy === strat.name && r.vol === vol);

      const noRF_noSL = subset.find(r => !r.features.regimeFilter && !r.features.stopLoss
        && !r.features.adaptiveCalls && !r.features.callRolling && !r.features.putRolling);
      const noRF_SL = subset.find(r => !r.features.regimeFilter && r.features.stopLoss
        && !r.features.adaptiveCalls && !r.features.callRolling && !r.features.putRolling);
      const RF_noSL = subset.find(r => r.features.regimeFilter && !r.features.stopLoss
        && !r.features.adaptiveCalls && !r.features.callRolling && !r.features.putRolling);
      const RF_SL = subset.find(r => r.features.regimeFilter && r.features.stopLoss
        && !r.features.adaptiveCalls && !r.features.callRolling && !r.features.putRolling);

      if (!noRF_noSL || !noRF_SL || !RF_noSL || !RF_SL) continue;

      rows.push({
        "Vol%": vol,
        "Config": "Baseline (no RF, no SL)",
        "Sharpe": noRF_noSL.sharpe.toFixed(3),
        "APR%": noRF_noSL.meanAPR.toFixed(2),
        "MaxDD%": (noRF_noSL.maxDD * 100).toFixed(1),
        "SL#": noRF_noSL.avgStopLosses.toFixed(2),
        "Skip#": noRF_noSL.avgSkippedCycles.toFixed(1),
      });
      rows.push({
        "Vol%": "",
        "Config": "+ Stop-Loss only",
        "Sharpe": noRF_SL.sharpe.toFixed(3),
        "APR%": noRF_SL.meanAPR.toFixed(2),
        "MaxDD%": (noRF_SL.maxDD * 100).toFixed(1),
        "SL#": noRF_SL.avgStopLosses.toFixed(2),
        "Skip#": noRF_SL.avgSkippedCycles.toFixed(1),
      });
      rows.push({
        "Vol%": "",
        "Config": "+ Regime Filter only",
        "Sharpe": RF_noSL.sharpe.toFixed(3),
        "APR%": RF_noSL.meanAPR.toFixed(2),
        "MaxDD%": (RF_noSL.maxDD * 100).toFixed(1),
        "SL#": RF_noSL.avgStopLosses.toFixed(2),
        "Skip#": RF_noSL.avgSkippedCycles.toFixed(1),
      });
      rows.push({
        "Vol%": "",
        "Config": "+ Both RF + SL",
        "Sharpe": RF_SL.sharpe.toFixed(3),
        "APR%": RF_SL.meanAPR.toFixed(2),
        "MaxDD%": (RF_SL.maxDD * 100).toFixed(1),
        "SL#": RF_SL.avgStopLosses.toFixed(2),
        "Skip#": RF_SL.avgSkippedCycles.toFixed(1),
      });
      rows.push({ "Vol%": "---", "Config": "---", "Sharpe": "---", "APR%": "---",
        "MaxDD%": "---", "SL#": "---", "Skip#": "---" });
    }
    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 5: Best Complete Configs per Strategy
  // =======================================================
  console.log("=".repeat(100));
  console.log("=== SECTION 5: BEST COMPLETE CONFIG PER STRATEGY ===");
  console.log("=".repeat(100));
  console.log("Top 5 configs per strategy, across all vol levels.\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const allForStrat = allResults
      .filter(r => r.strategy === strat.name)
      .sort((a, b) => b.sharpe - a.sharpe);

    const top5 = allForStrat.slice(0, 5);
    const rows = top5.map((r, i) => ({
      "#": i + 1,
      "Vol%": r.vol,
      "Features": r.featureLabel,
      "Sharpe": r.sharpe.toFixed(3),
      "Sortino": r.sortino.toFixed(3),
      "APR%": r.meanAPR.toFixed(2),
      "P5%": r.p5APR.toFixed(2),
      "MaxDD%": (r.maxDD * 100).toFixed(1),
      "WinRate%": (r.winRate * 100).toFixed(1),
      "Alpha%": r.alpha.toFixed(2),
      "SL#": r.avgStopLosses.toFixed(2),
      "Roll#": r.avgPutRolls.toFixed(1),
      "Skip#": r.avgSkippedCycles.toFixed(1),
    }));
    console.table(rows);

    // Also show best per vol level
    console.log(`\n  Best per vol level:`);
    for (const vol of volLevels) {
      const best = allForStrat.filter(r => r.vol === vol)[0];
      console.log(`    ${vol}%: ${best.featureLabel} → Sharpe ${best.sharpe.toFixed(3)}, APR ${best.meanAPR.toFixed(2)}%, MaxDD ${(best.maxDD*100).toFixed(1)}%`);
    }
    console.log();
  }

  // =======================================================
  // SECTION 6: Vol Robustness of Best Configs
  // =======================================================
  console.log("=".repeat(100));
  console.log("=== SECTION 6: VOL ROBUSTNESS — TOP CONFIGS ACROSS VOL LEVELS ===");
  console.log("=".repeat(100));
  console.log("How does each strategy's overall best config perform at other vol levels?\n");

  for (const strat of strategies) {
    const allForStrat = allResults.filter(r => r.strategy === strat.name);
    const overallBest = allForStrat.sort((a, b) => b.sharpe - a.sharpe)[0];
    const bestLabel = overallBest.featureLabel;

    console.log(`--- ${strat.name} — Best: ${bestLabel} ---`);
    const rows: any[] = [];

    for (const vol of volLevels) {
      const r = allResults.find(x =>
        x.strategy === strat.name && x.vol === vol && x.featureLabel === bestLabel
      );
      if (!r) continue;

      const baseline = allResults.find(x =>
        x.strategy === strat.name && x.vol === vol && x.featureLabel === "NONE"
      )!;

      rows.push({
        "Vol%": vol,
        "Sharpe": r.sharpe.toFixed(3),
        "vs Baseline": `${(r.sharpe - baseline.sharpe) > 0 ? "+" : ""}${(r.sharpe - baseline.sharpe).toFixed(3)}`,
        "APR%": r.meanAPR.toFixed(2),
        "MaxDD%": (r.maxDD * 100).toFixed(1),
        "WinRate%": (r.winRate * 100).toFixed(1),
        "Alpha%": r.alpha.toFixed(2),
        "SL#": r.avgStopLosses.toFixed(2),
      });
    }
    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 7: Full Stack vs Baseline
  // =======================================================
  console.log("=".repeat(100));
  console.log("=== SECTION 7: FULL STACK (ALL ON) vs BASELINE (ALL OFF) ===");
  console.log("=".repeat(100) + "\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const vol of volLevels) {
      const baseline = allResults.find(r =>
        r.strategy === strat.name && r.vol === vol && r.featureLabel === "NONE"
      )!;
      const fullStackLabel = strat.putRollEnabled ? "RF+AC+CR+PR+SL" : "RF+AC+CR+SL";
      const fullStack = allResults.find(r =>
        r.strategy === strat.name && r.vol === vol && r.featureLabel === fullStackLabel
      )!;
      const best = allResults
        .filter(r => r.strategy === strat.name && r.vol === vol)
        .sort((a, b) => b.sharpe - a.sharpe)[0];

      rows.push({
        "Vol%": vol,
        "Baseline Sharpe": baseline.sharpe.toFixed(3),
        "Full Stack Sharpe": fullStack.sharpe.toFixed(3),
        "ΔSharpe": `${(fullStack.sharpe - baseline.sharpe) > 0 ? "+" : ""}${(fullStack.sharpe - baseline.sharpe).toFixed(3)}`,
        "Best Config": best.featureLabel,
        "Best Sharpe": best.sharpe.toFixed(3),
        "Full APR%": fullStack.meanAPR.toFixed(2),
        "Full MaxDD%": (fullStack.maxDD * 100).toFixed(1),
      });
    }
    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 8: Summary & Preset Recommendations
  // =======================================================
  console.log("=".repeat(100));
  console.log("=== SECTION 8: SUMMARY & PRESET RECOMMENDATIONS ===");
  console.log("=".repeat(100) + "\n");

  for (const strat of strategies) {
    const allForStrat = allResults.filter(r => r.strategy === strat.name);

    // Overall best across all vol levels
    const sortedBySharpe = [...allForStrat].sort((a, b) => b.sharpe - a.sharpe);
    const top1 = sortedBySharpe[0];

    // Best at the sweet-spot vol (60%)
    const best60 = allForStrat
      .filter(r => r.vol === 60)
      .sort((a, b) => b.sharpe - a.sharpe)[0];

    // Baseline for comparison
    const baseline60 = allForStrat.find(r => r.vol === 60 && r.featureLabel === "NONE")!;

    console.log(`${strat.name}:`);
    console.log(`  Overall Best: vol=${top1.vol}%, features=${top1.featureLabel}`);
    console.log(`    Sharpe=${top1.sharpe.toFixed(3)}, APR=${top1.meanAPR.toFixed(2)}%, MaxDD=${(top1.maxDD*100).toFixed(1)}%, WinRate=${(top1.winRate*100).toFixed(1)}%`);
    console.log(`    Alpha=${top1.alpha.toFixed(2)}%, SL#=${top1.avgStopLosses.toFixed(2)}, Rolls=${top1.avgPutRolls.toFixed(1)}, Skipped=${top1.avgSkippedCycles.toFixed(1)}`);
    console.log(`  Best @60% vol: features=${best60.featureLabel}`);
    console.log(`    Sharpe=${best60.sharpe.toFixed(3)}, APR=${best60.meanAPR.toFixed(2)}%, MaxDD=${(best60.maxDD*100).toFixed(1)}%`);
    console.log(`  Baseline @60%: Sharpe=${baseline60.sharpe.toFixed(3)}, APR=${baseline60.meanAPR.toFixed(2)}%`);
    console.log(`  Full stack improvement @60%: ${(best60.sharpe - baseline60.sharpe) > 0 ? "+" : ""}${(best60.sharpe - baseline60.sharpe).toFixed(3)} Sharpe\n`);
  }

  // Feature importance ranking
  console.log("--- FEATURE IMPORTANCE (mean marginal ΔSharpe across all strategies × vol levels) ---\n");
  const featureImportance: { name: string; meanDelta: number }[] = [];

  for (const feat of featureNames) {
    let totalDelta = 0;
    let count = 0;

    for (const strat of strategies) {
      if (feat === "putRolling" && !strat.putRollEnabled) continue;
      for (const vol of volLevels) {
        const subset = allResults.filter(r => r.strategy === strat.name && r.vol === vol);
        const withFeat = subset.filter(r => r.features[feat]);
        const withoutFeat = subset.filter(r => !r.features[feat]);
        if (withFeat.length === 0 || withoutFeat.length === 0) continue;
        const avgWith = withFeat.reduce((a, r) => a + r.sharpe, 0) / withFeat.length;
        const avgWithout = withoutFeat.reduce((a, r) => a + r.sharpe, 0) / withoutFeat.length;
        totalDelta += avgWith - avgWithout;
        count++;
      }
    }

    featureImportance.push({
      name: featureLabels[feat],
      meanDelta: count > 0 ? totalDelta / count : 0,
    });
  }

  featureImportance.sort((a, b) => b.meanDelta - a.meanDelta);
  console.table(featureImportance.map(f => ({
    "Feature": f.name,
    "Mean ΔSharpe": `${f.meanDelta > 0 ? "+" : ""}${f.meanDelta.toFixed(4)}`,
    "Verdict": f.meanDelta > 0.01 ? "KEEP" : f.meanDelta > 0 ? "MARGINAL" : "DROP",
  })));
}

main().catch(console.error);
