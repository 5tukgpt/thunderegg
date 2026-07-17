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
  CONVERTIBLE, GRADE_META, shellQuote, normalizeGrade, isNoOcrError,
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

  async convertFile(file: TFile): Promise<void> {
    const engine = this.settings.enginePath;
    const full   = this.absPath(file);
    const notice = new Notice(`Thunderegg: converting ${file.name}…`, 0);

    try {
      const env: Record<string, string> = { ...process.env } as Record<string, string>;
      if (!this.settings.frontmatter) env["DISTILL_FRONTMATTER"] = "0";

      await execAsync(`${this.shellQuote(engine)} ${this.shellQuote(full)}`, { env });
      notice.hide();
      new Notice(`✅ Thunderegg: created ${file.name}.md`);

      if (this.settings.openAfter) {
        const mdPath = normalizePath(`${file.path}.md`);
        await sleep(300);
        const md = this.app.vault.getAbstractFileByPath(mdPath);
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

    for (const t of targets) {
      try {
        const env: Record<string, string> = { ...process.env } as Record<string, string>;
        if (!this.settings.frontmatter) env["DISTILL_FRONTMATTER"] = "0";
        await execAsync(
          `${this.shellQuote(this.settings.enginePath)} ${this.shellQuote(this.absPath(t))}`,
          { env },
        );
        ok++;
      } catch (e) {
        // Missing OCR must NOT short-circuit the batch: it only stops images, so every
        // other file still converts. Count them and name the remedy once, below.
        if (isNoOcrError(e)) noOcr++;
        console.error("[Thunderegg]", t.path, e);
      }
    }

    notice.hide();
    let msg = `✅ Thunderegg: converted ${ok}/${targets.length} files.`;
    if (noOcr > 0) {
      msg += ` ${noOcr} image(s) need on-device OCR — reinstall the Thunderegg app to enable it.`;
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

      const env: Record<string, string> = { ...process.env } as Record<string, string>;
      if (!this.settings.frontmatter) env["DISTILL_FRONTMATTER"] = "0";
      await execAsync(
        `${this.shellQuote(this.settings.enginePath)} ${this.shellQuote(this.absPath(tempFile))}`,
        { env },
      );

      // Remove the temporary source file
      await this.app.fileManager.trashFile(tempFile);
      notice.hide();

      // Locate the generated .md and give it a friendly name
      const mdRawPath = normalizePath(`${tempPath}.md`);
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
        "The Refinery is Thunderegg’s premium knowledge-management layer. " +
        "It introduces four concepts:",
    });
    const ul = refineryDesc.createEl("ul");
    const liGrades = ul.createEl("li");
    liGrades.createEl("strong", { text: "Grades" });
    liGrades.appendText(" — note maturity: ");
    liGrades.createEl("em", { text: "Vapor → Distillate → Essence" });
    const liBonds = ul.createEl("li");
    liBonds.createEl("strong", { text: "Bonds" });
    liBonds.appendText(" — connections discovered via ");
    liBonds.createEl("code", { text: "[[wikilinks]]" });
    const liCondensers = ul.createEl("li");
    liCondensers.createEl("strong", { text: "Condensers" });
    liCondensers.appendText(" — hub notes with many Bonds");
    const liFractions = ul.createEl("li");
    liFractions.createEl("strong", { text: "Fractions" });
    liFractions.appendText(" — folder-level grouping of related notes");

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
        "Publish a Canvas as a concept map to distillmd.dev. Nothing is sent unless " +
        "you explicitly publish; your vault never leaves your machine.",
    });

    new Setting(containerEl)
      .setName("Server URL")
      .setDesc("Where maps are published.")
      .addText((t) =>
        t.setValue(this.plugin.settings.serverBaseUrl).onChange(async (v) => {
          this.plugin.settings.serverBaseUrl = v.trim() || "https://distillmd.dev";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Device token")
      .setDesc(
        hasDeviceToken()
          ? "A device token is connected (stored outside your vault). Paste a new one to replace it."
          : "Paste a publish-only device token from distillmd.dev/settings. Stored outside your vault — never in plugin data.",
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
      "Thunderegg converts 20+ file types to clean Markdown — 100% on your Mac. " +
      "Download the free app or unlock the full Refinery at ",
    );
    cta.createEl("a", { href: "https://distillmd.dev", text: "distillmd.dev" });
    cta.appendText(".");
  }
}
