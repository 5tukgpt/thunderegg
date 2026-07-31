import { describe, it, expect } from "vitest";
import { sourceKey } from "../publish-core";

/*
 * sourceKey edges — the overlap-corpus join key (publish-core.ts §Helpers).
 *
 * sourceKey is THE key the "who distilled which source" overlap corpus joins
 * on (publish-core.ts:227-236). It is derived on-device and carried in every
 * exported map, so a same-source pair that keys *differently* silently
 * fragments the corpus, and a different-source pair that keys the *same*
 * wrongly merges it — both are invisible until the network graph is wrong.
 *
 * The sourceKey block in publish-core.test.ts is a happy-path table. These
 * pin the branches that table does NOT reach:
 *   - the DOI trailing-punctuation class beyond the tested `).` / `/`
 *     (bracketed / reference-list citation paste), and that the strip is
 *     anchored to the END only (interior punctuation of a real DOI survives);
 *   - query-param first-occurrence dedup — the documented "no decoding,
 *     first-occurrence" contract of the param parser;
 *   - param NAME folded to canonical case while the VALUE case is preserved
 *     (the tested `ID=9` case is numeric and can't show value-preservation);
 *   - registry-ladder fallthrough: a malformed yt / pmid URL degrades to a
 *     `web:` key, never emitting a broken `yt:` / `pmid:` / `yt:undefined`.
 *
 * All expectations were verified against the real compiled publish-core.ts
 * before being written (see lego-loop/reports/2026-07-19.md). vitest itself
 * is macOS-only in this repo (rolldown native binding); the in-sandbox proof
 * is a node:assert mirror of these same assertions.
 */

describe("sourceKey — edge contracts", () => {
  it("doi: strips every trailing-punctuation class member, not just the tested `).`/`/`", () => {
    // Citations get pasted with a trailing bracket / comma / semicolon; the
    // SAME DOI must still collapse to one key regardless of the stray char.
    for (const punct of [",", ";", ":", "!", "]"]) {
      expect(sourceKey(`https://doi.org/10.1234/abc${punct}`)).toBe("doi:10.1234/abc");
    }
    // The strip is anchored at the end only — interior punctuation of a real
    // DOI (dots are ubiquitous in DOI suffixes) must NOT be mangled.
    expect(sourceKey("https://doi.org/10.1234/a.b.c")).toBe("doi:10.1234/a.b.c");
  });

  it("web: dedups query params to the first occurrence (documented no-decode contract)", () => {
    expect(sourceKey("https://example.com/x?id=1&id=2")).toBe("web:example.com/x?id=1");
    // First-occurrence means input order is significant, so the two do NOT
    // collapse to one key — pins that the parser is order-sensitive by design.
    expect(sourceKey("https://example.com/x?id=1&id=2"))
      .not.toBe(sourceKey("https://example.com/x?id=2&id=1"));
  });

  it("web: folds the param NAME to canonical case but preserves the VALUE case", () => {
    // `ID` → canonical `id`, but `AbC` is kept verbatim: identity-bearing ids
    // can be case-sensitive, so lowercasing the value would merge distinct docs.
    expect(sourceKey("https://example.com/x?ID=AbC")).toBe("web:example.com/x?id=AbC");
    // host + path fold to lower; the kept param value still survives untouched.
    expect(sourceKey("https://EXAMPLE.com/PaTH?article=KeepCase"))
      .toBe("web:example.com/path?article=KeepCase");
  });

  it("registry ladder degrades a malformed yt/pmid URL to web:, never a broken namespace key", () => {
    // A watch URL missing ?v must not become `yt:` / `yt:undefined`.
    expect(sourceKey("https://youtube.com/watch?list=PLxyz")).toBe("web:youtube.com/watch");
    expect(sourceKey("https://www.youtube.com/watch")).toBe("web:youtube.com/watch");
    // The pmid ladder is strict (`^/<digits>$`): a non-canonical path is not
    // a PubMed id, so it falls through to web: rather than a bogus pmid:.
    expect(sourceKey("https://pubmed.ncbi.nlm.nih.gov/31452104/comments"))
      .toBe("web:pubmed.ncbi.nlm.nih.gov/31452104/comments");
    expect(sourceKey("https://pubmed.ncbi.nlm.nih.gov/abc"))
      .toBe("web:pubmed.ncbi.nlm.nih.gov/abc");
  });
});
