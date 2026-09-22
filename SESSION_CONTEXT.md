# Thunderegg Obsidian plugin — ✅ RELISTED · the cause is confirmed: the 254-char description
**Date:** 2026-09-22 · read from James's signed-in community.obsidian.md account (he had already claimed the plugin and connected GitHub).

- **Cause, verbatim from the 0.2.8 (Sep 4) and 0.2.10 (Sep 5) reviews, both `Failed`:**
  `Error — Plugin description exceeds the 250 character limit (currently 254 characters) — manifest.json:6`.
  The description grew past 250 in `d0f7246` (2026-09-03); the previously listed 0.2.7 (Sep 1) was
  `Completed`. One Error = not installable. The guess in the entry below was right.
- **0.2.12 review (Sep 22): `Completed`, 0 Errors.** Public page shows **Add to Obsidian**, Health
  **Excellent**, **164 downloads**, 13 releases. The plugin is installable again. **GTM D2 is unblocked.**
- **Remaining review items, none blocking:** Warnings for `fs` access, `child_process`, ~600
  `@typescript-eslint/no-unsafe-*` lines (the `obsidian` types are loose; cosmetic), and one
  `PluginSettingTab does not implement getSettingDefinitions()` (Obsidian 1.13+ settings search).
  Recommendations: GitHub artifact attestations for release assets; unused `engine` at main.ts:414;
  clipboard access. Worth a cleanup release someday; not now.
- **Process lesson:** every release is re-scanned and one Error delists silently. Before any future
  release: `len(description) <= 250`, and use **Review branch** on the account page. A local guard
  belongs in `scripts/preland-gate.sh` — added below if this session got to it.
- Baseline for launch: **164 plugin downloads, 0 Lemon Squeezy orders** (2026-09-22).

---

# Thunderegg Obsidian plugin — 0.2.12 RELEASED to get RELISTED · the resubmission itself is James-only
**Date:** 2026-09-21 · **Branch:** master · pushed · tag + release `0.2.12`, Latest, assets byte-identical; `versions.json` 13 keys for 13 releases. `main.js` is byte-identical to 0.2.11.

> Follows the delisting entry below. The cause is STILL unknown — it is visible only to the
> signed-in developer — but how the directory works is now known, and every outside-checkable
> cause has been removed.

## How the directory works now (read from Obsidian's own docs, 2026-09-21)

- The catalog is fed from **community.obsidian.md**, not pull requests. Developers sign in with an
  Obsidian account, **connect GitHub**, then **claim** existing plugins or add new ones.
- **After EVERY release the directory re-scans**: Manifest, Releases, Source code, **Build
  verification** (it runs the first of `build` / `build:plugin` / `compile` and checks the output
  matches the released `main.js`). Results are Error / Warning / Recommendation / Pass.
  **"Your plugin won't be installable from within Obsidian until any errors are resolved."** So a
  release can delist the plugin. 0.2.9 and 0.2.10 both shipped on 2026-09-04, the day it vanished.
- Profile → **Action required notifications** sends an email when an entry has failures. If James
  has never signed in, the plugin is unclaimed and nobody was ever told.
- Fixes must arrive as **a new GitHub release with an incremented version**. **Review branch** on
  the entry's page previews a scan against any branch or SHA without a release — use it next time
  BEFORE releasing.

## What 0.2.12 fixed (all checkable from outside)

- **Description**: was 254 chars with em-dashes and curly-free quotes; the rules are 250 max, end
  with a period, no emoji or special characters. Now 248 chars, pure ASCII, and says the app is required.
- **README `## Disclosures`**: one section, in the order of Obsidian's developer policies — payment,
  account, **closed-source code** (the Mac app; policy says "handled case by case", so this is the
  one most likely to need a human conversation), running a local program, files outside the vault
  (verified: the device token lives in the app-support dir, `publish-net.ts`), network use
  (none by default since 0.2.11), telemetry/ads (none).
- **Build verification reproduced**: a clean public clone + `npm ci` + `npm run build` yields a
  `main.js` byte-identical to the committed file AND to the release asset. GitHub reports the repo
  PUBLIC with an MIT licence.
- ⚠️ A `cd` into a scratch path failed mid-session and `npm ci` + `npm run build` ran in the LIVE
  repo; `gh repo clone` dropped a stray `thunderegg/` clone inside it. Verified harmless (only
  `manifest.json` was modified, by intent; the build reproduced `main.js` byte-for-byte) and the
  stray clone was moved out. **Chain `cd` with `&&`, never `;`.**

## Open threads (do these next)

1. **James: sign in at community.obsidian.md → connect GitHub → claim `thunderegg` (or New plugin
   with `https://github.com/5tukgpt/thunderegg` if it is not offered) → read the review results →
   turn on Action required notifications.** Paste whatever Errors it shows into the next session.
