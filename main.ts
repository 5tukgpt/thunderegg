import {
  App, FileSystemAdapter, Notice, Plugin, PluginSettingTab, Setting,
  TFile, TFolder, TAbstractFile, normalizePath,
  MarkdownView,
} from "obsidian";
import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import {
  CONVERTIBLE, GRADE_META, shellQuote, normalizeGrade, isNoOcrError, isAudioVideo,
  isTrialExhaustedError, isUnlicensedError, stemPath,
  BondGraph, emptyBondGraph, buildBondGraph,
  bondCount, isCondenser, referencingCondensers,
} from "./core";
import type { Canvas, Visibility, License, ForkLineage } from "./publish-core";
import { PublishModal, importForkedMap, forkMapFileIntoVault, ConfirmForkModal, type PublishContext } from "./publish-ui";
import { readDeviceToken, writeDeviceToken, clearDeviceToken, hasDeviceToken } from "./publish-net";
import { parseSidecarSignature, parseLineageFrontmatter } from "./publish-core";
import { signingKeyFingerprint, verifyBytes, keyFingerprint } from "./publish-sign";

const execAsync = promisify(exec);

/*
 * Core domain logic (CONVERTIBLE, Grades, Bond graph) lives in core.ts
 * so it can be unit-tested without Obsidian. Keep main.ts to glue + UI.
 */

/*
 * Electron's clipboard is only reachable at runtime through the renderer's
 * `window.require` in Obsidian's desktop shell — there is no ESM import for it.
 * Declare the minimal surface we touch so the access stays fully typed.
 */
declare global {
  interface Window {
    require?: (module: string) => unknown;
  }
}

interface ElectronClipboardLike {
  readHTML?: () => string;
  readText?: () => string;
}

interface ElectronLike {
  clipboard?: ElectronClipboardLike;
  remote?: { clipboard?: ElectronClipboardLike };
}

/* ═══════════════════════════════════════════════════════════════════
   Settings
   ═══════════════════════════════════════════════════════════════════ */

interface ThundereggSettings {
  /* Core */
  enginePath: string;
  frontmatter: boolean;
  openAfter: boolean;
  /* Refinery */
  refineryEnabled: boolean;
  vaultRoot: string;
  condenserThreshold: number;
  showGradeBadges: boolean;
  showBondCounts: boolean;
  showCondenserLinks: boolean;
  /* Publish & Community */
  serverBaseUrl: string;
  blockedZonesCsv: string;
  defaultVisibility: Visibility;
  defaultLicense: License;
}

const DEFAULT_SETTINGS: ThundereggSettings = {
  enginePath: `${os.homedir()}/Library/Application Support/MarkItDownDroplet/convert.sh`,
  frontmatter: true,
  openAfter: true,
  refineryEnabled: false,
  vaultRoot: "",
  condenserThreshold: 5,
  showGradeBadges: true,
  showBondCounts: true,
  showCondenserLinks: true,
  // The community publish server has NOT been redeployed since the Thunderegg rebrand — this
  // legacy host currently 404s, and thunderegg.ai is a static site with no /api. Deliberately
  // left pointing at the legacy zone (a clean HTTP failure) rather than re-pointed (a JSON
  // parse failure against marketing HTML). Revisit when/if the publish backend ships.
  serverBaseUrl: "https://distillmd.dev",
  blockedZonesCsv: "#health, #work, #client, #private",
  defaultVisibility: "private",
  defaultLicense: "user-generated",
};

/* ═══════════════════════════════════════════════════════════════════
   Plugin
   ═══════════════════════════════════════════════════════════════════ */

export default class ThundereggPlugin extends Plugin {
  settings!: ThundereggSettings;

  /* UI handles */
  private statusThunderegg!: HTMLElement;
  private statusRefinery!: HTMLElement;
  private refineryBarEl: HTMLElement | null = null;

  /* State */
  private thundereggAvailable = false;
  private bonds: BondGraph = emptyBondGraph();
  private lastForkReceipt: string | null = null;

