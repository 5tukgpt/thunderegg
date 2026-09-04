# Thunderegg Obsidian plugin — Session Handoff · ⭐ 0.2.8 RELEASED **and verified by a human** — three tests, all passing · ⭐⭐ the Browse description is BOT-OWNED and unreachable: PRs are disabled on obsidian-releases
**Date:** 2026-09-04 (arc runs 2026-09-03 → 2026-09-04) · **Branch:** master @ `d0f7246` · pushed · tag + GitHub release `0.2.8` published, assets byte-verified against the built tree.

> ⚠️ Supersedes the 0.2.5 entry below on almost everything. Its top open thread — *"Nobody has
> clicked 0.2.5 in real Obsidian"* — is **CLOSED**: James ran three tests against 0.2.8 on
> 2026-09-03 and all three passed. That is the first time this plugin has been exercised by a
> person, and it immediately mattered (see "What the human test proved" below).

## ⭐⭐ The description surfaces — settled, and NOT how anyone assumed

Three sessions' worth of belief about this was wrong. From Obsidian's own README on
`obsidianmd/obsidian-releases`:

> *"The `name`, `author` and `description` fields are used for **searching**. When the user opens
> the detail page of your plugin, Obsidian will pull the **`manifest.json` and `README.md` from
> your GitHub repo**."*

| surface | source | can we change it? |
|---|---|---|
| **Search matching** in Browse | `community-plugins.json` | ❌ **NO** — see below |
| **Detail page** (what a user reads before Install) | **our `manifest.json` + `README.md`** | ✅ ships with any release |

