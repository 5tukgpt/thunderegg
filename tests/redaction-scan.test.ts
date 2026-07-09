import { describe, it, expect } from "vitest";
import {
  redactionScan, transformCanvas, DEFAULT_BLOCKED_ZONES,
  type Canvas, type PublishMeta,
} from "../publish-core";

/*
 * redactionScan — the on-device pre-publish privacy gate
 * (publish-core.ts §"Redaction / zone / PII gate").
 *
 * The redactionScan block in publish-core.test.ts covers a blocked topic, a
 * blocked #tag in a *node*, node-body PII, a clean artifact, and a custom zone.
 * These cases harden the branches it does NOT reach:
 *   - a blocked #tag in the *title* (a distinct scanned source)
 *   - case-insensitive, #-agnostic zone normalization (normTag)
 *   - PII found in *metadata* (summary / provenance titles), each a distinct
 *     piiSources surface with its own `where` label
 *   - the two-tier contract: a zone hit is a HARD `block`, PII is a SOFT
 *     `warning`, and the two are independent (the RedactionResult design).
 *
 * Pure: no Obsidian/FS/network. Fixtures are built through transformCanvas so
 * they are always valid distill.map/0.2 artifacts.
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

const artifact = (over: Partial<PublishMeta> = {}, can: Canvas = canvas()) =>
  transformCanvas(can, goodMeta(over), "u").artifact;

describe("redactionScan — zone match beyond node text", () => {
  it("blocks a blocked #tag embedded in the TITLE (a distinct scanned source)", () => {
    const r = redactionScan(artifact({ title: "Recovery plan #private" }));
    expect(r.blocks.some((b) => b.includes("#private") && b.includes("title"))).toBe(true);
  });

  it("matches zones case-insensitively (Health topic and #WORK tag both block)", () => {
    expect(redactionScan(artifact({ topics: ["Health"] })).blocks.length).toBeGreaterThan(0);
    expect(
      redactionScan(artifact({ title: "Notes #WORK" })).blocks.some((b) => b.includes("#WORK")),
    ).toBe(true);
  });

  it("normalizes '#' on both sides — a bare custom zone matches a #tag", () => {
    const r = redactionScan(artifact({ title: "ref #clientx" }), ["clientx"]);
    expect(r.blocks.some((b) => b.includes("#clientx"))).toBe(true);
  });
});

describe("redactionScan — PII across metadata surfaces", () => {
  it("warns on an email in the summary (metadata, not just node text)", () => {
    const r = redactionScan(artifact({ summary: "reach me at jane@example.com " + "A".repeat(180) }));
    expect(r.warnings.some((w) => w.includes("email") && w.includes("summary"))).toBe(true);
  });

  it("warns on a phone number in a provenance source_title", () => {
    const r = redactionScan(artifact({
      provenance: [{
        source_title: "call notes +1 415 555 1212",
        url: "https://www.fda.gov/x",
        source_type: "government-publication",
        license: "public-domain",
      }],
    }));
    expect(r.warnings.some((w) => w.includes("phone") && w.includes("provenance"))).toBe(true);
  });

  it("warns on a URL in scanned text (the RE_URL branch)", () => {
    const r = redactionScan(artifact({ summary: "see https://tracker.example/p " + "A".repeat(180) }));
    expect(r.warnings.some((w) => w.includes("URL"))).toBe(true);
  });
});

describe("redactionScan — two-tier blocks-vs-warnings contract", () => {
  it("a zone hit is a HARD block and stays clean of PII noise", () => {
    const r = redactionScan(artifact({ topics: ["work"] }));
    expect(r.blocks.length).toBeGreaterThan(0);
    expect(r.warnings).toHaveLength(0);
  });

  it("PII is a SOFT warning only — it does not hard-block publish", () => {
    const r = redactionScan(artifact({ summary: "mail jane@example.com " + "A".repeat(180) }));
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.blocks).toHaveLength(0);
  });

  it("accumulates every distinct zone hit (matches are not collapsed)", () => {
    const r = redactionScan(artifact({ topics: ["health", "work"], title: "plan #private" }));
    expect(r.blocks.length).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_BLOCKED_ZONES).toContain("#health");
  });
});
