import { describe, it, expect } from "vitest";
import { stemPath } from "../core";

/* stemPath is the DEGRADED fallback for the note name — it runs only when the engine did not
   report the path it chose. The engine renamed `report.pdf.md` -> `report.md` on 2026-08-13
   and the plugin kept reconstructing the old name, so every success notice named a file that
   did not exist and "Open note after converting" opened nothing. The real fix is asking the
   engine (DISTILL_NOTE_PATH_OUT); this pins the fallback so an OLD engine still gets the name
   right for ordinary files. */
describe("stemPath", () => {
  it("drops the extension from an ordinary file", () => {
    expect(stemPath("report.pdf")).toBe("report");
    expect(stemPath("Attachments/Q3 Report.docx")).toBe("Attachments/Q3 Report");
  });

  it("takes the LAST extension only", () => {
    expect(stemPath("archive.tar.gz")).toBe("archive.tar");
  });

  it("leaves an extensionless name alone", () => {
    expect(stemPath("Makefile")).toBe("Makefile");
    expect(stemPath("notes/Makefile")).toBe("notes/Makefile");
  });

  it("leaves a dotfile alone — a leading dot is not an extension", () => {
    expect(stemPath(".gitignore")).toBe(".gitignore");
    expect(stemPath("cfg/.gitignore")).toBe("cfg/.gitignore");
  });

  /* The engine's own `${src%.*}` strips at the last dot ANYWHERE, so it would turn
     "v1.2/report" into "v1" and claim a note outside the folder. Only the basename is
     touched here, deliberately diverging from the engine on the case it gets wrong. */
  it("never eats a dot in a DIRECTORY name", () => {
    expect(stemPath("v1.2/report")).toBe("v1.2/report");
    expect(stemPath("v1.2/report.pdf")).toBe("v1.2/report");
  });

  it("is a no-op on a name that is only a dot-suffix", () => {
    expect(stemPath("a/.x")).toBe("a/.x");
  });
});
