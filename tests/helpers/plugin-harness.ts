/**
 * Harness that boots the real ThundereggPlugin (main.ts) against a fake Obsidian.
 *
 *  - The vault is a REAL temp folder on disk, so the engine subprocess and the plugin see
 *    the same files, exactly as in Obsidian.
 *  - The engine is a small shell script standing in for convert.sh (see ENGINE). It reacts
 *    to markers in the file name (TRIAL, UNLIC, NOOCR, CRASH, SILENT, OUTSIDE) so one folder
 *    can exercise several outcomes. It never touches the network.
 *  - Workspace / metadata cache are in-memory fakes that record what the plugin does.
 *
 * Needs a DOM: test files using this start with `// @vitest-environment happy-dom`.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TFile, TFolder, TAbstractFile, FileSystemAdapter, MarkdownView, notices, settingRows } from "./obsidian-mock";

/* ── Obsidian's DOM helpers (it patches these onto HTMLElement globally) ── */

type ElInfo = { cls?: string; text?: string; href?: string; attr?: Record<string, string> };

export function installObsidianDom(): void {
  const P = HTMLElement.prototype as any;
  if (P.createEl) return;
  P.createEl = function (tag: string, o: ElInfo = {}) {
    const el = document.createElement(tag);
    if (o.cls) el.className = o.cls;
    if (o.text !== undefined) el.textContent = o.text;
    if (o.href !== undefined) el.setAttribute("href", o.href);
    for (const [k, v] of Object.entries(o.attr ?? {})) el.setAttribute(k, v);
    this.appendChild(el);
    return el;
  };
  P.createDiv = function (o?: ElInfo) { return this.createEl("div", o); };
  P.createSpan = function (o?: ElInfo) { return this.createEl("span", o); };
  P.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
  P.appendText = function (t: string) { this.appendChild(document.createTextNode(t)); };
  P.setText = function (t: string) { this.textContent = t; };
  const g = globalThis as any;
  g.createDiv = (o: ElInfo = {}) => {
    const d = document.createElement("div");   // detached, like Obsidian's global createDiv
    if (o.cls) d.className = o.cls;
    if (o.text !== undefined) d.textContent = o.text;
    return d;
  };
  g.activeDocument = document;
}

/* ── Fake engine (stands in for convert.sh) ─────────────────────── */

export const ENGINE = `#!/bin/sh
src="$1"
name=$(basename "$src")
printf '%s\\t%s\\t%s\\n' "$src" "$DISTILL_VAULT_PATH" "\${DISTILL_FRONTMATTER:-1}" >> "$FAKE_ENGINE_LOG"
case "$name" in
  *TRIAL*)  echo "refused: DISTILL_TRIAL_EXHAUSTED" >&2; exit 3 ;;
  *UNLIC*)  echo "refused: DISTILL_UNLICENSED" >&2; exit 3 ;;
  *NOOCR*)  echo "DISTILL_NO_OCR: no ocr helper" >&2; exit 4 ;;
  *CRASH*)  echo "engine exploded" >&2; exit 1 ;;
  *SILENT*) exit 0 ;;
esac
out="\${src%.*}.md"
if [ -n "$FAKE_ENGINE_OUTSIDE" ]; then out="$FAKE_ENGINE_OUTSIDE/$(basename "$out")"; fi
printf -- '---\\nsource: %s\\n---\\n# converted\\n' "$name" > "$out"
if [ -z "$FAKE_ENGINE_LEGACY" ] && [ -n "$DISTILL_NOTE_PATH_OUT" ]; then
  printf '%s\\n' "$out" >> "$DISTILL_NOTE_PATH_OUT"
fi
exit 0
`;

/* ── Disk-backed vault ──────────────────────────────────────────── */

export class DiskVault {
  adapter: FileSystemAdapter;
  constructor(public base: string) { this.adapter = new FileSystemAdapter(base); }
  private abs(p: string) { return path.join(this.base, p); }

  getAbstractFileByPath(p: string): TAbstractFile | null {
    const a = this.abs(p);
    let st: fs.Stats;
    try { st = fs.statSync(a); } catch { return null; }
    if (st.isFile()) return new TFile(p);
    const kids = fs.readdirSync(a).sort()
      .map((n) => this.getAbstractFileByPath(p ? `${p}/${n}` : n))
      .filter((x): x is TAbstractFile => x !== null);
    return new TFolder(p, kids);
  }
  getRoot(): TFolder { return this.getAbstractFileByPath("") as TFolder; }
  async create(p: string, content: string): Promise<TFile> {
    if (fs.existsSync(this.abs(p))) throw new Error("File already exists.");
    fs.mkdirSync(path.dirname(this.abs(p)), { recursive: true });
    fs.writeFileSync(this.abs(p), content);
    return new TFile(p);
  }
  async createFolder(p: string): Promise<void> { fs.mkdirSync(this.abs(p), { recursive: true }); }
  async read(f: TFile): Promise<string> { return fs.readFileSync(this.abs(f.path), "utf8"); }
  async modify(f: TFile, c: string): Promise<void> { fs.writeFileSync(this.abs(f.path), c); }
  /* test helpers */
  write(p: string, c = "x"): TFile {
    fs.mkdirSync(path.dirname(this.abs(p)), { recursive: true });
    fs.writeFileSync(this.abs(p), c);
    return new TFile(p);
  }
  exists(p: string): boolean { return fs.existsSync(this.abs(p)); }
  list(): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const n of fs.readdirSync(this.abs(d)).sort()) {
        const rel = d ? `${d}/${n}` : n;
        if (fs.statSync(this.abs(rel)).isDirectory()) walk(rel); else out.push(rel);
      }
    };
    walk("");
    return out;
  }
}

