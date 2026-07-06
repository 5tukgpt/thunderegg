# Thunderegg — live-vault QA

## Install (one time)
Copy `manifest.json`, `main.js`, and `styles.css` into:
```
<your-vault>/.obsidian/plugins/thunderegg/
```

1. Open Obsidian → open the target vault.
2. Settings → **Community plugins** → (if first time) **Turn on community plugins**.
3. Under **Installed plugins**, find **Thunderegg** → toggle it on.
   - It's desktop-only and runs a local helper; Obsidian may warn — accept.

## 1. Status bar
- On load, check the status bar (bottom of the window).
- If the Thunderegg engine is installed: expect `⚗️ Ready 🟢`.
- If not installed: expect `⚗️ Unavailable 🔴`. Hover for the tooltip.

## 2. File conversion
Drop a real attachment into the vault (e.g. copy a PDF into the vault folder).

1. **File menu:** right-click the PDF → **Convert to Markdown (Thunderegg)**.
   → expect `<name>.pdf.md` to appear, opened in a new pane, with YAML frontmatter.
2. **Folder menu:** right-click a folder → **Thunderegg: convert all attachments**
   → converts every convertible file recursively; a notice reports the count.
3. **Command palette:** open a convertible file, then ⌘P → **Thunderegg: Convert file**.

## 3. Clipboard conversion
1. Copy some HTML content from a web page (or plain text).
2. ⌘P → **Thunderegg: Convert clipboard**.
3. Expect a new note named `Clipboard <timestamp>.md` to appear with the converted content.
4. The temporary source file (`_thunderegg_clip_*.html`) should be cleaned up automatically.

## 4. Refinery
### Enable
1. Settings → **Thunderegg** → toggle **Enable Refinery** on.
2. Status bar should now show Grade / Bond / Condenser info when a .md file is active.

### Grade badges
1. Create a note with `grade: vapor` in the frontmatter.
2. Open it → expect a grey "☁️ Vapor" badge in both the Refinery info bar (top of note) and the status bar.
3. Change to `grade: distillate` → blue "💧 Distillate" badge.
4. Change to `grade: essence` → purple "💎 Essence" badge.
5. Remove the `grade` field → badge disappears.

### Bond counts
1. Create two notes that link to each other via `[[wikilinks]]`.
2. Open either note → expect `🔗 N bonds` showing in the info bar and status bar.
3. Bond count = outgoing links + incoming links.

### Condensers
1. Create a note that links to 5+ other notes (default threshold).
2. That note should show the "⚗️ Condenser" badge.
3. Open a note that is linked FROM the condenser → expect a "Hub: <condenser name>" link in the info bar.
4. Click the condenser link → navigates to the condenser note.

### Vault root filter
1. Settings → set **Vault root for bond discovery** to a subfolder name.
2. Only notes under that folder should be counted in bond calculations.

### Condenser threshold slider
1. Adjust the slider in Settings.
2. Notes that no longer meet the threshold should lose their Condenser badge.

## 5. Settings to verify (Settings → Thunderegg)
- **Engine path** defaults to `~/Library/Application Support/MarkItDownDroplet/convert.sh`.
- **Add YAML frontmatter** toggle (on by default).
- **Open after converting** toggle.
- **Enable Refinery** toggle (off by default).
- **Vault root** text field (blank by default).
- **Condenser threshold** slider (default 5, range 2–30).
- **Show grade badges** toggle.
- **Show bond counts** toggle.
- **Show condenser links** toggle.

## If it fails
- "Thunderegg failed… Is the Thunderegg app installed?" → the engine isn't at the configured path.
  Install the Thunderegg app (or point Engine path at a valid `convert.sh`).
- Images don't convert → Xcode Command Line Tools missing (`xcode-select --install`).
- Refinery bar doesn't appear → ensure the Refinery toggle is on and the active file is `.md`.

## Pre-submission checklist
- [ ] Status bar shows correct availability state.
- [ ] All four entry points work (file menu, folder menu, convert file, convert clipboard).
- [ ] Frontmatter toggle on/off both behave.
- [ ] Refinery: grades, bonds, condensers all display correctly.
- [ ] Refinery: vault root filter restricts bond scanning.
- [ ] Plugin loads with no console errors (⌘⌥I → Console).
- [ ] `manifest.json` `authorUrl` points at the real public repo.
- [ ] Plugin folder includes `manifest.json`, `main.js`, and `styles.css`.
