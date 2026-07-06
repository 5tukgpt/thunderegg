import { describe, it, expect } from "vitest";
import {
  checkForkMap, prepareForkImport, sanitizeForkArtifact,
  buildAttributionNote, parseLineageFrontmatter, buildForkReceipt,
  transformCanvas, sourceKey,
  FORK_MAX_BYTES, FORK_MAX_NODES, NODE_TEXT_CAP,
  type Canvas, type PublishMeta, type ForkLineage,
} from "../publish-core";

const lineage: ForkLineage = {
  client_uuid: "uuid-src",
  author_fingerprint: "abcd1234abcd1234",
  content_hash: "f".repeat(64),
};

const node = (id: string, over: Record<string, unknown> = {}) => ({
  id, type: "text", x: 0, y: 0, width: 260, height: 120, text: `Node ${id}`, ...over,
});

const sourceArtifact = (over: Record<string, unknown> = {}) => ({
  schema: "distill.map/0.2",
  client_uuid: "uuid-src",
  title: "Forked Map",
  summary: "S".repeat(200),
  topics: ["medtech"],
  visibility: "public",
  map: {
    format: "jsoncanvas/1.0",
    nodes: [node("n1"), node("n2")],
    edges: [{ id: "e1", fromNode: "n1", toNode: "n2", label: "relates" }],
  },
  "x-distill": { nodes: { n1: { kind: "concept" } } },
  provenance: [{
    source_title: "Paper",
    url: "https://doi.org/10.1234/abc",
    source_type: "paper",
    license: "CC-BY-4.0",
    source_key: "doi:10.1234/abc",
  }],
  license: "CC-BY-4.0",
  distill_version: "1.x",
  ...over,
});

