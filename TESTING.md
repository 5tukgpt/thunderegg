# Distill plugin — live-vault QA

The plugin is already installed into **PM-Vault** at
`PM-Vault/.obsidian/plugins/distill-md/` (manifest.json + main.js). It is **not yet
enabled** — Obsidian only loads it once you toggle it on.

## Enable it (one time)
1. Open Obsidian → open the **PM-Vault** vault.
2. Settings → **Community plugins** → (if first time) **Turn on community plugins**.
3. Under **Installed plugins**, find **Distill — Convert to Markdown** → toggle it on.
   - It's desktop-only and runs a local helper; Obsidian may warn about that — accept.

## Test the three entry points
Drop a real attachment into the vault first (e.g. copy a PDF into the vault folder so it
shows in the file explorer).

1. **File menu:** right-click the PDF in the file explorer → **Convert to Markdown (Distill)**.
   → expect a `<name>.pdf.md` to appear next to it, opened in a new pane, with YAML frontmatter.
2. **Folder menu:** right-click a folder → **Distill: convert all attachments** → converts every
   convertible file under it; a notice reports the count.
3. **Command palette:** open a convertible file, then ⌘P → **Distill: Convert active file to Markdown**.

## Settings to verify (Settings → Distill)
- **Engine path** defaults to `~/Library/Application Support/MarkItDownDroplet/convert.sh`.
- **Add YAML frontmatter** toggle (on by default).
- **Open after converting** toggle.

## If it fails
- "Distill failed… Is the Distill app installed?" → the engine isn't at the configured path.
  Install the Distill app (or point Engine path at a valid `convert.sh`).
- Images don't convert → Xcode Command Line Tools missing (`xcode-select --install`).

## Pre-submission checklist (Obsidian community catalog)
- [ ] All three entry points work in a live vault.
- [ ] Frontmatter toggle on/off both behave.
- [ ] Plugin loads with no console errors (⌘⌥I → Console).
- [ ] `manifest.json` `authorUrl` points at the real public repo.
- [ ] Plugin lives in its own public GitHub repo with a tagged release.
