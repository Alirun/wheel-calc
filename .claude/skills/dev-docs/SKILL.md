---
name: dev-docs
description: Enforce project documentation discipline for the repo. Use when planning/implementing changes that should be reflected in `docs/` (architecture, APIs/contracts, data models, configs/env vars, operational runbooks, meaningful behavioral changes). Treat `docs/**.md` as constraints and update/create `docs/{domain}.md` (kebab-case; group only when necessary).
---

# dev-docs

Maintain repo documentation as a first-class constraint.

## Contract

- Treat `docs/**.md` as requirements.
- If docs and code disagree, default to making code match docs.
- If behavior must change, update docs first (or in the same change) and call out the intentional contract change.

## Workflow

1) Discover relevant docs

- Glob `docs/**/*.md`.
- Read the smallest set that can constrain the change.
- If no docs exist yet, create the minimal doc(s) needed to define the new/changed behavior.

2) Decide whether a docs update is required

Update/create docs when a change is meaningful for any of:

- architecture boundaries or data flow
- public API/contract (HTTP, CLI, events, job inputs/outputs)
- persistent data model (schemas, migrations, invariants)
- config/env vars, feature flags, defaults
- operational behavior (deploy/run/debug/rollback)
- security posture (authn/z, secret handling, permission model)

If a change is purely internal refactor with no externally observable effect, keep docs untouched.

3) Choose doc location

- Prefer `docs/{domain}.md` (kebab-case).
- Create a new domain only when it reduces ambiguity and will likely be referenced again.
- Use `docs/{group}/{domain}.md` only when the flat folder becomes noisy; keep grouping shallow.

4) Write or update docs

- Keep docs short and diff-friendly.
- Document only what is true now (no speculative “future work”).
- Prefer explicit contracts and examples over prose.

Use the templates in `references/`.

## Output expectations

- When you create/update docs, mention which `docs/...` files changed and what contract changed.
- If you discover a mismatch between docs and code, call it out explicitly and propose the smallest fix.

## Bundled references

- `references/domain-template.md`: default structure for `docs/{domain}.md`
- `references/doc-update-checklist.md`: quick “do I need docs?” checklist
- `references/decision-records.md`: lightweight ADR format for the “Decisions” section
