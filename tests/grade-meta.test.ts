import { describe, it, expect } from "vitest";
import { GRADE_META, VALID_GRADES, normalizeGrade } from "../core";

/**
 * TESTING.md section 4 "Grade badges" pins the exact badge each grade renders:
 *   grade: vapor      -> cloud (U+2601 U+FE0F) "Vapor"      css: vapor      (grey)
 *   grade: distillate -> drop  (U+1F4A7)       "Distillate" css: distillate (blue)
 *   grade: essence    -> gem   (U+1F48E)       "Essence"    css: essence    (purple)
 * core.test.ts only checks GRADE_META[g] exists with a non-empty label, so a
 * regression that swapped an icon or css class would ship a wrong/un-styled
 * badge undetected. These cases lock the documented mapping and the
 * VALID_GRADES <-> GRADE_META parity the badge renderer depends on.
 */
describe("GRADE_META presentation (TESTING.md #4)", () => {
  it("maps each grade to its documented label, icon and css class", () => {
    expect(GRADE_META.vapor).toEqual({ label: "Vapor", icon: "☁️", css: "vapor" });
    expect(GRADE_META.distillate).toEqual({ label: "Distillate", icon: "\u{1F4A7}", css: "distillate" });
    expect(GRADE_META.essence).toEqual({ label: "Essence", icon: "\u{1F48E}", css: "essence" });
  });

  it("keeps VALID_GRADES and GRADE_META in lockstep (no drift)", () => {
    expect(new Set(Object.keys(GRADE_META))).toEqual(VALID_GRADES);
    for (const g of VALID_GRADES) {
      expect(GRADE_META[g]).toBeDefined();
      // css class must equal the grade key — styles.css targets the grade key
      expect(GRADE_META[g].css).toBe(g);
    }
  });

  it("renders a badge only for a normalized grade", () => {
    expect(normalizeGrade("gold")).toBeNull();
    expect(GRADE_META["gold"]).toBeUndefined();
  });
});
