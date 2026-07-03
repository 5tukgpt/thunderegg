import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createPublicKey, createHash } from "crypto";
import { signBytes, verifyBytes, publicKeySpki, keyFingerprint, contentHash } from "../publish-sign";

function freshKeypair() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { priv: privateKey, pubSpki: publicKeySpki(createPublicKey(privateKey)) };
}

describe("ed25519 sign/verify", () => {
  it("verifies a signature it produced", () => {
    const { priv, pubSpki } = freshKeypair();
    const data = JSON.stringify({ schema: "distill.map/0.2", title: "Design Controls" });
    const sig = signBytes(data, priv);
    expect(verifyBytes(data, sig, pubSpki)).toBe(true);
  });

  it("rejects tampered data", () => {
    const { priv, pubSpki } = freshKeypair();
    const sig = signBytes("original", priv);
    expect(verifyBytes("original ", sig, pubSpki)).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const a = freshKeypair();
    const b = freshKeypair();
    const data = "shared bytes";
    const sig = signBytes(data, a.priv);
    expect(verifyBytes(data, sig, b.pubSpki)).toBe(false);
  });

  it("rejects garbage gracefully (no throw)", () => {
    const { pubSpki } = freshKeypair();
    expect(verifyBytes("x", "not-base64-sig", pubSpki)).toBe(false);
    expect(verifyBytes("x", "", "not-a-key")).toBe(false);
  });
});

describe("contentHash", () => {
  it("is sha256 hex over UTF-8, stable across calls", () => {
    const data = JSON.stringify({ schema: "distill.map/0.2", title: "Fork" }, null, 2);
    const expected = createHash("sha256").update(data, "utf8").digest("hex");
    expect(contentHash(data)).toBe(expected);
    expect(contentHash(data)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("differs on a single-byte change", () => {
    expect(contentHash("map")).not.toBe(contentHash("map "));
  });
});

describe("keyFingerprint", () => {
  it("is stable and 16 hex chars", () => {
    const { pubSpki } = freshKeypair();
    const fp = keyFingerprint(pubSpki);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(keyFingerprint(pubSpki)).toBe(fp);
  });

  it("differs across keys", () => {
    expect(keyFingerprint(freshKeypair().pubSpki)).not.toBe(keyFingerprint(freshKeypair().pubSpki));
  });
});
