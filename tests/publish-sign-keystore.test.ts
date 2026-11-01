import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/* The device signing key: created once, stored outside the vault (chmod 600), reused forever.
   os.homedir() is redirected to a temp dir so the real key is never read or replaced. */

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "thunderegg-key-"));
vi.mock("os", async (orig) => {
  const real = await orig<typeof import("os")>();
  return { ...real, homedir: () => HOME, default: { ...real, homedir: () => HOME } };
});

const sign = await import("../publish-sign");
const KEY_FILE = path.join(HOME, "Library", "Application Support", "MarkItDownDroplet", "distill-signing-key.pem");

afterAll(() => fs.rmSync(HOME, { recursive: true, force: true }));
beforeEach(() => { try { fs.unlinkSync(KEY_FILE); } catch { /* none yet */ } });

describe("device signing key", () => {
  it("has no fingerprint before a key exists", () => {
    expect(sign.signingKeyFingerprint()).toBeNull();
  });

  it("creates the key on first use, owner-only, and reuses it after", () => {
    const k1 = sign.getOrCreateSigningKey();
    expect(fs.statSync(KEY_FILE).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(KEY_FILE, "utf8")).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    const k2 = sign.getOrCreateSigningKey();
    expect(k2.export({ type: "pkcs8", format: "pem" })).toBe(k1.export({ type: "pkcs8", format: "pem" }));
  });

  it("signArtifact produces a signature that verifies against its own public key", () => {
    const json = JSON.stringify({ title: "Map", n: [1, 2, 3] }, null, 2);
    const s = sign.signArtifact(json);
    expect(s.algo).toBe("ed25519");
    expect(sign.verifyBytes(json, s.signature, s.public_key)).toBe(true);
    expect(sign.verifyBytes(json + " ", s.signature, s.public_key)).toBe(false);
  });

  it("the fingerprint shown in Settings matches the key that signs", () => {
    const s = sign.signArtifact("x");
    expect(sign.signingKeyFingerprint()).toBe(sign.keyFingerprint(s.public_key));
    expect(sign.signingKeyFingerprint()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("two signatures in a row come from the same identity", () => {
    expect(sign.signArtifact("a").public_key).toBe(sign.signArtifact("b").public_key);
  });

  it("an unreadable key file reads as 'no key' for the fingerprint", () => {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    fs.writeFileSync(KEY_FILE, "garbage");
    expect(sign.signingKeyFingerprint()).toBeNull();
  });
});
