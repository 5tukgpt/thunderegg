/**
 * publish-ui.ts — Obsidian-facing UI for Publish: the confirm modal (the
 * load-bearing "exact JSON leaving your device" control) and fork-to-vault import.
 * Imports obsidian, so it is glue (compile-checked, not unit-tested).
 */
import { App, Modal, Notice, Setting, TFile, normalizePath } from "obsidian";
import {
  Canvas, DistillMapArtifact, PublishMeta, ProvenanceEntry, NodeKind,
  transformCanvas, redactionScan, buildSidecar,
  SOURCE_TYPES, LICENSES, VISIBILITIES, SUMMARY_MIN, SUMMARY_MAX,
  type Visibility, type License, type SourceType,
} from "./publish-core";
import { publishArtifact, fetchForkFile } from "./publish-net";

export interface PublishContext {
  baseUrl: string;
  token: string;
  blockedZones: string[];
  distillVersion: string;
  defaultVisibility: Visibility;
  defaultLicense: License;
}

function emptyProvenance(): ProvenanceEntry {
  return { source_title: "", url: "", source_type: "webpage", license: "public-domain" };
}

/* ═══════════════════════════════════════════════════════════════════
   Publish modal — collect metadata + live preview the exact artifact.
   ═══════════════════════════════════════════════════════════════════ */

export class PublishModal extends Modal {
  private meta: PublishMeta;
  private readonly canvas: Canvas;
  private readonly ctx: PublishContext;
  private readonly clientUuid: string;

  private previewEl!: HTMLElement;
  private issuesEl!: HTMLElement;
  private publishBtn!: HTMLButtonElement;
  private exportBtn!: HTMLButtonElement;

