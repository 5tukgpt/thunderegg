import { describe, it, expect } from "vitest";
import {
  transformCanvas, NODE_TEXT_CAP,
  type PublishMeta, type CanvasNode, type CanvasEdge,
} from "../publish-core";

// Valid meta so `blocking` reflects only the transform branch under test
// (transformCanvas appends validatePublishMeta errors to `blocking`).
const meta = (over: Partial<PublishMeta> = {}): PublishMeta => ({
  title: "T",
  summary: "A".repeat(200),
  topics: ["x"],
  visibility: "public",
  license: "user-generated",
  provenance: [{
    source_title: "S", url: "https://example.com/a",
    source_type: "government-publication", license: "public-domain",
  }],
  distill_version: "1.x",
  ...over,
});

const tnode = (id: string, text: string, over: Partial<CanvasNode> = {}): CanvasNode =>
  ({ id, type: "text", x: 0, y: 0, width: 1, height: 1, text, ...over });

const run = (nodes: CanvasNode[], edges: CanvasEdge[] = []) =>
  transformCanvas({ nodes, edges }, meta(), "u");

// publish-core.test.ts covers transformCanvas's happy path; these four clusters
// pin the edge/boundary branches that table never reaches (lego-loop backlog #1).

describe("transformCanvas — empty/whitespace text nodes are excluded SILENTLY", () => {
  it("excludes an empty text node with no warning (unlike file/link/draft)", () => {
    const r = run([tnode("keep", "kept"), tnode("empty", "")]);
    expect(r.artifact.map.nodes.map((n) => n.id)).toEqual(["keep"]);
    expect(r.excluded.some((e) => e.id === "empty" && e.reason.includes("empty text node"))).toBe(true);
    expect(r.warnings).toHaveLength(0);          // silent, like a group node
  });

  it("treats a whitespace-only node as empty — the silent data-loss trap", () => {
    const r = run([tnode("keep", "kept"), tnode("ws", "   \n\t  ")]);
    expect(r.artifact.map.nodes.map((n) => n.id)).toEqual(["keep"]);   // ws vanished
    expect(r.excluded.some((e) => e.id === "ws" && e.reason.includes("empty text node"))).toBe(true);
    expect(r.warnings).toHaveLength(0);          // user is never told it dropped
  });
});

describe("transformCanvas — NODE_TEXT_CAP boundary is `>` and blocking != exclusion", () => {
  it("passes a node of exactly NODE_TEXT_CAP chars with no blocking", () => {
    const r = run([tnode("b", "z".repeat(NODE_TEXT_CAP))]);
    expect(r.blocking.some((b) => b.includes("max"))).toBe(false);     // CAP > CAP is false
    expect(r.artifact.map.nodes.map((n) => n.id)).toEqual(["b"]);
  });

  it("blocks a node one char over the cap BUT still includes it", () => {
    const r = run([tnode("big", "z".repeat(NODE_TEXT_CAP + 1))]);
    expect(r.blocking.some((b) => b.includes("max"))).toBe(true);
    // An over-cap node is NOT excluded: it stays in the map (so its edges survive
    // and it reappears once shortened); only the blocking message gates publish.
    expect(r.artifact.map.nodes.map((n) => n.id)).toEqual(["big"]);
    expect(r.excluded.some((e) => e.id === "big")).toBe(false);
  });
});

describe("transformCanvas — provenance source_key passthrough (corpus integrity)", () => {
  it("keeps an explicit source_key verbatim and only derives the missing ones", () => {
    const r = transformCanvas({ nodes: [tnode("n", "n")], edges: [] }, meta({
      provenance: [
        { source_title: "preset", url: "https://example.com/would-derive-differently",
          source_type: "government-publication", license: "public-domain",
          source_key: "doi:10.9999/preset-key" },
        { source_title: "derive", url: "https://www.FDA.gov/x/",
          source_type: "government-publication", license: "public-domain" },
      ],
    }), "u");
    expect(r.artifact.provenance[0].source_key).toBe("doi:10.9999/preset-key");  // preserved, not re-derived
    expect(r.artifact.provenance[1].source_key).toBe("web:fda.gov/x");           // derived for the unset one
  });
});

describe("transformCanvas — optional field omission & passthrough (clean minimal JSON)", () => {
  it("omits node color when absent, keeps it when present", () => {
    const r = run([tnode("plain", "a"), tnode("hued", "b", { color: "4" })]);
    const [plain, hued] = r.artifact.map.nodes;
    expect("color" in plain).toBe(false);
    expect(hued.color).toBe("4");
  });

  it("preserves toSide, label and edge color (fields publish-core.test.ts skips)", () => {
    const edge: CanvasEdge = { id: "e", fromNode: "a", toNode: "b", toSide: "left", label: "relates to", color: "3" };
    const r = run([tnode("a", "a"), tnode("b", "b")], [edge]);
    const out = r.artifact.map.edges[0];
    expect(out.toSide).toBe("left");
    expect(out.label).toBe("relates to");
    expect(out.color).toBe("3");
  });

  it("omits every optional edge key for a bare edge (undefined -> absent)", () => {
    const r = run([tnode("a", "a"), tnode("b", "b")], [{ id: "e", fromNode: "a", toNode: "b" }]);
    const out = r.artifact.map.edges[0];
    for (const k of ["fromSide", "toSide", "fromEnd", "toEnd", "label", "color"]) {
      expect(k in out).toBe(false);
    }
    expect(out).toEqual({ id: "e", fromNode: "a", toNode: "b" });      // exactly the three required keys
  });
});
