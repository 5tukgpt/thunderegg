/**
 * Minimal stand-in for the `obsidian` module so glue code (publish-net, publish-ui) can run
 * under vitest. Only what those files touch is modelled. `requestUrl` is a vi.fn() each test
 * programs — NO real network request is ever made.
 */
import { vi } from "vitest";

export const requestUrl = vi.fn();

export const notices: string[] = [];
export class Notice {
  constructor(public message: string, _timeout?: number) { notices.push(message); }
  hide(): void { /* no-op */ }
}

export class TFile {
  constructor(public path: string, public content = "") {}
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export class Modal { constructor(public app: unknown) {} }
export class Setting {}
export class App {}

/** In-memory vault with the subset of the Vault API publish-ui uses. */
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