  constructor(app: App, canvas: Canvas, defaultTitle: string, ctx: PublishContext) {
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
      kinds: {},
    };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Publish concept map" });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Only text nodes are included, as your own synthesis. The exact JSON is shown below — nothing else leaves your device. " +
        "“Export to vault” writes a shareable file with no account; “Publish” sends it to the server (needs a device token).",
    });

    new Setting(contentEl)
      .setName("Title")
      .addText((t) => t.setValue(this.meta.title).onChange((v) => { this.meta.title = v; this.refresh(); }));

    new Setting(contentEl)
      .setName("Summary")
      .setDesc(`${SUMMARY_MIN}–${SUMMARY_MAX} characters.`)
      .addTextArea((t) =>
        t.setPlaceholder("What this map is, in your words…").onChange((v) => { this.meta.summary = v; this.refresh(); }));

    new Setting(contentEl)
      .setName("Topics")
      .setDesc("Comma-separated. At least one.")
      .addText((t) => t.setPlaceholder("medtech, regulatory").onChange((v) => {
        this.meta.topics = v.split(",").map((s) => s.trim()).filter(Boolean);
        this.refresh();
      }));

    new Setting(contentEl)
      .setName("Visibility")
      .addDropdown((d) => {
        VISIBILITIES.forEach((v) => d.addOption(v, v));
        d.setValue(this.meta.visibility).onChange((v) => { this.meta.visibility = v as Visibility; this.refresh(); });
      });

    new Setting(contentEl)
      .setName("Map license")
      .addDropdown((d) => {
        LICENSES.forEach((l) => d.addOption(l, l));
        d.setValue(this.meta.license).onChange((v) => { this.meta.license = v as License; this.refresh(); });
      });

    // Provenance editor
    contentEl.createEl("h3", { text: "Provenance (sources)" });
    const provWrap = contentEl.createDiv();
    const renderProv = () => {
      provWrap.empty();
      this.meta.provenance.forEach((p, i) => {
        const row = provWrap.createDiv({ cls: "distill-prov-row" });
        new Setting(row)
          .setName(`Source #${i + 1}`)
          .addText((t) => t.setPlaceholder("Title").setValue(p.source_title).onChange((v) => { p.source_title = v; this.refresh(); }))
          .addText((t) => t.setPlaceholder("https://…").setValue(p.url).onChange((v) => { p.url = v; this.refresh(); }))
          .addDropdown((d) => { SOURCE_TYPES.forEach((s) => d.addOption(s, s)); d.setValue(p.source_type).onChange((v) => { p.source_type = v as SourceType; this.refresh(); }); })
          .addDropdown((d) => { LICENSES.forEach((l) => d.addOption(l, l)); d.setValue(p.license).onChange((v) => { p.license = v as License; this.refresh(); }); })
          .addExtraButton((b) => b.setIcon("trash").setTooltip("Remove").onClick(() => {
            if (this.meta.provenance.length > 1) { this.meta.provenance.splice(i, 1); renderProv(); this.refresh(); }
          }));
      });
    };
    renderProv();
    new Setting(contentEl).addButton((b) =>
      b.setButtonText("+ Add source").onClick(() => { this.meta.provenance.push(emptyProvenance()); renderProv(); this.refresh(); }));

    // Issues + preview
    contentEl.createEl("h3", { text: "Review" });
    this.issuesEl = contentEl.createDiv({ cls: "distill-publish-issues" });
    this.previewEl = contentEl.createEl("pre", { cls: "distill-publish-preview" });
    this.previewEl.style.maxHeight = "240px";
    this.previewEl.style.overflow = "auto";

    const btns = new Setting(contentEl);
    btns.addButton((b) => b.setButtonText("Copy JSON").onClick(async () => {
      await navigator.clipboard.writeText(this.previewEl.getText());
      new Notice("Artifact JSON copied.");
    }));
    btns.addButton((b) => {
      this.exportBtn = b.buttonEl;
      b.setButtonText("Export to vault").onClick(() => this.doExport());
    });
    btns.addButton((b) => {
      this.publishBtn = b.buttonEl;
      b.setButtonText("Publish").setCta().onClick(() => this.doPublish());
    });

    this.refresh();
  }

  /** Re-run the transform + redaction and repaint preview + issues + button state. */
  private refresh(): void {
    const { artifact, warnings, blocking, excluded } = transformCanvas(this.canvas, this.meta, this.clientUuid);
    const redaction = redactionScan(artifact, this.ctx.blockedZones);

    this.previewEl.setText(JSON.stringify(artifact, null, 2));

    this.issuesEl.empty();
    const blocks = [...blocking, ...redaction.blocks];
    const warns = [...warnings, ...redaction.warnings, ...excluded.filter((e) => e.type !== "group").map((e) => `Excluded ${e.type} node (${e.reason}).`)];

    if (blocks.length) {
      const ul = this.issuesEl.createEl("ul", { cls: "distill-publish-blocks" });
      blocks.forEach((b) => ul.createEl("li", { text: `⛔ ${b}` }));
    }
    if (warns.length) {
      const ul = this.issuesEl.createEl("ul", { cls: "distill-publish-warnings" });
      warns.forEach((w) => ul.createEl("li", { text: `⚠️ ${w}` }));
    }
    if (!blocks.length && !warns.length) {
      this.issuesEl.createEl("p", { text: "✅ No issues.", cls: "setting-item-description" });
    }

    const ready = blocks.length === 0 && this.ctx.token.length > 0;
    this.publishBtn.disabled = !ready;
    this.publishBtn.title = this.ctx.token ? (blocks.length ? "Resolve the blocking issues above." : "") : "Connect a device token in Settings → Distill first.";

    // Export needs no account — only that there are no blocking issues.
    this.exportBtn.disabled = blocks.length > 0;
    this.exportBtn.title = blocks.length
      ? "Resolve the blocking issues above."
      : "Write a shareable map file into your vault — no account needed.";
  }

  private async doPublish(): Promise<void> {
    const { artifact } = transformCanvas(this.canvas, this.meta, this.clientUuid);
    const notice = new Notice("Distill: publishing…", 0);
    try {
      const res = await publishArtifact(this.ctx.baseUrl, this.ctx.token, artifact);
      notice.hide();
      new Notice(`✅ Published: ${res.url}`);
      this.close();
    } catch (e: unknown) {
      notice.hide();
      new Notice(`❌ Publish failed: ${e instanceof Error ? e.message : String(e)}`, 8000);
    }
  }

  /** Write a shareable map file (+ provenance sidecar) into the vault. No account, no network. */
  private async doExport(): Promise<void> {
    const { artifact } = transformCanvas(this.canvas, this.meta, this.clientUuid);
    const folder = "Distill Exports";
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      try { await this.app.vault.createFolder(folder); } catch { /* race / exists */ }
    }
    const base = safeName(artifact.title);
    try {
      await writeOrReplace(this.app, normalizePath(`${folder}/${base}.distill.json`), JSON.stringify(artifact, null, 2));
      await writeOrReplace(this.app, normalizePath(`${folder}/${base} — provenance.md`), buildSidecar(artifact));
      new Notice(`✅ Exported "${artifact.title}" to ${folder}/ — share the .distill.json (no account needed).`);
      this.close();
    } catch (e: unknown) {
      new Notice(`❌ Export failed: ${e instanceof Error ? e.message : String(e)}`, 8000);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Fork-to-vault — write a public map into Forked/ as a real .canvas.
   ═══════════════════════════════════════════════════════════════════ */

interface ForkFile {
  id?: string;
  title?: string;
  license?: string;
  author?: { handle?: string; display_name?: string };
  map?: { nodes?: unknown[]; edges?: unknown[] };
}

function safeName(s: string): string {
  return (s || "map").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80).trim() || "map";
}

