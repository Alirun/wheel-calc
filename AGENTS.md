# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Dev server with hot reload (localhost:3000)
npm run build    # Production build to dist/
npm run clean    # Clear Observable cache (src/.observablehq/cache)
```

Tests use Vitest (`npx vitest run`). Coverage via `npx vitest run --coverage`. No linter, no tsconfig. TypeScript is compiled by Observable Framework's bundler (esbuild).

## Key Rules

- **Computation modules (`src/components/*.ts`) must be pure TypeScript with zero framework imports.** They must remain portable to a future production execution engine.
- **Seeded PRNG everywhere.** Same seed = same prices = reproducible simulation.
- **Tests are required.** Every change to computation modules must include or update tests in `tests/`. Export pure helper functions so they can be tested directly. Run `npx vitest run` before considering work complete.
- **Maintain high coverage.** Target ≥95% statement coverage on `src/components/`. Run `npx vitest run --coverage` to verify. If new code drops coverage, add tests to compensate.

## Skills

- **`observable-framework`** — Use when working on `.md` pages, components, or framework config.
- **`dev-docs`** — Use when changes need documentation. Treats `docs/**/*.md` as constraints.

## Implementation Planning

1. **Assess complexity.** Single-file, clear-scope changes — implement directly. Multi-file or unclear scope — plan first.
2. **Draft plan.** For complex tasks, create `IMPLEMENTATION_PLAN.md` with checkbox steps (`- [ ]`).
3. **Get approval** before starting implementation.
4. **Track progress.** Mark completed items `- [x]` during implementation.
5. **Clean up.** Delete `IMPLEMENTATION_PLAN.md` when all tasks are done.

## Scope Boundaries

- Only implement what's explicitly requested. If you discover related issues, note them but don't fix unless asked.
- When requirements are ambiguous, multiple valid approaches exist, or changes would touch more files than expected — stop and ask.
- Do not perform git commits, pushes, or branch operations unless explicitly asked.

## Context Management

- If a task requires broad research or exploring unfamiliar modules, delegate to subagents and integrate only the distilled conclusions.
- Parallelize independent research across multiple subagents when possible.
- Preserve main context for implementation — don't dump raw research into it.

## Code Rules

- **No redundant comments.** Don't explain what code does. Only comment the "why" when it's not obvious.
- **No TODO comments** unless explicitly requested.
- **No change-tracking comments** (`// Added by AI`, `// removed`, etc.). Version control handles history.
- **Remove dead code.** When refactoring, check if functions/imports become unused and remove them. Grep for old names before considering cleanup complete.
- **Remove debug artifacts.** No `console.log` or `debugger` in committed code.
- **Verify utilities exist** before importing. Don't assume helpers exist based on common patterns.
- **Follow existing patterns.** When in doubt, find a similar existing implementation and match its structure.

## Multi-Threaded Sweep Scripts

Research sweeps should use `worker_threads` to parallelize Monte Carlo runs across CPU cores. **tsx cannot propagate ESM loader hooks to worker threads** (Node.js limitation, tsx#354). The workaround:

1. **Pre-compile the worker with esbuild** at startup. Bundle the `.ts` worker file to a temporary `.compiled.mjs` file:
   ```ts
   import { buildSync } from "esbuild";
   const compiled = buildSync({
     entryPoints: [WORKER_TS_PATH],
     bundle: true,
     platform: "node",
     format: "esm",
     target: "node22",
     outfile: WORKER_JS_PATH,
   });
   process.on("exit", () => { try { unlinkSync(WORKER_JS_PATH); } catch {} });
   ```
2. **Spawn workers from the compiled JS**, not the `.ts` source:
   ```ts
   const w = new Worker(WORKER_JS_PATH);  // NOT the .ts file
   ```
3. **Use a WorkerPool class** that manages a fixed pool of workers, dispatches tasks via `postMessage`, and collects results via promises. See `research/sweep14/sweep14_mt.ts` for the reference implementation.
4. **Run with** `npx tsx research/sweepN/sweepN_mt.ts --threads=8` (default: `os.cpus().length - 1`).

Do NOT attempt: `execArgv: ["--import", "tsx/esm"]`, data URL workers importing `.ts`, or `.mjs` wrapper files calling `register("tsx/esm")` — all fail under tsx.

## Error Recovery

- If something fails, fix the issue. Don't skip or disable checks.
- If blocked, explain the blocker clearly and propose alternatives.
- If implementation fails partway, document what was completed and what remains. Don't leave the codebase broken.