**`community-plugins.json` is not editable by anyone.** `obsidianmd/obsidian-releases` has
**pull requests DISABLED** (*"An owner of this repository has disabled the ability to open pull
requests"*) and `has_issues: false`. The file is maintained by "Obsidian Bot — chore: Mirror
community plugins and themes". A PR branch was prepared, pushed and then deleted once the wall was
found. **Do not spend time on this again.**

⚠️ **Two wrong claims were made and corrected inside one session, both recorded so they are not
re-derived:** (1) "`gh` failed because Obsidian's org restricts third-party OAuth apps" — false,
PRs are simply off for everyone; (2) "the manifest description is the only OS statement Obsidian's
plugin browser renders" (from the 0.2.7 audit) — also false, and its inverse ("the manifest reaches
nobody browsing") is false too. The manifest reaches the **detail page**, which is exactly where a
browsing user lands.

**The fork `5tukgpt/obsidian-releases` is KEPT** (James's call, 2026-09-04). It was created
2026-07-06 and still holds branch `add-thunderegg` — the commit *"Add plugin: Thunderegg"* that got
this plugin listed. Its `master` was fast-forwarded from 1,800-plugins-stale to current before the
doomed PR, so it is no longer a July snapshot.

## Open threads (do these next)

1. **Committed but NOT released:** `d0f7246` (README "Three ways in" + manifest description naming
   Convert clipboard). Both are detail-page surfaces, so they reach nobody until the next release.
   Not worth a 0.2.9 alone — ride them along with the next real change.
2. **No re-entrancy guard** on `convertFile` / `convertFolder` / `convertClipboard`. A second click
   yields two notes and burns two of five trial credits. Known, deliberate, unfixed.
3. **`Convert clipboard` is command-palette only** — no ribbon icon, no menu item. James's note:
   people cannot find it. The README and manifest now say so; a ribbon icon is the real fix.
4. **Canvas publish still defaults to `distillmd.dev`**, which 404s. Unchanged, still the plugin's
   only self-initiated network call.

## ⭐ What the human test proved (2026-09-03, plugin 0.2.8, engine 0.8.7)

All three passed. Recovered from disk afterwards, because the output was not where it was looked for:

- **#1 right-click a PDF** → note named correctly, opened.
- **#2 `Convert clipboard`** → `Clipboard 2026-09-03 22-24.md` + `22-26.md`. On 0.2.7 these would
  have been `_thunderegg_clip_<epoch>.md` stranded in the vault root.
- **#3 folder convert** → 4 notes in `Documentation/`, matching 4 enrichment calls ten seconds
  apart in `$SUP/egress.log`.

⭐ **Obsidian AUTO-UPDATED a vault to 0.2.8 within 5 minutes of the GitHub release** (installed
15:15, released 15:10). The release pipeline is verified by a real client, not just by `gh`.

⚠️ **Obsidian appends `/* nosourcemap */` to `main.js` on install**, so an installed `main.js` is
18 bytes larger than the release asset and hashes differently. `cmp` reports the build as a PREFIX
of the installed file. **This is benign** — do not chase it as a build mismatch, as happened here.

⚠️ **James tested in `~/Downloads/EI Vault`, not the Desktop one.** Both vaults have the plugin.
When output "goes missing", check every vault and remember `$SUP/settings.conf` has
`VAULT_PATH=/Users/5tuktau/Desktop/Skillz` and `AUTO_SORT=folder`, so notes can land far from the
source.

## What shipped (0.2.7 → 0.2.8)

Found by two adversarial audit passes (7 lenses, ~250 agents). **Both passes found real blockers in
code the previous pass had declared fixed** — see Watch-outs.

- **`03f81ab`** the note-name reconstruction. The engine renamed `report.pdf.md` → `report.md` on
  2026-08-13 (engine `22d3168`) and the plugin kept rebuilding the old name, so **every** success
  toast named a nonexistent file and "Open note after converting" (default ON) silently opened
  nothing. The engine has published the answer since that same change — **`DISTILL_NOTE_PATH_OUT`**
  (`convert.sh:1150`) — and `convert.sh:1143-1147` documents this exact bug biting
  `watch_convert.sh`. Now asked, never reconstructed. Also: folder conversions surface licence
  refusals instead of a green "converted 0/37"; the settings pane stopped calling the paid app free;
  the privacy absolutes were scoped.
- **`32011c3`** the **third** call site. `03f81ab` fixed `convertFile` and `convertFolder` and left
  `convertClipboard`, which missed on 100% of runs. Plus `.txt`/`.jsonl` added to `CONVERTIBLE`
  (both verified converting on the real engine), the second "free" string 190 lines below the first,
  and `manifest.json` gaining "macOS only.".
- **`67f56ce`** release 0.2.8, and `versions.json` gains the key **unconditionally**. README's
  procedure no longer says *"and `versions.json` if `minAppVersion` changed"* — that conditional IS
  the bug shape that left 0.2.1-0.2.3 absent and silently resolved every Obsidian 1.4.0-1.6.5 user
  back to 0.2.0.

## Watch-outs

- **⚠️⚠️ A fix applied to two of three call sites reads exactly like a fix.** `03f81ab`'s own commit
  message described the partial-fix disease while committing an instance of it. **Grep for every
  caller of the pattern before claiming a class of bug is closed.**
- **⚠️ Two of the second audit's findings were defects the FIRST fix introduced.** Treating an empty
  `DISTILL_NOTE_PATH_OUT` capture as "an older engine" was wrong — `convert.sh` exits 0 and writes
  nothing when its `[ -f "$f" ]` check fails, so a moved file or unmounted volume produced
  "✅ created report.md" for a note that does not exist, reopening the fake-success hole 0.2.6 had
  closed. And the new folder-refusal copy told trial users to look for "🔒" notes when
  `_trial_notice` has no padlock. **A fix is a change; audit it like one.**
- **⚠️ An adversarial-verify survival rule of `kills < 2` lets a 1-vote/1-kill finding through** — a
  unanimous refutation reading as survival because the other refuters died on a session limit. Require
  **≥2 returning refuters AND a minority of kills**. The first audit reported 13 findings; 12 were real.
- **⚠️ A session limit mid-workflow silently converts "no findings" into "lens never ran".** Round one
  lost 97 of 173 agents; four lenses returned zero findings and 26 were dropped because all three of
  their refuters died. **Zero findings from a lens whose agents errored is not a clean bill.**
- Engine-side traps that bit here: `timeout` does not exist on macOS (and `2>/dev/null` hides it),
  and a `sed`-based mutant can silently no-op — assert the occurrence count changed before trusting
  a "mutant-verified" claim.

---

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
