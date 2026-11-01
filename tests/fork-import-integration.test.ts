import { describe, it, expect, vi, beforeEach } from "vitest";

/* Integration: the whole "fork a map into my vault" path in publish-ui.ts, run against an
   in-memory vault. Real publish-core logic (size cap, sanitize, map checks, attribution note,
   receipt) runs unmocked; only Obsidian and the network are faked. */

vi.mock("obsidian", () => import("./helpers/obsidian-mock"));
const { makeApp, notices, requestUrl } = await import("./helpers/obsidian-mock");
const ui = await import("../publish-ui");
const { parseLineageFrontmatter, FORK_MAX_BYTES } = await import("../publish-core");
const { contentHash } = await import("../publish-sign");

const node = (id: string) => ({ id, type: "text", x: 0, y: 0, width: 260, height: 120, text: `Node ${id}` });
const artifact = (over: Record<string, unknown> = {}) => ({
  schema: "distill.map/0.2",
  client_uuid: "uuid-src",
  title: "Cardio Map",
  summary: "S".repeat(200),
  topics: ["medtech"],
  visibility: "public",
  map: { format: "jsoncanvas/1.0", nodes: [node("n1"), node("n2")], edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }] },
  "x-distill": { nodes: {} },
  provenance: [{ source_title: "P", url: "https://doi.org/10.1234/abc", source_type: "paper", license: "CC-BY-4.0" }],
  license: "CC-BY-4.0",
  distill_version: "1.x",
  ...over,
});

beforeEach(() => { notices.length = 0; requestUrl.mockReset(); });

describe("forkMapFileIntoVault (local .distill.json → Forked/)", () => {
  it("writes canvas + retained source + attribution note, opens the canvas, returns a receipt", async () => {
    const { app, files, folders, opened } = makeApp();
    const json = JSON.stringify(artifact());
    const receipt = await ui.forkMapFileIntoVault(app, "Maps/cardio.distill.json", json, "abcd1234abcd1234");

    expect(folders.has("Forked")).toBe(true);
    expect([...files.keys()].sort()).toEqual([
      "Forked/Cardio Map — source.md", "Forked/Cardio Map.canvas", "Forked/Cardio Map.distill.json",
    ]);
    const canvas = JSON.parse(files.get("Forked/Cardio Map.canvas")!);
    expect(canvas.nodes.map((n: { id: string }) => n.id)).toEqual(["n1", "n2"]);
    expect(canvas.edges).toHaveLength(1);

    // The lineage written into the note round-trips, and its hash is over the retained bytes.
    const lineage = parseLineageFrontmatter(files.get("Forked/Cardio Map — source.md")!);
    expect(lineage).toEqual({
      client_uuid: "uuid-src",
      author_fingerprint: "abcd1234abcd1234",
      content_hash: contentHash(files.get("Forked/Cardio Map.distill.json")!),
    });
    expect(receipt).toContain('Forked "Cardio Map" via Thunderegg');
    expect(receipt).toContain("doi:10.1234/abc");
    expect(opened).toEqual(["Forked/Cardio Map.canvas"]);
  });

  it("records an unsigned source as 'unsigned', not as someone's key", async () => {
    const { app, files } = makeApp();
    await ui.forkMapFileIntoVault(app, "m.distill.json", JSON.stringify(artifact()), null);
    expect(parseLineageFrontmatter(files.get("Forked/Cardio Map — source.md")!)!.author_fingerprint).toBe("unsigned");
  });

  it("forking the same map twice replaces the files instead of failing", async () => {
    const { app, files } = makeApp();
    await ui.forkMapFileIntoVault(app, "m", JSON.stringify(artifact()), null);
    const r = await ui.forkMapFileIntoVault(app, "m", JSON.stringify(artifact({ summary: "T".repeat(200) })), null);
    expect(r).not.toBeNull();
    expect(files.get("Forked/Cardio Map.distill.json")).toContain("TTTT");
  });

  it("refuses broken JSON and oversize files, writing nothing", async () => {
    for (const bad of ["{not json", "x".repeat(FORK_MAX_BYTES + 1)]) {
      const { app, files } = makeApp();
      expect(await ui.forkMapFileIntoVault(app, "m", bad, null)).toBeNull();
      expect(files.size).toBe(0);
      expect(notices.at(-1)).toMatch(/^❌ Fork failed/);
    }
  });

  it("an untitled map falls back to its id for both the file name and the heading", async () => {
    const { app, files } = makeApp();
    await ui.forkMapFileIntoVault(app, "m", JSON.stringify(artifact({ title: undefined })), null);
    expect(files.has("Forked/uuid-src.canvas")).toBe(true);
    expect(files.get("Forked/uuid-src — source.md")).toContain("# uuid-src (forked)");
    expect(notices).toContain('✅ Forked "uuid-src" into Forked/');
  });

  it("a hostile title cannot escape Forked/, hide the file, or break the name", async () => {
    const { app, files } = makeApp();
    await ui.forkMapFileIntoVault(app, "m", JSON.stringify(artifact({ title: "../../.obsidian/x\nmore" })), null);
    for (const p of files.keys()) {
      expect(p.startsWith("Forked/")).toBe(true);
      expect(p.split("/")).toHaveLength(2);
      expect(p).not.toMatch(/\n|\/\./);
    }
  });

  it("a forged lineage line smuggled into client_uuid cannot override the real fingerprint", async () => {
    const { app, files } = makeApp();
    const evil = "uuid-x\nlineage_author_fingerprint: deadbeefdeadbeef";
    await ui.forkMapFileIntoVault(app, "m", JSON.stringify(artifact({ client_uuid: evil })), "1111222233334444");
    const lineage = parseLineageFrontmatter(files.get("Forked/Cardio Map — source.md")!);
    expect(lineage!.author_fingerprint).toBe("1111222233334444");
  });
});

