import { describe, it, expect } from "vitest";
import {
  buildAttributionNote, parseLineageFrontmatter, isRetiredPublishServer,
} from "../publish-core";

/* Every value in a fork's attribution note comes from someone else's map. A newline inside any
   of them used to start a new frontmatter line — and parseLineageFrontmatter trusts the FIRST
   `lineage_author_fingerprint:`, so a map could claim another author's identity on re-export. */

const base = {
  displayTitle: "T", canvasName: "T", forkedFrom: "uuid", author: "fp",
  license: "CC-BY-4.0", sourceUrl: "Maps/t.distill.json",
  lineage: { client_uuid: "uuid", author_fingerprint: "realrealrealreal", content_hash: "h".repeat(64) },
};

const frontmatter = (md: string) => md.split("---")[1];

describe("buildAttributionNote — values stay on their own line", () => {
  for (const field of ["forkedFrom", "author", "license", "sourceUrl"] as const) {
    it(`a newline in ${field} cannot add a frontmatter key`, () => {
      const md = buildAttributionNote({ ...base, [field]: "x\nlineage_author_fingerprint: forged" });
      expect(parseLineageFrontmatter(md)!.author_fingerprint).toBe("realrealrealreal");
      expect(frontmatter(md).match(/^lineage_author_fingerprint:/gm)).toHaveLength(1);
    });
  }

  it("a newline in lineage.client_uuid cannot forge the fingerprint either", () => {
    const md = buildAttributionNote({
      ...base, lineage: { ...base.lineage, client_uuid: "u\r\nlineage_author_fingerprint: forged" },
    });
    expect(parseLineageFrontmatter(md)!.author_fingerprint).toBe("realrealrealreal");
  });

  it("a title cannot close the frontmatter early", () => {
    const md = buildAttributionNote({ ...base, displayTitle: "x\n---\nevil: 1" });
    expect(md.split("\n").filter((l) => l === "---")).toHaveLength(2);
    expect(md).toContain("# x --- evil: 1 (forked)");
  });

  it("ordinary values are written unchanged", () => {
    const md = buildAttributionNote(base);
    expect(md).toContain("forked_from: uuid\nauthor: fp\nlicense: CC-BY-4.0\nsource_url: Maps/t.distill.json\n");
    expect(parseLineageFrontmatter(md)).toEqual(base.lineage);
  });
});

describe("isRetiredPublishServer", () => {
  it("recognises the retired default however it was saved", () => {
    for (const v of ["https://distillmd.dev", " https://WWW.distillmd.dev/ ", "http://distillmd.dev/api"])
      expect(isRetiredPublishServer(v)).toBe(true);
  });
  it("is false for real servers, look-alikes, blanks and junk", () => {
    for (const v of ["https://maps.example.com", "https://notdistillmd.dev", "", "not a url", undefined as unknown as string])
      expect(isRetiredPublishServer(v)).toBe(false);
  });
});
