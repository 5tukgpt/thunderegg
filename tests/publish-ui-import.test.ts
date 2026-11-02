/**
 * publish-ui fork import — integration over an in-memory vault. `obsidian` is replaced by
 * tests/helpers/obsidian-mock.ts and the network fetch is mocked; nothing leaves the process.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("obsidian", async () => await import("./helpers/obsidian-mock"));
vi.mock("../publish-net", () => ({ fetchForkFile: vi.fn(), publishArtifact: vi.fn() }));

import { fakeApp, notices } from "./helpers/obsidian-mock";
import { fetchForkFile } from "../publish-net";
import { importMapPayload, importForkedMap, forkMapFileIntoVault } from "../publish-ui";
import { contentHash } from "../publish-sign";
import { parseLineageFrontmatter } from "../publish-core";

const node = (id: string) => ({ id, type: "text", x: 0, y: 0, width: 260, height: 120, text: `Node ${id}` });
const map = { nodes: [node("n1"), node("n2")], edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }] };

const artifact = () => ({
  schema: "distill.map/0.2",
  client_uuid: "uuid-src",
  title: "Forked Map",
  summary: "S".repeat(200),
  topics: ["medtech"],
  visibility: "public",
  map: { format: "jsoncanvas/1.0", ...map },
  provenance: [{ source_title: "Paper", url: "https://doi.org/10.1234/abc", source_type: "paper",
    license: "CC-BY-4.0", source_key: "doi:10.1234/abc" }],
  license: "CC-BY-4.0",
  distill_version: "1.x",
});

beforeEach(() => { notices.length = 0; vi.mocked(fetchForkFile).mockReset(); });

describe("importMapPayload", () => {
  it("writes the canvas + attribution note into Forked/ and opens the canvas", async () => {
    const { app, files, opened, vault } = fakeApp();
    await importMapPayload(app, { title: "My Map", license: "CC-BY-4.0", map },
      { author: "alice", forkedFrom: "m1", sourceUrl: "https://x/@alice/m1" });
    expect(vault.createFolder).toHaveBeenCalledWith("Forked");
    const canvas = JSON.parse(files.get("Forked/My Map.canvas")!.content);
    expect(canvas.nodes.map((n: { id: string }) => n.id)).toEqual(["n1", "n2"]);
    expect(canvas.edges).toHaveLength(1);
    const note = files.get("Forked/My Map — source.md")!.content;
    expect(note).toContain("alice");
    expect(note).toContain("CC-BY-4.0");
    expect(files.has("Forked/My Map.distill.json")).toBe(false);   // only file forks retain source
    expect(opened).toEqual(["Forked/My Map.canvas"]);
  });

  it("replaces an existing fork instead of failing on create", async () => {
    const { app, files, vault } = fakeApp();
    const opts = { author: "a", forkedFrom: "m1", sourceUrl: "u" };
    await importMapPayload(app, { title: "Dup", map }, opts);
    await importMapPayload(app, { title: "Dup", map: { nodes: [node("only")], edges: [] } }, opts);
    expect(vault.modify).toHaveBeenCalled();
    expect(JSON.parse(files.get("Forked/Dup.canvas")!.content).nodes).toHaveLength(1);
  });

  it("sanitizes path characters in a server-supplied title", async () => {
    const { app, files } = fakeApp();
    await importMapPayload(app, { title: "../../etc/passwd:*?", map }, { author: "a", forkedFrom: "m", sourceUrl: "u" });
    const names = [...files.keys()];
    expect(names.every((n) => n.startsWith("Forked/") && !n.slice("Forked/".length).includes("/"))).toBe(true);
  });

  it("falls back to forkedFrom when the payload has no title", async () => {
    const { app, files } = fakeApp();
    await importMapPayload(app, { map }, { author: "a", forkedFrom: "map-42", sourceUrl: "u" });
    expect(files.has("Forked/map-42.canvas")).toBe(true);
  });

  it("throws and writes nothing when the map is blocked (too many nodes)", async () => {
    const { app, files } = fakeApp();
    const huge = { nodes: Array.from({ length: 5000 }, (_, i) => node(`n${i}`)), edges: [] };
    await expect(importMapPayload(app, { title: "Big", map: huge }, { author: "a", forkedFrom: "m", sourceUrl: "u" }))
      .rejects.toThrow(/refusing to import/);
    expect(files.size).toBe(0);
  });
});

describe("importForkedMap (server fork, network mocked)", () => {
  it("fetches the forkfile and links back to the author's page", async () => {
    vi.mocked(fetchForkFile).mockResolvedValue({ id: "m9", title: "Srv", license: "CC0", author: { handle: "bob" }, map });
    const { app, files } = fakeApp();
    await importForkedMap(app, "https://maps.example.com/", "m9");
    expect(fetchForkFile).toHaveBeenCalledWith("https://maps.example.com/", "m9");
    expect(files.get("Forked/Srv — source.md")!.content).toContain("https://maps.example.com/@bob/m9");
  });

  it("reports a fetch failure as a notice instead of throwing", async () => {
    vi.mocked(fetchForkFile).mockRejectedValue(new Error("Fork fetch failed: HTTP 404"));
    const { app, files } = fakeApp();
    await expect(importForkedMap(app, "https://m.example.com", "nope")).resolves.toBeUndefined();
    expect(notices.some((n) => n.includes("Fork failed") && n.includes("404"))).toBe(true);
    expect(files.size).toBe(0);
  });
});

describe("forkMapFileIntoVault (local file fork)", () => {
  it("writes canvas, retained source JSON and a lineage-stamped note; returns a receipt", async () => {
    const { app, files } = fakeApp();
    const receipt = await forkMapFileIntoVault(app, "Maps/src.distill.json", JSON.stringify(artifact()), "abcd1234abcd1234");
    expect(receipt).toContain('Forked "Forked Map"');
    expect(receipt).toContain("abcd1234abcd1234");
    expect(receipt).toContain("doi:10.1234/abc");

    const retained = files.get("Forked/Forked Map.distill.json")!.content;
    const note = files.get("Forked/Forked Map — source.md")!.content;
    const lin = parseLineageFrontmatter(note);
    expect(lin).toEqual({ client_uuid: "uuid-src", author_fingerprint: "abcd1234abcd1234", content_hash: contentHash(retained) });
  });

  it("marks an unsigned source as 'unsigned'", async () => {
    const { app } = fakeApp();
    const receipt = await forkMapFileIntoVault(app, "s.distill.json", JSON.stringify(artifact()), null);
    expect(receipt).toContain("`unsigned`");
  });

  it("returns null and writes nothing for invalid JSON", async () => {
    const { app, files } = fakeApp();
    expect(await forkMapFileIntoVault(app, "s.distill.json", "{not json", null)).toBeNull();
    expect(files.size).toBe(0);
    expect(notices.some((n) => n.includes("not valid JSON"))).toBe(true);
  });
});
