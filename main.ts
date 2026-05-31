import {
  App, Notice, Plugin, PluginSettingTab, Setting,
  TFile, TFolder, TAbstractFile, normalizePath,
} from "obsidian";
import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as path from "path";

const execAsync = promisify(exec);

// File extensions Distill can convert (everything except markdown itself).
const CONVERTIBLE = new Set([
  "pdf", "docx", "xlsx", "xls", "pptx", "html", "htm", "csv", "json",
  "eml", "msg", "png", "jpg", "jpeg", "tiff", "tif", "heic", "gif", "bmp", "webp",
]);

interface DistillSettings {
  enginePath: string;     // path to convert.sh
  frontmatter: boolean;   // pass DISTILL_FRONTMATTER
  openAfter: boolean;     // open the resulting .md in a new pane
}

const DEFAULT_SETTINGS: DistillSettings = {
  enginePath: `${os.homedir()}/Library/Application Support/MarkItDownDroplet/convert.sh`,
  frontmatter: true,
  openAfter: true,
};

export default class DistillPlugin extends Plugin {
  settings!: DistillSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new DistillSettingTab(this.app, this));

    // Right-click on a file in the file explorer
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && CONVERTIBLE.has(file.extension.toLowerCase())) {
          menu.addItem((item) =>
            item.setTitle("Convert to Markdown (Distill)")
              .setIcon("file-down")
              .onClick(() => this.convertFile(file))
          );
        } else if (file instanceof TFolder) {
          menu.addItem((item) =>
            item.setTitle("Distill: convert all attachments")
              .setIcon("folder-down")
              .onClick(() => this.convertFolder(file))
          );
        }
      })
    );

    // Command palette entry (acts on the active file)
    this.addCommand({
      id: "distill-convert-active",
      name: "Convert active file to Markdown",
      checkCallback: (checking: boolean) => {
        const f = this.app.workspace.getActiveFile();
        const ok = !!f && CONVERTIBLE.has(f.extension.toLowerCase());
        if (ok && !checking) this.convertFile(f as TFile);
        return ok;
      },
    });
  }

  private absPath(file: TFile): string {
    // @ts-ignore — FileSystemAdapter exposes getFullPath on desktop
    const base = (this.app.vault.adapter as any).getBasePath?.() ?? "";
    return path.join(base, file.path);
  }

  async convertFile(file: TFile): Promise<void> {
    const engine = this.settings.enginePath;
    const full = this.absPath(file);
    const notice = new Notice(`Distill: converting ${file.name}…`, 0);
    try {
      const env = { ...process.env } as Record<string, string>;
      if (!this.settings.frontmatter) env.DISTILL_FRONTMATTER = "0";
      await execAsync(`"${engine}" "${full}"`, { env });
      notice.hide();
      new Notice(`Distill: created ${file.name}.md`);
      if (this.settings.openAfter) {
        const mdPath = normalizePath(`${file.path}.md`);
        const md = this.app.vault.getAbstractFileByPath(mdPath);
        if (md instanceof TFile) this.app.workspace.getLeaf(true).openFile(md);
      }
    } catch (e: any) {
      notice.hide();
      new Notice(`Distill failed: ${e?.message ?? e}. Is the Distill app installed?`, 8000);
      console.error("[Distill]", e);
    }
  }

  async convertFolder(folder: TFolder): Promise<void> {
    const targets: TFile[] = [];
    const walk = (f: TAbstractFile) => {
      if (f instanceof TFile && CONVERTIBLE.has(f.extension.toLowerCase())) targets.push(f);
      else if (f instanceof TFolder) f.children.forEach(walk);
    };
    walk(folder);
    if (targets.length === 0) { new Notice("Distill: no convertible files here."); return; }
    const notice = new Notice(`Distill: converting ${targets.length} files…`, 0);
    let ok = 0;
    for (const t of targets) {
      try {
        const env = { ...process.env } as Record<string, string>;
        if (!this.settings.frontmatter) env.DISTILL_FRONTMATTER = "0";
        await execAsync(`"${this.settings.enginePath}" "${this.absPath(t)}"`, { env });
        ok++;
      } catch (e) { console.error("[Distill]", t.path, e); }
    }
    notice.hide();
    new Notice(`Distill: converted ${ok}/${targets.length} files.`);
  }

  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }
}

class DistillSettingTab extends PluginSettingTab {
  plugin: DistillPlugin;
  constructor(app: App, plugin: DistillPlugin) { super(app, plugin); this.plugin = plugin; }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "Distill — Convert to Markdown" });
    containerEl.createEl("p", {
      text: "Converts attachments on-device via the Distill engine. Requires the Distill macOS app (or its helper scripts) installed.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Engine path")
      .setDesc("Path to the Distill convert.sh script.")
      .addText((t) => t
        .setPlaceholder(DEFAULT_SETTINGS.enginePath)
        .setValue(this.plugin.settings.enginePath)
        .onChange(async (v) => { this.plugin.settings.enginePath = v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Add YAML frontmatter")
      .setDesc("Prepend title/source/type/tags so notes drop straight into your vault with Properties.")
      .addToggle((t) => t
        .setValue(this.plugin.settings.frontmatter)
        .onChange(async (v) => { this.plugin.settings.frontmatter = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Open after converting")
      .setDesc("Open the resulting .md in a new pane.")
      .addToggle((t) => t
        .setValue(this.plugin.settings.openAfter)
        .onChange(async (v) => { this.plugin.settings.openAfter = v; await this.plugin.saveSettings(); }));
  }
}
