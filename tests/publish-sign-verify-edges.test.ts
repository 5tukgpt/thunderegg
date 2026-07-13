import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createPublicKey } from "crypto";
import { signBytes, verifyBytes, publicKeySpki, keyFingerprint, contentHash } from "../publish-sign";

// The signed-authorship trust boundary (publish-sign.ts header: "the moat").
// publish-sign.test.ts already covers happy-path / 1-byte tamper / wrong-key /
// garbage. This file isolates the rejection reasons the conflated cases blur,
// pins the SPKI interop contract the sidecar depends on, and the doc-comment's
// "exact UTF-8 bytes" promise (publish-sign.ts:8,28). Pure crypto, no fs/obsidian.

function freshKeypair() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { priv: privateKey, pubSpki: publicKeySpki(createPublicKey(privateKey)) };
}

describe("publicKeySpki — SPKI interop round-trip", () => {
  it("is base64 SPKI-DER (44 bytes for Ed25519) that re-imports to the same key", () => {
    const { pubSpki } = freshKeypair();
    expect(pubSpki).toMatch(/^[A-Za-z0-9+/]+=*$/);
    // The public key travels the sidecar as this base64; another device must be
    // able to decode → SPKI DER → re-export identically or verification breaks.
    const der = Buffer.from(pubSpki, "base64");
    expect(der.length).toBe(44);
    const reExported = createPublicKey({ key: der, format: "der", type: "spki" })
      .export({ type: "spki", format: "der" })
      .toString("base64");
    expect(reExported).toBe(pubSpki);
  });
});

describe("verifyBytes — isolated rejection reasons (never a false accept)", () => {
  it("rejects an empty signature against an otherwise-valid key", () => {
    // Isolates the empty-sig branch from the existing conflated case
    // verifyBytes("x", "", "not-a-key") which also has a bad key.
    const { pubSpki } = freshKeypair();
    expect(verifyBytes("payload", "", pubSpki)).toBe(false);
  });

  it("rejects a wrong-length signature (valid base64, not 64 bytes) without throwing", () => {
    const { priv, pubSpki } = freshKeypair();
    const raw = Buffer.from(signBytes("payload", priv), "base64");
    expect(raw.length).toBe(64);
    const truncated = raw.subarray(0, raw.length - 1).toString("base64");
    expect(verifyBytes("payload", truncated, pubSpki)).toBe(false);
  });

  it("rejects mismatched (data, signature) pairs in both directions", () => {
    // A real signature over a *different* full payload must not verify — the
    // artifact-substitution threat, distinct from the 1-byte tamper case.
    const { priv, pubSpki } = freshKeypair();
    const sigA = signBytes("map A", priv);
    const sigB = signBytes("map B", priv);
    expect(verifyBytes("map A", sigB, pubSpki)).toBe(false);
    expect(verifyBytes("map B", sigA, pubSpki)).toBe(false);
  });
});

describe("keyFingerprint ⇄ contentHash relationship", () => {
  it("keyFingerprint(spki) is the first 16 hex chars of contentHash(spki)", () => {
    // The fingerprint a user compares by eye is the head of the SPKI content
    // hash; the two functions must stay in lockstep.
    const { pubSpki } = freshKeypair();
    expect(keyFingerprint(pubSpki)).toBe(contentHash(pubSpki).slice(0, 16));
  });
});

describe("signBytes/verifyBytes — exact UTF-8 bytes", () => {
  it("signs and verifies a Unicode payload byte-exactly", () => {
    const { priv, pubSpki } = freshKeypair();
    const u = "スパイン設計 🧭 café";
    expect(verifyBytes(u, signBytes(u, priv), pubSpki)).toBe(true);
  });

  it("rejects a Unicode-normalization variant (NFC signed, NFD presented)", () => {
    const { priv, pubSpki } = freshKeypair();
    const nfc = "café".normalize("NFC");
    const nfd = "café".normalize("NFD");
    expect(Buffer.from(nfc, "utf8").equals(Buffer.from(nfd, "utf8"))).toBe(false);
    const sig = signBytes(nfc, priv);
    expect(verifyBytes(nfc, sig, pubSpki)).toBe(true);
    expect(verifyBytes(nfd, sig, pubSpki)).toBe(false);
  });
});
