/**
 * A stand-in for the `obsidian` module so plugin code can run under vitest.
 *
 * Only what this plugin touches is modelled, and only as far as the plugin relies on it:
 *  - TFile / TFolder / TAbstractFile, normalizePath
 *  - Notice (every message is recorded in `notices`)
 *  - Plugin, PluginSettingTab, Modal, Setting (records what the plugin registers)
 *  - FileSystemAdapter, MarkdownView, App
 *  - requestUrl — a vi.fn() each test programs. NO real network request is ever made.
 *
 * The richer vault / workspace used to drive main.ts lives in plugin-harness.ts.
 */
import { vi } from "vitest";

export const requestUrl = vi.fn();

/* ── Notices ─────────────────────────────────────────────────────── */

export const notices: string[] = [];
export class Notice {
  constructor(public message: string, _timeout?: number) { notices.push(message); }
  hide(): void { /* no-op */ }
  setMessage(m: string): this { this.message = m; notices.push(m); return this; }
}

/* ── Files ───────────────────────────────────────────────────────── */

export class TAbstractFile {
  constructor(public path: string) {}
  get name(): string { return this.path.split("/").pop() ?? this.path; }
}

export class TFile extends TAbstractFile {
  constructor(path: string, public content = "") { super(path); }
  /** Obsidian: text after the LAST dot of the name ("a.distill.json" -> "json"). */
  get extension(): string {
    const n = this.name; const i = n.lastIndexOf(".");
    return i > 0 ? n.slice(i + 1) : "";
  }
  get basename(): string {
    const n = this.name; const i = n.lastIndexOf(".");
    return i > 0 ? n.slice(0, i) : n;
  }
}

export class TFolder extends TAbstractFile {
  constructor(path: string, public children: TAbstractFile[] = []) { super(path); }
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export class FileSystemAdapter {
  constructor(private base: string) {}
  getBasePath(): string { return this.base; }
}

export class MarkdownView {
  containerEl: HTMLElement;
  constructor(public file: TFile | null = null) {
    this.containerEl = document.createElement("div");
    const content = document.createElement("div");
    content.className = "view-content";
    this.containerEl.appendChild(content);
  }
}

export class App {}

/* ── Plugin + settings UI ────────────────────────────────────────── */

export interface RegisteredCommand {
  id: string; name: string;
  callback?: () => unknown;
  checkCallback?: (checking: boolean) => boolean;
}

export class Plugin {
  /** What loadData() returns — tests set this to seed saved settings. */
  data: unknown = null;
  statusItems: HTMLElement[] = [];
  ribbon: { icon: string; title: string; cb: () => void }[] = [];
  commands = new Map<string, RegisteredCommand>();
  protocolHandlers = new Map<string, (params: Record<string, string>) => void>();
  settingTabs: PluginSettingTab[] = [];
  intervals: number[] = [];

  constructor(public app: any, public manifest: { id: string; version: string }) {}

  addStatusBarItem(): HTMLElement {
    const el = document.createElement("div");
    this.statusItems.push(el);
    return el;
  }
  addRibbonIcon(icon: string, title: string, cb: () => void): HTMLElement {
    this.ribbon.push({ icon, title, cb });
    return document.createElement("div");
  }
  addCommand(c: RegisteredCommand): RegisteredCommand { this.commands.set(c.id, c); return c; }
  addSettingTab(t: PluginSettingTab): void { this.settingTabs.push(t); }
  registerEvent(_ref: unknown): void { /* events are held by the fake workspace */ }
  registerInterval(id: number): number { this.intervals.push(id); return id; }
  registerObsidianProtocolHandler(action: string, h: (p: Record<string, string>) => void): void {
    this.protocolHandlers.set(action, h);
  }
  async loadData(): Promise<unknown> { return this.data; }
  async saveData(d: unknown): Promise<void> { this.data = JSON.parse(JSON.stringify(d)); }
}

export class PluginSettingTab {
  containerEl: HTMLElement;
  constructor(public app: unknown, public plugin: unknown) {
    this.containerEl = document.createElement("div");
  }
}

export class Modal {
  contentEl: HTMLElement;
  constructor(public app: unknown) {
    this.contentEl = typeof document !== "undefined" ? document.createElement("div") : ({} as HTMLElement);
  }
  open(): void { (this as unknown as { onOpen?: () => void }).onOpen?.(); }
  close(): void { (this as unknown as { onClose?: () => void }).onClose?.(); }
}

/** One input inside a Setting row. `fire(v)` simulates the user changing it. */
export class Component {
  kind: string;
  value: unknown = undefined;
  placeholder = "";
  options: Record<string, string> = {};
  inputEl = { type: "text" };
  handler: ((v: any) => unknown) | null = null;
  constructor(kind: string) { this.kind = kind; }
  setValue(v: unknown) { this.value = v; return this; }
  setPlaceholder(p: string) { this.placeholder = p; return this; }
  setLimits() { return this; }
  setDynamicTooltip() { return this; }
  addOption(v: string, label: string) { this.options[v] = label; return this; }
  setButtonText() { return this; }
  setWarning() { return this; }
  setCta() { return this; }
  setIcon() { return this; }
  setTooltip() { return this; }
  setDisabled() { return this; }
  onChange(fn: (v: any) => unknown) { this.handler = fn; return this; }
  onClick(fn: () => unknown) { this.handler = fn; return this; }
  async fire(v?: unknown): Promise<void> { await this.handler?.(v); }
}

/** Every Setting row created, in order — tests find rows by name. */
export const settingRows: Setting[] = [];

export class Setting {
  name = "";
  desc = "";
  heading = false;
  components: Component[] = [];
  constructor(_containerEl?: unknown) { settingRows.push(this); }
  setName(n: string) { this.name = n; return this; }
  setDesc(d: string) { this.desc = d; return this; }
  setHeading() { this.heading = true; return this; }
  setClass() { return this; }
  private add(kind: string, cb: (c: Component) => unknown) {
    const c = new Component(kind); this.components.push(c); cb(c); return this;
  }
  addText(cb: (c: any) => unknown) { return this.add("text", cb); }
  addTextArea(cb: (c: any) => unknown) { return this.add("textarea", cb); }
  addToggle(cb: (c: any) => unknown) { return this.add("toggle", cb); }
  addSlider(cb: (c: any) => unknown) { return this.add("slider", cb); }
  addDropdown(cb: (c: any) => unknown) { return this.add("dropdown", cb); }
  addButton(cb: (c: any) => unknown) { return this.add("button", cb); }
  addExtraButton(cb: (c: any) => unknown) { return this.add("extra-button", cb); }
}

/* ── Simple in-memory app (used by the publish-ui import tests) ─── */

export function fakeApp() {
  const files = new Map<string, TFile>();
  const folders = new Set<string>();
  const opened: string[] = [];
  const vault = {
    getAbstractFileByPath: (p: string) => files.get(p) ?? (folders.has(p) ? { path: p } : null),
    createFolder: vi.fn(async (p: string) => { folders.add(p); }),
    create: vi.fn(async (p: string, c: string) => {
      if (files.has(p)) throw new Error(`exists: ${p}`);
      const f = new TFile(p, c); files.set(p, f); return f;
    }),
    modify: vi.fn(async (f: TFile, c: string) => { f.content = c; }),
  };
  const workspace = { getLeaf: () => ({ openFile: async (f: TFile) => { opened.push(f.path); } }) };
  return { app: { vault, workspace } as never, files, folders, opened, vault };
}