describe("checkForkMap", () => {
  it("passes a well-formed map through (happy path)", () => {
    const r = checkForkMap({ nodes: [node("a"), node("b")], edges: [{ id: "e", fromNode: "a", toNode: "b" }] });
    expect(r.blocking).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
    expect(r.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(r.edges).toHaveLength(1);
  });

  it("blocks a map over the node cap", () => {
    const nodes = Array.from({ length: FORK_MAX_NODES + 1 }, (_, i) => node(`n${i}`));
    const r = checkForkMap({ nodes, edges: [] });
    expect(r.blocking.some((b) => b.includes(`max ${FORK_MAX_NODES}`))).toBe(true);
    expect(r.nodes).toHaveLength(0);
  });

  it("rejects over-cap node text with a warning listing it, importing the rest", () => {
    const big = node("big", { text: "Way too long\n" + "z".repeat(NODE_TEXT_CAP + 1) });
    const r = checkForkMap({ nodes: [node("ok"), big], edges: [{ id: "e", fromNode: "ok", toNode: "big" }] });
    expect(r.nodes.map((n) => n.id)).toEqual(["ok"]);          // rest imported, not truncated
    expect(r.warnings.some((w) => w.includes("Rejected 1 node") && w.includes("Way too long"))).toBe(true);
    expect(r.edges).toHaveLength(0);                            // edge to rejected node dropped
    expect(r.warnings.some((w) => w.includes("edge"))).toBe(true);
  });

  it("strips fields not in the known schema from nodes and edges", () => {
    const r = checkForkMap({
      nodes: [node("a", { evil: "<script>", onclick: "x()" })],
      edges: [],
    });
    expect(r.nodes[0]).toEqual({ id: "a", type: "text", x: 0, y: 0, width: 260, height: 120, text: "Node a" });
    expect("evil" in r.nodes[0]).toBe(false);
  });

  it("skips non-text and malformed nodes with a warning", () => {
    const r = checkForkMap({
      nodes: [node("a"), { id: "f", type: "file", x: 0, y: 0, width: 1, height: 1, file: "x" }, "garbage"],
      edges: [],
    });
    expect(r.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(r.warnings.some((w) => w.includes("Skipped 2"))).toBe(true);
  });

  it("blocks when nothing importable remains", () => {
    const r = checkForkMap({ nodes: [], edges: [] });
    expect(r.blocking.some((b) => b.includes("no importable"))).toBe(true);
  });
});

describe("prepareForkImport", () => {
  it("accepts a valid artifact file (happy path)", () => {
    const r = prepareForkImport(JSON.stringify(sourceArtifact()));
    expect(r.blocking).toHaveLength(0);
    expect(r.artifact?.client_uuid).toBe("uuid-src");
    expect(r.artifact?.map.nodes).toHaveLength(2);
    expect(r.artifact?.provenance[0].source_key).toBe("doi:10.1234/abc");
  });

  it("blocks an oversized file", () => {
    const r = prepareForkImport("x".repeat(FORK_MAX_BYTES + 1));
    expect(r.artifact).toBeNull();
    expect(r.blocking.some((b) => b.includes("bytes"))).toBe(true);
  });

  it("blocks invalid JSON and non-artifact JSON", () => {
    expect(prepareForkImport("{nope").blocking).toHaveLength(1);
    expect(prepareForkImport('{"hello": 1}').blocking.some((b) => b.includes("not a distill map"))).toBe(true);
  });

  it("strips fields not in the known artifact schema at every level", () => {
    const raw = sourceArtifact({
      map_uid: "SERVER-ONLY",
      injected: { deep: true },
      "x-distill": { nodes: { n1: { kind: "concept" } }, tracker: "https://evil" },
    });
    const a = prepareForkImport(JSON.stringify(raw)).artifact!;
    expect("map_uid" in a).toBe(false);
    expect("injected" in a).toBe(false);
    expect("tracker" in a["x-distill"]).toBe(false);
    expect(a["x-distill"].nodes.n1.kind).toBe("concept");
  });

  it("drops invalid kinds and preserves a valid forked_from chain", () => {
    const raw = sourceArtifact({
      "x-distill": { nodes: { n1: { kind: "hacker" } }, forked_from: lineage },
    });
    const a = prepareForkImport(JSON.stringify(raw)).artifact!;
    expect(a["x-distill"].nodes.n1).toBeUndefined();
    expect(a["x-distill"].forked_from).toEqual(lineage);
  });

  it("preserves a valid ai_assisted disclosure, drops an invalid one", () => {
    const ok = sourceArtifact({ "x-distill": { nodes: {}, authoring: { ai_assisted: "drafted" } } });
    expect(prepareForkImport(JSON.stringify(ok)).artifact!["x-distill"].authoring).toEqual({ ai_assisted: "drafted" });
    const bad = sourceArtifact({ "x-distill": { nodes: {}, authoring: { ai_assisted: "fully-ai" } } });
    expect(prepareForkImport(JSON.stringify(bad)).artifact!["x-distill"].authoring).toBeUndefined();
  });
});

describe("sanitizeForkArtifact", () => {
  it("returns null when there is no map object", () => {
    expect(sanitizeForkArtifact(null)).toBeNull();
    expect(sanitizeForkArtifact({ title: "x" })).toBeNull();
  });
  it("keeps over-cap nodes in the retained copy (caps are checkForkMap's job)", () => {
    const raw = sourceArtifact({
      map: { format: "jsoncanvas/1.0", nodes: [node("big", { text: "z".repeat(NODE_TEXT_CAP + 5) })], edges: [] },
    });
    const a = sanitizeForkArtifact(raw)!;
    expect(a.map.nodes[0].text.length).toBe(NODE_TEXT_CAP + 5);
  });
});

describe("buildAttributionNote / parseLineageFrontmatter", () => {
  it("round-trips the lineage receipt through the frontmatter", () => {
    const md = buildAttributionNote({
      displayTitle: "Forked Map",
      canvasName: "Forked Map",
      forkedFrom: "uuid-src",
      author: lineage.author_fingerprint,
      license: "CC-BY-4.0",
      sourceUrl: "Thunderegg Exports/Forked Map.distill.json",
      lineage,
    });
    expect(md).toContain("forked_from: uuid-src");
    expect(md).toContain("# Forked Map (forked)");
    expect(md).toContain("`Forked Map.canvas`");
    expect(parseLineageFrontmatter(md)).toEqual(lineage);
  });

  it("omits lineage lines (and parses to null) when there is no receipt", () => {
    const md = buildAttributionNote({
      displayTitle: "T", canvasName: "T", forkedFrom: "id-1",
      author: "handle", license: "unknown", sourceUrl: "https://x/@handle/id-1",
    });
    expect(md).not.toContain("lineage_");
    expect(parseLineageFrontmatter(md)).toBeNull();
  });
});

describe("buildForkReceipt", () => {
  it("carries title, fingerprint, hash prefix, and source keys", () => {
    const a = sanitizeForkArtifact(sourceArtifact())!;
    const r = buildForkReceipt(a, lineage);
    expect(r).toContain('Forked "Forked Map"');
    expect(r).toContain(lineage.author_fingerprint);
    expect(r).toContain(lineage.content_hash.slice(0, 12));
    expect(r).toContain("doi:10.1234/abc");
    expect(r).not.toContain(lineage.content_hash);              // prefix only
  });
});

describe("transformCanvas forked_from (export side)", () => {
  const meta: PublishMeta = {
    title: "T", summary: "A".repeat(200), topics: ["t"], visibility: "public",
    license: "user-generated",
    provenance: [{ source_title: "S", url: "https://fda.gov/x", source_type: "webpage", license: "public-domain" }],
    distill_version: "1.x",
  };
  const canvas: Canvas = {
    nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 1, height: 1, text: "a" }],
    edges: [],
  };

  it("includes x-distill.forked_from when a lineage record accompanies the canvas", () => {
    const r = transformCanvas(canvas, meta, "u", lineage);
    expect(r.artifact["x-distill"].forked_from).toEqual(lineage);
  });

  it("omits forked_from when there is no lineage (existing artifacts unchanged)", () => {
    const r = transformCanvas(canvas, meta, "u");
    expect(r.artifact["x-distill"].forked_from).toBeUndefined();
    expect("forked_from" in r.artifact["x-distill"]).toBe(false);
  });

  it("leaves sourceKey untouched by this upgrade", () => {
    expect(sourceKey("https://doi.org/10.1234/abc")).toBe("doi:10.1234/abc");
    expect(sourceKey("https://www.fda.gov/x/")).toBe("web:fda.gov/x");
  });
});
