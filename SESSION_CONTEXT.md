# Thunderegg Obsidian plugin — Session Handoff · ⭐ 0.2.5 RELEASED: seven weeks of engine drift closed
**Date:** 2026-08-09 · **Branch:** master @ `a32b2b8` · pushed · tag + GitHub release `0.2.5` published (assets byte-verified against the tested tree).

First handoff doc in this repo. Context the next session needs: this plugin is a **second consumer
of the Thunderegg engine** (the Mac app is the other). The engine lives in `markdown-droplet` and is
deployed to `~/Library/Application Support/MarkItDownDroplet/`; the plugin shells out to its
`convert.sh`. That split is why this repo silently rotted for 7 weeks while the app shipped 7
releases — see the audit findings below before assuming anything here is current.

## Open threads (do these next)

- **⚠️ Nobody has clicked 0.2.5 in real Obsidian.** One minute closes it: open a note with
  `grade: crystal` → expect a badge (this is the feature that was dead); drop an `.m4a` → expect
  "transcribing… takes a few minutes" and a meeting summary. Everything shipped today is verified
  by tests + the built bytes + a live engine smoke test, but not by a human in the app.
- **DECIDE: the Canvas publish backend.** `serverBaseUrl` still defaults to `https://distillmd.dev`,
  which 404s; `thunderegg.ai` is a static Pages site with no `/api`. Left deliberately pointing at
  the dead legacy host — a clean HTTP failure beats re-pointing at HTML that would fail as a JSON
  parse. This is the plugin's ONLY network egress (4 commands, Ed25519 signing, device tokens).
  Either stand a server up or cut the surface; do not silently re-point it.
- **`versions.json` gap:** 0.2.1–0.2.3 are unlisted, so Obsidian 1.4.0–1.6.5 resolves back to 0.2.0
  (which also carries a dead `authorUrl`). Backfill needs each tag's real `minAppVersion` — the
  audit believed 1.4.0 for all three but flagged its own method as loop-corrupted, so **verify tag
  by tag without a shell `for` loop** (see Watch-outs).
- **`tests/publish-fork-receipt-edges.test.ts` is UNTRACKED** — a 16th test file that runs for
  whoever wrote it and for nobody else. Left alone deliberately (possibly lego-loop WIP): commit it
  or delete it, but don't leave a contract pinned only on one machine.
- **`obsidian-releases/` is a stale depth-1 clone of upstream** (2026-07-07, no local commits). It
  reports this plugin as NOT listed, which is **wrong** — it merged; the plugin is live in the
  official directory. Delete it or refresh it; never answer "are we published?" from it.

## What shipped in 0.2.5 (`a32b2b8`)

Driven by a 12-agent audit (contract / features / copy / ship-state lenses, every finding
adversarially verified). Four live breaks, all fixed:

1. **Grade badges were dead for every note the engine writes.** `core.ts` allow-listed the retired
   still ladder (vapor/distillate/essence); the engine renamed to the rock ladder
   (blank/rough/polished/crystal/gem, + `synthesis` on map pages) on 2026-07-16. Measured: 30/30
   graded notes in the live vault rendered nothing. Now: rock ladder + the five legacy names read
   forever (mirrors `promote.py: LEGACY_GRADES`, a permanent contract, not a deprecation window).
2. **The 2026-07-17 OCR-message fix had never been released** — tag 0.2.4 was 11 commits behind
   HEAD and `manifest.json` was never bumped, so 49 users ran the pre-fix build for three weeks.
3. **Recordings were invisible.** The A/V pipeline (whisper.cpp + meeting summaries) has shipped on
   users' Macs since app v0.5; the plugin's `CONVERTIBLE` set was the only gate. Added the exact A/V
   list from `convert.sh` (mkv/webm/avi/wmv deliberately excluded — the engine refuses them), plus
   `.doc`/`.rtf`, a transcription-aware notice, and a raised `maxBuffer` for minutes-long runs.
4. **Bonds enriched against the WRONG vault.** `convert.sh:137`'s comment claimed this plugin sets
   `DISTILL_VAULT_PATH`; it never did, so the engine fell back to the Mac app's configured vault and
   wrote wikilinks resolving in someone else's vault. Now set at all three exec sites.

Also: premium/"unlock" copy removed (the app is free; Thunderegg+ dissolved 08-08 — this was an
unchecked action item in `markdown-droplet/PRICING-STRATEGY.md` §4, now ticked); phantom "Fractions"
de-advertised (never implemented); `distillmd.dev` → `thunderegg.ai` in user-visible copy; README +
TESTING teach the current ladder and the REAL OCR remedy (the Vision `ocr` helper, not Xcode CLT);
the Publish surface is now disclosed in the manifest and README; repo description de-branded.

## Current state
- 164/164 tests green. The grade tests were **rewritten to pin the ENGINE's vocabulary** — the old
  ones asserted the dead values and stayed green over the dead feature, actively certifying the bug.
- Published assets (`manifest.json`/`main.js`/`styles.css`) downloaded back and byte-compared
  identical to the tested tree; published manifest reads 0.2.5.
- The invocation contract to the engine is INTACT and was never the problem — `$SUP` path, bare-path
  argument, `DISTILL_FRONTMATTER`, and the `DISTILL_NO_OCR` token all still hold. Don't re-audit it.

## Watch-outs
- **Releasing is a separate act from committing, and this repo has forgotten it twice.** The recipe
  now lives in README ("Releasing an update") with that warning attached. A fix in `main.js` at HEAD
  reaches nobody until `manifest.json` is bumped and a tag + release with all three assets is cut.
- **⚠️ `git -C <path> log` via the PATH git returned the PARENT repo's history** (projects-meta) for
  three repos in a row, while `git -C … rev-parse` was correct in the same command. Use
  `/usr/bin/git -C …` or `cd` first. Likewise a `for` loop containing a pipe reported identical
  output for every iteration during the audit — re-run loop-derived facts without the loop.
- **Machine tokens are deliberately NOT rebranded** and must stay: `DISTILL_*` env vars,
  `.distill.json`, the `distill-fork` URI scheme, and the `MarkItDownDroplet` support path. The
  rationale is in `core.ts` — renaming any of them silently breaks the engine contract.
- A stale `.git/HEAD.lock` blocked a commit today; `rm -f .git/{HEAD,index}.lock` after confirming
  no live git process (standing order in `~/Projects/CLAUDE.md`).
