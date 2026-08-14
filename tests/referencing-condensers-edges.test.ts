import { describe, it, expect } from "vitest";
import { buildBondGraph, referencingCondensers } from "../core";

/**
 * Edge/boundary cases for referencingCondensers that core.test.ts's
 * "lists only condenser notes that link to the file" block leaves unpinned.
 * That block covers the happy-path filter (threshold 5 vs 1) and the
 * no-incoming guard (hub / emptyBondGraph → []). It never exercises:
 *   (a) the OTHER empty result — a file WITH referrers where none clear the
 *       threshold, i.e. the .filter() path, distinct from `if (!incoming) []`;
 *   (b) the >= source-threshold boundary THROUGH referencingCondensers
 *       (core.test.ts pins >= on isCondenser directly, never via this fn);
 *   (c) a self-linking condenser listing itself.
 * All target pure logic in core.ts — no Obsidian, no native bindings — so
 * they are provable in the Linux sandbox. (BACKLOG #1: broaden core coverage.)
 */

describe("referencingCondensers — empty result is not only the no-incoming guard", () => {
  // t is a fan-out condenser (out {a,b,c}=3, in {leaf}=1 → 4 bonds), but its
  // sole referrer `leaf` is a 1-bond leaf. The filter keys on the SOURCE's
  // bond count, never the target's own.
  const g = buildBondGraph(
    {
      "t.md": { "a.md": 1, "b.md": 1, "c.md": 1 },
      "leaf.md": { "t.md": 1 },
    },
    "",
  );

  it("returns [] when the file HAS referrers but none clear the threshold", () => {
    // distinct code path from the guard: t.md has a non-empty incoming set,
    // the .filter() just yields nothing — a regression returning [...incoming]
    // unconditionally would pass every existing case but fail here.
    expect(g.incoming.get("t.md")).toEqual(new Set(["leaf.md"]));
    expect(referencingCondensers(g, "t.md", 4)).toEqual([]);
  });

  it("keys the filter on the referrer's count, not the target's own", () => {
    // t is itself a condenser at threshold 4, yet that never promotes its
    // non-condenser referrer. Drop the threshold to 1 and the same leaf now
    // qualifies — proof the gate is on `leaf`, not on `t`.
    expect(referencingCondensers(g, "t.md", 1)).toEqual(["leaf.md"]);
  });
});

describe("referencingCondensers — source-threshold >= boundary", () => {
  // src → {t, p}: src has 2 outgoing bonds, 0 incoming → bondCount 2.
  // t's only referrer is src.
  const g = buildBondGraph({ "src.md": { "t.md": 1, "p.md": 1 } }, "");

  it("includes a referrer whose bond count exactly equals the threshold (>=, not >)", () => {
    expect(referencingCondensers(g, "t.md", 2)).toEqual(["src.md"]);
  });

  it("excludes that same referrer one above its bond count", () => {
    expect(referencingCondensers(g, "t.md", 3)).toEqual([]);
  });
});

describe("referencingCondensers — self-linking condenser", () => {
  // x links to itself and to y: outgoing {x, y}=2, incoming {x}=1 → 3 bonds.
  // x's incoming set contains x, and x clears the threshold, so x is returned
  // as its own referencing condenser.
  const g = buildBondGraph({ "x.md": { "x.md": 1, "y.md": 1 } }, "");

  it("lists a self-linking note as its own referencing condenser", () => {
    expect(referencingCondensers(g, "x.md", 3)).toEqual(["x.md"]);
  });

  it("still respects the threshold for the self-reference", () => {
    expect(referencingCondensers(g, "x.md", 4)).toEqual([]);
  });
});
