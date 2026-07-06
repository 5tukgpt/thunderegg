/**
 * publish-net.ts — networking + device-token storage for Publish.
 * Imports obsidian (requestUrl) + node builtins (fs/os/path), so it is glue,
 * not unit-tested (like main.ts). Pure logic lives in publish-core.ts.
 *
 * The device token is stored OUTSIDE the vault (app-support dir), never in
 * .obsidian/.../data.json — see auth-and-api-spec §2.
 */
import { requestUrl } from "obsidian";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import type { DistillMapArtifact } from "./publish-core";

/** App-support dir the Thunderegg engine already uses; token lives here, chmod 600. */
const TOKEN_DIR = path.join(os.homedir(), "Library", "Application Support", "MarkItDownDroplet");
const TOKEN_FILE = path.join(TOKEN_DIR, "distill-token");

export function readDeviceToken(): string {
  try {
    return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

export function writeDeviceToken(token: string): void {
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, token.trim(), { mode: 0o600 });
  try { fs.chmodSync(TOKEN_FILE, 0o600); } catch { /* best effort */ }
}

export function clearDeviceToken(): void {
  try { fs.unlinkSync(TOKEN_FILE); } catch { /* already gone */ }
}

export function hasDeviceToken(): boolean {
  return readDeviceToken().length > 0;
}

export interface PublishResponse {
  id: string;
  map_uid: string;
  version: number;
  url: string;
}

function trimSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

/** POST a distill.map/0.2 artifact. Uses requestUrl (bypasses CORS, bearer in header). */
export async function publishArtifact(
  baseUrl: string,
  token: string,
  artifact: DistillMapArtifact,
): Promise<PublishResponse> {
  const res = await requestUrl({
    url: `${trimSlash(baseUrl)}/api/maps`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(artifact),
    throw: false,
  });
  if (res.status < 200 || res.status >= 300) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = res.json;
      if (j && typeof j.error === "string") msg = j.error;
    } catch { /* non-JSON error body */ }
    throw new Error(msg);
  }
  return res.json as PublishResponse;
}

/** Fetch a public/forkable map's artifact (visibility re-checked server-side). */
export async function fetchForkFile(baseUrl: string, mapId: string): Promise<unknown> {
  const res = await requestUrl({
    url: `${trimSlash(baseUrl)}/api/maps/${encodeURIComponent(mapId)}/forkfile`,
    method: "GET",
    throw: false,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Fork fetch failed: HTTP ${res.status}`);
  }
  return res.json;
}