/* ── Workspace / metadata cache ─────────────────────────────────── */

type Handler = (...args: any[]) => unknown;

export class FakeEvents {
  handlers = new Map<string, Handler[]>();
  on(name: string, fn: Handler) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
    return { name, fn };
  }
  trigger(name: string, ...args: unknown[]) {
    for (const h of this.handlers.get(name) ?? []) h(...args);
  }
}

export class FakeWorkspace extends FakeEvents {
  activeFile: TFile | null = null;
  activeView: MarkdownView | null = null;
  opened: string[] = [];
  getActiveFile() { return this.activeFile; }
  getActiveViewOfType(cls: unknown) {
    return this.activeView && this.activeView instanceof (cls as typeof MarkdownView) ? this.activeView : null;
  }
  getLeaf(_newLeaf?: boolean) { return { openFile: async (f: TFile) => { this.opened.push(f.path); } }; }
  onLayoutReady(cb: () => void) { cb(); }
  /** Make `p` the active note (and give it a Markdown view to decorate). */
  activate(p: string) {
    this.activeFile = new TFile(p);
    this.activeView = p.endsWith(".md") ? new MarkdownView(this.activeFile) : null;
    // Like Obsidian tabs: views stay in the document after you switch away from them.
    if (this.activeView) document.body.appendChild(this.activeView.containerEl);
    this.trigger("active-leaf-change");
  }
}

export class FakeMetadataCache extends FakeEvents {
  resolvedLinks: Record<string, Record<string, number>> = {};
  frontmatter = new Map<string, Record<string, unknown>>();
  getFileCache(f: TFile) {
    const fm = this.frontmatter.get(f.path);
    return fm ? { frontmatter: fm } : {};
  }
}

/** A menu that records the items the plugin adds. */
export function fakeMenu() {
  const items: { title: string; icon: string; click: () => unknown }[] = [];
  return {
    items,
    addItem(cb: (i: any) => void) {
      const it = { title: "", icon: "", click: () => undefined as unknown };
      const api = {
        setTitle(t: string) { it.title = t; return api; },
        setIcon(i: string) { it.icon = i; return api; },
        onClick(fn: () => unknown) { it.click = fn; return api; },
      };
      cb(api);
      items.push(it);
      return this;
    },
  };
}

/* ── Boot ───────────────────────────────────────────────────────── */

export interface Booted {
  plugin: any;
  app: { vault: DiskVault; workspace: FakeWorkspace; metadataCache: FakeMetadataCache; fileManager: any };
  vault: DiskVault;
  workspace: FakeWorkspace;
  metadataCache: FakeMetadataCache;
  root: string;
  enginePath: string;
  /** Lines the fake engine logged: [sourcePath, DISTILL_VAULT_PATH, DISTILL_FRONTMATTER]. */
  engineCalls(): string[][];
  cleanup(): void;
}

export async function bootPlugin(
  PluginClass: new (app: any, manifest: any) => any,
  opts: { settings?: Record<string, unknown>; engine?: boolean; before?: (b: Omit<Booted, "plugin">) => void } = {},
): Promise<Booted> {
  installObsidianDom();
  notices.length = 0;
  settingRows.length = 0;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "te-plugin-"));
  const vaultDir = path.join(root, "vault");
  fs.mkdirSync(vaultDir);
  const enginePath = path.join(root, "engine", "convert.sh");
  if (opts.engine !== false) {
    fs.mkdirSync(path.dirname(enginePath));
    fs.writeFileSync(enginePath, ENGINE, { mode: 0o755 });
  }
  const logFile = path.join(root, "engine.log");
  process.env.FAKE_ENGINE_LOG = logFile;

  const vault = new DiskVault(vaultDir);
  const workspace = new FakeWorkspace();
  const metadataCache = new FakeMetadataCache();
  const fileManager = {
    trashFile: async (f: TFile) => { fs.rmSync(path.join(vaultDir, f.path)); },
    renameFile: async (f: TFile, to: string) => {
      const dst = path.join(vaultDir, to);
      if (fs.existsSync(dst)) throw new Error("Destination file already exists!");
      fs.renameSync(path.join(vaultDir, f.path), dst);
    },
  };
  const app = { vault, workspace, metadataCache, fileManager };
  const partial = {
    app, vault, workspace, metadataCache, root, enginePath,
    engineCalls: () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split("\t")) : []),
    cleanup: () => {
      for (const id of plugin.intervals ?? []) clearInterval(id);
      document.body.innerHTML = "";
      delete process.env.FAKE_ENGINE_LEGACY;
      delete process.env.FAKE_ENGINE_OUTSIDE;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  opts.before?.(partial);
  const plugin = new PluginClass(app, { id: "thunderegg", version: "0.0.0-test" });
  plugin.data = { enginePath, ...(opts.settings ?? {}) };
  await plugin.onload();
  return { plugin, ...partial };
}

/** Text content of the plugin's two status-bar items: [engine, refinery]. */
export function statusText(b: Booted): string[] {
  return b.plugin.statusItems.map((el: HTMLElement) => el.textContent ?? "");
}
