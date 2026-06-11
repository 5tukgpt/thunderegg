# Distill Bridge — Obsidian Plugin

Convert any attachment in your vault — PDF, Word, Excel, PowerPoint, email, image — to clean Markdown **with YAML frontmatter**, 100% on your Mac. Plus the **Refinery**: track note maturity, discover connections, and surface hub notes automatically.

## Features

### Conversion (free)
- **File menu:** right-click a file → *Convert to Markdown (Distill)*
- **Folder menu:** right-click a folder → *Distill: convert all attachments* (recursive)
- **Command palette:**
  - `Distill: Convert file` — convert the active attachment
  - `Distill: Convert clipboard` — paste clipboard content (HTML or text), run it through Distill, and create a new note
- **Status bar:** live indicator showing whether the Distill engine is available (🟢 Ready / 🔴 Unavailable)
- Output is written as `<file>.md` next to the source, with `title/source/type/created/tags` frontmatter.

### Refinery (premium)
Enable the Refinery in settings to unlock Distill's knowledge-management layer. It adds four concepts:

| Concept       | What it is                                             |
|---------------|--------------------------------------------------------|
| **Grades**    | Note maturity: *Vapor* → *Distillate* → *Essence*     |
| **Bonds**     | Connections discovered via `[[wikilinks]]`              |
| **Condensers**| Hub notes — notes whose bond count exceeds a threshold |
| **Fractions** | Folder-level grouping of related notes                 |

When Refinery is enabled:
- A **Refinery info bar** appears at the top of each note showing the note's Grade badge, Bond count, Condenser flag, and links to any Condensers that reference it.
- The **status bar** displays Grade / Bond / Condenser metadata for the active note.
- The bond graph is built from Obsidian's own metadata cache — zero parsing overhead.

#### How Grades work
Add a `grade` field to any note's YAML frontmatter:
```yaml
---
grade: vapor
---
```
Valid values: `vapor`, `distillate`, `essence`. The plugin reads Obsidian's metadata cache for instant display.

## Requirements
- **macOS** (desktop-only — uses the on-device Distill engine).
- The **Distill app** (or its helper scripts) installed, which provides
  `~/Library/Application Support/MarkItDownDroplet/convert.sh`. The engine path is
  configurable in plugin settings.
- Image OCR needs Xcode Command Line Tools (`xcode-select --install`).

## Settings

| Setting                | Description                                              |
|------------------------|----------------------------------------------------------|
| Engine path            | Full path to the Distill `convert.sh` script             |
| Add YAML frontmatter   | Prepend title/source/type/tags to converted notes        |
| Open after converting  | Auto-open the resulting .md in a new pane                |
| Enable Refinery        | Turn on Grade badges, Bond counts, and Condenser links   |
| Vault root             | Limit bond scanning to a subfolder (blank = whole vault) |
| Condenser threshold    | Min bonds to flag a note as a Condenser (default: 5)     |
| Show grade badges      | Toggle Grade display                                     |
| Show bond counts       | Toggle Bond count display                                |
| Show condenser links   | Toggle Condenser back-link display                       |

## How it works
The plugin shells out to the local Distill engine via Node's `child_process`
(allowed for desktop-only plugins). Nothing is uploaded — conversion is entirely
on-device. Frontmatter can be toggled off in settings (passes `DISTILL_FRONTMATTER=0`).

The Refinery reads from Obsidian's `metadataCache.resolvedLinks` to build the bond graph — no custom file parsing, no background workers.

## Build from source
```sh
npm install
npm run build      # produces main.js
```

## Install into a vault (manual / dev)
Copy `manifest.json`, `main.js`, and `styles.css` into:
```
<your-vault>/.obsidian/plugins/distill-bridge/
```
Then enable **Distill** in Settings → Community plugins.

## Submitting to the community catalog
1. Push this folder to a public GitHub repo.
2. Tag a release whose assets include `manifest.json`, `main.js`, and `styles.css`.
3. PR to [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) adding the plugin to `community-plugins.json`.

> Note: Obsidian's review guidelines require desktop-only plugins that run shell
> commands to clearly disclose it. The description and this README state that the
> plugin executes a local helper script; keep that disclosure if you edit copy.

## Status
v0.2.0 — builds clean, type-checks clean. Adds Refinery awareness, clipboard conversion,
and status-bar indicators on top of the original v0.1.0 conversion features.
