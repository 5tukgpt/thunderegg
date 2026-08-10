import { describe, it, expect } from "vitest";
import {
  buildForkReceipt, sourceKey,
  type DistillMapArtifact, type ForkLineage, type ProvenanceEntry,
} from "../publish-core";

/**
 * buildForkReceipt — the zero-telemetry self-report a user pastes into Discord/
 * forums to show a fork (the demand-gate funnel's receipt). publish-fork.test.ts
 * covers ONE happy path (title + fingerprint + 12-char hash prefix + one source
 * key). These cases pin the four source-list contracts that path never reaches;
 * each is a regression that would ship a wrong or broken receipt silently. Pure
 * logic in publish-core.ts (no Obsidian, no native binding), so sandbox-provable
 * via `tsc --noEmit` + a node mirror — the vitest run itself is macOS-only.
 * (BACKLOG #1: broaden pure-JS coverage.)
 */

const lineage: ForkLineage = {
  client_uuid: "uuid-src",
  author_fingerprint: "abcd1234abcd1234",
  content_hash: "f".repeat(64),
};

const prov = (over: Partial<ProvenanceEntry> = {}): ProvenanceEntry => ({
  source_title: "S", url: "https://example.com/a",
  source_type: "webpage", license: "public-domain", ...over,
});

const artifact = (provenance: ProvenanceEntry[]): DistillMapArtifact => ({
  schema: "distill.map/0.2", client_uuid: "u", title: "Forked Map",
  summary: "S".repeat(200), topics: ["t"], visibility: "public",
  map: { format: "jsoncanvas/1.0", nodes: [], edges: [] },
  "x-distill": { nodes: {} },
  provenance, license: "CC-BY-4.0", distill_version: "1.x",
});

describe("buildForkReceipt — source-list contracts", () => {
  it("derives a source key from the url when the entry carries none", () => {
    const r = buildForkReceipt(artifact([prov({ url: "https://youtu.be/vidID123" })]), lineage);
    expect(r).toContain("- sources: `yt:vidID123`");   // sourceKey(url), source_key absent
  });

  it("uses a pre-set source_key VERBATIM, never re-deriving it from the url", () => {
    // the `p.source_key ?? sourceKey(p.url)` idiom: a fork keeps its origin key
    const r = buildForkReceipt(
      artifact([prov({ url: "https://youtu.be/deriveME", source_key: "doi:10.9/verbatim" })]),
      lineage,
    );
    expect(r).toContain("`doi:10.9/verbatim`");
    expect(r).not.toContain("yt:deriveME");            // the url was NOT consulted
  });

  it("drops an entry whose url normalizes to the bare `web:` sentinel", () => {
    // an empty/junk url has no identity key; emitting `web:` would be pure noise
    expect(sourceKey("")).toBe("web:");                // the exact value this filter guards
    const r = buildForkReceipt(
      artifact([prov({ url: "https://doi.org/10.1234/keep" }), prov({ url: "" })]),
      lineage,
    );
    expect(r).toContain("`doi:10.1234/keep`");
    expect(r).not.toContain("web:");                   // the meaningless key never appears
  });

  it("omits the entire sources line when no usable key remains", () => {
    const empty = buildForkReceipt(artifact([]), lineage);
    expect(empty).not.toContain("- sources:");
    expect(empty.split("\n")).toHaveLength(3);         // title + author + content only

    // every entry normalizes to the `web:` sentinel → still no sources line
    const junk = buildForkReceipt(artifact([prov({ url: "" }), prov({ url: "https://" })]), lineage);
    expect(junk).not.toContain("- sources:");
    expect(junk.split("\n")).toHaveLength(3);
  });

  it("lists multiple keys comma-joined and backticked, WITHOUT deduplicating", () => {
    const r = buildForkReceipt(artifact([
      prov({ url: "https://youtu.be/aaa" }),
      prov({ url: "https://youtu.be/bbb" }),
      prov({ url: "https://youtu.be/aaa" }),           // duplicate key — kept, order preserved
    ]), lineage);
    expect(r).toContain("- sources: `yt:aaa`, `yt:bbb`, `yt:aaa`");
    expect((r.match(/yt:aaa/g) ?? []).length).toBe(2); // no Set dedup
  });
});
