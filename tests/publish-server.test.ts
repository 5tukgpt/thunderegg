import { describe, it, expect } from "vitest";
import { resolvePublishServer, NO_PUBLISH_SERVER } from "../publish-core";

describe("resolvePublishServer — no request to a server that does not exist", () => {
  it("refuses an unset server", () => {
    for (const v of ["", "   "]) expect(() => resolvePublishServer(v)).toThrow(NO_PUBLISH_SERVER);
  });
  it("treats the retired default as unset, however it was saved", () => {
    for (const v of ["https://distillmd.dev", "https://distillmd.dev/", "https://DistillMD.dev", "http://www.distillmd.dev//"])
      expect(() => resolvePublishServer(v)).toThrow(NO_PUBLISH_SERVER);
  });
  it("does not mistake a look-alike host for the retired one", () => {
    expect(resolvePublishServer("https://notdistillmd.dev")).toBe("https://notdistillmd.dev");
    expect(resolvePublishServer("https://distillmd.dev.example.com")).toBe("https://distillmd.dev.example.com");
  });
  it("passes a real server through, slash-trimmed", () => {
    expect(resolvePublishServer(" https://maps.example.com/// ")).toBe("https://maps.example.com");
    expect(resolvePublishServer("http://localhost:8787")).toBe("http://localhost:8787");
  });
  it("names a malformed URL instead of sending it", () => {
    expect(() => resolvePublishServer("not a url")).toThrow(/not valid/);
  });
});
