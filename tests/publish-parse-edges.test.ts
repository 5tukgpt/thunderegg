import { describe, it, expect } from "vitest";
import {
  transformCanvas, buildSidecar, parseSidecarSignature,
  buildAttributionNote, parseLineageFrontmatter,
  type Canvas, type PublishMeta, type ForkLineage,
} from "../publish-core";

// Minimal fixtures (mirrors publish-core.test.ts / publish-fork.test.ts).
const goodMeta = (): PublishMeta => ({
  title: "Design Controls",
  summary: "A".repeat(200),
  topics: ["medtech"],
  visibility: "public",
  license: "user-generated",
  provenance: [{
    source_title: "FDA", url: "https://www.fda.gov/x",
    source_type: "government-publication", license: "public-domain",
  }],
  distill_version: "1.x",
});
const canvas = (): Canvas => ({
  nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 260, height: 120, text: "Design Inputs" }],
  edges: [],
});
const artifact = () => transformCanvas(canvas(), goodMeta(), "u").artifact;

const sig = { algo: "ed25519", public_key: "PK_B64", signature: "SG_B64" };
const lineage: ForkLineage = {
  client_uuid: "uuid-src",
  author_fingerprint: "abcd1234abcd1234",
  content_hash: "f".repeat(64),
};
const attributionNote = () => buildAttributionNote({
  displayTitle: "Forked Map", canvasName: "Forked Map", forkedFrom: "uuid-src",
  author: lineage.author_fingerprint, license: "CC-BY-4.0",
  sourceUrl: "Thunderegg Exports/Forked Map.distill.json", lineage,
});

// Drop the one frontmatter line whose key is `key` from real builder output.
// `startsWith("signature:")` matches only the bare `signature:` line, never
// `signature_algo:` (which starts with `signature_`) — the exact distinction
// the parser's `^signature:` anchor relies on.
const dropLine = (md: string, key: string): string =>
  md.split("\n").filter((l) => !l.startsWith(`${key}:`)).join("\n");

describe("parseSidecarSignature — all-three-or-null contract", () => {
  it("returns null when the bare `signature:` line is absent, proving `signature_algo:` is not mistaken for it", () => {
    const truncated = dropLine(buildSidecar(artifact(), sig), "signature");
    expect(truncated).toContain("signature_algo: ed25519"); // algo line survives
    expect(truncated).not.toMatch(/^signature: /m);         // bare signature line gone
    expect(parseSidecarSignature(truncated)).toBeNull();     // partial block => null, not a partial object
  });

  it("returns null when `public_key:` is absent", () => {
    expect(parseSidecarSignature(dropLine(buildSidecar(artifact(), sig), "public_key"))).toBeNull();
  });

  it("returns null when `signature_algo:` is absent", () => {
    expect(parseSidecarSignature(dropLine(buildSidecar(artifact(), sig), "signature_algo"))).toBeNull();
  });

  it("returns null on a lineage note that carries no signature_* fields", () => {
    expect(parseSidecarSignature(attributionNote())).toBeNull();
  });
});

describe("parseLineageFrontmatter — all-three-or-null contract", () => {
  it("returns null when `lineage_content_hash:` is absent", () => {
    expect(parseLineageFrontmatter(dropLine(attributionNote(), "lineage_content_hash"))).toBeNull();
  });

  it("returns null when `lineage_author_fingerprint:` is absent", () => {
    expect(parseLineageFrontmatter(dropLine(attributionNote(), "lineage_author_fingerprint"))).toBeNull();
  });

  it("returns null on a signed sidecar that carries no lineage_* fields", () => {
    expect(parseLineageFrontmatter(buildSidecar(artifact(), sig))).toBeNull();
  });
});
