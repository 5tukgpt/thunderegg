import { describe, it, expect } from "vitest";
import { checkForkMap, FORK_MAX_NODES, NODE_TEXT_CAP } from "../publish-core";

// checkForkMap is the last gate before a third-party map is written into the
// vault (publish-core.ts:651 "Harden a third-party map before it is written").
// publish-fork.test.ts covers the shape of each branch; this file pins the two
// numeric CAP BOUNDARIES (both contracts are `>`, not `>=`), the order of
// operations that makes the node cap a real DoS guard, and the edge-sanitizer —
// which publish-fork.test.ts's "strips fields ... from nodes and edges" case
// never reaches, because it passes `edges: []`.

const node = (id: string, over: Record<string, unknown> = {}) => ({
  id, type: "text", x: 0, y: 0, width: 260, height: 120, text: `Node ${id}`, ...over,
});

describe("checkForkMap — node-count cap boundary", () => {
  it("imports a map of exactly FORK_MAX_NODES (the cap is `>`, not `>=`)", () => {
    const nodes = Array.from({ length: FORK_MAX_NODES }, (_, i) => node(`n${i}`));
    const r = checkForkMap({ nodes, edges: [] });
    expect(r.blocking).toHaveLength(0);
    expect(r.nodes).toHaveLength(FORK_MAX_NODES);
  });

  it("counts RAW nodes before sanitizing, so garbage cannot dodge the cap", () => {
    // Order of operations is the guard: if the cap were applied to the
    // *sanitized* list, 100k junk entries would sanitize to 0 nodes and report
    // the benign "no importable text nodes" instead of refusing the import.
    const r = checkForkMap({ nodes: Array(FORK_MAX_NODES + 1).fill("garbage"), edges: [] });
    expect(r.blocking).toEqual([
      `Map has ${FORK_MAX_NODES + 1} nodes (max ${FORK_MAX_NODES}) — refusing to import.`,
    ]);
    expect(r.blocking.some((b) => b.includes("no importable"))).toBe(false);
    expect(r.warnings).toHaveLength(0); // early return — nothing is even inspected
    expect(r.nodes).toHaveLength(0);
  });
});

describe("checkForkMap — per-node text cap boundary", () => {
  it("imports text of exactly NODE_TEXT_CAP and rejects CAP+1 (the cap is `>`, not `>=`)", () => {
    const at = checkForkMap({ nodes: [node("at", { text: "z".repeat(NODE_TEXT_CAP) })], edges: [] });
    expect(at.nodes.map((n) => n.id)).toEqual(["at"]);
    expect(at.warnings).toHaveLength(0);

    const over = checkForkMap({ nodes: [node("over", { text: "z".repeat(NODE_TEXT_CAP + 1) })], edges: [] });
    expect(over.nodes).toHaveLength(0);
    expect(over.warnings.some((w) => w.includes(`over the ${NODE_TEXT_CAP}-char cap`))).toBe(true);
  });
});

describe("checkForkMap — edge sanitizer", () => {
  it("strips unknown edge fields, keeps known optionals, drops wrong-typed ones", () => {
    const r = checkForkMap({
      nodes: [node("a"), node("b")],
      edges: [{
        id: "e", fromNode: "a", toNode: "b",
        fromSide: "right", toSide: "left", fromEnd: "none", label: "supports", color: "3",
        toEnd: 42,                    // known field, wrong type -> dropped, not coerced
        onclick: "steal()", evil: {}, // unknown -> stripped
      }],
    });
    expect(r.edges).toEqual([{
      id: "e", fromNode: "a", toNode: "b",
      fromSide: "right", toSide: "left", fromEnd: "none", label: "supports", color: "3",
    }]);
    expect("onclick" in r.edges[0]).toBe(false);
    expect("toEnd" in r.edges[0]).toBe(false);
  });

  it("keeps a node's `color` — the one optional node field that survives", () => {
    const r = checkForkMap({ nodes: [node("a", { color: "6" })], edges: [] });
    expect(r.nodes[0].color).toBe("6");
  });
});

describe("checkForkMap — degenerate input and warning accounting", () => {
  it("blocks rather than throws on an absent map or an absent nodes key", () => {
    for (const r of [checkForkMap(undefined), checkForkMap({})]) {
      expect(r.blocking).toEqual(["This map has no importable text nodes."]);
      expect(r.nodes).toHaveLength(0);
      expect(r.edges).toHaveLength(0);
    }
  });

  it("accumulates independent warnings: over-cap counts as Rejected, not Skipped", () => {
    const r = checkForkMap({
      nodes: [
        node("ok"),
        "garbage",                                                  // -> Skipped
        node("big", { text: "z".repeat(NODE_TEXT_CAP + 1) }),       // -> Rejected
      ],
      edges: [
        { id: "e1", fromNode: "ok", toNode: "big" },                // -> Dropped (rejected node)
        { id: "e2", fromNode: "ok" },                               // -> Dropped (malformed)
        { id: "e3", fromNode: "ok", toNode: "ok" },                 // kept
      ],
    });
    expect(r.nodes.map((n) => n.id)).toEqual(["ok"]);
    expect(r.edges.map((e) => e.id)).toEqual(["e3"]);
    expect(r.blocking).toHaveLength(0); // one importable node is enough
    expect(r.warnings.some((w) => w.startsWith("Skipped 1 node"))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith("Rejected 1 node"))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith("Dropped 2 edge"))).toBe(true);
    expect(r.warnings).toHaveLength(3); // three independent counters, no double-count
  });
});