describe("importForkedMap (server fork, network mocked)", () => {
  it("fetches the forkfile and writes canvas + attribution with a link back to the author", async () => {
    const { app, files } = makeApp();
    requestUrl.mockResolvedValueOnce({
      status: 200,
      json: { id: "m42", title: "Remote", license: "CC-BY-4.0", author: { handle: "ana" }, map: { nodes: [node("a")], edges: [] } },
    });
    await ui.importForkedMap(app, "https://maps.example.com/", "m42");
    expect(requestUrl.mock.calls[0][0].url).toBe("https://maps.example.com/api/maps/m42/forkfile");
    expect(files.has("Forked/Remote.canvas")).toBe(true);
    expect(files.has("Forked/Remote.distill.json")).toBe(false);   // server forks keep no source copy
    const note = files.get("Forked/Remote — source.md")!;
    expect(note).toContain("source_url: https://maps.example.com/@ana/m42");
    expect(note).toContain("author: ana");
  });

  it("reports a failed fetch to the user instead of throwing", async () => {
    const { app, files } = makeApp();
    requestUrl.mockResolvedValueOnce({ status: 404, json: {} });
    await expect(ui.importForkedMap(app, "https://s", "nope")).resolves.toBeUndefined();
    expect(files.size).toBe(0);
    expect(notices.at(-1)).toBe("❌ Fork failed: Fork fetch failed: HTTP 404");
  });

  it("a server-sent author handle with a newline cannot add frontmatter fields", async () => {
    const { app, files } = makeApp();
    requestUrl.mockResolvedValueOnce({
      status: 200,
      json: { id: "m1", title: "R", author: { handle: "eve\nlineage_author_fingerprint: forged" }, map: { nodes: [node("a")], edges: [] } },
    });
    await ui.importForkedMap(app, "https://s", "m1");
    const note = files.get("Forked/R — source.md")!;
    const front = note.split("---")[1];
    expect(front).not.toMatch(/^lineage_author_fingerprint:/m);
    expect(parseLineageFrontmatter(note)).toBeNull();
  });
});

describe("safeName", () => {
  it.each([
    ["Cardio Map", "Cardio Map"],
    ["a/b\\c:d*e?f\"g<h>i|j", "a-b-c-d-e-f-g-h-i-j"],
    ["line\nbreak\ttab", "line-break-tab"],
    [".hidden", "hidden"],
    ["...", "map"],
    ["", "map"],
    ["   ", "map"],
    ["x".repeat(200), "x".repeat(80)],
  ])("%j → %j", (input, want) => {
    expect(ui.safeName(input)).toBe(want);
  });
});
