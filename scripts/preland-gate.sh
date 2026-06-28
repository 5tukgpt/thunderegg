#!/usr/bin/env bash
# Distill pre-land gate (host-aware). Exit 0 = safe to land. Backlog #2.
#
# Linux sandbox (Cowork): typecheck + staged-file guard only — esbuild and
#   vitest(rolldown) need host-native bindings absent here, so build/test skip.
# macOS host (Tau / CC): full gate — guard + typecheck + build + test.
#
# See ~/Projects/lego-loop/LOOP.md (proof gate) and reports/2026-06-28.md.
set -uo pipefail
export TMPDIR="${TMPDIR:-/tmp}"   # sandbox inode safety; harmless on macOS
cd "$(git rev-parse --show-toplevel)" || exit 2
fail=0

# 1. never commit secrets or local plugin data (main.js IS committed — Obsidian
#    ships the built bundle — so it is deliberately NOT guarded here).
if git diff --cached --name-only | grep -qE '(^|/)(\.env|data\.json)$|\.(pem|key)$'; then
  echo "GATE FAIL: a secret/local-data file (.env, data.json, *.pem, *.key) is staged"; fail=1
else
  echo "ok: no secret/local-data files staged"
fi

# 2. typecheck — tsc is pure JS, runs on every platform
if npx tsc --noEmit; then echo "ok: tsc --noEmit"; else echo "GATE FAIL: typecheck"; fail=1; fi

# 3. native steps — macOS host only (esbuild build + vitest/rolldown tests)
if [ "$(uname)" = "Darwin" ]; then
  npm run build || { echo "GATE FAIL: build"; fail=1; }
  npm test      || { echo "GATE FAIL: test";  fail=1; }
else
  echo "skip (non-macOS sandbox): build/test need native bindings (esbuild, rolldown) — run on Tau"
fi

[ "$fail" = 0 ] && echo "GATE PASS" || echo "GATE FAILED"
exit "$fail"
