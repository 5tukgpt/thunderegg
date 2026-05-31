# Distill — Convert to Markdown (Obsidian plugin)

Right-click any attachment in your vault — PDF, Word, Excel, PowerPoint, email, image — and convert it to clean Markdown **with YAML frontmatter**, 100% on your Mac. Powered by the [Distill](../index.html) engine.

## What it adds
- **File-menu item:** right-click a file → *Convert to Markdown (Distill)*
- **Folder item:** right-click a folder → *Distill: convert all attachments* (recursive)
- **Command:** *Distill: Convert active file to Markdown*
- Output is written as `<file>.md` next to the source, with `title/source/type/created/tags` frontmatter so it lands as a first-class note.

## Requirements
- **macOS** (desktop-only — uses the on-device Distill engine).
- The **Distill app** (or its helper scripts) installed, which provides
  `~/Library/Application Support/MarkItDownDroplet/convert.sh`. The engine path is
  configurable in plugin settings.
- Image OCR needs Xcode Command Line Tools (`xcode-select --install`).

## How it works
The plugin shells out to the local Distill engine via Node's `child_process`
(allowed for desktop-only plugins). Nothing is uploaded — conversion is entirely
on-device. Frontmatter can be toggled off in settings (passes `DISTILL_FRONTMATTER=0`).

## Build from source
```sh
cd obsidian-plugin
npm install
npm run build      # produces main.js
```

## Install into a vault (manual / dev)
Copy `manifest.json` and `main.js` into:
```
<your-vault>/.obsidian/plugins/distill-md/
```
Then enable **Distill — Convert to Markdown** in Settings → Community plugins.

## Submitting to the community catalog
1. Push this folder to a public GitHub repo.
2. Tag a release whose assets include `manifest.json` + `main.js`.
3. PR to [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) adding the plugin to `community-plugins.json`.

> Note: Obsidian's review guidelines require desktop-only plugins that run shell
> commands to clearly disclose it. The description and this README state that the
> plugin executes a local helper script; keep that disclosure if you edit copy.

## Status
v0.1.0 — builds clean, type-checks clean. Not yet tested inside a live Obsidian
vault (needs a manual install + a real attachment). That's the remaining QA step
before submitting to the catalog.