  /* ── Lifecycle ──────────────────────────────────────────────── */

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ThundereggSettingTab(this.app, this));

    /* ── Status bar ── */
    this.statusThunderegg  = this.addStatusBarItem();
    this.statusRefinery = this.addStatusBarItem();

    await this.checkThundereggAvailable();
    this.renderThundereggStatus();

    /* ── Ribbon ──
       Convert clipboard had NO entry point except the command palette: no ribbon icon, no
       menu item, nothing to stumble over. It was documented, but as a nested sub-bullet, and
       0.2.9 shipped better copy for it — copy is a workaround for discoverability, not a fix.
       This is the fix. Only the clipboard command gets an icon: converting a file or folder
       already has a right-click item, and a ribbon button for those would have nothing to act
       on. `addRibbonIcon` is cleaned up by the Plugin base class on unload, so it needs no
       registerEvent. The icon name is a Lucide name — verified present in the bundled set
       against `file-down` and `git-fork`, two this plugin already renders. */
    this.addRibbonIcon("clipboard-paste", "Thunderegg: Convert clipboard", () => {
      void this.convertClipboard();
    });

    /* ── File-explorer context menu ── */
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && CONVERTIBLE.has(file.extension.toLowerCase())) {
          menu.addItem((item) =>
            item
              .setTitle("Convert to Markdown (Thunderegg)")
              .setIcon("file-down")
              .onClick(() => this.convertFile(file)),
          );
        } else if (file instanceof TFile && file.extension.toLowerCase() === "canvas") {
          menu.addItem((item) =>
            item
              .setTitle("Publish concept map (Thunderegg)")
              .setIcon("upload")
              .onClick(() => this.openPublishModal(file)),
          );
        } else if (file instanceof TFile && file.name.toLowerCase().endsWith(".distill.json")) {
          menu.addItem((item) =>
            item
              .setTitle("Verify signature (Thunderegg)")
              .setIcon("shield-check")
              .onClick(() => this.verifyMapFile(file)),
          );
          menu.addItem((item) =>
            item
              .setTitle("Fork map file into vault (Thunderegg)")
              .setIcon("git-fork")
              .onClick(() => this.forkMapFile(file)),
          );
        } else if (file instanceof TFolder) {
          menu.addItem((item) =>
            item
              .setTitle("Thunderegg: convert all attachments")
              .setIcon("folder-down")
              .onClick(() => this.convertFolder(file)),
          );
        }
      }),
    );

    /* ── Command palette ── */
    this.addCommand({
      id: "convert-file",
      name: "Convert file",
      checkCallback: (checking: boolean) => {
        const f = this.app.workspace.getActiveFile();
        const ok = f instanceof TFile && CONVERTIBLE.has(f.extension.toLowerCase());
        if (ok && !checking) void this.convertFile(f);
        return ok;
      },
    });

    this.addCommand({
      id: "convert-clipboard",
      name: "Convert clipboard",
      callback: () => { void this.convertClipboard(); },
    });

    this.addCommand({
      id: "publish-canvas",
      name: "Publish concept map",
      checkCallback: (checking: boolean) => {
        const f = this.app.workspace.getActiveFile();
        const ok = f instanceof TFile && f.extension.toLowerCase() === "canvas";
        if (ok && !checking) void this.openPublishModal(f);
        return ok;
      },
    });

    this.addCommand({
      id: "verify-map",
      name: "Verify concept-map signature",
      checkCallback: (checking: boolean) => {
        const f = this.app.workspace.getActiveFile();
        const ok = f instanceof TFile && f.name.toLowerCase().endsWith(".distill.json");
        if (ok && !checking) void this.verifyMapFile(f);
        return ok;
      },
    });

    this.addCommand({
      id: "fork-map-file",
      name: "Fork map file into vault",
      checkCallback: (checking: boolean) => {
        const f = this.app.workspace.getActiveFile();
        const ok = f instanceof TFile && f.name.toLowerCase().endsWith(".distill.json");
        if (ok && !checking) void this.forkMapFile(f);
        return ok;
      },
    });

    this.addCommand({
      id: "copy-fork-receipt",
      name: "Copy fork receipt",
      checkCallback: (checking: boolean) => {
        const receipt = this.lastForkReceipt;
        if (receipt === null) return false;
        if (!checking) {
          void navigator.clipboard.writeText(receipt);
          new Notice("Thunderegg: fork receipt copied — paste it wherever you self-report.");
        }
        return true;
      },
    });

    /* ── Fork deep-link: obsidian://distill-fork?map=<id> (scheme kept for wire compatibility) ── */
    this.registerObsidianProtocolHandler("distill-fork", (params) => {
      const mapId = (params as Record<string, string>).map;
      if (!mapId) {
        new Notice("Thunderegg: fork link is missing ?map=…");
        return;
      }
      void importForkedMap(this.app, this.settings.serverBaseUrl, mapId);
    });

    /* ── Refinery bootstrap ── */
    if (this.settings.refineryEnabled) {
      this.bootRefinery();
    }

    /* ── React to active-file changes ── */
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.renderRefineryStatus();
        this.decorateActiveLeaf();
      }),
    );

    /* ── Rebuild bond graph when metadata cache settles ── */
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        if (this.settings.refineryEnabled) {
          this.buildBondGraph();
          this.renderRefineryStatus();
          this.decorateActiveLeaf();
        }
      }),
    );

    /* ── Re-check Thunderegg engine availability every 60 s ── */
    this.registerInterval(
      window.setInterval(() => {
        void this.checkThundereggAvailable().then(() => this.renderThundereggStatus());
      }, 60_000),
    );
  }

  onunload() {
    this.stripRefineryBar();
  }

  /* ═════════════════════════════════════════════════════════════════
     Thunderegg availability
     ═════════════════════════════════════════════════════════════════ */

  async checkThundereggAvailable(): Promise<void> {
    try {
      await fs.promises.access(this.settings.enginePath, fs.constants.X_OK);
      this.thundereggAvailable = true;
    } catch {
      this.thundereggAvailable = false;
    }
  }

  renderThundereggStatus(): void {
    this.statusThunderegg.empty();
    const dot   = this.thundereggAvailable ? "🟢" : "🔴"; // 🟢 / 🔴
    const label = this.thundereggAvailable ? "Ready" : "Unavailable";
    this.statusThunderegg.createSpan({
      cls: "thunderegg-status",
      text: `⚗️ ${label} ${dot}`,  // ⚗️
    });
    this.statusThunderegg.setAttribute(
      "aria-label",
      this.thundereggAvailable
        ? `Thunderegg engine: ${this.settings.enginePath}`
        : "Thunderegg engine not found — check Settings → Thunderegg",
    );
  }

  /* ═════════════════════════════════════════════════════════════════
     File conversion
     ═════════════════════════════════════════════════════════════════ */

  /** Resolve a vault-relative TFile to an absolute filesystem path. */
  private absPath(file: TFile): string {
    const adapter = this.app.vault.adapter;
    const base = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
    return path.join(base, file.path);
  }

  /** Shell-escape a single argument (see core.ts). */
  private shellQuote(s: string): string {
    return shellQuote(s);
  }

  /**
   * Environment for an engine call. DISTILL_VAULT_PATH tells the engine which vault to enrich
   * against — convert.sh's own comment names this plugin as the setter; without it the engine
   * falls back to the Mac app's configured vault and writes bonds/wikilinks that resolve in
   * SOMEONE ELSE'S vault, not this one. maxBuffer is raised because a transcription run can
   * chat well past exec's 1 MB default over the minutes a recording takes.
   */
  private engineEnv(): Record<string, string> {
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (!this.settings.frontmatter) env["DISTILL_FRONTMATTER"] = "0";
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) env["DISTILL_VAULT_PATH"] = adapter.getBasePath();
    return env;
  }

  private static readonly ENGINE_MAX_BUFFER = 10 * 1024 * 1024;

  /** Monotonic suffix so two conversions never share a capture file. */
  private noteOutSeq = 0;

  /* The engine WRITES the note path it actually chose to $DISTILL_NOTE_PATH_OUT
     (convert.sh:1150). ASK IT — never reconstruct the name. The engine renamed
     `report.pdf.md` -> `report.md` on 2026-08-13; every caller that rebuilt the name from
     the source has been wrong for each ordinary file since, and convert.sh:1143-1147
     records that exact bug happening to watch_convert.sh. `report.pdf.md` is now only the
     collision fallback, so guessing it is wrong in the common case and right in the rare one.

     Returns vault-relative paths in the order the engine wrote them, or [] when the engine
     wrote nothing — an older engine that does not honour the variable lands here, so callers
     must degrade rather than depend on it. */
  private async runEngine(absSource: string): Promise<string[]> {
    const outFile = path.join(
      os.tmpdir(), `thunderegg-note-${process.pid}-${this.noteOutSeq++}.txt`);
    const env = this.engineEnv();
    env["DISTILL_NOTE_PATH_OUT"] = outFile;
    try {
      await execAsync(
        `${this.shellQuote(this.settings.enginePath)} ${this.shellQuote(absSource)}`,
        { env, maxBuffer: ThundereggPlugin.ENGINE_MAX_BUFFER });
      return this.readNotePaths(outFile);
    } finally {
      try { fs.unlinkSync(outFile); } catch { /* best effort — it is in tmp */ }
    }
  }

  /** Absolute paths from the capture file -> vault-relative. Anything outside the vault is
      dropped: the engine can file a note elsewhere (CONVERT_DEST), and a path Obsidian
      cannot address is not something we can open or name. */
  private readNotePaths(outFile: string): string[] {
    let raw = "";
    try { raw = fs.readFileSync(outFile, "utf8"); } catch { return []; }
    const adapter = this.app.vault.adapter;
    const base = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
    if (!base) return [];
    const out: string[] = [];
    for (const line of raw.split("\n")) {
      const abs = line.trim();
      if (!abs) continue;
      const rel = path.relative(base, abs);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
      out.push(normalizePath(rel));
    }
    return out;
  }

  async convertFile(file: TFile): Promise<void> {
    const engine = this.settings.enginePath;
    const full   = this.absPath(file);
    const notice = new Notice(
      isAudioVideo(file.extension)
        ? `Thunderegg: transcribing ${file.name} — recordings take a few minutes…`
        : `Thunderegg: converting ${file.name}…`,
      0,
    );

    try {
      const notes = await this.runEngine(full);
      notice.hide();
      // Name what the engine actually wrote. Only fall back to the old reconstruction when
      // the engine told us nothing, and even then say the stem name the engine prefers —
      // `${file.path}.md` is the collision fallback, not the normal result.
      // An empty capture does NOT prove an old engine: convert.sh exits 0 and writes nothing
      // when its `[ -f "$f" ]` check fails (a moved file, an unmounted volume). Verified
      // against the deployed engine — exit 0, capture file never created. So the fallback name
      // is a GUESS and must be confirmed on disk before we claim a note exists, or this branch
      // reopens the same fake-success hole 0.2.6 and 03f81ab each closed once.
      const created = notes.length
        ? notes[notes.length - 1]
        : normalizePath(`${stemPath(file.path)}.md`);
      if (!notes.length && !(this.app.vault.getAbstractFileByPath(created) instanceof TFile)) {
        new Notice(
          `Thunderegg reported success for "${file.name}" but no note appeared. ` +
          `If the file lives on a drive that is not mounted, reconnect it and try again.`,
          10000,
        );
        return;
      }
      new Notice(`✅ Thunderegg: created ${created.split("/").pop()}`);

      if (this.settings.openAfter) {
        await sleep(300);
        const md = this.app.vault.getAbstractFileByPath(created);
        if (md instanceof TFile) void this.app.workspace.getLeaf(true).openFile(md);
      }
    } catch (e) {
      notice.hide();
      // No on-device OCR: the engine is installed and ran, it just cannot read images,
      // so "Is the Thunderegg app installed?" would send the user down the wrong path.
      if (isNoOcrError(e)) {
        new Notice(
          `Thunderegg couldn't read "${file.name}" — on-device OCR isn't available. ` +
          `Reinstall the Thunderegg app to enable image OCR.`,
          9000,
        );
        return;
      }
      // A refusal is not a broken install. Say which refusal it is: someone whose trial ran
      // out has no key and no purchase email, so the activation wording sends them looking
      // for something that does not exist.
      if (isTrialExhaustedError(e)) {
        new Notice(
          `Thunderegg's free trial is used up, so "${file.name}" wasn't converted. ` +
          `Thunderegg is $19.95, one time — open Thunderegg → Settings to buy, then try again. ` +
          `Everything you already converted stays yours.`,
          12000,
        );
        return;
      }
      if (isUnlicensedError(e)) {
        new Notice(
          `Thunderegg isn't activated, so "${file.name}" wasn't converted. ` +
          `Open Thunderegg → Settings and paste the licence key from your purchase email.`,
          12000,
        );
        return;
      }
      new Notice(
        `❌ Thunderegg failed: ${errMsg(e)}. Is the Thunderegg app installed?`,
        8000,
      );
      console.error("[Thunderegg]", e);
    }
  }

  async convertFolder(folder: TFolder): Promise<void> {
    const targets: TFile[] = [];
    const walk = (f: TAbstractFile) => {
      if (f instanceof TFile && CONVERTIBLE.has(f.extension.toLowerCase())) {
        targets.push(f);
      } else if (f instanceof TFolder) {
        f.children.forEach(walk);
      }
    };
    walk(folder);

    if (targets.length === 0) {
      new Notice("Thunderegg: no convertible files here.");
      return;
    }

    const notice = new Notice(`Thunderegg: converting ${targets.length} files…`, 0);
    let ok = 0;
    let noOcr = 0;

    // A licence refusal is not a per-file problem — it refuses every remaining file, and each
    // refusal writes a lock-notice note into the vault under the name the real note would have
    // had. Stop at the first one and say which it is. 0.2.6 fixed exactly this for a single
    // file and left the folder path reporting "converted 0/N" behind a green tick.
    let refusal: "trial" | "unlicensed" | null = null;
    let missing = 0;   // exited 0 but produced no note — a moved file or an unmounted volume
    for (const t of targets) {
      try {
        // Count NOTES, not exit codes. convert.sh exits 0 without writing anything when its
        // `[ -f "$f" ]` check fails, so counting exit-0 reports "converted 200/200 files"
        // over an empty folder. An older engine reports no path at all — fall back to the
        // engine's own naming and confirm the note is really there before counting it.
        const produced = await this.runEngine(this.absPath(t));
        const landed = produced.length
          ? true
          : this.app.vault.getAbstractFileByPath(
              normalizePath(`${stemPath(t.path)}.md`)) instanceof TFile;
        if (landed) ok++; else missing++;
      } catch (e) {
        if (isTrialExhaustedError(e)) { refusal = "trial";      break; }
        if (isUnlicensedError(e))     { refusal = "unlicensed"; break; }
        // Missing OCR must NOT short-circuit the batch: it only stops images, so every
        // other file still converts. Count them and name the remedy once, below.
        if (isNoOcrError(e)) noOcr++;
        console.error("[Thunderegg]", t.path, e);
      }
    }

    notice.hide();
    if (refusal) {
      // Lead with the reason, not a tick. Name the placeholder notes too: the user is about
      // to find them in the folder and they look like real converted notes.
      const done = ok > 0 ? `${ok} of ${targets.length} files converted first. ` : "";
      new Notice(
        refusal === "trial"
          ? `Thunderegg's free trial is used up, so the rest of the folder wasn't converted. ` +
            `${done}Thunderegg is $19.95, one time — open Thunderegg → Settings to buy, then ` +
            `try again. Any "Your free trial is used up" notes left in the folder are ` +
            `placeholders, not conversions.`
          : `Thunderegg isn't activated, so the rest of the folder wasn't converted. ` +
            `${done}Open Thunderegg → Settings and paste the licence key from your purchase ` +
            `email. Any "🔒 Thunderegg isn't activated" notes left in the folder are ` +
            `placeholders, not conversions.`,
        14000,
      );
      return;
    }
    let msg = `✅ Thunderegg: converted ${ok}/${targets.length} files.`;
    if (noOcr > 0) {
      msg += ` ${noOcr} image(s) need on-device OCR — reinstall the Thunderegg app to enable it.`;
    }
    if (missing > 0) {
      msg += ` ${missing} file(s) reported success but produced no note — if they live on a ` +
             `drive that is not mounted, reconnect it and run this again.`;
    }
    new Notice(msg, noOcr > 0 ? 10000 : undefined);
  }

  /* ═════════════════════════════════════════════════════════════════
     Clipboard conversion
     ═════════════════════════════════════════════════════════════════ */

  async convertClipboard(): Promise<void> {
    /* Read clipboard — prefer HTML (richer), fall back to plain text. */
    let clipHtml = "";
    let clipText = "";
    try {
      if (!window.require) throw new Error("window.require unavailable");
      const electron = window.require("electron") as ElectronLike;
      const cb = electron.clipboard ?? electron.remote?.clipboard;
      if (cb) {
        clipHtml = cb.readHTML?.() ?? "";
        clipText = cb.readText?.() ?? "";
      }
    } catch {
      try {
        clipText = await navigator.clipboard.readText();
      } catch {
        new Notice("❌ Could not read clipboard.");
        return;
      }
    }

    const content = clipHtml.trim() || clipText.trim();
    if (!content) {
      new Notice("Clipboard is empty.");
      return;
    }

    const ext      = clipHtml.trim() ? "html" : "txt";
    const stamp    = Date.now();
    const tempName = `_thunderegg_clip_${stamp}.${ext}`;
    const tempPath = normalizePath(tempName);

    const notice = new Notice("Thunderegg: converting clipboard…", 0);

    try {
      // Write clipboard content to a temporary file inside the vault
      await this.app.vault.create(tempPath, content);
      const tempFile = this.app.vault.getAbstractFileByPath(tempPath);
      if (!(tempFile instanceof TFile)) throw new Error("Could not create temp file");

      // Route through runEngine like every other caller. The temp name carries a timestamp,
      // so it is ALWAYS free, so the engine ALWAYS claims `<stem>.md` — meaning the old
      // `${tempPath}.md` reconstruction missed on 100% of runs, not intermittently, and left
      // a note called `_thunderegg_clip_<epoch>` in the vault root every single time.
      const notes = await this.runEngine(this.absPath(tempFile));

      // Remove the temporary source file
      await this.app.fileManager.trashFile(tempFile);
      notice.hide();

      // Locate the generated .md and give it a friendly name
      const mdRawPath = notes.length
        ? notes[notes.length - 1]
        : normalizePath(`${stemPath(tempPath)}.md`);
      await sleep(400);
      const mdFile = this.app.vault.getAbstractFileByPath(mdRawPath);

      if (mdFile instanceof TFile) {
        const dateStr = new Date()
          .toISOString()
          .slice(0, 16)
          .replace("T", " ")
          .replace(":", "-");
        const niceName = `Clipboard ${dateStr}.md`;
        const nicePath = normalizePath(niceName);
        await this.app.fileManager.renameFile(mdFile, nicePath);

        new Notice(`✅ Thunderegg: created ${niceName}`);
        if (this.settings.openAfter) {
          const renamed = this.app.vault.getAbstractFileByPath(nicePath);
          if (renamed instanceof TFile) {
            void this.app.workspace.getLeaf(true).openFile(renamed);
          }
        }
      } else {
        new Notice("✅ Clipboard converted (file may take a moment to appear).");
      }
    } catch (e) {
      notice.hide();
      // Best-effort cleanup
      try {
        const tf = this.app.vault.getAbstractFileByPath(tempPath);
        if (tf instanceof TFile) await this.app.fileManager.trashFile(tf);
      } catch { /* swallow */ }
      new Notice(`❌ Clipboard conversion failed: ${errMsg(e)}`, 8000);
      console.error("[Thunderegg]", e);
    }
  }

  /* ═════════════════════════════════════════════════════════════════
     Publish concept map (Canvas → distill.map/0.2)
     ═════════════════════════════════════════════════════════════════ */

  /** Open the Publish modal for a .canvas file. */
  async openPublishModal(file: TFile): Promise<void> {
    let canvas: Canvas;
    try {
      canvas = JSON.parse(await this.app.vault.read(file)) as Canvas;
    } catch (e) {
      new Notice(`Thunderegg: could not read canvas — ${errMsg(e)}`);
      return;
    }
    const ctx: PublishContext = {
      baseUrl: this.settings.serverBaseUrl,
      token: readDeviceToken(),
      blockedZones: this.settings.blockedZonesCsv
        .split(",").map((s) => s.trim()).filter(Boolean),
      distillVersion: this.manifest.version,
      defaultVisibility: this.settings.defaultVisibility,
      defaultLicense: this.settings.defaultLicense,
    };
    // Forked canvases carry their lineage receipt into the export (x-distill.forked_from).
    let lineage: ForkLineage | undefined;
    const notePath = normalizePath(file.path.replace(/[^/]+$/, `${file.basename} — source.md`));
    const note = this.app.vault.getAbstractFileByPath(notePath);
    if (note instanceof TFile) {
      lineage = parseLineageFrontmatter(await this.app.vault.read(note)) ?? undefined;
    }
    new PublishModal(this.app, canvas, file.basename, ctx, lineage).open();
  }

  /** Verify the Ed25519 signature on an exported .distill.json against its sidecar. */
  async verifyMapFile(file: TFile): Promise<void> {
    try {
      const json = await this.app.vault.read(file);
      const base = file.name.replace(/\.distill\.json$/i, "");
      const sidecarPath = normalizePath(file.path.replace(/[^/]+$/, `${base} — provenance.md`));
      const sidecar = this.app.vault.getAbstractFileByPath(sidecarPath);
      if (!(sidecar instanceof TFile)) {
        new Notice("Thunderegg: no provenance sidecar found next to this map — can't verify.");
        return;
      }
      const sig = parseSidecarSignature(await this.app.vault.read(sidecar));
      if (!sig) {
        new Notice("Thunderegg: sidecar has no signature block — this map is unsigned.");
        return;
      }
      const ok = verifyBytes(json, sig.signature, sig.public_key);
      new Notice(
        ok
          ? `✅ Signature valid — authored by key ${keyFingerprint(sig.public_key)} (${sig.algo}).`
          : "❌ Signature INVALID — the map may have been altered or re-signed.",
        ok ? 8000 : 10000,
      );
    } catch (e) {
      new Notice(`Thunderegg: verify failed — ${errMsg(e)}`);
    }
  }

  /** Fork a local .distill.json into Forked/, verifying its signature first. */
  async forkMapFile(file: TFile): Promise<void> {
    try {
      const json = await this.app.vault.read(file);

      // Same verify path as verifyMapFile: sidecar → parseSidecarSignature → verifyBytes.
      const base = file.name.replace(/\.distill\.json$/i, "");
      const sidecarPath = normalizePath(file.path.replace(/[^/]+$/, `${base} — provenance.md`));
      const sidecar = this.app.vault.getAbstractFileByPath(sidecarPath);
      let fingerprint: string | null = null;
      let problem: string | null = null;
      if (!(sidecar instanceof TFile)) {
        problem = "no provenance sidecar found next to this map";
      } else {
        const sig = parseSidecarSignature(await this.app.vault.read(sidecar));
        if (!sig) {
          problem = "the sidecar has no signature block (unsigned map)";
        } else if (!verifyBytes(json, sig.signature, sig.public_key)) {
          problem = "the signature is INVALID — the map may have been altered";
        } else {
          fingerprint = keyFingerprint(sig.public_key);
        }
      }

      const run = async () => {
        const receipt = await forkMapFileIntoVault(this.app, file.path, json, fingerprint);
        if (receipt) this.lastForkReceipt = receipt;
      };
      if (problem) {
        new Notice(`Thunderegg: ${problem}.`, 8000);
        new ConfirmForkModal(this.app, problem, () => { void run(); }).open();
      } else {
        await run();
      }
    } catch (e) {
      new Notice(`Thunderegg: fork failed — ${errMsg(e)}`);
    }
  }

  /* ═════════════════════════════════════════════════════════════════
     Refinery — Grades · Bonds · Condensers
     ═════════════════════════════════════════════════════════════════ */

  /** Called once when Refinery is first enabled or on plugin load. */
  bootRefinery(): void {
    this.buildBondGraph();
    this.renderRefineryStatus();
    this.app.workspace.onLayoutReady(() => this.decorateActiveLeaf());
  }

  /** Tear down Refinery visuals. */
  teardownRefinery(): void {
    this.stripRefineryBar();
    this.bonds = emptyBondGraph();
    this.renderRefineryStatus();
  }

  /* ── Bond graph ─────────────────────────────────────────────── */

  /** Build the Bond graph from Obsidian's resolved-link cache (see core.ts). */
  buildBondGraph(): void {
    this.bonds = buildBondGraph(
      this.app.metadataCache.resolvedLinks,
      this.settings.vaultRoot,
    );
  }

  /* ── Grade helpers ──────────────────────────────────────────── */

  /** Read the `grade` frontmatter field of a markdown file. */
  private getGrade(file: TFile): string | null {
    const cache = this.app.metadataCache.getFileCache(file);
    return normalizeGrade(cache?.frontmatter?.["grade"]);
  }

  /* ── Bond helpers ───────────────────────────────────────────── */

  /** Total bond count = outgoing links + incoming links. */
  private getBondCount(filePath: string): number {
    return bondCount(this.bonds, filePath);
  }

  /* ── Condenser helpers ──────────────────────────────────────── */

  /** A note is a Condenser when its bond count meets the threshold. */
  private isCondenser(filePath: string): boolean {
    return isCondenser(this.bonds, filePath, this.settings.condenserThreshold);
  }

  /** Return Condenser notes that link TO the given file. */
  private getReferencingCondensers(filePath: string): string[] {
    return referencingCondensers(
      this.bonds,
      filePath,
      this.settings.condenserThreshold,
    );
  }

  /* ── Status-bar Refinery section ────────────────────────────── */

  private renderRefineryStatus(): void {
    this.statusRefinery.empty();
    if (!this.settings.refineryEnabled) return;

    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") return;

    const grade     = this.getGrade(file);
    const bondCount = this.getBondCount(file.path);
    const condenser = this.isCondenser(file.path);

    const wrap = this.statusRefinery.createSpan({ cls: "thunderegg-refinery-status" });

    if (grade && this.settings.showGradeBadges) {
      const m = GRADE_META[grade];
      if (m) {
        wrap.createSpan({
          cls: `thunderegg-grade thunderegg-grade-${m.css}`,
          text: `${m.icon} ${m.label}`,
        });
      }
    }

    if (this.settings.showBondCounts) {
      wrap.createSpan({
        cls: "thunderegg-bonds",
        text: `🔗 ${bondCount}`,  // 🔗
      });
    }

    if (condenser) {
      wrap.createSpan({
        cls: "thunderegg-condenser-badge",
        text: "⚗️ Condenser",  // ⚗️
      });
    }
  }

  /* ── Refinery info bar inside the active leaf ────────────────── */

  private decorateActiveLeaf(): void {
    this.stripRefineryBar();
    if (!this.settings.refineryEnabled) return;

    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") return;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    const grade         = this.getGrade(file);
    const bondCount     = this.getBondCount(file.path);
    const condenser     = this.isCondenser(file.path);
    const condenserRefs = this.settings.showCondenserLinks
      ? this.getReferencingCondensers(file.path)
      : [];

    // Nothing meaningful to render
    if (!grade && bondCount === 0 && condenserRefs.length === 0) return;

    const bar = createDiv({ cls: "thunderegg-refinery-bar" });

    /* Grade badge */
    if (grade && this.settings.showGradeBadges) {
      const m = GRADE_META[grade];
      if (m) {
        bar.createSpan({
          cls: `thunderegg-grade thunderegg-grade-${m.css}`,
          text: `${m.icon} ${m.label}`,
        });
      }
    }

    /* Bond count */
    if (this.settings.showBondCounts && bondCount > 0) {
      bar.createSpan({
        cls: "thunderegg-bonds",
        text: `🔗 ${bondCount} bond${bondCount === 1 ? "" : "s"}`,
      });
    }

    /* Condenser flag */
    if (condenser) {
      bar.createSpan({
        cls: "thunderegg-condenser-badge",
        text: "⚗️ Condenser",
      });
    }

    /* Condenser back-links */
    if (condenserRefs.length > 0) {
      const linksEl = bar.createSpan({ cls: "thunderegg-condenser-links" });
      linksEl.createSpan({ text: "Hub: " });
      condenserRefs.forEach((cPath, i) => {
        const name = cPath.replace(/\.md$/, "").split("/").pop() ?? cPath;
        const a = linksEl.createEl("a", {
          cls: "internal-link",
          text: name,
          href: cPath,
        });
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          const target = this.app.vault.getAbstractFileByPath(cPath);
          if (target instanceof TFile) {
            void this.app.workspace.getLeaf(false).openFile(target);
          }
        });
        if (i < condenserRefs.length - 1) {
          linksEl.createSpan({ text: ", " });
        }
      });
    }

    /* Insert at the top of the view-content area */
    const viewContent = view.containerEl.querySelector(".view-content");
    if (viewContent) {
      viewContent.insertBefore(bar, viewContent.firstChild);
      this.refineryBarEl = bar;
    }
  }

  /** Remove Refinery bar from the DOM. */
  private stripRefineryBar(): void {
    this.refineryBarEl?.remove();
    this.refineryBarEl = null;
    // Clean up orphans left by rapid tab switches
    activeDocument.querySelectorAll(".thunderegg-refinery-bar").forEach((el) => el.remove());
  }

  /* ═════════════════════════════════════════════════════════════════
     Persistence
     ═════════════════════════════════════════════════════════════════ */

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<ThundereggSettings> | null,
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Utility
   ═══════════════════════════════════════════════════════════════════ */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