2. If the scan still shows Errors, fix, run **Review branch**, then release 0.2.13.
3. GTM D2 (Obsidian forum) stays blocked until the plugin is installable from inside Obsidian again.

---

# Thunderegg Obsidian plugin — ⛔ DELISTED from the Obsidian community directory since 2026-09-04 — nobody noticed for 17 days
**Date:** 2026-09-21 · found while fetching the download count for James.

- **Fact.** `thunderegg` is absent from the live source of truth
  (`community.obsidian.md/assets/community-plugins.json`, 7,894 entries, checked 2026-09-21) and
  from its hourly mirror `obsidianmd/obsidian-releases`. Mirror history: the entry was ADDED in the
  2026-08-26 mirror commit `2ee8425` and REMOVED in the 2026-09-04 commit `96702d2`; it left
  `community-plugin-stats.json` on 09-06. It is NOT in `community-plugins-removed.json` or the
  deprecation file, so there is no public reason on record.
- **Consequence.** New users cannot find or install it from Obsidian's plugin browser. Existing
  installs keep working and still auto-update (updates come from this repo's releases, not the
  catalog), which is exactly why three releases since then looked healthy. **GTM D2 (the Obsidian
  forum post) is blocked until this is resolved** — a showcase post for a plugin nobody can install.
- **Last known download count: 141** (obsidianstats.com, snapshot taken at 0.2.8, so ~09-03).
  GTM-PLAN's "87" is older. There is no live number while delisted.
- **Cause: UNKNOWN. Do not pick one.** What happened on 09-04: 0.2.9 and 0.2.10 were released within
  three hours; a prior session pushed to the `5tukgpt/obsidian-releases` fork and prepared-then-
  deleted a PR branch. One thing that IS out of spec regardless: the manifest `description` is
  **254 characters** and Obsidian's submission rule is 250 max (it was 259 when the plugin was
  listed on 08-26, so length alone did not prevent listing). The catalog is now fed from a portal
  at community.obsidian.md with developer sign-in; the reason, if any is given, will be there or in
  email to the account that submitted the plugin.
- **Next (James):** sign in at community.obsidian.md, look at the plugin's status, and check
  5tukgpt@gmail.com for mail from Obsidian around 2026-09-04. Then tell the next session what it
  says. **Next (session, once the reason is known):** fix it, trim the description to <= 250 in the
  same release, resubmit.

---

# Thunderegg Obsidian plugin — Session Handoff · 0.2.11 RELEASED
**Date:** 2026-09-21 · **Branch:** master @ release commit `0e03092` · tag + GitHub release `0.2.11`, marked Latest, three assets byte-identical to the tree, `versions.json` at 12 keys for 12 releases.

> Closes open thread #1 of the entry below ("release it after James clicks it once"). James said
> release without the click-test, so the gap was closed another way first.

- **The wiring was PROVEN against the built bundle, not just typechecked.** `main.js` was loaded in
  Node with a stubbed `obsidian` module (Plugin, Notice, TFile...), `runEngine` replaced by a
  promise that never resolves, and `convertFile` fired twice. **0.2.11 bundle: 1 engine run and the
  "already running" notice; after the first finishes, a third click runs normally. Released 0.2.10
  bundle (control): 2 engine runs from the same double-fire.** Default publish server read back as
  `""`. The harness lived in `/tmp/te-smoke` and is disposable; rebuilding it is ~40 lines. This is
  the first time anything in `main.ts` has been exercised outside Obsidian, and the pattern is
  worth reusing before any future release that touches it.
- Still unverified by eye: the disabled Publish button's tooltip, and the new "to record a meeting,
  use the Mac app" line at the bottom of Settings. Both are cosmetic; neither can block conversion.
- Open threads carried: the Browse-list description is bot-owned and unreachable (do not retry).

---

# Thunderegg Obsidian plugin — Session Handoff · both known gaps FIXED on master — ⚠️ COMMITTED, NOT RELEASED
**Date:** 2026-09-18 · **Branch:** master · pushed · **manifest still 0.2.10 on purpose** (see below). 200 tests / typecheck / build / preland gate green.

> Closes open threads #1 and #2 of the entry below. #3 (the bot-owned Browse description) stands.

## Open threads (do these next)

1. **⭐ RELEASE IT as 0.2.11 — after James clicks it once in a real vault.** Nothing here has run
   inside Obsidian: `main.ts` has no unit tests, so the wiring is proven by typecheck + the bundle
   only. The guard sits in front of EVERY conversion, so a wiring mistake would stop conversion for
   every auto-updating user — that is why it was not released blind. Test: copy `main.js` into a
   vault's `.obsidian/plugins/thunderegg/`, reload, (a) convert a PDF — works; (b) double-click
   Convert on a long file — ONE note and a "conversion is already running" notice; (c) open a
   Canvas → Publish — the button is disabled and its tooltip says no server is set; Export works.
   ⚠️ **Do NOT bump `manifest.json` without cutting the release in the same breath** — Obsidian
   reads the version from the default branch's manifest and then fetches THAT release; a bumped
   manifest with no release breaks updates for everyone. Add the `versions.json` key unconditionally.

