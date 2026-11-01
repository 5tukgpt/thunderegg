import { describe, it, expect } from "vitest";
import { buildBondGraph, bondCount } from "../core";

/* Settings → "Vault root for bond discovery" tells the user to type a folder name like
   "Notes". The filter used to be a raw string prefix, so "Notes" also matched "Notes Archive/"
   and "Notes2/" — those notes leaked into every bond count. */

const RESOLVED: Record<string, Record<string, number>> = {
  "Notes/a.md": { "Notes/b.md": 1, "Notes Archive/old.md": 1 },
  "Notes/b.md": { "Notes/a.md": 1 },
  "Notes Archive/old.md": { "Notes/a.md": 1 },
  "Notes2/x.md": { "Notes/a.md": 1 },
  "Inbox/y.md": { "Notes/a.md": 1 },
};

describe("buildBondGraph — vault root is a folder, not a string prefix", () => {
  it('"Notes" does not pull in sibling folders that merely start with "Notes"', () => {
    const g = buildBondGraph(RESOLVED, "Notes");
    expect([...g.outgoing.keys()].sort()).toEqual(["Notes/a.md", "Notes/b.md"]);
    expect(g.incoming.get("Notes/a.md")).toEqual(new Set(["Notes/b.md"]));
    expect(bondCount(g, "Notes/a.md")).toBe(2);   // out {b} + in {b}
  });

  it('"Notes", "Notes/", "/Notes/" and " Notes " all mean the same folder', () => {
    const want = buildBondGraph(RESOLVED, "Notes");
    for (const root of ["Notes/", "/Notes/", " Notes ", "Notes//"]) {
      const g = buildBondGraph(RESOLVED, root);
      expect(g.outgoing).toEqual(want.outgoing);
      expect(g.incoming).toEqual(want.incoming);
    }
  });

  it("a nested root works on a folder boundary too", () => {
    const g = buildBondGraph({
      "a/b/1.md": { "a/b/2.md": 1, "a/bc/3.md": 1 },
      "a/bc/3.md": { "a/b/1.md": 1 },
    }, "a/b");
    expect(g.outgoing.get("a/b/1.md")).toEqual(new Set(["a/b/2.md"]));
    expect(g.outgoing.has("a/bc/3.md")).toBe(false);
  });

  it("empty or slash-only root means the whole vault", () => {
    for (const root of ["", "  ", "/"]) {
      expect(buildBondGraph(RESOLVED, root).outgoing.size).toBe(5);
    }
  });
});
