// @vitest-environment happy-dom
/**
 * main.ts — the Refinery (grade badges, bond counts, condenser hub links in the status bar and
 * the in-note info bar) and the settings tab, driven through the fake workspace / metadata
 * cache and the recorded Setting rows.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("obsidian", async () => await import("./helpers/obsidian-mock"));
vi.mock("../publish-net", () => ({
  readDeviceToken: vi.fn(() => ""), writeDeviceToken: vi.fn(), clearDeviceToken: vi.fn(), hasDeviceToken: vi.fn(() => false),
}));
vi.mock("../publish-ui", () => ({
  PublishModal: vi.fn(), importForkedMap: vi.fn(), forkMapFileIntoVault: vi.fn(), ConfirmForkModal: vi.fn(),
}));
vi.mock("../publish-sign", async (orig) => ({
  ...(await orig<typeof import("../publish-sign")>()),
  signingKeyFingerprint: vi.fn(() => "0123456789abcdef"),
}));

import ThundereggPlugin from "../main";
import { notices, settingRows } from "./helpers/obsidian-mock";
import { bootPlugin, statusText, type Booted } from "./helpers/plugin-harness";
import { writeDeviceToken, clearDeviceToken } from "../publish-net";

let b: Booted;
afterEach(() => b?.cleanup());

/** hub links to 5 notes (a condenser at the default threshold); a.md also links back. */
function seedGraph(x: Omit<Booted, "plugin">) {
  const links: Record<string, Record<string, number>> = {
    "Notes/hub.md": { "Notes/a.md": 1, "Notes/b.md": 1, "Notes/c.md": 1, "Notes/d.md": 1, "Notes/e.md": 1 },
    "Notes/a.md": { "Notes/hub.md": 1 },
  };
  x.metadataCache.resolvedLinks = links;
  x.metadataCache.frontmatter.set("Notes/a.md", { grade: "crystal" });
  x.metadataCache.frontmatter.set("Notes/old.md", { grade: "essence" });   // legacy name
}
const bar = () => document.querySelector(".thunderegg-refinery-bar");
const bootRefinery = (settings: Record<string, unknown> = {}) =>
  bootPlugin(ThundereggPlugin, { settings: { refineryEnabled: true, ...settings }, before: seedGraph });

describe("Refinery off (default)", () => {
  it("shows nothing for notes", async () => {
    b = await bootPlugin(ThundereggPlugin, { before: seedGraph });
    b.workspace.activate("Notes/a.md");
    expect(statusText(b)[1]).toBe("");
    expect(bar()).toBeNull();
  });
});

describe("Refinery on", () => {
  it("status bar shows grade, bond count and the condenser flag", async () => {
    b = await bootRefinery();
    b.workspace.activate("Notes/a.md");
    expect(statusText(b)[1]).toBe("💠 Crystal🔗 2");           // in: hub; out: hub
    b.workspace.activate("Notes/hub.md");
    expect(statusText(b)[1]).toBe("🔗 6⚗️ Condenser");
  });

  it("badges a legacy grade name with its new rung", async () => {
    b = await bootRefinery();
    b.workspace.activate("Notes/old.md");
    expect(statusText(b)[1]).toContain("💎 Gem");
  });

  it("puts an info bar with a clickable Hub link at the top of the note", async () => {
    b = await bootRefinery();
    b.workspace.activate("Notes/a.md");
    const el = b.workspace.activeView!.containerEl.querySelector(".view-content > .thunderegg-refinery-bar")!;
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("💠 Crystal");
    expect(el.textContent).toContain("🔗 2 bonds");
    const link = el.querySelector("a.internal-link") as HTMLAnchorElement;
    expect(link.textContent).toBe("hub");
    b.vault.write("Notes/hub.md", "# hub");
    link.click();
    await vi.waitFor(() => expect(b.workspace.opened).toEqual(["Notes/hub.md"]));
  });

  it("says '1 bond', not '1 bonds'", async () => {
    b = await bootRefinery();
    b.workspace.activate("Notes/b.md");
    expect(bar()!.textContent).toContain("🔗 1 bond");
    expect(bar()!.textContent).not.toContain("1 bonds");
  });

  it("leaves only one bar when switching notes, and none for non-markdown files", async () => {
    b = await bootRefinery();
    b.workspace.activate("Notes/a.md");
    b.workspace.activate("Notes/b.md");
    // a.md's tab is still in the document, but its stale bar must be gone
    expect(document.querySelectorAll(".thunderegg-refinery-bar")).toHaveLength(1);
    expect(b.workspace.activeView!.containerEl.querySelectorAll(".thunderegg-refinery-bar")).toHaveLength(1);
    b.workspace.activate("pic.png");
    expect(statusText(b)[1]).toBe("");
  });

  it("rebuilds bonds when Obsidian's link cache settles", async () => {
    b = await bootRefinery();
    b.metadataCache.resolvedLinks["Notes/z.md"] = { "Notes/a.md": 1 };
    b.workspace.activeFile = null;
    b.metadataCache.trigger("resolved");
    b.workspace.activate("Notes/a.md");
    expect(statusText(b)[1]).toContain("🔗 3");
  });

  it("respects the display toggles", async () => {
    b = await bootRefinery({ showGradeBadges: false, showBondCounts: false, showCondenserLinks: false });
    b.workspace.activate("Notes/a.md");
    expect(statusText(b)[1]).toBe("");
    expect(bar()?.querySelector("a")).toBeFalsy();
  });

  it("onunload removes the info bar", async () => {
    b = await bootRefinery();
    b.workspace.activate("Notes/a.md");
    b.plugin.onunload();
    expect(b.workspace.activeView!.containerEl.querySelector(".thunderegg-refinery-bar")).toBeNull();
  });
});