export async function importForkedMap(app: App, baseUrl: string, mapId: string): Promise<void> {
  const notice = new Notice("Distill: forking map…", 0);
  try {
    const data = (await fetchForkFile(baseUrl, mapId)) as ForkFile;
    const title = safeName(data.title ?? mapId);

    const folder = "Forked";
    if (!app.vault.getAbstractFileByPath(folder)) {
      try { await app.vault.createFolder(folder); } catch { /* race / exists */ }
    }

    // The map is already JSON Canvas — write nodes/edges only (drop x-distill).
    const canvasBody = JSON.stringify({ nodes: data.map?.nodes ?? [], edges: data.map?.edges ?? [] }, null, 2);
    const canvasPath = normalizePath(`${folder}/${title}.canvas`);
    await writeOrReplace(app, canvasPath, canvasBody);

    // Companion attribution note (provenance travels with the fork).
    const author = data.author?.handle ?? "unknown";
    const link = `${baseUrl.replace(/\/+$/, "")}/@${author}/${data.id ?? mapId}`;
    const attribution =
      `---\nforked_from: ${data.id ?? mapId}\nauthor: ${author}\nlicense: ${data.license ?? "unknown"}\nsource_url: ${link}\n---\n\n` +
      `# ${data.title ?? title} (forked)\n\nForked from [@${author}](${link}). License: ${data.license ?? "unknown"}.\n\nThe map is in \`${title}.canvas\` in this folder.\n`;
    await writeOrReplace(app, normalizePath(`${folder}/${title} — source.md`), attribution);

    notice.hide();
    new Notice(`✅ Forked "${data.title ?? title}" into ${folder}/`);
    const f = app.vault.getAbstractFileByPath(canvasPath);
    if (f instanceof TFile) app.workspace.getLeaf(true).openFile(f);
  } catch (e: unknown) {
    notice.hide();
    new Notice(`❌ Fork failed: ${e instanceof Error ? e.message : String(e)}`, 8000);
  }
}

async function writeOrReplace(app: App, path: string, content: string): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
  } else {
    await app.vault.create(path, content);
  }
}
