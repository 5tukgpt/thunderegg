# Distill Backlog (lego-loop)

Loop implements top unblocked item only. `[proposed]` items need James's promotion (remove tag). See `~/Projects/lego-loop/LOOP.md` for rules.

1. **Test harness** — add vitest, extract testable core logic from `main.ts` if needed (minimal moves only), first unit tests for the distill/summarize logic. *Scope: land (phase-1 eligible — test infra).*
2. **Pre-land gate** — `scripts/preland-gate.sh`: `npm run build` + `tsc --noEmit` + `npx vitest run`. Exit non-zero on any failure. *Scope: land (phase-1 eligible).*
3. **TESTING.md → executable** — convert manual test steps in TESTING.md into automated tests where possible. *Scope: land (phase-1 eligible).*
4. [proposed] Split `main.ts` into modules (only after tests exist to catch regressions).
