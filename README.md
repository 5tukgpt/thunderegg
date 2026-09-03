# Thunderegg — Obsidian Plugin

Convert any attachment in your vault — PDF, Word, Excel, PowerPoint, email, image, **even meeting recordings (transcribed on-device)** — to clean Markdown **with YAML frontmatter**, 100% on your Mac. Plus the **Refinery**: track note maturity, discover connections, and surface hub notes automatically.

> **The plugin is free and MIT-licensed. The app it drives is not.** Thunderegg for macOS is
> **$19.95, once** — no subscription, no account — after a free trial of 5 conversions. This
> plugin is the Obsidian half; the Thunderegg app does the converting, and it is what you buy.
> [thunderegg.ai](https://thunderegg.ai)

## Features

### Conversion
- **File menu:** right-click a file → *Convert to Markdown (Thunderegg)*
- **Folder menu:** right-click a folder → *Thunderegg: convert all attachments* (recursive)
- **Command palette:**
  - `Thunderegg: Convert file` — convert the active attachment
  - `Thunderegg: Convert clipboard` — paste clipboard content (HTML or text), run it through Thunderegg, and create a new note
- **Status bar:** live indicator showing whether the Thunderegg engine is available (🟢 Ready / 🔴 Unavailable)
- Output is written as `<file>.md` next to the source, with `title/source/type/created/tags` frontmatter.
- **Recordings become meeting summaries:** drop an audio or video file (mp3, m4a, wav, aiff, aac, flac, opus, mp4, mov, m4v, mkv, webm — Zoom, OBS, Discord and
  browser recordings included) and the engine transcribes it on-device and writes a structured summary — action items, decisions, notable quotes. Transcription takes a few minutes per recording; nothing is uploaded.

### Refinery
Enable the Refinery in settings for Thunderegg's knowledge-management layer. It adds three concepts:

| Concept       | What it is                                             |
|---------------|--------------------------------------------------------|
| **Grades**    | Note maturity: *Blank* → *Rough* → *Polished* → *Crystal* → *Gem* |
| **Bonds**     | Connections discovered via `[[wikilinks]]`              |
| **Condensers**| Hub notes — notes whose bond count exceeds a threshold |

When Refinery is enabled:
- A **Refinery info bar** appears at the top of each note showing the note's Grade badge, Bond count, Condenser flag, and links to any Condensers that reference it.
- The **status bar** displays Grade / Bond / Condenser metadata for the active note.
- The bond graph is built from Obsidian's own metadata cache — zero parsing overhead.

#### How Grades work
Add a `grade` field to any note's YAML frontmatter:
```yaml
---
grade: rough
---
```
Valid values: `blank`, `rough`, `polished`, `crystal`, `gem` (plus `synthesis` on generated map
pages). Notes from before the 2026-07 rename (`vapor`, `crude`, `distillate`, `refined`,
`essence`) are read forever and shown under their new names. The plugin reads Obsidian's
metadata cache for instant display.

## Requirements
- **macOS** (desktop-only — uses the on-device Thunderegg engine).
- The **Thunderegg app** — **$19.95 once, 5 conversions free to try** — installed, which provides
  `~/Library/Application Support/MarkItDownDroplet/convert.sh`. The engine path is
  configurable in plugin settings.
- Image OCR uses the Apple Vision `ocr` helper that ships with the Thunderegg app. If image
  conversion fails with an OCR message, reinstall the Thunderegg app — that restores the helper.

## Settings

| Setting                | Description                                              |
|------------------------|----------------------------------------------------------|
| Engine path            | Full path to the Thunderegg `convert.sh` script          |
| Add YAML frontmatter   | Prepend title/source/type/tags to converted notes        |
| Open after converting  | Auto-open the resulting .md in a new pane                |
| Enable Refinery        | Turn on Grade badges, Bond counts, and Condenser links   |
| Vault root             | Limit bond scanning to a subfolder (blank = whole vault) |
| Condenser threshold    | Min bonds to flag a note as a Condenser (default: 5)     |
| Show grade badges      | Toggle Grade display                                     |
| Show bond counts       | Toggle Bond count display                                |
| Show condenser links   | Toggle Condenser back-link display                       |

## How it works
The plugin shells out to the local Thunderegg engine via Node's `child_process`
(allowed for desktop-only plugins). Conversion and transcription are entirely on-device —
nothing is uploaded to convert. Frontmatter can be toggled off in settings (passes
`DISTILL_FRONTMATTER=0`); the plugin also passes your vault's path (`DISTILL_VAULT_PATH`)
so the engine's bond discovery links against *this* vault.

The Refinery reads from Obsidian's `metadataCache.resolvedLinks` to build the bond graph — no custom file parsing, no background workers.

### Publish & Community (optional, off by default — and the one feature that CAN upload)
The plugin can publish an Obsidian **Canvas** as a signed concept map to a server you
configure (Settings → Publish & Community), and import maps others share via
`obsidian://distill-fork` links. This is the only network call **the plugin itself** makes:
nothing is sent by the plugin unless you explicitly run a Publish command, publishing sends
only the selected Canvas (after a redaction scan for blocked tags), and the device token is
stored outside your vault.

That is a claim about the plugin, not about the whole pipeline, and the difference matters.
Conversion, OCR and transcription run entirely on your Mac. But if you have connected a
cloud model in the Thunderegg app, the **engine's** AI enrichment step sends part of each
converted note to that provider — the plugin never sees that request and cannot prevent it.
Mark the vault **Local** in Thunderegg (or connect no cloud model) to keep everything
on-device. The hosted community server is not currently online; the feature works against
any server implementing the protocol.

## Build from source
```sh
npm install
npm run build      # produces main.js
```

## Install into a vault (manual / dev)
Copy `manifest.json`, `main.js`, and `styles.css` into:
```
<your-vault>/.obsidian/plugins/thunderegg/
```
Then enable **Thunderegg** in Settings → Community plugins.

## Releasing an update (the plugin is already in the community catalog)
The plugin is listed in the official Obsidian directory as `thunderegg`. To ship an update:
1. Bump `version` in `manifest.json` **and add the same version to `versions.json`** —
   always, even when `minAppVersion` did not change. Obsidian picks the newest version
   whose `versions.json` entry its app version satisfies, so a MISSING key does not mean
   "unchanged", it means "skip this release". 0.2.1-0.2.3 were absent for exactly this
   reason and every Obsidian 1.4.0-1.6.5 user silently resolved back to 0.2.0.
2. `npm test && npm run build`.
3. Tag a release named exactly the version, with `manifest.json`, `main.js`, and `styles.css`
   as assets — Obsidian serves updates from the GitHub release, no new catalog PR needed.
   ⚠️ This step has been forgotten twice: a fix committed to the repo reaches nobody until a
   release is cut under a bumped version.

> Note: Obsidian's review guidelines require desktop-only plugins that run shell
> commands to clearly disclose it. The description and this README state that the
> plugin executes a local helper script; keep that disclosure if you edit copy.

## Status
v0.2.7 — listed in the official Obsidian community directory. On top of the v0.1.0
conversion features: the Refinery (rock-ladder grades with permanent legacy-name reads),
audio/video → on-device meeting summaries, `.doc`/`.rtf` support, vault-aware bond
discovery (`DISTILL_VAULT_PATH`), clipboard conversion, status-bar indicators, and the
Canvas publish/verify/fork surface (disclosed above).