/** Human-readable message from an unknown thrown value. */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ═══════════════════════════════════════════════════════════════════
   Settings Tab
   ═══════════════════════════════════════════════════════════════════ */

class ThundereggSettingTab extends PluginSettingTab {
  plugin: ThundereggPlugin;

  constructor(app: App, plugin: ThundereggPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    /* ── Header ── */
    containerEl.createEl("p", {
      text:
        "Converts attachments on-device via the Thunderegg engine. " +
        "The Refinery adds note-maturity Grades, wikilink Bonds, " +
        "and hub-note Condensers to your vault.",
      cls: "setting-item-description",
    });

    /* ────────────────────────────────────────────────────────────── */
    /*  CONVERSION                                                   */
    /* ────────────────────────────────────────────────────────────── */
    new Setting(containerEl).setName("Conversion").setHeading();

    new Setting(containerEl)
      .setName("Engine path")
      .setDesc("Full path to the Thunderegg convert.sh helper script.")
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_SETTINGS.enginePath)
          .setValue(this.plugin.settings.enginePath)
          .onChange(async (v) => {
            this.plugin.settings.enginePath = v.trim();
            await this.plugin.saveSettings();
            await this.plugin.checkThundereggAvailable();
            this.plugin.renderThundereggStatus();
          }),
      );

    new Setting(containerEl)
      .setName("Add YAML frontmatter")
      .setDesc(
        "Prepend title / source / type / tags so converted notes land with full Properties.",
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.frontmatter).onChange(async (v) => {
          this.plugin.settings.frontmatter = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Open after converting")
      .setDesc("Automatically open the resulting .md in a new pane.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.openAfter).onChange(async (v) => {
          this.plugin.settings.openAfter = v;
          await this.plugin.saveSettings();
        }),
      );

    /* ────────────────────────────────────────────────────────────── */
    /*  REFINERY                                                     */
    /* ────────────────────────────────────────────────────────────── */
    new Setting(containerEl).setName("Refinery").setHeading();

    const refineryDesc = containerEl.createDiv({
      cls: "setting-item-description thunderegg-refinery-desc",
    });
    refineryDesc.createEl("p", {
      text:
        "The Refinery is Thunderegg’s knowledge-management layer. This plugin is free and " +
        "open source; the Thunderegg app it drives is $19.95 once, after a free trial. " +
        "It introduces three concepts:",
    });
    const ul = refineryDesc.createEl("ul");
    const liGrades = ul.createEl("li");
    liGrades.createEl("strong", { text: "Grades" });
    liGrades.appendText(" — note maturity: ");
    liGrades.createEl("em", { text: "Blank → Rough → Polished → Crystal → Gem" });
    const liBonds = ul.createEl("li");
    liBonds.createEl("strong", { text: "Bonds" });
    liBonds.appendText(" — connections discovered via ");
    liBonds.createEl("code", { text: "[[wikilinks]]" });
    const liCondensers = ul.createEl("li");
    liCondensers.createEl("strong", { text: "Condensers" });
    liCondensers.appendText(" — hub notes with many Bonds");

    new Setting(containerEl)
      .setName("Enable Refinery")
      .setDesc("Show Grade badges, Bond counts, and Condenser links in the UI.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.refineryEnabled).onChange(async (v) => {
          this.plugin.settings.refineryEnabled = v;
          await this.plugin.saveSettings();
          if (v) {
            this.plugin.bootRefinery();
          } else {
            this.plugin.teardownRefinery();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Vault root for bond discovery")
      .setDesc(
        'Limit bond scanning to a subfolder (e.g. "Notes"). ' +
        "Leave empty to scan the entire vault.",
      )
      .addText((t) =>
        t
          .setPlaceholder("(entire vault)")
          .setValue(this.plugin.settings.vaultRoot)
          .onChange(async (v) => {
            this.plugin.settings.vaultRoot = v.trim();
            await this.plugin.saveSettings();
            if (this.plugin.settings.refineryEnabled) {
              this.plugin.buildBondGraph();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Condenser threshold")
      .setDesc(
        "Minimum number of Bonds for a note to be flagged as a Condenser (hub note).",
      )
      .addSlider((s) =>
        s
          .setLimits(2, 30, 1)
          .setValue(this.plugin.settings.condenserThreshold)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.condenserThreshold = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Show grade badges")
      .setDesc("Display Vapor / Distillate / Essence maturity indicators.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showGradeBadges).onChange(async (v) => {
          this.plugin.settings.showGradeBadges = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Show bond counts")
      .setDesc("Display the number of wikilink connections for the active note.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showBondCounts).onChange(async (v) => {
          this.plugin.settings.showBondCounts = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Show condenser links")
      .setDesc("When viewing a note, list which Condenser (hub) notes reference it.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showCondenserLinks).onChange(async (v) => {
          this.plugin.settings.showCondenserLinks = v;
          await this.plugin.saveSettings();
        }),
      );

    /* ────────────────────────────────────────────────────────────── */
    /*  PUBLISH & COMMUNITY                                          */
    /* ────────────────────────────────────────────────────────────── */
    new Setting(containerEl).setName("Publish & Community").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Publish a Canvas as a concept map to the server configured below. Nothing is sent " +
        "unless you explicitly publish. Conversion, OCR and transcription all run on your Mac. " +
      "If you have connected a cloud model in the Thunderegg app, the AI enrichment step sends " +
      "part of each note to that provider — mark a vault Local in Thunderegg to keep " +
      "everything on-device.",
    });

    new Setting(containerEl)
      .setName("Server URL")
      .setDesc("Where maps are published.")
      .addText((t) =>
        t.setValue(this.plugin.settings.serverBaseUrl).onChange(async (v) => {
          this.plugin.settings.serverBaseUrl = v.trim() || DEFAULT_SETTINGS.serverBaseUrl;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Device token")
      .setDesc(
        hasDeviceToken()
          ? "A device token is connected (stored outside your vault). Paste a new one to replace it."
          : "Paste a publish-only device token from your server's settings page. Stored outside your vault — never in plugin data.",
      )
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder(hasDeviceToken() ? "•••• connected ••••" : "paste token").onChange((v) => {
          const tok = v.trim();
          if (tok) writeDeviceToken(tok);
        });
      })
      .addExtraButton((b) =>
        b.setIcon("trash").setTooltip("Disconnect (delete local token)").onClick(() => {
          clearDeviceToken();
          new Notice("Thunderegg: device token removed.");
          this.display();
        }),
      );

    const fp = signingKeyFingerprint();
    new Setting(containerEl)
      .setName("Signing key")
      .setDesc(
        fp
          ? `Maps are signed with device key ${fp} (Ed25519). The public key travels in each exported map's sidecar so others can verify you authored it.`
          : "An Ed25519 signing key is created on your first export, stored outside your vault. Its public key travels with each map so others can verify authorship.",
      );

    new Setting(containerEl)
      .setName("Default visibility")
      .setDesc("Pre-selected visibility for new publishes.")
      .addDropdown((d) => {
        (["private", "followers", "public"] as const).forEach((v) => { d.addOption(v, v); });
        d.setValue(this.plugin.settings.defaultVisibility).onChange(async (v) => {
          this.plugin.settings.defaultVisibility = v as Visibility;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Default map license")
      .addText((t) =>
        t.setValue(this.plugin.settings.defaultLicense).onChange(async (v) => {
          this.plugin.settings.defaultLicense = (v.trim() || "user-generated") as License;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Blocked privacy zones")
      .setDesc("Comma-separated tags that block publishing (checked on-device).")
      .addText((t) =>
        t.setValue(this.plugin.settings.blockedZonesCsv).onChange(async (v) => {
          this.plugin.settings.blockedZonesCsv = v;
          await this.plugin.saveSettings();
        }),
      );

    /* ────────────────────────────────────────────────────────────── */
    /*  CTA                                                          */
    /* ────────────────────────────────────────────────────────────── */
    new Setting(containerEl).setName("Get the app").setHeading();
    const cta = containerEl.createEl("p", {
      cls: "setting-item-description",
    });
    cta.appendText(
      "Thunderegg converts 30+ file types to clean Markdown — including meeting recordings, " +
      "transcribed on-device — 100% on your Mac. This plugin is free; the Mac app is " +
      "$19.95 once, after a free trial. Get it at ",
    );
    cta.createEl("a", { href: "https://thunderegg.ai", text: "thunderegg.ai" });
    cta.appendText(".");
  }
}
