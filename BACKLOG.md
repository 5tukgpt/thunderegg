# Distill Backlog (lego-loop)

Loop implements top unblocked item only. `[proposed]` items need James's promotion (remove tag). See `~/Projects/lego-loop/LOOP.md` for rules.

**Sandbox proof capability (verified 2026-06-26, run 11).** From the Cowork Linux sandbox, only `tsc --noEmit` runs (pure JS — exit 0). `npm run build` (esbuild) and `npx vitest run` (vitest 4 pulls in `rolldown`) both need a host-native binary (`@esbuild/linux-*`, `@rolldown/binding-linux-*`) that isn't in the shared macOS `node_modules`, so both fail on Linux. Consequence: a **type-only** change is sandbox-provable; anything touching the build output or tests must be proven on **macOS (CC-on-Tau)**. See `lego-loop/reports/2026-06-26.md`.

1. **Test harness** — vitest `^4.1.8` + `"test": "vitest run"` and `tests/core.test.ts` (16 cases: isConvertible, shellQuote, normalizeGrade, buildBondGraph, bond/condenser helpers) are in place on `master`. Remaining: broaden coverage of the distill/summarize core. *Scope: land (phase-1 — test infra). Test run is macOS-only (see capability note); not executed this run.*
2. **Pre-land gate** — ✅ **LANDED on `master` (run 13, `1b1066b`)** as a host-aware `scripts/preland-gate.sh`: staged-secret guard (`.env`/`data.json`/`*.pem`/`*.key`) + `tsc --noEmit` on every platform; `npm run build` + `npm test` (vitest) run on **macOS only** (esbuild/rolldown native bindings are absent in the Linux sandbox). Proven green in-sandbox against the master tree; guard verified to fail on a staged `.env`/`.key` and to pass the committed `main.js`. Remaining (CC-on-Tau): run it once on macOS to confirm the build+test legs are green. *Scope: land (phase-1 — done).*

3. **TESTING.md → executable** — convert manual test steps in TESTING.md into automated tests where possible. *Scope: land (phase-1 eligible).*
4. [proposed] Split `main.ts` into modules (only after tests exist to catch regressions).
