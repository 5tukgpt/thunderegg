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
  default: () => DistillBridgePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");
var import_child_process = require("child_process");
var import_util = require("util");
var os2 = __toESM(require("os"));
var path2 = __toESM(require("path"));
var fs2 = __toESM(require("fs"));

// core.ts
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
function shellQuote(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
var GRADE_META = {
  vapor: { label: "Vapor", icon: "\u2601\uFE0F", css: "vapor" },
  // ☁️
  distillate: { label: "Distillate", icon: "\u{1F4A7}", css: "distillate" },
  // 💧
  essence: { label: "Essence", icon: "\u{1F48E}", css: "essence" }
  // 💎
};
var VALID_GRADES = /* @__PURE__ */ new Set(["vapor", "distillate", "essence"]);
function normalizeGrade(raw) {
  return typeof raw === "string" && VALID_GRADES.has(raw) ? raw : null;
}
function emptyBondGraph() {
  return { outgoing: /* @__PURE__ */ new Map(), incoming: /* @__PURE__ */ new Map() };
}
function buildBondGraph(resolved, root) {
  const out = /* @__PURE__ */ new Map();
  const inc = /* @__PURE__ */ new Map();
  for (const [src, targets] of Object.entries(resolved)) {
    if (root && !src.startsWith(root))
      continue;
    for (const tgt of Object.keys(targets)) {
      if (root && !tgt.startsWith(root))
        continue;
      if (!out.has(src))
        out.set(src, /* @__PURE__ */ new Set());
      out.get(src).add(tgt);
      if (!inc.has(tgt))
        inc.set(tgt, /* @__PURE__ */ new Set());
      inc.get(tgt).add(src);
    }
  }
  return { outgoing: out, incoming: inc };
}
function bondCount(bonds, filePath) {
  return (bonds.outgoing.get(filePath)?.size ?? 0) + (bonds.incoming.get(filePath)?.size ?? 0);
}
function isCondenser(bonds, filePath, threshold) {
  return bondCount(bonds, filePath) >= threshold;
}
function referencingCondensers(bonds, filePath, threshold) {
  const incoming = bonds.incoming.get(filePath);
  if (!incoming)
    return [];
  return [...incoming].filter((src) => isCondenser(bonds, src, threshold));
}

// publish-ui.ts
var import_obsidian2 = require("obsidian");

// publish-core.ts
var NODE_TEXT_CAP = 280;
var SUMMARY_MIN = 150;
var SUMMARY_MAX = 500;
var VISIBILITIES = ["private", "followers", "public"];
var SOURCE_TYPES = [
  "book",
  "paper",
  "article",
  "government-publication",
  "course",
  "video",
  "webpage",
  "dataset",
  "personal-notes",
  "other"
];
var LICENSES = [
  "CC0-1.0",
  "public-domain",
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC-BY-NC-4.0",
  "CC-BY-ND-4.0",
  "MIT",
  "Apache-2.0",
  "user-generated",
  "all-rights-reserved",
  "proprietary",
  "unknown"
];
var DEFAULT_BLOCKED_ZONES = ["#health", "#work", "#client", "#private"];
function firstLine(text) {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line)
      return line.replace(/^#{1,6}\s+/, "").trim();
  }
  return "";
}
function inferKind(text) {
  return firstLine(text).endsWith("?") ? "question" : "concept";
}
function transformCanvas(canvas, meta, clientUuid) {
  const warnings = [];
  const blocking = [];
  const excluded = [];
  const nodes = [];
  const kinds = {};
  const includedIds = /* @__PURE__ */ new Set();
  for (const n of canvas.nodes ?? []) {
    if (n.type === "group") {
      excluded.push({ id: n.id, type: "group", reason: "group (visual-only)" });
      continue;
    }
    if (n.type === "file") {
      excluded.push({ id: n.id, type: "file", reason: "file node references a vault path (privacy)" });
      warnings.push(`Excluded file node "${n.file ?? n.id}" \u2014 convert it to a text node to publish it.`);
      continue;
    }
    if (n.type === "link") {
      excluded.push({ id: n.id, type: "link", reason: "link node URL belongs in provenance" });
      warnings.push(`Excluded link node "${n.url ?? n.id}" \u2014 add its URL as a provenance entry instead.`);
      continue;
    }
    const text = (n.text ?? "").trim();
    if (!text) {
      excluded.push({ id: n.id, type: "text", reason: "empty text node" });
      continue;
    }
    if (text.length > NODE_TEXT_CAP) {
      blocking.push(`Node "${firstLine(text).slice(0, 40)}\u2026" is ${text.length} chars (max ${NODE_TEXT_CAP}). Shorten it before publishing.`);
    }
    nodes.push({
      id: n.id,
      type: "text",
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      text,
      ...n.color !== void 0 ? { color: n.color } : {}
    });
    includedIds.add(n.id);
    const kind = meta.kinds?.[n.id] ?? inferKind(text);
    kinds[n.id] = { kind };
  }
  if (nodes.length === 0) {
    blocking.push("This canvas has no text nodes to publish.");
  }
  const edges = [];
  for (const e of canvas.edges ?? []) {
    if (!includedIds.has(e.fromNode) || !includedIds.has(e.toNode)) {
      excluded.push({ id: e.id, type: "edge", reason: "edge endpoint was excluded" });
      warnings.push(`Dropped an edge connected to an excluded node.`);
      continue;
    }
    edges.push({
      id: e.id,
      fromNode: e.fromNode,
      toNode: e.toNode,
      ...e.fromSide !== void 0 ? { fromSide: e.fromSide } : {},
      ...e.toSide !== void 0 ? { toSide: e.toSide } : {},
      ...e.fromEnd !== void 0 ? { fromEnd: e.fromEnd } : {},
      ...e.toEnd !== void 0 ? { toEnd: e.toEnd } : {},
      ...e.label !== void 0 ? { label: e.label } : {},
      ...e.color !== void 0 ? { color: e.color } : {}
    });
  }
  const artifact = {
    schema: "distill.map/0.2",
    client_uuid: clientUuid,
    title: meta.title,
    summary: meta.summary,
    topics: meta.topics,
    visibility: meta.visibility,
    map: { format: "jsoncanvas/1.0", nodes, edges },
    "x-distill": { nodes: kinds },
    provenance: meta.provenance,
    license: meta.license,
    distill_version: meta.distill_version
  };
  blocking.push(...validatePublishMeta(meta));
  return { artifact, warnings, blocking, excluded };
}
function validatePublishMeta(meta) {
  const errs = [];
  const len = meta.summary.trim().length;
  if (len < SUMMARY_MIN || len > SUMMARY_MAX) {
    errs.push(`Summary must be ${SUMMARY_MIN}\u2013${SUMMARY_MAX} chars (currently ${len}).`);
  }
  if (!meta.topics || meta.topics.length < 1) {
    errs.push("At least one topic is required.");
  }
  if (!VISIBILITIES.includes(meta.visibility)) {
    errs.push(`Invalid visibility "${meta.visibility}".`);
  }
  if (!LICENSES.includes(meta.license)) {
    errs.push(`Invalid map license "${meta.license}".`);
  }
  if (!meta.provenance || meta.provenance.length < 1) {
    errs.push("At least one provenance entry is required.");
  } else {
    meta.provenance.forEach((p, i) => {
      if (!p.source_title?.trim())
        errs.push(`Provenance #${i + 1}: source_title is required.`);
      if (!p.url?.trim())
        errs.push(`Provenance #${i + 1}: url is required.`);
      if (!SOURCE_TYPES.includes(p.source_type)) {
        errs.push(`Provenance #${i + 1}: invalid source_type "${p.source_type}".`);
      }
      if (!LICENSES.includes(p.license)) {
        errs.push(`Provenance #${i + 1}: invalid license "${p.license}".`);
      }
    });
  }
  return errs;
}
var RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
var RE_PHONE = /(?:\+?\d[\d\s().-]{8,}\d)/;
var RE_HANDLE = /(?:^|\s)@[A-Za-z0-9_]{2,}/;
var RE_URL = /https?:\/\/\S+/;
function normTag(s) {
  return s.replace(/^#/, "").trim().toLowerCase();
}
function redactionScan(artifact, blockedZones = DEFAULT_BLOCKED_ZONES) {
  const blocks = [];
  const warnings = [];
  const blocked = new Set(blockedZones.map(normTag));
  const taggedSources = [
    { where: "title", text: artifact.title },
    ...artifact.map.nodes.map((n) => ({ where: `node ${n.id}`, text: n.text }))
  ];
  for (const topic of artifact.topics) {
    if (blocked.has(normTag(topic)))
      blocks.push(`Topic "${topic}" is in a blocked privacy zone.`);
  }
  for (const { where, text } of taggedSources) {
    const tags = text.match(/#[A-Za-z0-9_/-]+/g) ?? [];
    for (const t of tags) {
      if (blocked.has(normTag(t)))
        blocks.push(`Tag "${t}" (in ${where}) is in a blocked privacy zone.`);
    }
  }
  const piiSources = [
    { where: "title", text: artifact.title },
    { where: "summary", text: artifact.summary },
    { where: "topics", text: artifact.topics.join(" ") },
    ...artifact.map.nodes.map((n) => ({ where: `node ${n.id}`, text: n.text })),
    ...artifact.provenance.map((p, i) => ({ where: `provenance #${i + 1} title`, text: p.source_title }))
  ];
  for (const { where, text } of piiSources) {
    if (RE_EMAIL.test(text))
      warnings.push(`Possible email address in ${where}.`);
    if (RE_PHONE.test(text))
      warnings.push(`Possible phone number in ${where}.`);
    if (RE_HANDLE.test(text))
      warnings.push(`Possible @handle in ${where}.`);
    if (RE_URL.test(text))
      warnings.push(`A URL appears in ${where} \u2014 make sure it isn't private.`);
  }
  return { blocks, warnings };
}

// publish-net.ts
var import_obsidian = require("obsidian");
var os = __toESM(require("os"));
var path = __toESM(require("path"));
var fs = __toESM(require("fs"));
var TOKEN_DIR = path.join(os.homedir(), "Library", "Application Support", "MarkItDownDroplet");
var TOKEN_FILE = path.join(TOKEN_DIR, "distill-token");
function readDeviceToken() {
  try {
    return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    return "";
  }
}
function writeDeviceToken(token) {
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, token.trim(), { mode: 384 });
  try {
    fs.chmodSync(TOKEN_FILE, 384);
  } catch {
  }
}
function clearDeviceToken() {
  try {
    fs.unlinkSync(TOKEN_FILE);
  } catch {
  }
}
function hasDeviceToken() {
  return readDeviceToken().length > 0;
}
function trimSlash(u) {
  return u.replace(/\/+$/, "");
}
async function publishArtifact(baseUrl, token, artifact) {
  const res = await (0, import_obsidian.requestUrl)({
    url: `${trimSlash(baseUrl)}/api/maps`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(artifact),
    throw: false
  });
  if (res.status < 200 || res.status >= 300) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = res.json;
      if (j && typeof j.error === "string")
        msg = j.error;
    } catch {
    }
    throw new Error(msg);
  }
  return res.json;
}
async function fetchForkFile(baseUrl, mapId) {
  const res = await (0, import_obsidian.requestUrl)({
    url: `${trimSlash(baseUrl)}/api/maps/${encodeURIComponent(mapId)}/forkfile`,
    method: "GET",
    throw: false
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Fork fetch failed: HTTP ${res.status}`);
  }
  return res.json;
}

// publish-ui.ts
function emptyProvenance() {
  return { source_title: "", url: "", source_type: "webpage", license: "public-domain" };
}
var PublishModal = class extends import_obsidian2.Modal {
  constructor(app, canvas, defaultTitle, ctx) {
    super(app);
    this.canvas = canvas;
    this.ctx = ctx;
    this.clientUuid = crypto.randomUUID();
    this.meta = {
      title: defaultTitle,
      summary: "",
      topics: [],
      visibility: ctx.defaultVisibility,
      license: ctx.defaultLicense,
      provenance: [emptyProvenance()],
      distill_version: ctx.distillVersion,
      kinds: {}
    };
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Publish concept map" });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "Only text nodes are published, as your own synthesis. The exact JSON that will leave your device is shown below \u2014 nothing else is sent."
    });
    new import_obsidian2.Setting(contentEl).setName("Title").addText((t) => t.setValue(this.meta.title).onChange((v) => {
      this.meta.title = v;
      this.refresh();
    }));
    new import_obsidian2.Setting(contentEl).setName("Summary").setDesc(`${SUMMARY_MIN}\u2013${SUMMARY_MAX} characters.`).addTextArea((t) => t.setPlaceholder("What this map is, in your words\u2026").onChange((v) => {
      this.meta.summary = v;
      this.refresh();
    }));
    new import_obsidian2.Setting(contentEl).setName("Topics").setDesc("Comma-separated. At least one.").addText((t) => t.setPlaceholder("medtech, regulatory").onChange((v) => {
      this.meta.topics = v.split(",").map((s) => s.trim()).filter(Boolean);
      this.refresh();
    }));
    new import_obsidian2.Setting(contentEl).setName("Visibility").addDropdown((d) => {
      VISIBILITIES.forEach((v) => d.addOption(v, v));
      d.setValue(this.meta.visibility).onChange((v) => {
        this.meta.visibility = v;
        this.refresh();
      });
    });
    new import_obsidian2.Setting(contentEl).setName("Map license").addDropdown((d) => {
      LICENSES.forEach((l) => d.addOption(l, l));
      d.setValue(this.meta.license).onChange((v) => {
        this.meta.license = v;
        this.refresh();
      });
    });
    contentEl.createEl("h3", { text: "Provenance (sources)" });
    const provWrap = contentEl.createDiv();
    const renderProv = () => {
      provWrap.empty();
      this.meta.provenance.forEach((p, i) => {
        const row = provWrap.createDiv({ cls: "distill-prov-row" });
        new import_obsidian2.Setting(row).setName(`Source #${i + 1}`).addText((t) => t.setPlaceholder("Title").setValue(p.source_title).onChange((v) => {
          p.source_title = v;
          this.refresh();
        })).addText((t) => t.setPlaceholder("https://\u2026").setValue(p.url).onChange((v) => {
          p.url = v;
          this.refresh();
        })).addDropdown((d) => {
          SOURCE_TYPES.forEach((s) => d.addOption(s, s));
          d.setValue(p.source_type).onChange((v) => {
            p.source_type = v;
            this.refresh();
          });
        }).addDropdown((d) => {
          LICENSES.forEach((l) => d.addOption(l, l));
          d.setValue(p.license).onChange((v) => {
            p.license = v;
            this.refresh();
          });
        }).addExtraButton((b) => b.setIcon("trash").setTooltip("Remove").onClick(() => {
          if (this.meta.provenance.length > 1) {
            this.meta.provenance.splice(i, 1);
            renderProv();
            this.refresh();
          }
        }));
      });
    };
    renderProv();
    new import_obsidian2.Setting(contentEl).addButton((b) => b.setButtonText("+ Add source").onClick(() => {
      this.meta.provenance.push(emptyProvenance());
      renderProv();
      this.refresh();
    }));
    contentEl.createEl("h3", { text: "Review" });
    this.issuesEl = contentEl.createDiv({ cls: "distill-publish-issues" });
    this.previewEl = contentEl.createEl("pre", { cls: "distill-publish-preview" });
    this.previewEl.style.maxHeight = "240px";
    this.previewEl.style.overflow = "auto";
    const btns = new import_obsidian2.Setting(contentEl);
    btns.addButton((b) => b.setButtonText("Copy JSON").onClick(async () => {
      await navigator.clipboard.writeText(this.previewEl.getText());
      new import_obsidian2.Notice("Artifact JSON copied.");
    }));
    btns.addButton((b) => {
      this.publishBtn = b.buttonEl;
      b.setButtonText("Publish").setCta().onClick(() => this.doPublish());
    });
    this.refresh();
  }
  /** Re-run the transform + redaction and repaint preview + issues + button state. */
  refresh() {
    const { artifact, warnings, blocking, excluded } = transformCanvas(this.canvas, this.meta, this.clientUuid);
    const redaction = redactionScan(artifact, this.ctx.blockedZones);
    this.previewEl.setText(JSON.stringify(artifact, null, 2));
    this.issuesEl.empty();
    const blocks = [...blocking, ...redaction.blocks];
    const warns = [...warnings, ...redaction.warnings, ...excluded.filter((e) => e.type !== "group").map((e) => `Excluded ${e.type} node (${e.reason}).`)];
    if (blocks.length) {
      const ul = this.issuesEl.createEl("ul", { cls: "distill-publish-blocks" });
      blocks.forEach((b) => ul.createEl("li", { text: `\u26D4 ${b}` }));
    }
    if (warns.length) {
      const ul = this.issuesEl.createEl("ul", { cls: "distill-publish-warnings" });
      warns.forEach((w) => ul.createEl("li", { text: `\u26A0\uFE0F ${w}` }));
    }
    if (!blocks.length && !warns.length) {
      this.issuesEl.createEl("p", { text: "\u2705 No issues.", cls: "setting-item-description" });
    }
    const ready = blocks.length === 0 && this.ctx.token.length > 0;
    this.publishBtn.disabled = !ready;
    this.publishBtn.title = this.ctx.token ? blocks.length ? "Resolve the blocking issues above." : "" : "Connect a device token in Settings \u2192 Distill first.";
  }
  async doPublish() {
    const { artifact } = transformCanvas(this.canvas, this.meta, this.clientUuid);
    const notice = new import_obsidian2.Notice("Distill: publishing\u2026", 0);
    try {
      const res = await publishArtifact(this.ctx.baseUrl, this.ctx.token, artifact);
      notice.hide();
      new import_obsidian2.Notice(`\u2705 Published: ${res.url}`);
      this.close();
    } catch (e) {
      notice.hide();
      new import_obsidian2.Notice(`\u274C Publish failed: ${e instanceof Error ? e.message : String(e)}`, 8e3);
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};
function safeName(s) {
  return (s || "map").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80).trim() || "map";
}
async function importForkedMap(app, baseUrl, mapId) {
  const notice = new import_obsidian2.Notice("Distill: forking map\u2026", 0);
  try {
    const data = await fetchForkFile(baseUrl, mapId);
    const title = safeName(data.title ?? mapId);
    const folder = "Forked";
    if (!app.vault.getAbstractFileByPath(folder)) {
      try {
        await app.vault.createFolder(folder);
      } catch {
      }
    }
    const canvasBody = JSON.stringify({ nodes: data.map?.nodes ?? [], edges: data.map?.edges ?? [] }, null, 2);
    const canvasPath = (0, import_obsidian2.normalizePath)(`${folder}/${title}.canvas`);
    await writeOrReplace(app, canvasPath, canvasBody);
    const author = data.author?.handle ?? "unknown";
    const link = `${baseUrl.replace(/\/+$/, "")}/@${author}/${data.id ?? mapId}`;
    const attribution = `---
forked_from: ${data.id ?? mapId}
author: ${author}
license: ${data.license ?? "unknown"}
source_url: ${link}
---

# ${data.title ?? title} (forked)

Forked from [@${author}](${link}). License: ${data.license ?? "unknown"}.

The map is in \`${title}.canvas\` in this folder.
`;
    await writeOrReplace(app, (0, import_obsidian2.normalizePath)(`${folder}/${title} \u2014 source.md`), attribution);
    notice.hide();
    new import_obsidian2.Notice(`\u2705 Forked "${data.title ?? title}" into ${folder}/`);
    const f = app.vault.getAbstractFileByPath(canvasPath);
    if (f instanceof import_obsidian2.TFile)
      app.workspace.getLeaf(true).openFile(f);
  } catch (e) {
    notice.hide();
    new import_obsidian2.Notice(`\u274C Fork failed: ${e instanceof Error ? e.message : String(e)}`, 8e3);
  }
}
async function writeOrReplace(app, path3, content) {
  const existing = app.vault.getAbstractFileByPath(path3);
  if (existing instanceof import_obsidian2.TFile) {
    await app.vault.modify(existing, content);
  } else {
    await app.vault.create(path3, content);
  }
}

