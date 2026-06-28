import { describe, it, expect } from "vitest";
import {
  firstLine, inferKind, transformCanvas, validatePublishMeta, validateArtifact,
  redactionScan, buildSidecar, NODE_TEXT_CAP, DEFAULT_BLOCKED_ZONES,
  type Canvas, type PublishMeta, type DistillMapArtifact,
} from "../publish-core";

const goodMeta = (over: Partial<PublishMeta> = {}): PublishMeta => ({
  title: "Design Controls",
  summary: "A".repeat(200),
  topics: ["medtech"],
  visibility: "public",
  license: "user-generated",
  provenance: [{
    source_title: "FDA Design Controls Guidance",
    url: "https://www.fda.gov/x",
    source_type: "government-publication",
    license: "public-domain",
  }],
  distill_version: "1.x",
  ...over,
});

const canvas = (over: Partial<Canvas> = {}): Canvas => ({
  nodes: [
    { id: "n1", type: "text", x: 0, y: 0, width: 260, height: 120, text: "Design Inputs\n\nthe requirements" },
    { id: "n2", type: "text", x: 300, y: 0, width: 260, height: 120, text: "Design Outputs" },
  ],
  edges: [{ id: "e1", fromNode: "n1", toNode: "n2", label: "must trace to" }],
  ...over,
});

describe("firstLine", () => {
  it("returns the first non-empty line, stripping heading marks", () => {
    expect(firstLine("# Title\n\nbody")).toBe("Title");
    expect(firstLine("\n\n  hello \nworld")).toBe("hello");
    expect(firstLine("")).toBe("");
  });
});

describe("inferKind", () => {
  it("flags questions, defaults to concept", () => {
    expect(inferKind("What is X?")).toBe("question");
    expect(inferKind("Design Inputs")).toBe("concept");
    expect(inferKind("## Is it safe?")).toBe("question");
  });
});

describe("transformCanvas", () => {
  it("includes text nodes + their edges and infers kind", () => {
    const r = transformCanvas(canvas(), goodMeta(), "uuid-1");
    expect(r.artifact.map.nodes.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(r.artifact.map.edges).toHaveLength(1);
    expect(r.artifact["x-distill"].nodes.n1.kind).toBe("concept");
    expect(r.artifact.schema).toBe("distill.map/0.2");
    expect(r.artifact.client_uuid).toBe("uuid-1");
    expect(r.blocking).toHaveLength(0);
  });

  it("excludes file/link/group nodes and warns for file/link", () => {
    const r = transformCanvas(canvas({
      nodes: [
        { id: "t", type: "text", x: 0, y: 0, width: 1, height: 1, text: "kept" },
        { id: "f", type: "file", x: 0, y: 0, width: 1, height: 1, file: "secret/notes.md" },
        { id: "l", type: "link", x: 0, y: 0, width: 1, height: 1, url: "https://x.com" },
        { id: "g", type: "group", x: 0, y: 0, width: 1, height: 1 },
      ],
      edges: [],
    }), goodMeta(), "u");
    expect(r.artifact.map.nodes.map((n) => n.id)).toEqual(["t"]);
    expect(r.excluded.map((e) => e.type).sort()).toEqual(["file", "group", "link"]);
    // file + link warn; group is silent
    expect(r.warnings.some((w) => w.includes("file"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("link"))).toBe(true);
    expect(r.warnings.some((w) => w.toLowerCase().includes("group"))).toBe(false);
  });

  it("drops edges whose endpoints were excluded", () => {
    const r = transformCanvas(canvas({
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 1, height: 1, text: "a" },
        { id: "b", type: "file", x: 0, y: 0, width: 1, height: 1, file: "x" },
      ],
      edges: [{ id: "e", fromNode: "a", toNode: "b" }],
    }), goodMeta(), "u");
    expect(r.artifact.map.edges).toHaveLength(0);
  });

  it("blocks when a node exceeds the cap", () => {
    const r = transformCanvas(canvas({
      nodes: [{ id: "big", type: "text", x: 0, y: 0, width: 1, height: 1, text: "z".repeat(NODE_TEXT_CAP + 1) }],
      edges: [],
    }), goodMeta(), "u");
    expect(r.blocking.some((b) => b.includes("max"))).toBe(true);
  });

  it("blocks when there are no text nodes", () => {
    const r = transformCanvas({ nodes: [{ id: "g", type: "group", x: 0, y: 0, width: 1, height: 1 }], edges: [] }, goodMeta(), "u");
    expect(r.blocking.some((b) => b.includes("no text nodes"))).toBe(true);
  });

  it("honors per-node kind overrides", () => {
    const r = transformCanvas(canvas(), goodMeta({ kinds: { n2: "claim" } }), "u");
    expect(r.artifact["x-distill"].nodes.n2.kind).toBe("claim");
  });

  it("preserves edge ends/sides and node color", () => {
    const r = transformCanvas(canvas({
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 1, height: 1, text: "a", color: "4" },
        { id: "b", type: "text", x: 0, y: 0, width: 1, height: 1, text: "b" },
      ],
      edges: [{ id: "e", fromNode: "a", toNode: "b", fromEnd: "none", toEnd: "arrow", fromSide: "right" }],
    }), goodMeta(), "u");
    expect(r.artifact.map.nodes[0].color).toBe("4");
    expect(r.artifact.map.edges[0].toEnd).toBe("arrow");
    expect(r.artifact.map.edges[0].fromSide).toBe("right");
  });
});

