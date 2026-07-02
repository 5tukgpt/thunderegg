import { describe, it, expect } from "vitest";
import {
  isConvertible, shellQuote,
  emptyBondGraph, buildBondGraph, bondCount, isCondenser,
} from "../core";

/**
 * Edge/boundary cases the core.test.ts + grade-meta.test.ts suites don't pin.
 * All target pure logic in core.ts — no Obsidian, no native bindings — so they
 * are provable in the Linux sandbox. Each locks a behavior whose regression
 * would pass the existing suite silently. (BACKLOG #1: broaden core coverage.)
 */

describe("isConvertible — extension contract", () => {
  it("expects a bare extension: a leading dot or whitespace is NOT stripped", () => {
    // callers pass Obsidian's TFile.extension (no dot); ".pdf"/" pdf" must miss.
    expect(isConvertible(".pdf")).toBe(false);
    expect(isConvertible(" pdf")).toBe(false);
  });

  it("accepts the office + image formats core.test.ts omits", () => {
    // guards against a member being dropped from the CONVERTIBLE set.
    for (const ext of ["xlsx", "pptx", "csv", "json", "webp", "tiff"]) {
      expect(isConvertible(ext)).toBe(true);
    }
  });
});

describe("shellQuote — escaping composition", () => {
  it("quotes the empty string to a valid empty argument", () => {
    expect(shellQuote("")).toBe("''");
  });

  it("escapes EVERY single quote, not just the first (global replace)", () => {
    // a regression dropping the /g flag would still pass the single-quote case.
    expect(shellQuote("a'b'c")).toBe("'a'\\''b'\\''c'");
    expect(shellQuote("'")).toBe("''\\'''");
  });
});

describe("buildBondGraph — filtering & degenerate edges", () => {
  it("drops a bond whose TARGET is outside the vault root (uncovered branch)", () => {
    const g = buildBondGraph(
      { "notes/x.md": { "notes/y.md": 1, "external/z.md": 1 } },
      "notes/",
    );
    expect(g.outgoing.get("notes/x.md")).toEqual(new Set(["notes/y.md"]));
    expect(g.incoming.has("external/z.md")).toBe(false);
    expect(g.incoming.get("notes/y.md")).toEqual(new Set(["notes/x.md"]));
  });

  it("indexes a self-link in both directions (counts as two bonds)", () => {
    const g = buildBondGraph({ "notes/s.md": { "notes/s.md": 1 } }, "");
    expect(g.outgoing.get("notes/s.md")).toEqual(new Set(["notes/s.md"]));
    expect(g.incoming.get("notes/s.md")).toEqual(new Set(["notes/s.md"]));
    expect(bondCount(g, "notes/s.md")).toBe(2);
  });

  it("creates no entry for a source with zero resolved links", () => {
    const g = buildBondGraph({ "notes/lonely.md": {} }, "");
    expect(g.outgoing.has("notes/lonely.md")).toBe(false);
    expect(g.incoming.has("notes/lonely.md")).toBe(false);
    expect(bondCount(g, "notes/lonely.md")).toBe(0);
  });
});

describe("isCondenser — threshold floor", () => {
  it("treats threshold 0 as 'every note is a condenser', even a bond-less one", () => {
    expect(isCondenser(emptyBondGraph(), "anything.md", 0)).toBe(true);
  });
});
