// @vitest-environment happy-dom
/**
 * main.ts — right-click menus, palette commands, the fork deep link, signature verification,
 * fork-from-file and the publish hand-off. The publish UI and network modules are mocked (we
 * check what main.ts hands them); signature checks use REAL Ed25519 keys made per test.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { generateKeyPairSync } from "crypto";

vi.mock("obsidian", async () => await import("./helpers/obsidian-mock"));
vi.mock("../publish-net", () => ({
  readDeviceToken: vi.fn(() => "tok-xyz"), writeDeviceToken: vi.fn(), clearDeviceToken: vi.fn(), hasDeviceToken: vi.fn(() => false),
}));
const modalOpen = vi.fn();
vi.mock("../publish-ui", () => ({
  PublishModal: vi.fn(function () { return { open: modalOpen }; }),
  ConfirmForkModal: vi.fn(function () { return { open: modalOpen }; }),
  importForkedMap: vi.fn(async () => undefined),
  forkMapFileIntoVault: vi.fn(async () => "RECEIPT"),
}));
vi.mock("../publish-sign", async (orig) => ({
  ...(await orig<typeof import("../publish-sign")>()),
  signingKeyFingerprint: vi.fn(() => null),          // never read the real device key
}));

import ThundereggPlugin from "../main";
import { notices, TFile, TFolder } from "./helpers/obsidian-mock";
import { bootPlugin, fakeMenu, type Booted } from "./helpers/plugin-harness";
import { PublishModal, ConfirmForkModal, importForkedMap, forkMapFileIntoVault } from "../publish-ui";
import { signBytes, publicKeySpki, keyFingerprint } from "../publish-sign";

let b: Booted;
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => b?.cleanup());
const last = () => notices[notices.length - 1];

function menuFor(file: TFile | TFolder) {
  const m = fakeMenu();
  b.workspace.trigger("file-menu", m, file);
  return m.items.map((i) => i.title);
}

/** Write `<dir>/<name>.distill.json` plus a signed provenance sidecar. */
function signedMap(dir: string, name: string, json = '{"schema":"distill.map/0.2"}', tamper = false) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pub = publicKeySpki(publicKey);
  const sig = signBytes(json, privateKey);
  const file = b.vault.write(`${dir}/${name}.distill.json`, tamper ? json + " " : json);
  b.vault.write(`${dir}/${name} — provenance.md`,
    `# Provenance\n\nsignature_algo: ed25519\npublic_key: ${pub}\nsignature: ${sig}\n`);
  return { file, fingerprint: keyFingerprint(pub) };
}

describe("file-explorer menu", () => {
  it("offers the right action for each kind of file", async () => {
    b = await bootPlugin(ThundereggPlugin);
    expect(menuFor(new TFile("a.pdf"))).toEqual(["Convert to Markdown (Thunderegg)"]);
    expect(menuFor(new TFile("m.canvas"))).toEqual(["Publish concept map (Thunderegg)"]);
    expect(menuFor(new TFolder("F"))).toEqual(["Thunderegg: convert all attachments"]);
    expect(menuFor(new TFile("note.md"))).toEqual([]);
  });

  it("offers Verify and Fork for a .distill.json map (regression: was shadowed by 'json is convertible')", async () => {
    b = await bootPlugin(ThundereggPlugin);
    expect(menuFor(new TFile("Maps/x.distill.json"))).toEqual([
      "Verify signature (Thunderegg)", "Fork map file into vault (Thunderegg)",
    ]);
    expect(menuFor(new TFile("data.json"))).toEqual(["Convert to Markdown (Thunderegg)"]);
  });
});

describe("palette commands are only offered where they apply", () => {
  it("publish needs a canvas; verify/fork need a .distill.json", async () => {
    b = await bootPlugin(ThundereggPlugin);
    const can = (id: string, p: string | null) => {
      b.workspace.activeFile = p ? new TFile(p) : null;
      return b.plugin.commands.get(id).checkCallback(true);
    };
    expect(can("publish-canvas", "m.canvas")).toBe(true);
    expect(can("publish-canvas", "m.md")).toBe(false);
    expect(can("verify-map", "x.DISTILL.json")).toBe(true);
    expect(can("fork-map-file", "x.json")).toBe(false);
  });

  it("'Copy fork receipt' appears only after a fork produced one", async () => {
    b = await bootPlugin(ThundereggPlugin);
    const cmd = b.plugin.commands.get("copy-fork-receipt");
    expect(cmd.checkCallback(true)).toBe(false);
    const { file } = signedMap("Maps", "good");
    await b.plugin.forkMapFile(file);
    expect(cmd.checkCallback(true)).toBe(true);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    cmd.checkCallback(false);
    expect(writeText).toHaveBeenCalledWith("RECEIPT");
  });
});

