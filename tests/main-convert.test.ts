// @vitest-environment happy-dom
/**
 * main.ts — conversion entry points, run end to end: real plugin, real temp vault on disk,
 * a fake convert.sh subprocess (tests/helpers/plugin-harness.ts). No network, no real engine.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

vi.mock("obsidian", async () => await import("./helpers/obsidian-mock"));
vi.mock("../publish-net", () => ({
  readDeviceToken: vi.fn(() => ""), writeDeviceToken: vi.fn(), clearDeviceToken: vi.fn(), hasDeviceToken: vi.fn(() => false),
}));
vi.mock("../publish-ui", () => ({
  PublishModal: vi.fn(), importForkedMap: vi.fn(), forkMapFileIntoVault: vi.fn(), ConfirmForkModal: vi.fn(),
}));

import ThundereggPlugin from "../main";
import { notices, TFile, TFolder } from "./helpers/obsidian-mock";
import { bootPlugin, statusText, type Booted } from "./helpers/plugin-harness";

let b: Booted;
afterEach(() => { b?.cleanup(); vi.unstubAllGlobals(); });

const last = () => notices[notices.length - 1];

describe("engine availability (status bar)", () => {
  it("shows Ready when the engine is present and executable", async () => {
    b = await bootPlugin(ThundereggPlugin);
    expect(statusText(b)[0]).toContain("Ready 🟢");
  });
  it("shows Unavailable when the engine is missing", async () => {
    b = await bootPlugin(ThundereggPlugin, { engine: false });
    expect(statusText(b)[0]).toContain("Unavailable 🔴");
    expect(b.plugin.statusItems[0].getAttribute("aria-label")).toMatch(/not found/);
  });
});

describe("convert a single file", () => {
  it("runs the engine, names the note the engine reported, and opens it", async () => {
    b = await bootPlugin(ThundereggPlugin);
    const f = b.vault.write("Inbox/report.pdf");
    await b.plugin.convertFile(f);
    expect(b.vault.exists("Inbox/report.md")).toBe(true);
    expect(notices).toContain("✅ Thunderegg: created report.md");
    expect(b.workspace.opened).toEqual(["Inbox/report.md"]);
  });

  it("passes awkward paths to the shell safely, and tells the engine which vault it is", async () => {
    b = await bootPlugin(ThundereggPlugin);
    const f = b.vault.write("it's a $(echo pwned) file.pdf");
    await b.plugin.convertFile(f);
    const [src, vaultPath, fm] = b.engineCalls()[0];
    expect(src).toBe(path.join(b.vault.base, "it's a $(echo pwned) file.pdf"));
    expect(vaultPath).toBe(b.vault.base);
    expect(fm).toBe("1");
    expect(b.vault.exists("it's a $(echo pwned) file.md")).toBe(true);
  });

  it("sends DISTILL_FRONTMATTER=0 when frontmatter is turned off; does not open when openAfter is off", async () => {
    b = await bootPlugin(ThundereggPlugin, { settings: { frontmatter: false, openAfter: false } });
    await b.plugin.convertFile(b.vault.write("a.docx"));
    expect(b.engineCalls()[0][2]).toBe("0");
    expect(b.workspace.opened).toEqual([]);
  });

  it("with an older engine that reports no path, falls back to <stem>.md once it exists", async () => {
    b = await bootPlugin(ThundereggPlugin, { settings: { openAfter: false } });
    process.env.FAKE_ENGINE_LEGACY = "1";
    await b.plugin.convertFile(b.vault.write("old.pdf"));
    expect(last()).toBe("✅ Thunderegg: created old.md");
  });

  it("does not claim success when the engine exits 0 but writes nothing", async () => {
    b = await bootPlugin(ThundereggPlugin);
    await b.plugin.convertFile(b.vault.write("gone-SILENT.pdf"));
    expect(last()).toMatch(/reported success .* but no note appeared/);
  });

  it("ignores a note the engine filed outside the vault", async () => {
    b = await bootPlugin(ThundereggPlugin);
    const outside = path.join(b.root, "elsewhere"); fs.mkdirSync(outside);
    process.env.FAKE_ENGINE_OUTSIDE = outside;
    await b.plugin.convertFile(b.vault.write("x.pdf"));
    expect(last()).toMatch(/no note appeared/);
    expect(b.workspace.opened).toEqual([]);
  });

  it("names each failure for what it is", async () => {
    b = await bootPlugin(ThundereggPlugin);
    await b.plugin.convertFile(b.vault.write("pic-NOOCR.png"));
    expect(last()).toMatch(/on-device OCR isn't available/);
    await b.plugin.convertFile(b.vault.write("talk-TRIAL.m4a"));
    expect(last()).toMatch(/free recordings are used up/);
    await b.plugin.convertFile(b.vault.write("doc-UNLIC.pdf"));
    expect(last()).toMatch(/isn't activated/);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await b.plugin.convertFile(b.vault.write("doc-CRASH.pdf"));
    expect(last()).toMatch(/❌ Thunderegg failed: .*Is the Thunderegg app installed\?/s);
  });

  it("says 'transcribing' up front for recordings", async () => {
    b = await bootPlugin(ThundereggPlugin, { settings: { openAfter: false } });
    await b.plugin.convertFile(b.vault.write("meeting.mkv"));
    expect(notices.some((n) => n.includes("transcribing meeting.mkv"))).toBe(true);
  });

  it("runs only one conversion at a time (a double-click does not spend two credits)", async () => {
    b = await bootPlugin(ThundereggPlugin, { settings: { openAfter: false } });
    const f = b.vault.write("a.pdf");
    await Promise.all([b.plugin.convertFile(f), b.plugin.convertFile(f)]);
    expect(b.engineCalls()).toHaveLength(1);
    expect(notices.some((n) => n.includes("already running"))).toBe(true);
  });
});

describe("convert a folder", () => {
  it("converts every convertible file recursively and reports OCR / missing counts", async () => {
    b = await bootPlugin(ThundereggPlugin);
    b.vault.write("F/a.pdf");
    b.vault.write("F/sub/b.docx");
    b.vault.write("F/c-NOOCR.png");
    b.vault.write("F/d-SILENT.pdf");
    b.vault.write("F/notes.md");          // not convertible — skipped
    vi.spyOn(console, "error").mockImplementation(() => {});
    await b.plugin.convertFolder(b.vault.getAbstractFileByPath("F") as TFolder);
    expect(b.engineCalls()).toHaveLength(4);
    expect(last()).toMatch(/converted 2\/4 files\. 1 image\(s\) need on-device OCR.* 1 file\(s\) reported success but produced no note/);
  });

  it("stops at the first licence refusal and says how many converted first", async () => {
    b = await bootPlugin(ThundereggPlugin);
    b.vault.write("F/a.pdf");
    b.vault.write("F/b-TRIAL.pdf");
    b.vault.write("F/c.pdf");
    await b.plugin.convertFolder(b.vault.getAbstractFileByPath("F") as TFolder);
    expect(b.engineCalls()).toHaveLength(2);          // c.pdf never attempted
    expect(last()).toMatch(/^Thunderegg's free recordings are used up.*1 of 3 files converted first/);
  });

  it("says so when there is nothing to convert", async () => {
    b = await bootPlugin(ThundereggPlugin);
    b.vault.write("F/only.md");
    await b.plugin.convertFolder(b.vault.getAbstractFileByPath("F") as TFolder);
    expect(last()).toBe("Thunderegg: no convertible files here.");
  });
});

describe("convert clipboard", () => {
  const stubClipboard = (html: string, text = "") =>
    vi.stubGlobal("require", (m: string) => (m === "electron" ? { clipboard: { readHTML: () => html, readText: () => text } } : undefined));

  it("converts clipboard HTML into a 'Clipboard <time>.md' note and removes the temp file", async () => {
    b = await bootPlugin(ThundereggPlugin);
    stubClipboard("<p>hello</p>");
    await b.plugin.convertClipboard();
    const files = b.vault.list();
    expect(files.some((f) => f.startsWith("_thunderegg_clip_"))).toBe(false);
    const note = files.find((f) => /^Clipboard \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.md$/.test(f));
    expect(note).toBeDefined();
    expect(b.workspace.opened).toEqual([note]);
    expect(b.engineCalls()[0][0]).toMatch(/_thunderegg_clip_\d+\.html$/);
  });

  it("uses .txt when the clipboard only has plain text", async () => {
    b = await bootPlugin(ThundereggPlugin, { settings: { openAfter: false } });
    stubClipboard("", "plain words");
    await b.plugin.convertClipboard();
    expect(b.engineCalls()[0][0]).toMatch(/\.txt$/);
  });

  it("a second clipboard in the same minute gets its own name (regression)", async () => {
    b = await bootPlugin(ThundereggPlugin, { settings: { openAfter: false } });
    stubClipboard("<p>one</p>");
    await b.plugin.convertClipboard();
    stubClipboard("<p>two</p>");
    await b.plugin.convertClipboard();
    const clips = b.vault.list().filter((f) => f.startsWith("Clipboard "));
    // Unless the minute rolled over between the two runs, the second is "… 2.md".
    expect(clips).toHaveLength(2);
    expect(b.vault.list().some((f) => f.startsWith("_thunderegg_clip_"))).toBe(false);
    expect(notices.some((n) => n.includes("Clipboard conversion failed"))).toBe(false);
  });

  it("refuses an empty clipboard without running the engine", async () => {
    b = await bootPlugin(ThundereggPlugin);
    stubClipboard("  ", "");
    await b.plugin.convertClipboard();
    expect(last()).toBe("Clipboard is empty.");
    expect(b.engineCalls()).toHaveLength(0);
  });

  it("cleans up the temp file when the engine fails", async () => {
    b = await bootPlugin(ThundereggPlugin, { settings: { enginePath: "/nonexistent/convert.sh" } });
    stubClipboard("<p>x</p>");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await b.plugin.convertClipboard();
    expect(last()).toMatch(/Clipboard conversion failed/);
    expect(b.vault.list()).toEqual([]);
  });
});

describe("conversion entry points", () => {
  it("registers the ribbon icon and the palette command for the clipboard", async () => {
    b = await bootPlugin(ThundereggPlugin);
    expect(b.plugin.ribbon.map((r: { icon: string }) => r.icon)).toEqual(["clipboard-paste"]);
    expect(b.plugin.commands.has("convert-clipboard")).toBe(true);
  });

  it("'Convert file' is only offered for a convertible active file", async () => {
    b = await bootPlugin(ThundereggPlugin);
    const cmd = b.plugin.commands.get("convert-file");
    b.workspace.activeFile = new TFile("note.md");
    expect(cmd.checkCallback(true)).toBe(false);
    b.workspace.activeFile = new TFile("scan.PDF");
    expect(cmd.checkCallback(true)).toBe(true);
    b.workspace.activeFile = null;
    expect(cmd.checkCallback(true)).toBe(false);
  });
});