describe("settings", () => {
  const row = (name: string) => {
    const r = settingRows.find((s) => s.name === name);
    if (!r) throw new Error(`no setting row "${name}"`);
    return r;
  };
  const display = (x: Booted) => { settingRows.length = 0; x.plugin.settingTabs[0].display(); };

  it("merges saved settings over the defaults", async () => {
    b = await bootPlugin(ThundereggPlugin, { settings: { condenserThreshold: 9 } });
    expect(b.plugin.settings).toMatchObject({
      condenserThreshold: 9, frontmatter: true, openAfter: true, refineryEnabled: false,
      serverBaseUrl: "", defaultVisibility: "private",
    });
  });

  it("renders every row and saves changes", async () => {
    b = await bootPlugin(ThundereggPlugin);
    display(b);
    for (const n of ["Engine path", "Add YAML frontmatter", "Enable Refinery", "Condenser threshold",
      "Server URL", "Device token", "Signing key", "Default visibility", "Blocked privacy zones"]) row(n);
    expect(row("Signing key").desc).toContain("0123456789abcdef");
    await row("Condenser threshold").components[0].fire(12);
    expect((b.plugin.data as any).condenserThreshold).toBe(12);
    await row("Default visibility").components[0].fire("public");
    expect(b.plugin.settings.defaultVisibility).toBe("public");
  });

  it("uses the current grade names in the badge toggle description (regression)", async () => {
    b = await bootPlugin(ThundereggPlugin);
    display(b);
    expect(row("Show grade badges").desc).toMatch(/Blank .* Gem/);
    expect(row("Show grade badges").desc).not.toMatch(/Vapor|Distillate|Essence/);
  });

  it("toggling Refinery on boots it; off tears it down", async () => {
    b = await bootPlugin(ThundereggPlugin, { before: seedGraph });
    display(b);
    b.workspace.activate("Notes/a.md");
    await row("Enable Refinery").components[0].fire(true);
    expect(statusText(b)[1]).toContain("💠 Crystal");
    await row("Enable Refinery").components[0].fire(false);
    expect(statusText(b)[1]).toBe("");
  });

  it("changing the vault root rebuilds the bond graph", async () => {
    b = await bootRefinery();
    display(b);
    await row("Vault root for bond discovery").components[0].fire("  Elsewhere ");
    expect(b.plugin.settings.vaultRoot).toBe("Elsewhere");
    b.workspace.activate("Notes/a.md");
    expect(statusText(b)[1]).toBe("💠 Crystal🔗 0");   // no bonds inside Elsewhere/
  });

  it("a new condenser threshold shows at once, without switching notes (regression)", async () => {
    b = await bootRefinery();
    display(b);
    b.workspace.activate("Notes/hub.md");
    expect(statusText(b)[1]).toContain("⚗️ Condenser");          // 6 bonds >= default 5
    await row("Condenser threshold").components[0].fire(10);
    expect(statusText(b)[1]).not.toContain("Condenser");
    expect(bar()!.textContent).not.toContain("Condenser");
  });

  it("display toggles apply at once to the status bar and the in-note bar (regression)", async () => {
    b = await bootRefinery();
    display(b);
    b.workspace.activate("Notes/a.md");
    await row("Show grade badges").components[0].fire(false);
    expect(statusText(b)[1]).not.toContain("Crystal");
    await row("Show bond counts").components[0].fire(false);
    expect(statusText(b)[1]).toBe("");
    expect(bar()!.querySelector("a.internal-link")).not.toBeNull();
    await row("Show condenser links").components[0].fire(false);
    expect(document.querySelector(".thunderegg-refinery-bar a.internal-link")).toBeNull();
  });

  it("a new vault root shows at once, without switching notes (regression)", async () => {
    b = await bootRefinery();
    display(b);
    b.workspace.activate("Notes/a.md");
    await row("Vault root for bond discovery").components[0].fire("Elsewhere");
    expect(statusText(b)[1]).toBe("💠 Crystal🔗 0");
  });

  it("re-checks the engine when its path changes", async () => {
    b = await bootPlugin(ThundereggPlugin);
    display(b);
    await row("Engine path").components[0].fire("/no/such/convert.sh");
    expect(statusText(b)[0]).toContain("Unavailable");
    await row("Engine path").components[0].fire(b.enginePath);
    expect(statusText(b)[0]).toContain("Ready");
  });

  it("hides a retired server URL, and an emptied URL saves as unset", async () => {
    b = await bootPlugin(ThundereggPlugin, { settings: { serverBaseUrl: "https://distillmd.dev" } });
    display(b);
    expect(row("Server URL").components[0].value).toBe("");
    await row("Server URL").components[0].fire("   ");
    expect(b.plugin.settings.serverBaseUrl).toBe("");
  });

  it("stores a pasted device token outside settings, and can remove it", async () => {
    b = await bootPlugin(ThundereggPlugin);
    display(b);
    const [text, trash] = row("Device token").components;
    expect(text.inputEl.type).toBe("password");
    await text.fire("  tok  ");
    expect(writeDeviceToken).toHaveBeenCalledWith("tok");
    expect(JSON.stringify(b.plugin.data ?? {})).not.toContain("tok");
    await trash.fire();
    expect(clearDeviceToken).toHaveBeenCalled();
    expect(notices).toContain("Thunderegg: device token removed.");
  });
});
