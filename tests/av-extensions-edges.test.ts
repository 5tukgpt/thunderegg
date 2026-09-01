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

describe("Matroska/WebM — supported since the engine's own demuxer (2026-08-11)", () => {
  it("mkv and webm are A/V and convertible", () => {
    for (const ext of ["mkv", "webm"]) {
      expect(isAudioVideo(ext)).toBe(true);
      expect(isConvertible(ext)).toBe(true);
    }
  });
  it("is case-insensitive for them too, like every other extension", () => {
    expect(isAudioVideo("MKV")).toBe(true);
    expect(isAudioVideo("WebM")).toBe(true);
  });
});

describe("deliberately-refused container formats", () => {
  // convert.sh DOES route .avi/.wmv/.wma to transcribe, but only so it can name the container
  // and tell the user to convert it first. That is a better error message, not a conversion —
  // so offering a menu item for them would still promise something that always fails.
  it("avi/wmv/wma are neither A/V nor convertible", () => {
    for (const ext of ["avi", "wmv", "wma"]) {
      expect(isAudioVideo(ext)).toBe(false);
      expect(isConvertible(ext)).toBe(false);
    }
  });
  it("does not confuse webp (convertible image) with webm (now a supported video)", () => {
    expect(isConvertible("webp")).toBe(true);
    expect(isAudioVideo("webp")).toBe(false);
    expect(isAudioVideo("webm")).toBe(true);
  });
});
