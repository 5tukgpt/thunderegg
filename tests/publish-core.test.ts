import { describe, it, expect } from "vitest";
import {
  firstLine, inferKind, transformCanvas, validatePublishMeta, validateArtifact,
  redactionScan, buildSidecar, sourceKey, parseSidecarSignature,
  NODE_TEXT_CAP, DEFAULT_BLOCKED_ZONES,
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

  it("excludes draft nodes with a warning (same gate as file/link nodes)", () => {
    const r = transformCanvas(canvas({
      nodes: [
        { id: "keep", type: "text", x: 0, y: 0, width: 1, height: 1, text: "Kept" },
        { id: "wip", type: "text", x: 0, y: 0, width: 1, height: 1, text: "LLM draft", draft: true },
      ],
      edges: [{ id: "e", fromNode: "keep", toNode: "wip" }],
    }), goodMeta(), "u");
    expect(r.artifact.map.nodes.map((n) => n.id)).toEqual(["keep"]);
    expect(r.excluded.some((e) => e.reason.includes("draft"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("draft node") && w.includes("LLM draft"))).toBe(true);
    expect(r.artifact.map.edges).toHaveLength(0);              // edge to draft dropped
  });

  it("leaves non-draft nodes untouched (draft absent or false)", () => {
    const r = transformCanvas(canvas({
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 1, height: 1, text: "a", draft: false },
        { id: "b", type: "text", x: 0, y: 0, width: 1, height: 1, text: "b" },
      ],
      edges: [],
    }), goodMeta(), "u");
    expect(r.artifact.map.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(r.warnings).toHaveLength(0);
  });

  it("carries ai_assisted into x-distill.authoring when set, omits it when not", () => {
    const set = transformCanvas(canvas(), goodMeta({ ai_assisted: "drafted" }), "u");
    expect(set.artifact["x-distill"].authoring).toEqual({ ai_assisted: "drafted" });
    const unset = transformCanvas(canvas(), goodMeta(), "u");
    expect(unset.artifact["x-distill"].authoring).toBeUndefined();
    expect("authoring" in unset.artifact["x-distill"]).toBe(false);
    expect(validateArtifact(set.artifact)).toHaveLength(0);    // additive — still valid
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

  it("carries the ai_assisted disclosure into the frontmatter when set, omits it when not", () => {
    const disclosed = transformCanvas(canvas(), goodMeta({ ai_assisted: "edited" }), "u").artifact;
    expect(buildSidecar(disclosed)).toContain("ai_assisted: edited");
    expect(buildSidecar(artifact)).not.toContain("ai_assisted:");
  });

  it("embeds the signature block when provided, omits it when absent", () => {
    const signed = buildSidecar(artifact, { algo: "ed25519", public_key: "PUBKEY_B64", signature: "SIG_B64" });
    expect(signed).toContain("signature_algo: ed25519");
    expect(signed).toContain("public_key: PUBKEY_B64");
    expect(signed).toContain("signature: SIG_B64");
    expect(signed).toContain("Verify the exact bytes");
    expect(buildSidecar(artifact)).not.toContain("signature:");
  });
});

describe("sourceKey", () => {
  it("normalizes scheme, www, query, fragment, trailing slash, and case (web: fallback)", () => {
    expect(sourceKey("https://www.FDA.gov/media/116573/")).toBe("web:fda.gov/media/116573");
    expect(sourceKey("http://example.com/a/b?x=1#frag")).toBe("web:example.com/a/b");
  });
  it("collapses two URLs for the same doc to one key (the overlap join)", () => {
    expect(sourceKey("https://fda.gov/x/")).toBe(sourceKey("http://www.fda.gov/x?utm=1"));
  });

  it("doi: resolves doi.org, dx.doi.org, and DOIs in publisher paths to one key", () => {
    expect(sourceKey("https://doi.org/10.1038/s41586-021-03819-2")).toBe("doi:10.1038/s41586-021-03819-2");
    expect(sourceKey("http://dx.doi.org/10.1038/s41586-021-03819-2")).toBe("doi:10.1038/s41586-021-03819-2");
    expect(sourceKey("https://link.springer.com/article/10.1038/s41586-021-03819-2"))
      .toBe(sourceKey("https://doi.org/10.1038/s41586-021-03819-2"));
  });
  it("doi: lowercases and strips trailing punctuation", () => {
    expect(sourceKey("https://doi.org/10.1234/ABC.Def")).toBe("doi:10.1234/abc.def");
    expect(sourceKey("https://doi.org/10.1234/abc).")).toBe("doi:10.1234/abc");
    expect(sourceKey("https://doi.org/10.1234/abc/")).toBe("doi:10.1234/abc");
  });

  it("pmid: extracts the PubMed id, ignoring trailing slash and query", () => {
    expect(sourceKey("https://pubmed.ncbi.nlm.nih.gov/31452104/")).toBe("pmid:31452104");
    expect(sourceKey("https://pubmed.ncbi.nlm.nih.gov/31452104?format=abstract")).toBe("pmid:31452104");
  });

  it("arxiv: unifies abs/pdf shapes and strips .pdf + version suffix", () => {
    expect(sourceKey("https://arxiv.org/abs/1234.5678")).toBe("arxiv:1234.5678");
    expect(sourceKey("https://arxiv.org/abs/2103.14030v2")).toBe("arxiv:2103.14030");
    expect(sourceKey("https://www.arxiv.org/pdf/2103.14030v1.pdf")).toBe("arxiv:2103.14030");
    expect(sourceKey("https://arxiv.org/abs/math/0211159")).toBe("arxiv:math/0211159");
  });

  it("yt: preserves the case-sensitive video id the old key destroyed", () => {
    expect(sourceKey("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("yt:dQw4w9WgXcQ");
    expect(sourceKey("https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL1&t=42")).toBe("yt:dQw4w9WgXcQ");
    expect(sourceKey("https://youtu.be/dQw4w9WgXcQ?t=42")).toBe("yt:dQw4w9WgXcQ");
    expect(sourceKey("https://youtube.com/shorts/AbC123_-xyz")).toBe("yt:AbC123_-xyz");
    expect(sourceKey("https://www.youtube.com/live/AbC123_-xyz")).toBe("yt:AbC123_-xyz");
    expect(sourceKey("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("yt:dQw4w9WgXcQ");
  });
  it("yt: two videos differing only in id case get distinct keys", () => {
    expect(sourceKey("https://youtu.be/abcDEF")).not.toBe(sourceKey("https://youtu.be/ABCdef"));
  });

  it("web: keeps identity-bearing query params (allowlist) in sorted order", () => {
    expect(sourceKey("https://example.com/story?id=42&utm_source=x")).toBe("web:example.com/story?id=42");
    expect(sourceKey("https://example.com/f?p=2&ID=9&article=abc")).toBe("web:example.com/f?article=abc&id=9&p=2");
    expect(sourceKey("https://forum.example.com/viewtopic.php?t=1")).toBe("web:forum.example.com/viewtopic.php");
  });

  it("tolerates empty and garbage input", () => {
    expect(sourceKey("")).toBe("web:");
    expect(sourceKey("   ")).toBe("web:");
    expect(sourceKey("not a url")).toBe("web:not a url");
  });
});

describe("transformCanvas source_key", () => {
  it("derives source_key for every provenance entry", () => {
    const r = transformCanvas(canvas(), goodMeta(), "u");
    expect(r.artifact.provenance[0].source_key).toBe("web:fda.gov/x");
  });
});

describe("parseSidecarSignature", () => {
  it("round-trips a signed sidecar", () => {
    const a = transformCanvas(canvas(), goodMeta(), "u").artifact;
    const sig = { algo: "ed25519", public_key: "PK", signature: "SG" };
    expect(parseSidecarSignature(buildSidecar(a, sig))).toEqual(sig);
  });
  it("returns null for an unsigned sidecar", () => {
    expect(parseSidecarSignature(buildSidecar(transformCanvas(canvas(), goodMeta(), "u").artifact))).toBeNull();
  });
});
