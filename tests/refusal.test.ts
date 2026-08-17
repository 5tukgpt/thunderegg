import { describe, it, expect } from "vitest";
import { isTrialExhaustedError, isUnlicensedError, isNoOcrError,
         TRIAL_TOKEN, UNLICENSED_TOKEN } from "../core";

// The plugin reported EVERY engine failure as "Is the Thunderegg app installed?" — false when
// the engine is installed and simply refused, and it left the refusal notice in the vault
// looking like a converted note. These pin that each refusal is recognised as itself.
describe("licence and trial refusals", () => {
  it("recognises an exhausted trial", () => {
    expect(isTrialExhaustedError({ stderr: `${TRIAL_TOKEN}\n` })).toBe(true);
  });
  it("recognises an unlicensed install", () => {
    expect(isUnlicensedError({ stderr: `${UNLICENSED_TOKEN}\n` })).toBe(true);
  });
  it("does NOT confuse the two — a trial user has no key to paste", () => {
    expect(isUnlicensedError({ stderr: `${TRIAL_TOKEN}\n` })).toBe(false);
    expect(isTrialExhaustedError({ stderr: `${UNLICENSED_TOKEN}\n` })).toBe(false);
  });
  it("does not fire on an ordinary failure or on the OCR token", () => {
    for (const e of [{ stderr: "boom" }, { stderr: "DISTILL_NO_OCR" }, {}, null, undefined, "x"]) {
      expect(isTrialExhaustedError(e)).toBe(false);
      expect(isUnlicensedError(e)).toBe(false);
    }
    expect(isNoOcrError({ stderr: "DISTILL_NO_OCR" })).toBe(true);
  });
});
