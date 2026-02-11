# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Dev server with hot reload (localhost:3000)
npm run build    # Production build to dist/
npm run clean    # Clear Observable cache (src/.observablehq/cache)
```

No test framework, no linter, no tsconfig. TypeScript is compiled by Observable Framework's bundler (esbuild).

## Key Rules

- **Computation modules (`src/components/*.ts`) must be pure TypeScript with zero framework imports.** They must remain portable to a future production execution engine.
- **Seeded PRNG everywhere.** Same seed = same prices = reproducible simulation.

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

## Error Recovery

- If something fails, fix the issue. Don't skip or disable checks.
- If blocked, explain the blocker clearly and propose alternatives.
- If implementation fails partway, document what was completed and what remains. Don't leave the codebase broken.