## What changed

- **No double conversion.** `SingleFlight` (`core.ts`, tested incl. release-after-throw). The three
  public `convert*` methods are now thin guarded wrappers over `runConvert*`, so all five call
  sites (ribbon, palette x2, both right-click menus) are covered at once — guarding call sites is
  the "fixed two of three" disease this repo already caught once. Global, not per-file: a folder
  run overlaps the files in it and the engine counts trial credits per batch. A second click does
  not queue; it shows a notice and starts nothing.
- **No call to a dead server.** Default `serverBaseUrl` is now `""`. `resolvePublishServer()`
  (`publish-core.ts`, tested) throws a readable error BEFORE any request when the server is empty,
  malformed, or a retired host — so existing installs with `https://distillmd.dev` saved in
  `data.json` stop calling it without a migration. Both network functions in `publish-net.ts` go
  through it; the Publish button is disabled with the reason; Settings shows the field empty with
  a placeholder. Look-alike hosts (`notdistillmd.dev`, `distillmd.dev.example.com`) pass — tested.
  Export (file, no network) is untouched.

---

# Thunderegg Obsidian plugin — Session Handoff · 0.2.9 + 0.2.10 SHIPPED — Convert clipboard finally has a way to be found
**Date:** 2026-09-04 · **Branch:** master @ `5247887` · pushed · tag + GitHub release `0.2.10` published, assets byte-verified. Tree clean; released == committed.

> Continues the entry below (same day). Its open thread #1 — *"committed but NOT released: the
> README and manifest description"* — is **DONE**, shipped as 0.2.9. Its #3, the discoverability
> gap, is **DONE** as 0.2.10.

## Open threads (do these next)

1. **No re-entrancy guard** on `convertFile` / `convertFolder` / `convertClipboard`. A second
   click yields two notes and burns two of five trial credits. Known, deliberate, unfixed.
2. **Canvas publish still defaults to `distillmd.dev`**, which 404s. The plugin's only
   self-initiated network call. Unchanged.
3. **The Browse-list description is still not ours to change** — `obsidianmd/obsidian-releases`
   has PRs AND issues disabled and the file is bot-mirrored. See the entry below; do not spend
   time on this again.

## What changed

- **`d9422c2` 0.2.9 — docs only, `main.js` byte-identical to 0.2.8.** Cut purely to deliver
  `d0f7246`, which had been committed and was reaching nobody. Obsidian renders `manifest.json`
  and `README.md` on the plugin's **detail page** — the screen someone reads immediately before
  clicking Install — so those two files ARE a user-facing surface, and leaving them in the repo is
  the same committed-is-not-released shape that let the Mac dmg advertise 10 Macs for nine days.
- **`5247887` 0.2.10 — a ribbon icon for Convert clipboard.** The feature had NO entry point but
  the command palette: no ribbon icon, no menu item, nothing to stumble over. 0.2.9 shipped better
  copy for it, and copy only reaches someone who reads the copy. Only the clipboard command gets an
  icon — file and folder conversion already have right-click items, and the ribbon is not
  context-aware. `addRibbonIcon` is cleaned up by the `Plugin` base class, so no `registerEvent`.

⭐ **Verified by James in a real vault**: the icon draws and the tooltip reads
*"Thunderegg: Convert clipboard"*. That was the one thing no test here could check.

## Watch-outs

- **⚠️ An unknown Lucide icon name renders a BLANK button**, and nothing in 192 tests or a
  typecheck catches it. Verify against the bundled set before shipping one. **The first method
  returned 0 for `clipboard-paste` AND for `file-down`/`git-fork`, two icons this plugin
  demonstrably renders** — a useless instrument, discarded rather than believed. The method that
  works: `grep -a` the loose string in `/Applications/Obsidian.app/Contents/Resources/obsidian.asar`
  and require the same signal as a known-good control. Then have a human look.
- **⚠️ `0.2.10` sorts BELOW `0.2.9` under string comparison and ABOVE it under semver.** Obsidian
  uses semver, so this is fine — but any tooling that sorts these as strings will silently strand
  users on 0.2.9. Checked at release: GitHub's "Latest" badge resolved correctly.
- **`versions.json` is at 11 keys for 11 releases, none missing.** That invariant is the thing
  that was broken for 0.2.1-0.2.3 and silently resolved every Obsidian 1.4.0-1.6.5 user back to
  0.2.0. README's procedure now says to add the key **unconditionally**; the old conditional
  wording *"and versions.json if minAppVersion changed"* IS the bug shape.
- Everything in the entry below still applies — especially that a fix applied to two of three call
  sites reads exactly like a fix, and that Obsidian appends `/* nosourcemap */` to an installed
  `main.js` so it is 18 bytes larger than the release asset and hashes differently.

---

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
