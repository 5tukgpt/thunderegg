import {
  App, Notice, Plugin, PluginSettingTab, Setting,
  TFile, TFolder, TAbstractFile, normalizePath,
  MarkdownView,
} from "obsidian";
import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

const execAsync = promisify(exec);

/* ═══════════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════════ */

/** File extensions the Distill engine can convert. */
const CONVERTIBLE = new Set([
  "pdf", "docx", "xlsx", "xls", "pptx", "html", "htm", "csv", "json",
  "eml", "msg", "png", "jpg", "jpeg", "tiff", "tif", "heic", "gif", "bmp", "webp",
]);

/* ── Refinery domain ──────────────────────────────────────────────── */

/**
 * Grade — note maturity level (Refinery terminology).
 *   vapor      → raw capture, unprocessed
 *   distillate → reviewed and refined
 *   essence    → canonical, evergreen knowledge
 */
interface GradeMeta {
  label: string;
  icon: string;
  css: string;
}

const GRADE_META: Record<string, GradeMeta> = {
  vapor:      { label: "Vapor",      icon: "☁️",  css: "vapor" },      // ☁️
  distillate: { label: "Distillate", icon: "💧", css: "distillate" },  // 💧
  essence:    { label: "Essence",    icon: "💎", css: "essence" },     // 💎
};

const VALID_GRADES = new Set(["vapor", "distillate", "essence"]);

/* ═══════════════════════════════════════════════════════════════════
   Settings
   ═══════════════════════════════════════════════════════════════════ */

interface DistillBridgeSettings {
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
}

const DEFAULT_SETTINGS: DistillBridgeSettings = {
  enginePath: `${os.homedir()}/Library/Application Support/MarkItDownDroplet/convert.sh`,
  frontmatter: true,
  openAfter: true,
  refineryEnabled: false,
  vaultRoot: "",
  condenserThreshold: 5,
  showGradeBadges: true,
  showBondCounts: true,
  showCondenserLinks: true,
};

/* ═══════════════════════════════════════════════════════════════════
   Bond graph — built from Obsidian's resolved-link cache
   ═══════════════════════════════════════════════════════════════════ */

interface BondGraph {
  /** filePath → set of paths it links TO */
  outgoing: Map<string, Set<string>>;
  /** filePath → set of paths that link TO it */
  incoming: Map<string, Set<string>>;
}

function emptyBondGraph(): BondGraph {
  return { outgoing: new Map(), incoming: new Map() };
}

/* ═══════════════════════════════════════════════════════════════════
   Plugin
   ═══════════════════════════════════════════════════════════════════ */

export default class DistillBridgePlugin extends Plugin {
  settings!: DistillBridgeSettings;

  /* UI handles */
  private statusDistill!: HTMLElement;
  private statusRefinery!: HTMLElement;
  private refineryBarEl: HTMLElement | null = null;

  /* State */
  private distillAvailable = false;
  private bonds: BondGraph = emptyBondGraph();

