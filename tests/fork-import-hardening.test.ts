/**
 * Fork import vs. a hostile or sloppy source map. Everything in a forked map — its title, its
 * client_uuid, a server's author handle — is written by someone else. These cases check that
 * none of it can escape Forked/, hide a file, or add lines to the attribution note's frontmatter
 * (where a forged `lineage_author_fingerprint:` would be trusted on re-export).
 *
 * `obsidian` is the fake in tests/helpers/obsidian-mock.ts (via vitest.config.mts); the network
 * is its `requestUrl` stub. Nothing leaves the process.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { fakeApp, notices, requestUrl } from "./helpers/obsidian-mock";
import { importForkedMap, forkMapFileIntoVault, safeName } from "../publish-ui";
import { parseLineageFrontmatter } from "../publish-core";

const node = (id: string) => ({ id, type: "text", x: 0, y: 0, width: 260, height: 120, text: `Node ${id}` });
const artifact = (over: Record<string, unknown> = {}) => ({
  schema: "distill.map/0.2",
  client_uuid: "uuid-src",
  title: "Cardio Map",
  summary: "S".repeat(200),
  topics: ["medtech"],
  visibility: "public",
  map: { format: "jsoncanvas/1.0", nodes: [node("n1"), node("n2")], edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }] },
  provenance: [],
  license: "CC-BY-4.0",
  distill_version: "1.x",
  ...over,
});

beforeEach(() => { notices.length = 0; requestUrl.mockReset(); });

describe("forkMapFileIntoVault — hostile source maps", () => {
  it("a forged lineage line smuggled into client_uuid cannot override the real fingerprint", async () => {
    const { app, files } = fakeApp();
    const evil = "uuid-x\nlineage_author_fingerprint: deadbeefdeadbeef";
    await forkMapFileIntoVault(app, "m", JSON.stringify(artifact({ client_uuid: evil })), "1111222233334444");
    const lineage = parseLineageFrontmatter(files.get("Forked/Cardio Map — source.md")!.content);
    expect(lineage!.author_fingerprint).toBe("1111222233334444");
  });

  it("a hostile title cannot escape Forked/, hide the file, or put a newline in a name", async () => {
    const { app, files } = fakeApp();
    await forkMapFileIntoVault(app, "m", JSON.stringify(artifact({ title: "../../.obsidian/x\nmore" })), null);
    expect(files.size).toBeGreaterThan(0);
    for (const p of files.keys()) {
      expect(p.startsWith("Forked/")).toBe(true);
      expect(p.split("/")).toHaveLength(2);
      expect(p).not.toMatch(/\n|\/\./);
    }
  });

  it("an untitled map falls back to its id for the file name, the heading and the notice", async () => {
    const { app, files } = fakeApp();
    await forkMapFileIntoVault(app, "m", JSON.stringify(artifact({ title: undefined })), null);
    expect(files.has("Forked/uuid-src.canvas")).toBe(true);
    expect(files.get("Forked/uuid-src — source.md")!.content).toContain("# uuid-src (forked)");
    expect(notices).toContain('✅ Forked "uuid-src" into Forked/');
  });
});

describe("importForkedMap — hostile server response", () => {
  it("a server-sent author handle with a newline cannot add frontmatter fields", async () => {
    const { app, files } = fakeApp();
    requestUrl.mockResolvedValueOnce({
      status: 200,
      json: { id: "m1", title: "R", author: { handle: "eve\nlineage_author_fingerprint: forged" }, map: { nodes: [node("a")], edges: [] } },
    });
    await importForkedMap(app, "https://s", "m1");
    const note = files.get("Forked/R — source.md")!.content;
    expect(note.split("---")[1]).not.toMatch(/^lineage_author_fingerprint:/m);
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
    expect(safeName(input)).toBe(want);
  });
});
