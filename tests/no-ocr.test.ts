import { describe, it, expect } from "vitest";
import { exec } from "child_process";
import { promisify } from "util";
import { isNoOcrError, NO_OCR_TOKEN } from "../core";

const execAsync = promisify(exec);

describe("isNoOcrError", () => {
  /* The token is a wire contract with the engine (markdown-droplet helpers/convert.sh,
     which prints this exact string to stderr). Pinned as a LITERAL on purpose: every
     other test here spells it NO_OCR_TOKEN, so they would all still pass if the
     constant drifted away from what convert.sh emits — proving only that this file
     agrees with itself. This is the one assertion that fails if the value changes. */
  it("pins the token the engine actually emits", () => {
    expect(NO_OCR_TOKEN).toBe("DISTILL_NO_OCR");
  });

  it("detects the token on stderr", () => {
    expect(isNoOcrError({ stderr: "DISTILL_NO_OCR\n" })).toBe(true);
  });

  it("detects the token among the engine's other stderr lines", () => {
    expect(isNoOcrError({
      stderr: `${NO_OCR_TOKEN}\nThunderegg: can't read 'shot.png' — on-device OCR isn't installed.\n`,
    })).toBe(true);
  });

  it("ignores unrelated engine failures", () => {
    expect(isNoOcrError({ stderr: "convert.sh: line 12: markitdown: command not found\n" })).toBe(false);
    expect(isNoOcrError({ stderr: "" })).toBe(false);
  });

  /* The engine's contract is a token on STDERR. A missing binary puts its message on
     stderr too, so matching `message` as well would be harmless — but matching stdout
     would let a converted document that merely quotes the token trigger the notice. */
  it("does not match the token on stdout", () => {
    expect(isNoOcrError({ stdout: NO_OCR_TOKEN, stderr: "" })).toBe(false);
  });

  it("survives thrown values that carry no usable stderr", () => {
    expect(isNoOcrError(new Error("spawn ENOENT"))).toBe(false);
    expect(isNoOcrError(undefined)).toBe(false);
    expect(isNoOcrError(null)).toBe(false);
    expect(isNoOcrError("DISTILL_NO_OCR")).toBe(false);
    expect(isNoOcrError({ stderr: Buffer.from(NO_OCR_TOKEN) })).toBe(false);
  });

  /* Pins the assumption the whole port rests on: that `promisify(exec)` — the call
     main.ts makes — really does hand us the child's stderr as a string on rejection.
     If Node ever stopped doing that, both notices would silently regress to the
     generic "Is the Thunderegg app installed?" and this is what would catch it. */
  it("matches a real promisify(exec) rejection from an engine that emits the token", async () => {
    const engine = `sh -c 'echo ${NO_OCR_TOKEN} >&2; exit 1'`;
    await expect(execAsync(engine)).rejects.toSatisfy(isNoOcrError);
  });

  it("does not match a real rejection from an engine that fails some other way", async () => {
    await expect(execAsync(`sh -c 'echo broken >&2; exit 1'`)).rejects.not.toSatisfy(isNoOcrError);
  });
});