  /* ── Lifecycle ──────────────────────────────────────────────── */

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new DistillBridgeSettingTab(this.app, this));

    /* ── Status bar ── */
    this.statusDistill  = this.addStatusBarItem();
    this.statusRefinery = this.addStatusBarItem();

    await this.checkDistillAvailable();
    this.renderDistillStatus();

    /* ── File-explorer context menu ── */
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && CONVERTIBLE.has(file.extension.toLowerCase())) {
          menu.addItem((item) =>
            item
              .setTitle("Convert to Markdown (Distill)")
              .setIcon("file-down")
              .onClick(() => this.convertFile(file)),
          );
        } else if (file instanceof TFolder) {
          menu.addItem((item) =>
            item
              .setTitle("Distill: convert all attachments")
              .setIcon("folder-down")
              .onClick(() => this.convertFolder(file)),
          );
        }
      }),
    );

    /* ── Command palette ── */
    this.addCommand({
      id: "distill-convert-file",
      name: "Convert file",
      checkCallback: (checking: boolean) => {
        const f = this.app.workspace.getActiveFile();
        const ok = !!f && CONVERTIBLE.has(f.extension.toLowerCase());
        if (ok && !checking) this.convertFile(f as TFile);
        return ok;
      },
    });

    this.addCommand({
      id: "distill-convert-clipboard",
      name: "Convert clipboard",
      callback: () => this.convertClipboard(),
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

    /* ── Re-check Distill engine availability every 60 s ── */
    this.registerInterval(
      window.setInterval(() => {
        this.checkDistillAvailable().then(() => this.renderDistillStatus());
      }, 60_000),
    );
  }

  onunload() {
    this.stripRefineryBar();
  }

  /* ═════════════════════════════════════════════════════════════════
     Distill availability
     ═════════════════════════════════════════════════════════════════ */

  private async checkDistillAvailable(): Promise<void> {
    try {
      await fs.promises.access(this.settings.enginePath, fs.constants.X_OK);
      this.distillAvailable = true;
    } catch {
      this.distillAvailable = false;
    }
  }

  private renderDistillStatus(): void {
    this.statusDistill.empty();
    const dot   = this.distillAvailable ? "🟢" : "🔴"; // 🟢 / 🔴
    const label = this.distillAvailable ? "Ready" : "Unavailable";
    this.statusDistill.createSpan({
      cls: "distill-status",
      text: `⚗️ ${label} ${dot}`,  // ⚗️
    });
    this.statusDistill.setAttribute(
      "aria-label",
      this.distillAvailable
        ? `Distill engine: ${this.settings.enginePath}`
        : "Distill engine not found — check Settings → Distill",
    );
  }

  /* ═════════════════════════════════════════════════════════════════
     File conversion
     ═════════════════════════════════════════════════════════════════ */

  /** Resolve a vault-relative TFile to an absolute filesystem path. */
  private absPath(file: TFile): string {
    // @ts-ignore — getBasePath exists on desktop FileSystemAdapter
    const base: string = (this.app.vault.adapter as any).getBasePath?.() ?? "";
    return path.join(base, file.path);
  }

  /** Shell-escape a single argument (POSIX single-quote convention). */
  private shellQuote(s: string): string {
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }

  async convertFile(file: TFile): Promise<void> {
    const engine = this.settings.enginePath;
    const full   = this.absPath(file);
    const notice = new Notice(`Distill: converting ${file.name}…`, 0);

    try {
      const env: Record<string, string> = { ...process.env } as Record<string, string>;
      if (!this.settings.frontmatter) env["DISTILL_FRONTMATTER"] = "0";

      await execAsync(`${this.shellQuote(engine)} ${this.shellQuote(full)}`, { env });
      notice.hide();
      new Notice(`✅ Distill: created ${file.name}.md`);

      if (this.settings.openAfter) {
        const mdPath = normalizePath(`${file.path}.md`);
        await sleep(300);
        const md = this.app.vault.getAbstractFileByPath(mdPath);
        if (md instanceof TFile) this.app.workspace.getLeaf(true).openFile(md);
      }
    } catch (e: any) {
      notice.hide();
      new Notice(
        `❌ Distill failed: ${e?.message ?? e}. Is the Distill app installed?`,
        8000,
      );
      console.error("[Distill]", e);
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
      new Notice("Distill: no convertible files here.");
      return;
    }

    const notice = new Notice(`Distill: converting ${targets.length} files…`, 0);
    let ok = 0;

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
        console.error("[Distill]", t.path, e);
      }
    }

    notice.hide();
    new Notice(`✅ Distill: converted ${ok}/${targets.length} files.`);
  }

  /* ═════════════════════════════════════════════════════════════════
     Clipboard conversion
     ═════════════════════════════════════════════════════════════════ */

  async convertClipboard(): Promise<void> {
    /* Read clipboard — prefer HTML (richer), fall back to plain text. */
    let clipHtml = "";
    let clipText = "";
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require("electron");
      const cb = electron.clipboard ?? electron.remote?.clipboard;
      if (cb) {
        clipHtml = (cb.readHTML?.() as string) ?? "";
        clipText = (cb.readText?.() as string) ?? "";
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
    const tempName = `_distill_clip_${stamp}.${ext}`;
    const tempPath = normalizePath(tempName);

    const notice = new Notice("Distill: converting clipboard…", 0);

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
      await this.app.vault.delete(tempFile);
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

        new Notice(`✅ Distill: created ${niceName}`);
        if (this.settings.openAfter) {
          const renamed = this.app.vault.getAbstractFileByPath(nicePath);
          if (renamed instanceof TFile) {
            this.app.workspace.getLeaf(true).openFile(renamed);
          }
        }
      } else {
        new Notice("✅ Clipboard converted (file may take a moment to appear).");
      }
    } catch (e: any) {
      notice.hide();
      // Best-effort cleanup
      try {
        const tf = this.app.vault.getAbstractFileByPath(tempPath);
        if (tf instanceof TFile) await this.app.vault.delete(tf);
      } catch { /* swallow */ }
      new Notice(`❌ Clipboard conversion failed: ${e?.message ?? e}`, 8000);
      console.error("[Distill]", e);
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

  /**
   * Build the Bond graph from Obsidian's `metadataCache.resolvedLinks`.
   * Each resolved [[wikilink]] becomes a directed Bond.
   * If `vaultRoot` is set, only files under that prefix are indexed.
   */
  private buildBondGraph(): void {
    const out = new Map<string, Set<string>>();
    const inc = new Map<string, Set<string>>();
    const resolved: Record<string, Record<string, number>> =
      this.app.metadataCache.resolvedLinks;
    const root = this.settings.vaultRoot;

    for (const [src, targets] of Object.entries(resolved)) {
      if (root && !src.startsWith(root)) continue;
      for (const tgt of Object.keys(targets)) {
        if (root && !tgt.startsWith(root)) continue;

        if (!out.has(src)) out.set(src, new Set());
        out.get(src)!.add(tgt);

        if (!inc.has(tgt)) inc.set(tgt, new Set());
        inc.get(tgt)!.add(src);
      }
    }

    this.bonds = { outgoing: out, incoming: inc };
  }

  /* ── Grade helpers ──────────────────────────────────────────── */

  /** Read the `grade` frontmatter field of a markdown file. */
  private getGrade(file: TFile): string | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const raw   = cache?.frontmatter?.["grade"];
    return typeof raw === "string" && VALID_GRADES.has(raw) ? raw : null;
  }

  /* ── Bond helpers ───────────────────────────────────────────── */

  /** Total bond count = outgoing links + incoming links. */
  private getBondCount(filePath: string): number {
    return (
      (this.bonds.outgoing.get(filePath)?.size ?? 0) +
      (this.bonds.incoming.get(filePath)?.size ?? 0)
    );
  }

  /* ── Condenser helpers ──────────────────────────────────────── */

  /** A note is a Condenser when its bond count meets the threshold. */
  private isCondenser(filePath: string): boolean {
    return this.getBondCount(filePath) >= this.settings.condenserThreshold;
  }

  /** Return Condenser notes that link TO the given file. */
  private getReferencingCondensers(filePath: string): string[] {
    const incoming = this.bonds.incoming.get(filePath);
    if (!incoming) return [];
    return [...incoming].filter((src) => this.isCondenser(src));
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

    const wrap = this.statusRefinery.createSpan({ cls: "distill-refinery-status" });

    if (grade && this.settings.showGradeBadges) {
      const m = GRADE_META[grade];
      if (m) {
        wrap.createSpan({
          cls: `distill-grade distill-grade-${m.css}`,
          text: `${m.icon} ${m.label}`,
        });
      }
    }

    if (this.settings.showBondCounts) {
      wrap.createSpan({
        cls: "distill-bonds",
        text: `🔗 ${bondCount}`,  // 🔗
      });
    }

    if (condenser) {
      wrap.createSpan({
        cls: "distill-condenser-badge",
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

    const bar = createEl("div", { cls: "distill-refinery-bar" });

    /* Grade badge */
    if (grade && this.settings.showGradeBadges) {
      const m = GRADE_META[grade];
      if (m) {
        bar.createSpan({
          cls: `distill-grade distill-grade-${m.css}`,
          text: `${m.icon} ${m.label}`,
        });
      }
    }

    /* Bond count */
    if (this.settings.showBondCounts && bondCount > 0) {
      bar.createSpan({
        cls: "distill-bonds",
        text: `🔗 ${bondCount} bond${bondCount === 1 ? "" : "s"}`,
      });
    }

    /* Condenser flag */
    if (condenser) {
      bar.createSpan({
        cls: "distill-condenser-badge",
        text: "⚗️ Condenser",
      });
    }

    /* Condenser back-links */
    if (condenserRefs.length > 0) {
      const linksEl = bar.createSpan({ cls: "distill-condenser-links" });
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
            this.app.workspace.getLeaf(false).openFile(target);
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
    document.querySelectorAll(".distill-refinery-bar").forEach((el) => el.remove());
  }

  /* ═════════════════════════════════════════════════════════════════
     Persistence
     ═════════════════════════════════════════════════════════════════ */

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Utility
   ═══════════════════════════════════════════════════════════════════ */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ═══════════════════════════════════════════════════════════════════
   Settings Tab
   ═══════════════════════════════════════════════════════════════════ */

class DistillBridgeSettingTab extends PluginSettingTab {
  plugin: DistillBridgePlugin;

  constructor(app: App, plugin: DistillBridgePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    /* ── Header ── */
    containerEl.createEl("h2", { text: "Distill Bridge" });
    containerEl.createEl("p", {
      text:
        "Converts attachments on-device via the Distill engine. " +
        "The Refinery adds note-maturity Grades, wikilink Bonds, " +
        "and hub-note Condensers to your vault.",
      cls: "setting-item-description",
    });

    /* ────────────────────────────────────────────────────────────── */
    /*  CONVERSION                                                   */
    /* ────────────────────────────────────────────────────────────── */
    containerEl.createEl("h3", { text: "Conversion" });

    new Setting(containerEl)
      .setName("Engine path")
      .setDesc("Full path to the Distill convert.sh helper script.")
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_SETTINGS.enginePath)
          .setValue(this.plugin.settings.enginePath)
          .onChange(async (v) => {
            this.plugin.settings.enginePath = v.trim();
            await this.plugin.saveSettings();
            await (this.plugin as any).checkDistillAvailable();
            (this.plugin as any).renderDistillStatus();
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
    containerEl.createEl("h3", { text: "Refinery" });

    const refineryDesc = containerEl.createEl("div", {
      cls: "setting-item-description distill-refinery-desc",
    });
    refineryDesc.createEl("p", {
      text:
        "The Refinery is Distill’s premium knowledge-management layer. " +
        "It introduces four concepts:",
    });
    const ul = refineryDesc.createEl("ul");
    ul.createEl("li").innerHTML =
      "<strong>Grades</strong> — note maturity: <em>Vapor → Distillate → Essence</em>";
    ul.createEl("li").innerHTML =
      "<strong>Bonds</strong> — connections discovered via <code>[[wikilinks]]</code>";
    ul.createEl("li").innerHTML =
      "<strong>Condensers</strong> — hub notes with many Bonds";
    ul.createEl("li").innerHTML =
      "<strong>Fractions</strong> — folder-level grouping of related notes";

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
              (this.plugin as any).buildBondGraph();
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
    /*  CTA                                                          */
    /* ────────────────────────────────────────────────────────────── */
    containerEl.createEl("h3", { text: "Get Distill" });
    const cta = containerEl.createEl("p", {
      cls: "setting-item-description",
    });
    cta.innerHTML =
      "Distill converts 20+ file types to clean Markdown — 100% on your Mac. " +
      'Download the free app or unlock the full Refinery at ' +
      '<a href="https://distill.dev">distill.dev</a>.';
  }
}
