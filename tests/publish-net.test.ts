/**
 * publish-net — network + device-token storage. `obsidian.requestUrl` is mocked, and HOME is
 * pointed at a throwaway temp dir BEFORE the module loads (it computes the token path from
 * os.homedir() at import time), so no real server and no real token file are touched.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

vi.mock("obsidian", async () => await import("./helpers/obsidian-mock"));
import { NO_PUBLISH_SERVER } from "../publish-core";

const realHome = process.env.HOME;
let home = "";
let net: typeof import("../publish-net");
let tokenFile = "";
let requestUrl: typeof import("./helpers/obsidian-mock")["requestUrl"];

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "te-net-"));
  process.env.HOME = home;
  vi.resetModules();
  net = await import("../publish-net");
  // same registry as publish-net after the reset, so this is the mock it actually calls
  ({ requestUrl } = await import("./helpers/obsidian-mock"));
  tokenFile = path.join(home, "Library", "Application Support", "MarkItDownDroplet", "distill-token");
});
afterAll(() => {
  process.env.HOME = realHome;
  fs.rmSync(home, { recursive: true, force: true });
});
beforeEach(() => { requestUrl.mockReset(); });

describe("device token storage", () => {
  it("reads empty when no token has been saved", () => {
    net.clearDeviceToken();
    expect(net.readDeviceToken()).toBe("");
    expect(net.hasDeviceToken()).toBe(false);
  });

  it("writes outside the vault, trimmed, owner-only (0600), and reads it back", () => {
    net.writeDeviceToken("  tok-123\n");
    expect(fs.readFileSync(tokenFile, "utf8")).toBe("tok-123");
    expect(fs.statSync(tokenFile).mode & 0o777).toBe(0o600);
    expect(net.readDeviceToken()).toBe("tok-123");
    expect(net.hasDeviceToken()).toBe(true);
  });

  it("clear removes it, and clearing twice does not throw", () => {
    net.writeDeviceToken("x");
    net.clearDeviceToken();
    expect(fs.existsSync(tokenFile)).toBe(false);
    expect(() => net.clearDeviceToken()).not.toThrow();
  });

  it("a whitespace-only token counts as no token", () => {
    net.writeDeviceToken("   ");
    expect(net.hasDeviceToken()).toBe(false);
  });
});

const artifact = { schema: "distill.map/0.2", title: "T" } as never;

describe("publishArtifact", () => {
  it("POSTs JSON with the bearer token to <server>/api/maps and returns the body", async () => {
    const body = { id: "m1", map_uid: "u1", version: 1, url: "https://maps.example.com/@a/m1" };
    requestUrl.mockResolvedValue({ status: 201, json: body });
    const r = await net.publishArtifact("https://maps.example.com/", "tok", artifact);
    expect(r).toEqual(body);
    const req = requestUrl.mock.calls[0][0];
    expect(req.url).toBe("https://maps.example.com/api/maps");
    expect(req.method).toBe("POST");
    expect(req.headers.Authorization).toBe("Bearer tok");
    expect(req.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(req.body)).toEqual(artifact);
    expect(req.throw).toBe(false);
  });

  it("surfaces the server's {error} message on a non-2xx", async () => {
    requestUrl.mockResolvedValue({ status: 422, json: { error: "summary too short" } });
    await expect(net.publishArtifact("https://m.example.com", "t", artifact)).rejects.toThrow("summary too short");
  });

  it("falls back to 'HTTP <status>' when the error body is not JSON", async () => {
    requestUrl.mockResolvedValue({ status: 500, get json() { throw new SyntaxError("not json"); } });
    await expect(net.publishArtifact("https://m.example.com", "t", artifact)).rejects.toThrow("HTTP 500");
  });

  it("falls back to 'HTTP <status>' when {error} is not a string", async () => {
    requestUrl.mockResolvedValue({ status: 401, json: { error: { code: 1 } } });
    await expect(net.publishArtifact("https://m.example.com", "t", artifact)).rejects.toThrow("HTTP 401");
  });

  it("makes NO request when the server is unset or the retired default", async () => {
    await expect(net.publishArtifact("", "t", artifact)).rejects.toThrow(NO_PUBLISH_SERVER);
    await expect(net.publishArtifact("https://distillmd.dev", "t", artifact)).rejects.toThrow(NO_PUBLISH_SERVER);
    expect(requestUrl).not.toHaveBeenCalled();
  });
});

describe("fetchForkFile", () => {
  it("GETs the URL-encoded forkfile path and returns the JSON", async () => {
    requestUrl.mockResolvedValue({ status: 200, json: { id: "a/b" } });
    const r = await net.fetchForkFile("https://m.example.com", "a/b c");
    expect(r).toEqual({ id: "a/b" });
    expect(requestUrl.mock.calls[0][0].url).toBe("https://m.example.com/api/maps/a%2Fb%20c/forkfile");
    expect(requestUrl.mock.calls[0][0].method).toBe("GET");
  });

  it("throws with the status on a non-2xx", async () => {
    requestUrl.mockResolvedValue({ status: 404, json: null });
    await expect(net.fetchForkFile("https://m.example.com", "x")).rejects.toThrow("Fork fetch failed: HTTP 404");
  });

  it("makes NO request when the server is unset", async () => {
    await expect(net.fetchForkFile("  ", "x")).rejects.toThrow(NO_PUBLISH_SERVER);
    expect(requestUrl).not.toHaveBeenCalled();
  });
});
