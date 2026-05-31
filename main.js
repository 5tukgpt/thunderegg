"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => DistillPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_child_process = require("child_process");
var import_util = require("util");
var os = __toESM(require("os"));
var path = __toESM(require("path"));
var execAsync = (0, import_util.promisify)(import_child_process.exec);
var CONVERTIBLE = /* @__PURE__ */ new Set([
  "pdf",
  "docx",
  "xlsx",
  "xls",
  "pptx",
  "html",
  "htm",
  "csv",
  "json",
  "eml",
  "msg",
  "png",
  "jpg",
  "jpeg",
  "tiff",
  "tif",
  "heic",
  "gif",
  "bmp",
  "webp"
]);
var DEFAULT_SETTINGS = {
  enginePath: `${os.homedir()}/Library/Application Support/MarkItDownDroplet/convert.sh`,
  frontmatter: true,
  openAfter: true
};
var DistillPlugin = class extends import_obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new DistillSettingTab(this.app, this));
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof import_obsidian.TFile && CONVERTIBLE.has(file.extension.toLowerCase())) {
          menu.addItem(
            (item) => item.setTitle("Convert to Markdown (Distill)").setIcon("file-down").onClick(() => this.convertFile(file))
          );
        } else if (file instanceof import_obsidian.TFolder) {
          menu.addItem(
            (item) => item.setTitle("Distill: convert all attachments").setIcon("folder-down").onClick(() => this.convertFolder(file))
          );
        }
      })
    );
    this.addCommand({
      id: "distill-convert-active",
      name: "Convert active file to Markdown",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        const ok = !!f && CONVERTIBLE.has(f.extension.toLowerCase());
        if (ok && !checking)
          this.convertFile(f);
        return ok;
      }
    });
  }
  absPath(file) {
    const base = this.app.vault.adapter.getBasePath?.() ?? "";
    return path.join(base, file.path);
  }
  async convertFile(file) {
    const engine = this.settings.enginePath;
    const full = this.absPath(file);
    const notice = new import_obsidian.Notice(`Distill: converting ${file.name}\u2026`, 0);
    try {
      const env = { ...process.env };
      if (!this.settings.frontmatter)
        env.DISTILL_FRONTMATTER = "0";
      await execAsync(`"${engine}" "${full}"`, { env });
      notice.hide();
      new import_obsidian.Notice(`Distill: created ${file.name}.md`);
      if (this.settings.openAfter) {
        const mdPath = (0, import_obsidian.normalizePath)(`${file.path}.md`);
        const md = this.app.vault.getAbstractFileByPath(mdPath);
        if (md instanceof import_obsidian.TFile)
          this.app.workspace.getLeaf(true).openFile(md);
      }
    } catch (e) {
      notice.hide();
      new import_obsidian.Notice(`Distill failed: ${e?.message ?? e}. Is the Distill app installed?`, 8e3);
      console.error("[Distill]", e);
    }
  }
  async convertFolder(folder) {
    const targets = [];
    const walk = (f) => {
      if (f instanceof import_obsidian.TFile && CONVERTIBLE.has(f.extension.toLowerCase()))
        targets.push(f);
      else if (f instanceof import_obsidian.TFolder)
        f.children.forEach(walk);
    };
    walk(folder);
    if (targets.length === 0) {
      new import_obsidian.Notice("Distill: no convertible files here.");
      return;
    }
    const notice = new import_obsidian.Notice(`Distill: converting ${targets.length} files\u2026`, 0);
    let ok = 0;
    for (const t of targets) {
      try {
        const env = { ...process.env };
        if (!this.settings.frontmatter)
          env.DISTILL_FRONTMATTER = "0";
        await execAsync(`"${this.settings.enginePath}" "${this.absPath(t)}"`, { env });
        ok++;
      } catch (e) {
        console.error("[Distill]", t.path, e);
      }
    }
    notice.hide();
    new import_obsidian.Notice(`Distill: converted ${ok}/${targets.length} files.`);
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var DistillSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "Distill \u2014 Convert to Markdown" });
    containerEl.createEl("p", {
      text: "Converts attachments on-device via the Distill engine. Requires the Distill macOS app (or its helper scripts) installed.",
      cls: "setting-item-description"
    });
    new import_obsidian.Setting(containerEl).setName("Engine path").setDesc("Path to the Distill convert.sh script.").addText((t) => t.setPlaceholder(DEFAULT_SETTINGS.enginePath).setValue(this.plugin.settings.enginePath).onChange(async (v) => {
      this.plugin.settings.enginePath = v.trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Add YAML frontmatter").setDesc("Prepend title/source/type/tags so notes drop straight into your vault with Properties.").addToggle((t) => t.setValue(this.plugin.settings.frontmatter).onChange(async (v) => {
      this.plugin.settings.frontmatter = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Open after converting").setDesc("Open the resulting .md in a new pane.").addToggle((t) => t.setValue(this.plugin.settings.openAfter).onChange(async (v) => {
      this.plugin.settings.openAfter = v;
      await this.plugin.saveSettings();
    }));
  }
};
