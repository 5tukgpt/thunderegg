import { describe, it, expect } from "vitest";
import { CONVERTIBLE, isConvertible } from "../core";

/* Formats the ENGINE converts that the plugin must offer a menu item for.
 *
 * Each was verified by invoking the deployed convert.sh on a real file in a temp dir:
 * exit 0 and a non-empty note. `.txt` and `.jsonl` were missing until 2026-09-03 — a user
 * right-clicked a .txt attachment and got no menu item at all, and folder conversion skipped
 * them without counting them. The plugin's OWN clipboard path writes a .txt precisely because
 * the engine handles it, so the omission contradicted the plugin's own behaviour.
 *
 * This list is deliberately hand-maintained: the test suite cannot read convert.sh, so the
 * cost of drift is a human re-checking the engine. Add an entry only after actually running
 * the engine on that extension. */
const ENGINE_CONVERTS = [
  "pdf", "docx", "doc", "rtf",
  "xlsx", "xls", "pptx",
  "html", "htm",
  "csv", "json", "jsonl", "txt",
  "eml", "msg",
  "png", "jpg", "jpeg", "tiff", "tif", "heic", "gif", "bmp", "webp",
];

describe("engine/plugin format parity", () => {
  it("offers a menu item for every format the engine converts", () => {
    const missing = ENGINE_CONVERTS.filter((e) => !CONVERTIBLE.has(e));
    expect(missing).toEqual([]);
  });

  it("is case-insensitive for the newly added formats", () => {
    expect(isConvertible("TXT")).toBe(true);
    expect(isConvertible("JSONL")).toBe(true);
  });

  /* The reverse direction is the worse failure: offering a format the engine refuses means
     the user clicks and THEN fails. These are excluded on purpose — the engine has no
     demuxer for them (.avi/.wmv) and they must stay out. */
  it("does not offer containers the engine refuses", () => {
    for (const ext of ["avi", "wmv", "wma"]) expect(isConvertible(ext)).toBe(false);
  });
});
