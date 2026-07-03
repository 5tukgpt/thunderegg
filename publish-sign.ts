/**
 * publish-sign.ts — Ed25519 authorship signing for exported/published maps.
 *
 * The moat is a trustworthy authorship graph (see distill-community/
 * COMMUNITY-MOAT-REFRAME). Signing makes authorship verifiable peer-to-peer
 * with NO identity server: the device owns an Ed25519 keypair; the private key
 * lives outside the synced vault (app-support dir, chmod 600); the detached
 * signature + public key travel in the exported map's sidecar.
 *
 * Uses Node crypto + fs (desktop-only plugin) — NOT obsidian. The pure
 * sign/verify/publicKey functions are unit-tested; the fs key-storage path is not.
 */
import {
  generateKeyPairSync, createPublicKey, createPrivateKey, createHash,
  sign as cryptoSign, verify as cryptoVerify, type KeyObject,
} from "crypto";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

const KEY_DIR = path.join(os.homedir(), "Library", "Application Support", "MarkItDownDroplet");
const KEY_FILE = path.join(KEY_DIR, "distill-signing-key.pem");

export interface Signature {
  algo: "ed25519";
  /** base64 SPKI DER of the public key. */
  public_key: string;
  /** base64 of the 64-byte detached signature over the artifact's exact UTF-8 bytes. */
  signature: string;
}

/* ── Pure crypto (unit-tested) ───────────────────────────────────────── */

/** base64 SPKI-DER of an Ed25519 public key. */
export function publicKeySpki(pub: KeyObject): string {
  return (pub.export({ type: "spki", format: "der" }) as Buffer).toString("base64");
}

/** Sign UTF-8 bytes with an Ed25519 private key → base64 signature. */
export function signBytes(data: string, privateKey: KeyObject): string {
  return cryptoSign(null, Buffer.from(data, "utf8"), privateKey).toString("base64");
}

/** Verify a base64 signature over UTF-8 bytes against a base64 SPKI-DER public key. */
export function verifyBytes(data: string, signatureB64: string, publicKeySpkiB64: string): boolean {
  try {
    const pub = createPublicKey({
      key: Buffer.from(publicKeySpkiB64, "base64"),
      format: "der",
      type: "spki",
    });
    return cryptoVerify(null, Buffer.from(data, "utf8"), pub, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

/** Short, human-comparable fingerprint of a public key (first 16 hex of sha256). */
export function keyFingerprint(publicKeySpkiB64: string): string {
  return createHash("sha256").update(publicKeySpkiB64).digest("hex").slice(0, 16);
}

/** sha256 hex over UTF-8 content — the fork-lineage content hash. */
export function contentHash(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/* ── Device key storage (fs; not unit-tested) ────────────────────────── */

/** Load the device signing key, generating + persisting it (chmod 600) on first use. */
export function getOrCreateSigningKey(): KeyObject {
  try {
    return createPrivateKey(fs.readFileSync(KEY_FILE, "utf8"));
  } catch {
    const { privateKey } = generateKeyPairSync("ed25519");
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    fs.mkdirSync(KEY_DIR, { recursive: true });
    fs.writeFileSync(KEY_FILE, pem, { mode: 0o600 });
    try { fs.chmodSync(KEY_FILE, 0o600); } catch { /* best effort */ }
    return privateKey;
  }
}

/** Sign an artifact's serialized bytes; returns the detached signature block. */
export function signArtifact(jsonString: string): Signature {
  const priv = getOrCreateSigningKey();
  const pub = createPublicKey(priv);
  return {
    algo: "ed25519",
    public_key: publicKeySpki(pub),
    signature: signBytes(jsonString, priv),
  };
}

/** Fingerprint of the device's public key, or null if no key has been created yet. */
export function signingKeyFingerprint(): string | null {
  try {
    const priv = createPrivateKey(fs.readFileSync(KEY_FILE, "utf8"));
    return keyFingerprint(publicKeySpki(createPublicKey(priv)));
  } catch {
    return null;
  }
}
