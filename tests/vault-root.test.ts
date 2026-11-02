import { describe, it, expect } from "vitest";
import { buildBondGraph, isUnderRoot, insideVaultRelative } from "../core";

describe("isUnderRoot — vault root is a folder, not a string prefix", () => {
  it("treats empty / slash-only root as the whole vault", () => {
    for (const r of ["", "/", "//"]) expect(isUnderRoot("any/x.md", r)).toBe(true);
  });
  it("accepts 'Notes', 'Notes/' and '/Notes/' as the same folder", () => {
    for (const r of ["Notes", "Notes/", "/Notes/"]) {
      expect(isUnderRoot("Notes/a.md", r)).toBe(true);
      expect(isUnderRoot("Notes/sub/b.md", r)).toBe(true);
    }
  });
  it("does NOT capture look-alike siblings (regression)", () => {
    expect(isUnderRoot("Notes Archive/a.md", "Notes")).toBe(false);
    expect(isUnderRoot("Notes.md", "Notes")).toBe(false);
    expect(isUnderRoot("Notesy/a.md", "Notes")).toBe(false);
  });
  it("supports nested roots", () => {
    expect(isUnderRoot("Work/Notes/a.md", "Work/Notes")).toBe(true);
    expect(isUnderRoot("Work/NotesX/a.md", "Work/Notes")).toBe(false);
  });
});

describe("buildBondGraph with a root typed the way the settings hint suggests ('Notes')", () => {
  const resolved = {
    "Notes/a.md": { "Notes/b.md": 1, "Notes Archive/old.md": 1 },
    "Notes Archive/old.md": { "Notes/a.md": 1 },
  };
  it("excludes bonds to and from a sibling folder sharing the prefix", () => {
    const g = buildBondGraph(resolved, "Notes");
    expect(g.outgoing.get("Notes/a.md")).toEqual(new Set(["Notes/b.md"]));
    expect(g.outgoing.has("Notes Archive/old.md")).toBe(false);
    expect(g.incoming.has("Notes/a.md")).toBe(false);
  });
});

describe("insideVaultRelative — engine-reported note paths", () => {
  it("keeps paths inside the vault", () => {
    expect(insideVaultRelative("Inbox/report.md", false)).toBe("Inbox/report.md");
  });
  it("drops the vault folder itself, parent hops and absolute paths", () => {
    expect(insideVaultRelative("", false)).toBeNull();
    expect(insideVaultRelative("..", false)).toBeNull();
    expect(insideVaultRelative("../elsewhere/x.md", false)).toBeNull();
    expect(insideVaultRelative("/abs/x.md", true)).toBeNull();
  });
  it("keeps a file whose name merely starts with '..' (regression)", () => {
    expect(insideVaultRelative("..notes.md", false)).toBe("..notes.md");
    expect(insideVaultRelative("...draft/x.md", false)).toBe("...draft/x.md");
  });
  it("honours a platform separator", () => {
    expect(insideVaultRelative("..\\x.md", false, "\\")).toBeNull();
  });
});
