import { describe, it, expect } from "vitest";
import {
  validateArtifact, transformCanvas, NODE_TEXT_CAP,
  type Canvas, type PublishMeta, type DistillMapArtifact,
} from "../publish-core";

/*
 * validateArtifact — the "defense in depth" structural re-check
 * (publish-core.ts §Validation). It re-validates an *assembled* artifact
 * (which may have been parsed/forged, not produced by transformCanvas), then
 * delegates the metadata half to validatePublishMeta.
 *
 * The validateArtifact block in publish-core.test.ts asserts only two things:
 * a good artifact returns [], and one bad-schema artifact returns length > 0.
 * These cases harden the branches it does NOT reach:
 *   - the message identifies the offending schema (not just "some error")
 *   - the map.format mismatch branch, incl. the String(undefined) coercion
 *     when map.format is absent
 *   - the per-node NODE_TEXT_CAP branch, named by node id, at the exact
 *     boundary (the contract is `>` not `>=`, so 280 passes / 281 fails)
 *   - defense-in-depth: independent structural + delegated meta errors all
 *     accumulate (no short-circuit), proving the validatePublishMeta hand-off
 *
 * Pure: no Obsidian/FS/network. Valid fixtures are built through
 * transformCanvas; invalid shapes are cast, mirroring the existing test's
 * `as unknown as DistillMapArtifact` pattern for data that intentionally
 * violates the declared interface.
 */

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
    { id: "n1", type: "text", x: 0, y: 0, width: 260, height: 120, text: "Design Inputs" },
    { id: "n2", type: "text", x: 300, y: 0, width: 260, height: 120, text: "Design Outputs" },
  ],
  edges: [],
  ...over,
});

/** A fully valid assembled artifact. */
const good = (): DistillMapArtifact => transformCanvas(canvas(), goodMeta(), "u").artifact;

/** Build an assembled artifact whose sole node carries `text` (bypasses no caps). */
const oneNode = (id: string, text: string): DistillMapArtifact =>
  transformCanvas(
    canvas({ nodes: [{ id, type: "text", x: 0, y: 0, width: 1, height: 1, text }], edges: [] }),
    goodMeta(),
    "u",
  ).artifact;

describe("validateArtifact — structural re-check (defense in depth)", () => {
  it("passes a fully assembled good artifact", () => {
    expect(validateArtifact(good())).toHaveLength(0);
  });

  it("flags an unexpected schema and names it", () => {
    const bad = { ...good(), schema: "distill.map/0.9" } as unknown as DistillMapArtifact;
    const errs = validateArtifact(bad);
    expect(errs.some((e) => /schema/i.test(e) && e.includes("distill.map/0.9"))).toBe(true);
  });

  it("flags an unexpected map.format and names it", () => {
    const a = good();
    const bad = { ...a, map: { ...a.map, format: "jsoncanvas/2.0" } } as unknown as DistillMapArtifact;
    expect(validateArtifact(bad).some((e) => /map\.format/i.test(e) && e.includes("jsoncanvas/2.0"))).toBe(true);
  });

  it("coerces a missing map.format to the string 'undefined' in the message", () => {
    const a = good();
    const bad = { ...a, map: { ...a.map, format: undefined } } as unknown as DistillMapArtifact;
    expect(validateArtifact(bad).some((e) => /map\.format/i.test(e) && e.includes("undefined"))).toBe(true);
  });

  it("flags a node over the cap and names the node id", () => {
    const errs = validateArtifact(oneNode("oops", "x".repeat(NODE_TEXT_CAP + 1)));
    expect(errs.some((e) => e.includes("oops") && /exceeds 280/.test(e))).toBe(true);
  });

  it("accepts a node at exactly the cap (boundary is > not >=)", () => {
    expect(validateArtifact(oneNode("edge", "x".repeat(NODE_TEXT_CAP)))).toHaveLength(0);
  });

  it("surfaces delegated meta errors when the structure is valid but a field is bad", () => {
    const bad = { ...good(), summary: "too short" } as DistillMapArtifact;
    expect(validateArtifact(bad).some((e) => /summary/i.test(e))).toBe(true);
  });

  it("accumulates independent structural and meta errors (no short-circuit)", () => {
    const base = transformCanvas(
      canvas({ nodes: [{ id: "huge", type: "text", x: 0, y: 0, width: 1, height: 1, text: "y".repeat(300) }], edges: [] }),
      goodMeta({ summary: "nope" }),
      "u",
    ).artifact;
    const bad = {
      ...base,
      schema: "distill.map/0.9",
      map: { ...base.map, format: "jsoncanvas/9.9" },
    } as unknown as DistillMapArtifact;
    const errs = validateArtifact(bad);
    expect(errs.length).toBeGreaterThanOrEqual(4);
    expect(errs.some((e) => /schema/i.test(e))).toBe(true);
    expect(errs.some((e) => /map\.format/i.test(e))).toBe(true);
    expect(errs.some((e) => e.includes("huge") && /exceeds 280/.test(e))).toBe(true);
    expect(errs.some((e) => /summary/i.test(e))).toBe(true);
  });
});
