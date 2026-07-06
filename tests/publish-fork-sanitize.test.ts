import { describe, it, expect } from "vitest";
import { sanitizeForkArtifact, VISIBILITIES } from "../publish-core";

/*
 * sanitizeForkArtifact is the untrusted-input boundary for fork import: it
 * rebuilds a third-party `.distill.json` into the vault, keeping ONLY known
 * schema fields and defaulting the rest. Existing coverage (publish-fork.test.ts
 * + prepareForkImport) exercises node/edge stripping, kinds, ai_assisted, and
 * forked_from. UNTESTED until now: the top-level *defaulting* contract — the
 * privacy-safe visibility fallback, the license/topics/schema coercions, and
 * provenance field-selection. Those are what a careless refactor would silently
 * break, so pin them here. All pure (no Obsidian/IO) — provable in-sandbox.
 */

/** Minimal schema-valid text node (survives the internal sanitizeMapNode). */
const node = (id: string): Record<string, unknown> => ({
  id, type: "text", x: 0, y: 0, width: 260, height: 120, text: `Node ${id}`,
});

/** Untrusted fork artifact whose `map` clears the null-guard, so each test can
 *  vary ONE field and observe the sanitizer's default. Typed as untrusted. */
const raw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: "distill.map/0.2",
  client_uuid: "uuid-src",
  title: "Forked Map",
  summary: "S".repeat(200),
  topics: ["medtech"],
  visibility: "public",
  map: { format: "jsoncanvas/1.0", nodes: [node("n1")], edges: [] },
  "x-distill": { nodes: {} },
  provenance: [],
  license: "CC-BY-4.0",
  distill_version: "1.x",
  ...over,
});

describe("sanitizeForkArtifact — untrusted field defaulting (fork-import boundary)", () => {
  it("defaults visibility to the privacy-safe 'private' on a garbage/wrong-type/absent value, but preserves every legitimate one", () => {
    expect(sanitizeForkArtifact(raw({ visibility: "world-readable" }))!.visibility).toBe("private");
    expect(sanitizeForkArtifact(raw({ visibility: 1 }))!.visibility).toBe("private");
    const noVis = raw(); delete noVis.visibility;
    expect(sanitizeForkArtifact(noVis)!.visibility).toBe("private");
    for (const v of VISIBILITIES) {
      expect(sanitizeForkArtifact(raw({ visibility: v }))!.visibility).toBe(v);
    }
  });

  it("defaults license to 'unknown' when empty/absent, and keeps a provided license string", () => {
    const noLicense = raw(); delete noLicense.license;
    expect(sanitizeForkArtifact(noLicense)!.license).toBe("unknown");
    expect(sanitizeForkArtifact(raw({ license: "" }))!.license).toBe("unknown");
    expect(sanitizeForkArtifact(raw({ license: "CC-BY-4.0" }))!.license).toBe("CC-BY-4.0");
  });

  it("filters topics to strings and coerces a non-array to []", () => {
    expect(sanitizeForkArtifact(raw({ topics: ["a", 2, null, "b", {}] }))!.topics).toEqual(["a", "b"]);
    expect(sanitizeForkArtifact(raw({ topics: "not-an-array" }))!.topics).toEqual([]);
  });

  it("forces the schema id to 'distill.map/0.2' regardless of a forged input schema", () => {
    expect(sanitizeForkArtifact(raw({ schema: "evil/9.9" }))!.schema).toBe("distill.map/0.2");
  });

  it("rebuilds provenance keeping only known fields, keeps accessed/source_key only when strings, and skips non-object entries", () => {
    const a = sanitizeForkArtifact(raw({
      provenance: [
        { source_title: "Paper", url: "https://x", source_type: "paper", license: "CC-BY-4.0",
          accessed: "2026-01-01", source_key: "web:x", tracker: "https://evil" },
        { source_title: "NoDates", url: "https://y", source_type: "web", license: "unknown",
          accessed: 123, source_key: null },
        "garbage",
        null,
      ],
    }))!;
    expect(a.provenance).toHaveLength(2);              // two non-object entries skipped
    expect("tracker" in a.provenance[0]).toBe(false); // unknown field stripped
    expect(a.provenance[0].accessed).toBe("2026-01-01");
    expect(a.provenance[0].source_key).toBe("web:x");
    expect("accessed" in a.provenance[1]).toBe(false);   // non-string accessed dropped
    expect("source_key" in a.provenance[1]).toBe(false); // non-string source_key dropped
  });
});
