import { describe, it, expect } from "vitest";
import {
  isConvertible, shellQuote, normalizeGrade, GRADE_META,
  emptyBondGraph, buildBondGraph, bondCount, isCondenser,
  referencingCondensers,
} from "../core";

describe("isConvertible", () => {
  it("accepts known extensions regardless of case", () => {
    expect(isConvertible("pdf")).toBe(true);
    expect(isConvertible("PDF")).toBe(true);
    expect(isConvertible("Docx")).toBe(true);
    expect(isConvertible("heic")).toBe(true);
  });

  it("rejects unknown extensions", () => {
    expect(isConvertible("md")).toBe(false);
    expect(isConvertible("exe")).toBe(false);
    expect(isConvertible("")).toBe(false);
  });
});

describe("shellQuote", () => {
  it("wraps plain strings in single quotes", () => {
    expect(shellQuote("file.pdf")).toBe("'file.pdf'");
  });

  it("preserves spaces and shell metacharacters", () => {
    expect(shellQuote("My File (v2).pdf")).toBe("'My File (v2).pdf'");
    expect(shellQuote("$HOME;rm -rf *")).toBe("'$HOME;rm -rf *'");
  });

  it("escapes embedded single quotes POSIX-style", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe("normalizeGrade", () => {
  it("accepts the three valid grades", () => {
    for (const g of ["vapor", "distillate", "essence"]) {
      expect(normalizeGrade(g)).toBe(g);
    }
  });

  it("rejects invalid or non-string values", () => {
    expect(normalizeGrade("gold")).toBeNull();
    expect(normalizeGrade("Vapor")).toBeNull(); // case-sensitive
    expect(normalizeGrade(undefined)).toBeNull();
    expect(normalizeGrade(3)).toBeNull();
    expect(normalizeGrade(["vapor"])).toBeNull();
  });

  it("every valid grade has display metadata", () => {
    for (const g of ["vapor", "distillate", "essence"]) {
      expect(GRADE_META[g]).toBeDefined();
      expect(GRADE_META[g].label.length).toBeGreaterThan(0);
    }
  });
});

/* ── Bond graph ───────────────────────────────────────────────────── */

/** resolvedLinks fixture: a → b, a → c, b → c, hub → a/b/c/d/e */
const RESOLVED: Record<string, Record<string, number>> = {
  "notes/a.md": { "notes/b.md": 1, "notes/c.md": 2 },
  "notes/b.md": { "notes/c.md": 1 },
  "notes/hub.md": {
    "notes/a.md": 1, "notes/b.md": 1, "notes/c.md": 1,
    "notes/d.md": 1, "notes/e.md": 1,
  },
  "inbox/stray.md": { "notes/a.md": 1 },
};

describe("buildBondGraph", () => {
  it("indexes outgoing and incoming directed bonds", () => {
    const g = buildBondGraph(RESOLVED, "");
    expect(g.outgoing.get("notes/a.md")).toEqual(new Set(["notes/b.md", "notes/c.md"]));
    expect(g.incoming.get("notes/c.md")).toEqual(
      new Set(["notes/a.md", "notes/b.md", "notes/hub.md"]),
    );
  });

  it("counts each linked pair once even with multiple link occurrences", () => {
    // a → c has weight 2 in resolvedLinks but is a single bond
    const g = buildBondGraph(RESOLVED, "");
    expect(g.outgoing.get("notes/a.md")!.has("notes/c.md")).toBe(true);
    expect(g.outgoing.get("notes/a.md")!.size).toBe(2);
  });

  it("filters both source and target by vault root prefix", () => {
    const g = buildBondGraph(RESOLVED, "notes/");
    expect(g.outgoing.has("inbox/stray.md")).toBe(false);
    expect(g.incoming.get("notes/a.md")).toEqual(new Set(["notes/hub.md"]));
  });

  it("returns an empty graph for empty input", () => {
    const g = buildBondGraph({}, "");
    expect(g.outgoing.size).toBe(0);
    expect(g.incoming.size).toBe(0);
  });
});

describe("bondCount / isCondenser / referencingCondensers", () => {
  const g = buildBondGraph(RESOLVED, "");

  it("bond count = outgoing + incoming", () => {
    // a: out {b, c}, in {hub, stray} → 4
    expect(bondCount(g, "notes/a.md")).toBe(4);
    // d: out none, in {hub} → 1
    expect(bondCount(g, "notes/d.md")).toBe(1);
    expect(bondCount(g, "notes/unknown.md")).toBe(0);
  });

  it("flags condensers at the threshold boundary", () => {
    // hub: out 5, in 0 → 5 bonds
    expect(isCondenser(g, "notes/hub.md", 5)).toBe(true);
    expect(isCondenser(g, "notes/hub.md", 6)).toBe(false);
    expect(isCondenser(g, "notes/d.md", 5)).toBe(false);
  });

  it("lists only condenser notes that link to the file", () => {
    // a is linked from hub (5 bonds) and stray (1 bond); threshold 5 → only hub
    expect(referencingCondensers(g, "notes/a.md", 5)).toEqual(["notes/hub.md"]);
    // threshold 1 → both qualify
    expect(new Set(referencingCondensers(g, "notes/a.md", 1))).toEqual(
      new Set(["notes/hub.md", "inbox/stray.md"]),
    );
    // no incoming links at all
    expect(referencingCondensers(g, "notes/hub.md", 1)).toEqual([]);
  });

  it("emptyBondGraph yields zero counts", () => {
    const e = emptyBondGraph();
    expect(bondCount(e, "x.md")).toBe(0);
    expect(isCondenser(e, "x.md", 1)).toBe(false);
    expect(referencingCondensers(e, "x.md", 1)).toEqual([]);
  });
});
