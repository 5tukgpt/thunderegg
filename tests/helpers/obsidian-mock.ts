/**
 * A minimal stand-in for the `obsidian` module, for tests only.
 *
 * The real `obsidian` npm package ships type definitions and no runtime code — inside Obsidian
 * the app supplies it. Tests that import publish-net.ts / publish-ui.ts load this instead via
 * `vi.mock("obsidian", () => import("./helpers/obsidian-mock"))`.
 *
 * Nothing here talks to a network: `requestUrl` is a vi.fn() each test programs itself.
 */
import { vi } from "vitest";

export class TAbstractFile { constructor(public path: string) {} }
export class TFile extends TAbstractFile {
  get name(): string { return this.path.split("/").pop() ?? this.path; }
  get basename(): string { return this.name.replace(/\.[^.]+$/, ""); }
}
export class TFolder extends TAbstractFile {}

/** Every Notice shown, in order — tests assert on what the user would have seen. */
export const notices: string[] = [];
export class Notice {
  constructor(public message: string, public timeout?: number) { notices.push(message); }
  hide(): void { /* no-op */ }
  setMessage(m: string): this { this.message = m; return this; }
}

export class Modal { constructor(public app: unknown) {} open(): void {} close(): void {} }
export class Setting { constructor(_el: unknown) {} }

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

/** Programmed per test: `requestUrl.mockResolvedValueOnce({ status, json })`. */
export const requestUrl = vi.fn();

/** An in-memory vault: path → content, plus the folder set. */
export function makeApp() {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const opened: string[] = [];
  const vault = {
    getAbstractFileByPath(p: string) {
      if (files.has(p)) return new TFile(p);
      if (folders.has(p)) return new TFolder(p);
      return null;
    },
    async createFolder(p: string) {
      if (folders.has(p)) throw new Error("Folder already exists.");
      folders.add(p);
    },
    async create(p: string, content: string) {
      if (files.has(p)) throw new Error("File already exists.");
      files.set(p, content);
      return new TFile(p);
    },
    async modify(f: TFile, content: string) { files.set(f.path, content); },
    async read(f: TFile) { return files.get(f.path) ?? ""; },
  };
  const workspace = {
    getLeaf: () => ({ openFile: async (f: TFile) => { opened.push(f.path); } }),
  };
  return { app: { vault, workspace } as never, files, folders, opened };
}