// main.ts
var execAsync = (0, import_util.promisify)(import_child_process.exec);
var DEFAULT_SETTINGS = {
  enginePath: `${os2.homedir()}/Library/Application Support/MarkItDownDroplet/convert.sh`,
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
  defaultLicense: "user-generated"
};
var DistillBridgePlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.refineryBarEl = null;
    /* State */
    this.distillAvailable = false;
    this.bonds = emptyBondGraph();
  }
  /* ── Lifecycle ──────────────────────────────────────────────── */
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new DistillBridgeSettingTab(this.app, this));
    this.statusDistill = this.addStatusBarItem();
    this.statusRefinery = this.addStatusBarItem();
    await this.checkDistillAvailable();
    this.renderDistillStatus();
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof import_obsidian3.TFile && CONVERTIBLE.has(file.extension.toLowerCase())) {
          menu.addItem(
            (item) => item.setTitle("Convert to Markdown (Distill)").setIcon("file-down").onClick(() => this.convertFile(file))
          );
        } else if (file instanceof import_obsidian3.TFile && file.extension.toLowerCase() === "canvas") {
          menu.addItem(
            (item) => item.setTitle("Publish concept map (Distill)").setIcon("upload").onClick(() => this.openPublishModal(file))
          );
        } else if (file instanceof import_obsidian3.TFolder) {
          menu.addItem(
            (item) => item.setTitle("Distill: convert all attachments").setIcon("folder-down").onClick(() => this.convertFolder(file))
          );
        }
      })
    );
    this.addCommand({
      id: "distill-convert-file",
      name: "Convert file",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        const ok = !!f && CONVERTIBLE.has(f.extension.toLowerCase());
        if (ok && !checking)
          this.convertFile(f);
        return ok;
      }
    });
    this.addCommand({
      id: "distill-convert-clipboard",
      name: "Convert clipboard",
      callback: () => this.convertClipboard()
    });
    this.addCommand({
      id: "distill-publish-canvas",
      name: "Publish concept map",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        const ok = !!f && f.extension.toLowerCase() === "canvas";
        if (ok && !checking)
          this.openPublishModal(f);
        return ok;
      }
    });
    this.registerObsidianProtocolHandler("distill-fork", (params) => {
      const mapId = params.map;
      if (!mapId) {
        new import_obsidian3.Notice("Distill: fork link is missing ?map=\u2026");
        return;
      }
      importForkedMap(this.app, this.settings.serverBaseUrl, mapId);
    });
    if (this.settings.refineryEnabled) {
      this.bootRefinery();
    }
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.renderRefineryStatus();
        this.decorateActiveLeaf();
      })
    );
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        if (this.settings.refineryEnabled) {
          this.buildBondGraph();
          this.renderRefineryStatus();
          this.decorateActiveLeaf();
        }
      })
    );
    this.registerInterval(
      window.setInterval(() => {
        this.checkDistillAvailable().then(() => this.renderDistillStatus());
      }, 6e4)
    );
  }
  onunload() {
    this.stripRefineryBar();
  }
  /* ═════════════════════════════════════════════════════════════════
     Distill availability
     ═════════════════════════════════════════════════════════════════ */
  async checkDistillAvailable() {
    try {
      await fs2.promises.access(this.settings.enginePath, fs2.constants.X_OK);
      this.distillAvailable = true;
    } catch {
      this.distillAvailable = false;
    }
  }
  renderDistillStatus() {
    this.statusDistill.empty();
    const dot = this.distillAvailable ? "\u{1F7E2}" : "\u{1F534}";
    const label = this.distillAvailable ? "Ready" : "Unavailable";
    this.statusDistill.createSpan({
      cls: "distill-status",
      text: `\u2697\uFE0F ${label} ${dot}`
      // ⚗️
    });
    this.statusDistill.setAttribute(
      "aria-label",
      this.distillAvailable ? `Distill engine: ${this.settings.enginePath}` : "Distill engine not found \u2014 check Settings \u2192 Distill"
    );
  }
  /* ═════════════════════════════════════════════════════════════════
     File conversion
     ═════════════════════════════════════════════════════════════════ */
  /** Resolve a vault-relative TFile to an absolute filesystem path. */
  absPath(file) {
    const base = this.app.vault.adapter.getBasePath?.() ?? "";
    return path2.join(base, file.path);
  }
  /** Shell-escape a single argument (see core.ts). */
  shellQuote(s) {
    return shellQuote(s);
  }
  async convertFile(file) {
    const engine = this.settings.enginePath;
    const full = this.absPath(file);
    const notice = new import_obsidian3.Notice(`Distill: converting ${file.name}\u2026`, 0);
    try {
      const env = { ...process.env };
      if (!this.settings.frontmatter)
        env["DISTILL_FRONTMATTER"] = "0";
      await execAsync(`${this.shellQuote(engine)} ${this.shellQuote(full)}`, { env });
      notice.hide();
      new import_obsidian3.Notice(`\u2705 Distill: created ${file.name}.md`);
      if (this.settings.openAfter) {
        const mdPath = (0, import_obsidian3.normalizePath)(`${file.path}.md`);
        await sleep(300);
        const md = this.app.vault.getAbstractFileByPath(mdPath);
        if (md instanceof import_obsidian3.TFile)
          this.app.workspace.getLeaf(true).openFile(md);
      }
    } catch (e) {
      notice.hide();
      new import_obsidian3.Notice(
        `\u274C Distill failed: ${e?.message ?? e}. Is the Distill app installed?`,
        8e3
      );
      console.error("[Distill]", e);
    }
  }
  async convertFolder(folder) {
    const targets = [];
    const walk = (f) => {
      if (f instanceof import_obsidian3.TFile && CONVERTIBLE.has(f.extension.toLowerCase())) {
        targets.push(f);
      } else if (f instanceof import_obsidian3.TFolder) {
        f.children.forEach(walk);
      }
    };
    walk(folder);
    if (targets.length === 0) {
      new import_obsidian3.Notice("Distill: no convertible files here.");
      return;
    }
    const notice = new import_obsidian3.Notice(`Distill: converting ${targets.length} files\u2026`, 0);
    let ok = 0;
    for (const t of targets) {
      try {
        const env = { ...process.env };
        if (!this.settings.frontmatter)
          env["DISTILL_FRONTMATTER"] = "0";
        await execAsync(
          `${this.shellQuote(this.settings.enginePath)} ${this.shellQuote(this.absPath(t))}`,
          { env }
        );
        ok++;
      } catch (e) {
        console.error("[Distill]", t.path, e);
      }
    }
    notice.hide();
    new import_obsidian3.Notice(`\u2705 Distill: converted ${ok}/${targets.length} files.`);
  }
  /* ═════════════════════════════════════════════════════════════════
     Clipboard conversion
     ═════════════════════════════════════════════════════════════════ */
  async convertClipboard() {
    let clipHtml = "";
    let clipText = "";
    try {
      const electron = require("electron");
      const cb = electron.clipboard ?? electron.remote?.clipboard;
      if (cb) {
        clipHtml = cb.readHTML?.() ?? "";
        clipText = cb.readText?.() ?? "";
      }
    } catch {
      try {
        clipText = await navigator.clipboard.readText();
      } catch {
        new import_obsidian3.Notice("\u274C Could not read clipboard.");
        return;
      }
    }
    const content = clipHtml.trim() || clipText.trim();
    if (!content) {
      new import_obsidian3.Notice("Clipboard is empty.");
      return;
    }
    const ext = clipHtml.trim() ? "html" : "txt";
    const stamp = Date.now();
    const tempName = `_distill_clip_${stamp}.${ext}`;
    const tempPath = (0, import_obsidian3.normalizePath)(tempName);
    const notice = new import_obsidian3.Notice("Distill: converting clipboard\u2026", 0);
    try {
      await this.app.vault.create(tempPath, content);
      const tempFile = this.app.vault.getAbstractFileByPath(tempPath);
      if (!(tempFile instanceof import_obsidian3.TFile))
        throw new Error("Could not create temp file");
      const env = { ...process.env };
      if (!this.settings.frontmatter)
        env["DISTILL_FRONTMATTER"] = "0";
      await execAsync(
        `${this.shellQuote(this.settings.enginePath)} ${this.shellQuote(this.absPath(tempFile))}`,
        { env }
      );
      await this.app.vault.delete(tempFile);
      notice.hide();
      const mdRawPath = (0, import_obsidian3.normalizePath)(`${tempPath}.md`);
      await sleep(400);
      const mdFile = this.app.vault.getAbstractFileByPath(mdRawPath);
      if (mdFile instanceof import_obsidian3.TFile) {
        const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
        const niceName = `Clipboard ${dateStr}.md`;
        const nicePath = (0, import_obsidian3.normalizePath)(niceName);
        await this.app.fileManager.renameFile(mdFile, nicePath);
        new import_obsidian3.Notice(`\u2705 Distill: created ${niceName}`);
        if (this.settings.openAfter) {
          const renamed = this.app.vault.getAbstractFileByPath(nicePath);
          if (renamed instanceof import_obsidian3.TFile) {
            this.app.workspace.getLeaf(true).openFile(renamed);
          }
        }
      } else {
        new import_obsidian3.Notice("\u2705 Clipboard converted (file may take a moment to appear).");
      }
    } catch (e) {
      notice.hide();
      try {
        const tf = this.app.vault.getAbstractFileByPath(tempPath);
        if (tf instanceof import_obsidian3.TFile)
          await this.app.vault.delete(tf);
      } catch {
      }
      new import_obsidian3.Notice(`\u274C Clipboard conversion failed: ${e?.message ?? e}`, 8e3);
      console.error("[Distill]", e);
    }
  }
  /* ═════════════════════════════════════════════════════════════════
     Publish concept map (Canvas → distill.map/0.2)
     ═════════════════════════════════════════════════════════════════ */
  /** Open the Publish modal for a .canvas file. */
  async openPublishModal(file) {
    let canvas;
    try {
      canvas = JSON.parse(await this.app.vault.read(file));
    } catch (e) {
      new import_obsidian3.Notice(`Distill: could not read canvas \u2014 ${e?.message ?? e}`);
      return;
    }
    const ctx = {
      baseUrl: this.settings.serverBaseUrl,
      token: readDeviceToken(),
      blockedZones: this.settings.blockedZonesCsv.split(",").map((s) => s.trim()).filter(Boolean),
      distillVersion: this.manifest.version,
      defaultVisibility: this.settings.defaultVisibility,
      defaultLicense: this.settings.defaultLicense
    };
    new PublishModal(this.app, canvas, file.basename, ctx).open();
  }
  /* ═════════════════════════════════════════════════════════════════
     Refinery — Grades · Bonds · Condensers
     ═════════════════════════════════════════════════════════════════ */
  /** Called once when Refinery is first enabled or on plugin load. */
  bootRefinery() {
    this.buildBondGraph();
    this.renderRefineryStatus();
    this.app.workspace.onLayoutReady(() => this.decorateActiveLeaf());
  }
  /** Tear down Refinery visuals. */
  teardownRefinery() {
    this.stripRefineryBar();
    this.bonds = emptyBondGraph();
    this.renderRefineryStatus();
  }
  /* ── Bond graph ─────────────────────────────────────────────── */
  /** Build the Bond graph from Obsidian's resolved-link cache (see core.ts). */
  buildBondGraph() {
    this.bonds = buildBondGraph(
      this.app.metadataCache.resolvedLinks,
      this.settings.vaultRoot
    );
  }
  /* ── Grade helpers ──────────────────────────────────────────── */
  /** Read the `grade` frontmatter field of a markdown file. */
  getGrade(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    return normalizeGrade(cache?.frontmatter?.["grade"]);
  }
  /* ── Bond helpers ───────────────────────────────────────────── */
  /** Total bond count = outgoing links + incoming links. */
  getBondCount(filePath) {
    return bondCount(this.bonds, filePath);
  }
  /* ── Condenser helpers ──────────────────────────────────────── */
  /** A note is a Condenser when its bond count meets the threshold. */
  isCondenser(filePath) {
    return isCondenser(this.bonds, filePath, this.settings.condenserThreshold);
  }
  /** Return Condenser notes that link TO the given file. */
  getReferencingCondensers(filePath) {
    return referencingCondensers(
      this.bonds,
      filePath,
      this.settings.condenserThreshold
    );
  }
  /* ── Status-bar Refinery section ────────────────────────────── */
  renderRefineryStatus() {
    this.statusRefinery.empty();
    if (!this.settings.refineryEnabled)
      return;
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md")
      return;
    const grade = this.getGrade(file);
    const bondCount2 = this.getBondCount(file.path);
    const condenser = this.isCondenser(file.path);
    const wrap = this.statusRefinery.createSpan({ cls: "distill-refinery-status" });
    if (grade && this.settings.showGradeBadges) {
      const m = GRADE_META[grade];
      if (m) {
        wrap.createSpan({
          cls: `distill-grade distill-grade-${m.css}`,
          text: `${m.icon} ${m.label}`
        });
      }
    }
    if (this.settings.showBondCounts) {
      wrap.createSpan({
        cls: "distill-bonds",
        text: `\u{1F517} ${bondCount2}`
        // 🔗
      });
    }
    if (condenser) {
      wrap.createSpan({
        cls: "distill-condenser-badge",
        text: "\u2697\uFE0F Condenser"
        // ⚗️
      });
    }
  }
  /* ── Refinery info bar inside the active leaf ────────────────── */
  decorateActiveLeaf() {
    this.stripRefineryBar();
    if (!this.settings.refineryEnabled)
      return;
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md")
      return;
    const view = this.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView);
    if (!view)
      return;
    const grade = this.getGrade(file);
    const bondCount2 = this.getBondCount(file.path);
    const condenser = this.isCondenser(file.path);
    const condenserRefs = this.settings.showCondenserLinks ? this.getReferencingCondensers(file.path) : [];
    if (!grade && bondCount2 === 0 && condenserRefs.length === 0)
      return;
    const bar = createEl("div", { cls: "distill-refinery-bar" });
    if (grade && this.settings.showGradeBadges) {
      const m = GRADE_META[grade];
      if (m) {
        bar.createSpan({
          cls: `distill-grade distill-grade-${m.css}`,
          text: `${m.icon} ${m.label}`
        });
      }
    }
    if (this.settings.showBondCounts && bondCount2 > 0) {
      bar.createSpan({
        cls: "distill-bonds",
        text: `\u{1F517} ${bondCount2} bond${bondCount2 === 1 ? "" : "s"}`
      });
    }
    if (condenser) {
      bar.createSpan({
        cls: "distill-condenser-badge",
        text: "\u2697\uFE0F Condenser"
      });
    }
    if (condenserRefs.length > 0) {
      const linksEl = bar.createSpan({ cls: "distill-condenser-links" });
      linksEl.createSpan({ text: "Hub: " });
      condenserRefs.forEach((cPath, i) => {
        const name = cPath.replace(/\.md$/, "").split("/").pop() ?? cPath;
        const a = linksEl.createEl("a", {
          cls: "internal-link",
          text: name,
          href: cPath
        });
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          const target = this.app.vault.getAbstractFileByPath(cPath);
          if (target instanceof import_obsidian3.TFile) {
            this.app.workspace.getLeaf(false).openFile(target);
          }
        });
        if (i < condenserRefs.length - 1) {
          linksEl.createSpan({ text: ", " });
        }
      });
    }
    const viewContent = view.containerEl.querySelector(".view-content");
    if (viewContent) {
      viewContent.insertBefore(bar, viewContent.firstChild);
      this.refineryBarEl = bar;
    }
  }
  /** Remove Refinery bar from the DOM. */
  stripRefineryBar() {
    this.refineryBarEl?.remove();
    this.refineryBarEl = null;
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
};
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
var DistillBridgeSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Distill Bridge" });
    containerEl.createEl("p", {
      text: "Converts attachments on-device via the Distill engine. The Refinery adds note-maturity Grades, wikilink Bonds, and hub-note Condensers to your vault.",
      cls: "setting-item-description"
    });
    containerEl.createEl("h3", { text: "Conversion" });
    new import_obsidian3.Setting(containerEl).setName("Engine path").setDesc("Full path to the Distill convert.sh helper script.").addText(
      (t) => t.setPlaceholder(DEFAULT_SETTINGS.enginePath).setValue(this.plugin.settings.enginePath).onChange(async (v) => {
        this.plugin.settings.enginePath = v.trim();
        await this.plugin.saveSettings();
        await this.plugin.checkDistillAvailable();
        this.plugin.renderDistillStatus();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Add YAML frontmatter").setDesc(
      "Prepend title / source / type / tags so converted notes land with full Properties."
    ).addToggle(
      (t) => t.setValue(this.plugin.settings.frontmatter).onChange(async (v) => {
        this.plugin.settings.frontmatter = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Open after converting").setDesc("Automatically open the resulting .md in a new pane.").addToggle(
      (t) => t.setValue(this.plugin.settings.openAfter).onChange(async (v) => {
        this.plugin.settings.openAfter = v;
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("h3", { text: "Refinery" });
    const refineryDesc = containerEl.createEl("div", {
      cls: "setting-item-description distill-refinery-desc"
    });
    refineryDesc.createEl("p", {
      text: "The Refinery is Distill\u2019s premium knowledge-management layer. It introduces four concepts:"
    });
    const ul = refineryDesc.createEl("ul");
    ul.createEl("li").innerHTML = "<strong>Grades</strong> \u2014 note maturity: <em>Vapor \u2192 Distillate \u2192 Essence</em>";
    ul.createEl("li").innerHTML = "<strong>Bonds</strong> \u2014 connections discovered via <code>[[wikilinks]]</code>";
    ul.createEl("li").innerHTML = "<strong>Condensers</strong> \u2014 hub notes with many Bonds";
    ul.createEl("li").innerHTML = "<strong>Fractions</strong> \u2014 folder-level grouping of related notes";
    new import_obsidian3.Setting(containerEl).setName("Enable Refinery").setDesc("Show Grade badges, Bond counts, and Condenser links in the UI.").addToggle(
      (t) => t.setValue(this.plugin.settings.refineryEnabled).onChange(async (v) => {
        this.plugin.settings.refineryEnabled = v;
        await this.plugin.saveSettings();
        if (v) {
          this.plugin.bootRefinery();
        } else {
          this.plugin.teardownRefinery();
        }
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Vault root for bond discovery").setDesc(
      'Limit bond scanning to a subfolder (e.g. "Notes"). Leave empty to scan the entire vault.'
    ).addText(
      (t) => t.setPlaceholder("(entire vault)").setValue(this.plugin.settings.vaultRoot).onChange(async (v) => {
        this.plugin.settings.vaultRoot = v.trim();
        await this.plugin.saveSettings();
        if (this.plugin.settings.refineryEnabled) {
          this.plugin.buildBondGraph();
        }
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Condenser threshold").setDesc(
      "Minimum number of Bonds for a note to be flagged as a Condenser (hub note)."
    ).addSlider(
      (s) => s.setLimits(2, 30, 1).setValue(this.plugin.settings.condenserThreshold).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.condenserThreshold = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Show grade badges").setDesc("Display Vapor / Distillate / Essence maturity indicators.").addToggle(
      (t) => t.setValue(this.plugin.settings.showGradeBadges).onChange(async (v) => {
        this.plugin.settings.showGradeBadges = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Show bond counts").setDesc("Display the number of wikilink connections for the active note.").addToggle(
      (t) => t.setValue(this.plugin.settings.showBondCounts).onChange(async (v) => {
        this.plugin.settings.showBondCounts = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Show condenser links").setDesc("When viewing a note, list which Condenser (hub) notes reference it.").addToggle(
      (t) => t.setValue(this.plugin.settings.showCondenserLinks).onChange(async (v) => {
        this.plugin.settings.showCondenserLinks = v;
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("h3", { text: "Publish & Community" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Publish a Canvas as a concept map to distillmd.dev. Nothing is sent unless you explicitly publish; your vault never leaves your machine."
    });
    new import_obsidian3.Setting(containerEl).setName("Server URL").setDesc("Where maps are published.").addText(
      (t) => t.setValue(this.plugin.settings.serverBaseUrl).onChange(async (v) => {
        this.plugin.settings.serverBaseUrl = v.trim() || "https://distillmd.dev";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Device token").setDesc(
      hasDeviceToken() ? "A device token is connected (stored outside your vault). Paste a new one to replace it." : "Paste a publish-only device token from distillmd.dev/settings. Stored outside your vault \u2014 never in plugin data."
    ).addText((t) => {
      t.inputEl.type = "password";
      t.setPlaceholder(hasDeviceToken() ? "\u2022\u2022\u2022\u2022 connected \u2022\u2022\u2022\u2022" : "paste token").onChange((v) => {
        const tok = v.trim();
        if (tok)
          writeDeviceToken(tok);
      });
    }).addExtraButton(
      (b) => b.setIcon("trash").setTooltip("Disconnect (delete local token)").onClick(() => {
        clearDeviceToken();
        new import_obsidian3.Notice("Distill: device token removed.");
        this.display();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Default visibility").setDesc("Pre-selected visibility for new publishes.").addDropdown((d) => {
      ["private", "followers", "public"].forEach((v) => d.addOption(v, v));
      d.setValue(this.plugin.settings.defaultVisibility).onChange(async (v) => {
        this.plugin.settings.defaultVisibility = v;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian3.Setting(containerEl).setName("Default map license").addText(
      (t) => t.setValue(this.plugin.settings.defaultLicense).onChange(async (v) => {
        this.plugin.settings.defaultLicense = v.trim() || "user-generated";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Blocked privacy zones").setDesc("Comma-separated tags that block publishing (checked on-device).").addText(
      (t) => t.setValue(this.plugin.settings.blockedZonesCsv).onChange(async (v) => {
        this.plugin.settings.blockedZonesCsv = v;
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("h3", { text: "Get Distill" });
    const cta = containerEl.createEl("p", {
      cls: "setting-item-description"
    });
    cta.innerHTML = 'Distill converts 20+ file types to clean Markdown \u2014 100% on your Mac. Download the free app or unlock the full Refinery at <a href="https://distillmd.dev">distillmd.dev</a>.';
  }
};
