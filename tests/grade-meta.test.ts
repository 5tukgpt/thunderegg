import { describe, it, expect } from "vitest";
import { GRADE_META, VALID_GRADES, LEGACY_GRADES, normalizeGrade } from "../core";

/**
 * Pins the rock-ladder grade contract against the ENGINE's authority
 * (markdown-droplet helpers/promote.py: GRADES + LEGACY_GRADES).
 *
 * History this suite exists to prevent repeating: the previous version pinned the retired
 * still ladder (vapor/distillate/essence) and asserted that unrecognized grades render
 * nothing — so when the engine renamed the ladder on 2026-07-16, every engine-written grade
 * stopped badging and the suite stayed GREEN, actively certifying the bug. The "engine
 * vocabulary renders" cases below are the regression pin: they fail if the plugin ever
 * drifts from what the engine actually writes.
 */
describe("GRADE_META presentation (rock ladder)", () => {
  it("maps each rung to its documented label, icon and css class", () => {
    expect(GRADE_META.blank).toEqual({ label: "Blank", icon: "⬜", css: "blank" });
    expect(GRADE_META.rough).toEqual({ label: "Rough", icon: "\u{1FAA8}", css: "rough" });
    expect(GRADE_META.polished).toEqual({ label: "Polished", icon: "\u{1F539}", css: "polished" });
    expect(GRADE_META.crystal).toEqual({ label: "Crystal", icon: "\u{1F4A0}", css: "crystal" });
    expect(GRADE_META.gem).toEqual({ label: "Gem", icon: "\u{1F48E}", css: "gem" });
    expect(GRADE_META.synthesis).toEqual({ label: "Synthesis", icon: "🗺️", css: "synthesis" });
  });

  it("keeps VALID_GRADES and GRADE_META in lockstep (no drift)", () => {
    expect(new Set(Object.keys(GRADE_META))).toEqual(VALID_GRADES);
    for (const g of VALID_GRADES) {
      expect(GRADE_META[g]).toBeDefined();
      // css class must equal the grade key — styles.css targets the grade key
      expect(GRADE_META[g].css).toBe(g);
    }
  });

  it("REGRESSION: every value the current engine writes gets a badge", () => {
    // promote.py GRADES + moc.py's synthesis — a live vault carries exactly these.
    for (const g of ["blank", "rough", "polished", "crystal", "gem", "synthesis"]) {
      const n = normalizeGrade(g);
      expect(n).toBe(g);
      expect(GRADE_META[n!]).toBeDefined();
    }
  });

  it("legacy still-ladder values canonicalize and still badge (permanent read contract)", () => {
    // Mirrors promote.py LEGACY_GRADES exactly — old vaults must never stop badging.
    expect(LEGACY_GRADES).toEqual({
      vapor: "blank",
      crude: "rough",
      distillate: "polished",
      refined: "crystal",
      essence: "gem",
    });
    for (const [legacy, canon] of Object.entries(LEGACY_GRADES)) {
      expect(normalizeGrade(legacy)).toBe(canon);
      expect(GRADE_META[canon]).toBeDefined();
    }
  });

  it("normalizes case and surrounding whitespace, like the engine's canon_grade", () => {
    expect(normalizeGrade("Crystal")).toBe("crystal");
    expect(normalizeGrade("  gem ")).toBe("gem");
    expect(normalizeGrade("VAPOR")).toBe("blank");
  });

  it("renders no badge for unknown values or non-strings (display fails closed, not to blank)", () => {
    expect(normalizeGrade("gold")).toBeNull();
    expect(normalizeGrade("")).toBeNull();
    expect(normalizeGrade(null)).toBeNull();
    expect(normalizeGrade(42)).toBeNull();
    expect(GRADE_META["gold"]).toBeUndefined();
  });
});
