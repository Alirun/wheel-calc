# Presets

## Overview

- Purpose: Save, load, and share named Market and Strategy configurations across page sessions.
- Module: `src/components/presets.ts` — pure TypeScript, no framework imports.
- Related docs: `docs/architecture.md`

## Architecture

Two independent preset stores — one for Market config, one for Strategy config — each with:
- **Built-in presets** (hardcoded in `presets.ts`, never written to localStorage)
- **User presets** (persisted in localStorage, can override a built-in by name)

On page load, `getMarketDefaults()` / `getStrategyDefaults()` are called once. They return the stored default preset's values, or the hardcoded defaults if no default is set.

## localStorage Schema

| Key | Contents |
|-----|----------|
| `wheel-calc:market-presets` | `PresetStoreJSON<MarketPresetValues>` |
| `wheel-calc:strategy-presets` | `PresetStoreJSON<StrategyPresetValues>` |

```ts
// What is written to localStorage (built-ins excluded)
interface PresetStoreJSON<T> {
  presets: Array<{ name: string; values: T; builtIn: false; createdAt: string }>;
  defaultPresetName: string | null;
}
```

**Invariants:**
- Built-in presets are never written to localStorage; they are merged at read time.
- If a user preset shares a name with a built-in, the user preset takes precedence.
- Corrupt or missing JSON falls back gracefully to built-ins only.
- All values are clamped to their valid range on read (`validateMarketValues` / `validateStrategyValues`).

## Built-in Presets

### Market

| Name | Model | Key differences |
|------|-------|----------------|
| Default | gbm | All form defaults |
| High Vol | heston | annualVol 150%, kappa 1.5, theta 1.0, sigma 0.8 |
| Low Vol | gbm | annualVol 40% |
| Crash Scenario | jump | annualDrift -30%, lambda 20, muJ -0.08, sigmaJ 0.12 |

### Strategy

| Name | Key differences |
|------|----------------|
| Default | All form defaults (sizing off) |
| Conservative | δ0.10, c30, AC (0.10–0.50), RF (s1.1/lb45, put-only skip), PR (30/14), VS-40/45 + CS-50/45 |
| Aggressive | δ0.20, c3, RF (s1.2/lb20, put-only skip), VS-40/45 |

**Legend:** δ = targetDelta, c = cycleLengthDays, AC = adaptiveCalls, RF = regime filter (ivRvSpread), PR = put rolling (initialDTE/rollWhenDTE), VS = vol-scaled sizing (volTarget/lookback), CS = cold-start (size/days).

> **Moderate preset removed** (Exp 23). It had negative mean Sharpe across rolling backtests and was dominated in 16/17 windows. Non-viable.

## Public API (`presets.ts`)

```ts
// Defaults
defaultMarketValues(): MarketPresetValues
defaultStrategyValues(): StrategyPresetValues

// Validation (fills missing, clamps ranges, strips unknowns)
validateMarketValues(raw: unknown): MarketPresetValues
validateStrategyValues(raw: unknown): StrategyPresetValues

// Storage CRUD (storage param is optional; defaults to localStorage in browser)
loadPresetStore<T>(key, builtIns, validate, storage?): PresetStore<T>
savePreset<T>(key, name, values, storage?): void
deletePreset(key, name, storage?): void
setDefaultPreset(key, name | null, storage?): void

// Convenience
getMarketDefaults(storage?): MarketPresetValues
getStrategyDefaults(storage?): StrategyPresetValues
```

`StorageBackend` is an injectable interface (`getItem` / `setItem`) used in tests to avoid real localStorage.

## UI Behavior (`simulator.md`)

Each config section has a preset toolbar: `[Preset ▾] [Load] [Save] [Save As…] [Set Default] [Delete]`

| Action | Behavior |
|--------|----------|
| Load | `setDefaultPreset` → `location.reload()` (forms reinitialise from new defaults) |
| Save | Writes current form values to selected preset name; no reload |
| Save As… | Prompts for name, saves, sets as default, reloads |
| Set Default | Writes defaultPresetName to localStorage; no reload (takes effect next load) |
| Delete | Removes user preset (built-ins blocked), clears default if needed, reloads |

Built-in presets are marked with ★ and cannot be deleted. Saving to a built-in's name creates a user override.

## Decisions

**2026-02-25** — Reload-on-load approach. Observable Framework form inputs cannot be updated programmatically after creation. Setting a preset as default and reloading is the only clean way to reinitialise all sliders/toggles with new values.

**2026-02-25** — Built-ins excluded from localStorage. They are defined in code so they can be updated via deployments without manual migration of stored data.