describe("fork deep link obsidian://distill-fork", () => {
  it("needs ?map=", async () => {
    b = await bootPlugin(ThundereggPlugin);
    b.plugin.protocolHandlers.get("distill-fork")({});
    expect(last()).toMatch(/missing \?map=/);
    expect(importForkedMap).not.toHaveBeenCalled();
  });
  it("hands the map id and the configured server to the importer", async () => {
    b = await bootPlugin(ThundereggPlugin, { settings: { serverBaseUrl: "https://maps.example.com" } });
    b.plugin.protocolHandlers.get("distill-fork")({ map: "m42" });
    expect(importForkedMap).toHaveBeenCalledWith(b.app, "https://maps.example.com", "m42");
  });
});

describe("verify a map's signature", () => {
  it("accepts a correctly signed map and names the key", async () => {
    b = await bootPlugin(ThundereggPlugin);
    const { file, fingerprint } = signedMap("Maps", "good");
    await b.plugin.verifyMapFile(file);
    expect(last()).toBe(`✅ Signature valid — authored by key ${fingerprint} (ed25519).`);
  });
  it("rejects a map changed after signing", async () => {
    b = await bootPlugin(ThundereggPlugin);
    const { file } = signedMap("Maps", "bad", undefined, true);
    await b.plugin.verifyMapFile(file);
    expect(last()).toMatch(/Signature INVALID/);
  });
  it("finds the sidecar even when the name contains '$&' (regression)", async () => {
    b = await bootPlugin(ThundereggPlugin);
    const { file } = signedMap("Maps", "Q$&A");
    await b.plugin.verifyMapFile(file);
    expect(last()).toMatch(/Signature valid/);
  });
  it("explains a missing sidecar and an unsigned sidecar", async () => {
    b = await bootPlugin(ThundereggPlugin);
    await b.plugin.verifyMapFile(b.vault.write("lonely.distill.json", "{}"));
    expect(last()).toMatch(/no provenance sidecar/);
    b.vault.write("u — provenance.md", "# no signature here\n");
    await b.plugin.verifyMapFile(b.vault.write("u.distill.json", "{}"));
    expect(last()).toMatch(/this map is unsigned/);
  });
});

describe("fork a map file", () => {
  it("forks a verified map straight away, passing the author's key fingerprint", async () => {
    b = await bootPlugin(ThundereggPlugin);
    const { file, fingerprint } = signedMap("Maps", "good", '{"a":1}');
    await b.plugin.forkMapFile(file);
    expect(forkMapFileIntoVault).toHaveBeenCalledWith(b.app, "Maps/good.distill.json", '{"a":1}', fingerprint);
    expect(ConfirmForkModal).not.toHaveBeenCalled();
  });

  it("asks for a second confirmation before forking a map that fails verification", async () => {
    b = await bootPlugin(ThundereggPlugin);
    const { file } = signedMap("Maps", "bad", '{"a":1}', true);
    await b.plugin.forkMapFile(file);
    expect(forkMapFileIntoVault).not.toHaveBeenCalled();
    expect(ConfirmForkModal).toHaveBeenCalledTimes(1);
    const [, problem, onConfirm] = vi.mocked(ConfirmForkModal).mock.calls[0] as unknown as [unknown, string, () => void];
    expect(problem).toMatch(/INVALID/);
    onConfirm();
    await vi.waitFor(() => expect(forkMapFileIntoVault).toHaveBeenCalledWith(b.app, "Maps/bad.distill.json", '{"a":1} ', null));
  });
});

describe("publish hand-off", () => {
  it("reports an unreadable canvas instead of opening the modal", async () => {
    b = await bootPlugin(ThundereggPlugin);
    await b.plugin.openPublishModal(b.vault.write("m.canvas", "{not json"));
    expect(last()).toMatch(/could not read canvas/);
    expect(PublishModal).not.toHaveBeenCalled();
  });

  it("opens the modal with the canvas, settings-derived context and fork lineage", async () => {
    b = await bootPlugin(ThundereggPlugin, {
      settings: { serverBaseUrl: "https://maps.example.com", blockedZonesCsv: " #a, ,#b ", defaultVisibility: "public" },
    });
    const canvas = { nodes: [{ id: "n", type: "text", text: "hi", x: 0, y: 0, width: 1, height: 1 }], edges: [] };
    const f = b.vault.write("Forked/My Map.canvas", JSON.stringify(canvas));
    b.vault.write("Forked/My Map — source.md",
      "---\nlineage_client_uuid: u1\nlineage_author_fingerprint: abcd\nlineage_content_hash: ffff\n---\n");
    await b.plugin.openPublishModal(f);
    const [, gotCanvas, title, ctx, lineage] = vi.mocked(PublishModal).mock.calls[0] as unknown as [unknown, unknown, string, any, any];
    expect(gotCanvas).toEqual(canvas);
    expect(title).toBe("My Map");
    expect(ctx).toMatchObject({
      baseUrl: "https://maps.example.com", token: "tok-xyz", blockedZones: ["#a", "#b"],
      distillVersion: "0.0.0-test", defaultVisibility: "public",
    });
    expect(lineage).toMatchObject({ client_uuid: "u1", author_fingerprint: "abcd" });
    expect(modalOpen).toHaveBeenCalled();
  });
});
