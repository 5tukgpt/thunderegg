/**
 * publish-sign — the on-disk device key path (getOrCreateSigningKey / signArtifact /
 * signingKeyFingerprint). HOME is redirected to a temp dir before import so the real
 * signing key is never read or written.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const realHome = process.env.HOME;
let home = "";
let sign: typeof import("../publish-sign");
let keyFile = "";

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "te-sign-"));
  process.env.HOME = home;
  vi.resetModules();
  sign = await import("../publish-sign");
  keyFile = path.join(home, "Library", "Application Support", "MarkItDownDroplet", "distill-signing-key.pem");
});
afterAll(() => {
  process.env.HOME = realHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("device signing key", () => {
  it("has no fingerprint before a key exists", () => {
    expect(sign.signingKeyFingerprint()).toBeNull();
  });

  it("creates the key on first sign, owner-only (0600)", () => {
    const s = sign.signArtifact('{"a":1}');
    expect(s.algo).toBe("ed25519");
    expect(fs.existsSync(keyFile)).toBe(true);
    expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(sign.verifyBytes('{"a":1}', s.signature, s.public_key)).toBe(true);
    expect(sign.verifyBytes('{"a":2}', s.signature, s.public_key)).toBe(false);
  });

  it("reuses the same key across calls (stable public key + fingerprint)", () => {
    const a = sign.signArtifact("x");
    const b = sign.signArtifact("y");
    expect(a.public_key).toBe(b.public_key);
    expect(sign.signingKeyFingerprint()).toBe(sign.keyFingerprint(a.public_key));
    expect(sign.signingKeyFingerprint()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("replaces a corrupt key file instead of crashing", () => {
    fs.writeFileSync(keyFile, "not a pem");
    expect(sign.signingKeyFingerprint()).toBeNull();
    const s = sign.signArtifact("z");
    expect(sign.verifyBytes("z", s.signature, s.public_key)).toBe(true);
    expect(sign.signingKeyFingerprint()).not.toBeNull();
  });
});
