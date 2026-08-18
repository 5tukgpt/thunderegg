import { describe, it, expect } from "vitest";
import { isAudioVideo, isConvertible, AV_EXTENSIONS, CONVERTIBLE } from "../core";

describe("isAudioVideo", () => {
  it("recognizes every documented A/V extension", () => {
    for (const ext of AV_EXTENSIONS) expect(isAudioVideo(ext)).toBe(true);
  });
  it("is case-insensitive, like isConvertible", () => {
    expect(isAudioVideo("MP3")).toBe(true);
    expect(isAudioVideo("Mov")).toBe(true);
    expect(isAudioVideo("M4A")).toBe(true);
  });
  it("separates recordings from convertible documents/images", () => {
    expect(isConvertible("pdf")).toBe(true);
    expect(isAudioVideo("pdf")).toBe(false);
    expect(isConvertible("png")).toBe(true);
    expect(isAudioVideo("png")).toBe(false);
  });
  it("is false for unknown/empty extensions", () => {
    expect(isAudioVideo("xyz")).toBe(false);
    expect(isAudioVideo("")).toBe(false);
  });
});

describe("A/V ⊆ convertible invariant", () => {
  it("every A/V extension is also convertible (pins the ...AV_EXTENSIONS spread in CONVERTIBLE)", () => {
    for (const ext of AV_EXTENSIONS) expect(isConvertible(ext)).toBe(true);
    for (const ext of AV_EXTENSIONS) expect(CONVERTIBLE.has(ext)).toBe(true);
  });
});

describe("deliberately-refused container formats", () => {
  it("mkv/webm/avi/wmv are neither A/V nor convertible", () => {
    for (const ext of ["mkv", "webm", "avi", "wmv"]) {
      expect(isAudioVideo(ext)).toBe(false);
      expect(isConvertible(ext)).toBe(false);
    }
  });
  it("does not confuse webp (convertible image) with webm (refused video)", () => {
    expect(isConvertible("webp")).toBe(true);
    expect(isConvertible("webm")).toBe(false);
    expect(isAudioVideo("webp")).toBe(false);
  });
});