describe("validatePublishMeta", () => {
  it("passes a good meta", () => {
    expect(validatePublishMeta(goodMeta())).toHaveLength(0);
  });
  it("catches short/long summary, no topics, bad enums, bad provenance", () => {
    expect(validatePublishMeta(goodMeta({ summary: "too short" })).length).toBeGreaterThan(0);
    expect(validatePublishMeta(goodMeta({ topics: [] })).length).toBeGreaterThan(0);
    expect(validatePublishMeta(goodMeta({ license: "bogus" as any })).length).toBeGreaterThan(0);
    expect(validatePublishMeta(goodMeta({ visibility: "world" as any })).length).toBeGreaterThan(0);
    expect(validatePublishMeta(goodMeta({ provenance: [] })).length).toBeGreaterThan(0);
    expect(validatePublishMeta(goodMeta({
      provenance: [{ source_title: "", url: "", source_type: "x" as any, license: "y" as any }],
    })).length).toBeGreaterThanOrEqual(4);
  });
});

describe("validateArtifact", () => {
  it("re-checks an assembled artifact", () => {
    const a = transformCanvas(canvas(), goodMeta(), "u").artifact;
    expect(validateArtifact(a)).toHaveLength(0);
    const bad = { ...a, schema: "distill.map/0.9" } as unknown as DistillMapArtifact;
    expect(validateArtifact(bad).length).toBeGreaterThan(0);
  });
});

describe("redactionScan", () => {
  const artifact = (over: Partial<PublishMeta> = {}, can = canvas()) =>
    transformCanvas(can, goodMeta(over), "u").artifact;

  it("blocks on a topic in a blocked zone", () => {
    const r = redactionScan(artifact({ topics: ["health"] }));
    expect(r.blocks.some((b) => b.includes("blocked privacy zone"))).toBe(true);
  });

  it("blocks on a blocked #tag embedded in a node", () => {
    const can = canvas({
      nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 1, height: 1, text: "notes #client stuff" }],
      edges: [],
    });
    const r = redactionScan(artifact({}, can));
    expect(r.blocks.some((b) => b.includes("#client"))).toBe(true);
  });

  it("warns on email / phone / handle / url PII", () => {
    const can = canvas({
      nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 1, height: 1, text: "ping a@b.com or @bob or +1 415 555 1212" }],
      edges: [],
    });
    const r = redactionScan(artifact({}, can));
    expect(r.warnings.some((w) => w.includes("email"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("phone"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("@handle"))).toBe(true);
  });

  it("clean artifact has no blocks", () => {
    expect(redactionScan(artifact()).blocks).toHaveLength(0);
  });

  it("respects custom zones", () => {
    const r = redactionScan(artifact({ topics: ["secret-project"] }), ["#secret-project"]);
    expect(r.blocks.length).toBeGreaterThan(0);
    expect(DEFAULT_BLOCKED_ZONES).toContain("#health");
  });
});

describe("buildSidecar", () => {
  const artifact = transformCanvas(canvas(), goodMeta(), "u").artifact;

  it("includes title, license, topics, summary, and every source", () => {
    const s = buildSidecar(artifact);
    expect(s).toContain("# Design Controls");
    expect(s).toContain("**License:** user-generated");
    expect(s).toContain('topics: ["medtech"]');
    expect(s).toContain(goodMeta().summary);
    expect(s).toContain("FDA Design Controls Guidance — https://www.fda.gov/x");
    expect(s).toMatch(/distill\.map\/0\.2/);
  });

  it("lists all provenance entries", () => {
    const multi = transformCanvas(canvas(), goodMeta({
      provenance: [
        { source_title: "A", url: "https://a", source_type: "paper", license: "CC-BY-4.0", accessed: "2026-01-01" },
        { source_title: "B", url: "https://b", source_type: "book", license: "public-domain" },
      ],
    }), "u").artifact;
    const s = buildSidecar(multi);
    expect(s).toContain("A — https://a · paper · CC-BY-4.0 (accessed 2026-01-01)");
    expect(s).toContain("B — https://b · book · public-domain");
  });
});
