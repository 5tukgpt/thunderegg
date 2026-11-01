import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/* publish-net.ts is the only code that talks to a server and the only code that stores the
   device token. Both are faked here:
   - `obsidian.requestUrl` is a vi.fn() — no request ever leaves the machine.
   - `os.homedir()` points at a throwaway temp dir, so the real
     ~/Library/Application Support/MarkItDownDroplet/distill-token is never read or written. */

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "thunderegg-net-"));
vi.mock("os", async (orig) => {
  const real = await orig<typeof import("os")>();
  return { ...real, homedir: () => HOME, default: { ...real, homedir: () => HOME } };
});
vi.mock("obsidian", () => import("./helpers/obsidian-mock"));

const { requestUrl } = await import("./helpers/obsidian-mock");
const net = await import("../publish-net");
const { NO_PUBLISH_SERVER } = await import("../publish-core");

const TOKEN_FILE = path.join(HOME, "Library", "Application Support", "MarkItDownDroplet", "distill-token");
const artifact = { schema: "distill.map/0.2", title: "T" } as never;

afterAll(() => fs.rmSync(HOME, { recursive: true, force: true }));
beforeEach(() => { requestUrl.mockReset(); net.clearDeviceToken(); });

describe("device token storage", () => {
  it("reads empty when no token was ever saved", () => {
    expect(net.readDeviceToken()).toBe("");
    expect(net.hasDeviceToken()).toBe(false);
  });

  it("writes outside the vault, trimmed, owner-only (chmod 600)", () => {
    net.writeDeviceToken("  tok-123\n");
    expect(fs.readFileSync(TOKEN_FILE, "utf8")).toBe("tok-123");
    expect(fs.statSync(TOKEN_FILE).mode & 0o777).toBe(0o600);
    expect(net.readDeviceToken()).toBe("tok-123");
    expect(net.hasDeviceToken()).toBe(true);
  });

  it("clear removes it, and clearing twice does not throw", () => {
    net.writeDeviceToken("x");
    net.clearDeviceToken();
    expect(fs.existsSync(TOKEN_FILE)).toBe(false);
    expect(() => net.clearDeviceToken()).not.toThrow();
    expect(net.hasDeviceToken()).toBe(false);
  });

  it("a whitespace-only token file counts as no token", () => {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, "  \n");
    expect(net.hasDeviceToken()).toBe(false);
  });
});

describe("publishArtifact", () => {
  it("POSTs JSON to <server>/api/maps with the bearer token in a header", async () => {
    requestUrl.mockResolvedValueOnce({ status: 201, json: { id: "m1", map_uid: "u", version: 1, url: "https://x/m1" } });
    const res = await net.publishArtifact("https://maps.example.com/", "tok", artifact);
    expect(res.id).toBe("m1");
    expect(requestUrl).toHaveBeenCalledTimes(1);
    const req = requestUrl.mock.calls[0][0];
    expect(req.url).toBe("https://maps.example.com/api/maps");
    expect(req.method).toBe("POST");
    expect(req.headers.Authorization).toBe("Bearer tok");
    expect(req.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(req.body)).toEqual({ schema: "distill.map/0.2", title: "T" });
    expect(req.throw).toBe(false);                 // we read the status ourselves
  });

  it("makes NO request when the server is unset or the retired default", async () => {
    await expect(net.publishArtifact("", "tok", artifact)).rejects.toThrow(NO_PUBLISH_SERVER);
    await expect(net.publishArtifact("https://distillmd.dev", "tok", artifact)).rejects.toThrow(NO_PUBLISH_SERVER);
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("surfaces the server's own error message when it sends one", async () => {
    requestUrl.mockResolvedValueOnce({ status: 401, json: { error: "token revoked" } });
    await expect(net.publishArtifact("https://s", "t", artifact)).rejects.toThrow("token revoked");
  });

  it("falls back to the HTTP status for a non-JSON or shapeless error body", async () => {
    requestUrl.mockResolvedValueOnce({ status: 500, get json() { throw new SyntaxError("not json"); } });
    await expect(net.publishArtifact("https://s", "t", artifact)).rejects.toThrow("HTTP 500");
    requestUrl.mockResolvedValueOnce({ status: 413, json: { error: 42 } });
    await expect(net.publishArtifact("https://s", "t", artifact)).rejects.toThrow("HTTP 413");
    requestUrl.mockResolvedValueOnce({ status: 302, json: null });
    await expect(net.publishArtifact("https://s", "t", artifact)).rejects.toThrow("HTTP 302");
  });
});

describe("fetchForkFile", () => {
  it("GETs the forkfile with the map id URL-encoded (no path tricks)", async () => {
    requestUrl.mockResolvedValueOnce({ status: 200, json: { id: "a/b" } });
    await net.fetchForkFile("https://s/", "../admin?x=1");
    const req = requestUrl.mock.calls[0][0];
    expect(req.url).toBe("https://s/api/maps/..%2Fadmin%3Fx%3D1/forkfile");
    expect(req.method).toBe("GET");
    expect(req.headers).toBeUndefined();           // anonymous — never sends the token
  });

  it("throws on a non-2xx status", async () => {
    requestUrl.mockResolvedValueOnce({ status: 404, json: {} });
    await expect(net.fetchForkFile("https://s", "m")).rejects.toThrow("Fork fetch failed: HTTP 404");
  });

  it("makes no request without a server", async () => {
    await expect(net.fetchForkFile(" ", "m")).rejects.toThrow(NO_PUBLISH_SERVER);
    expect(requestUrl).not.toHaveBeenCalled();
  });
});
