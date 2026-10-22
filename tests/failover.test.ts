import { afterEach, describe, expect, it, vi } from "vitest";

const mcp = vi.hoisted(() => ({ runViaMcp: vi.fn() }));
vi.mock("../lib/clickup/mcp", async (orig) => ({ ...(await orig<typeof import("../lib/clickup/mcp")>()), runViaMcp: mcp.runViaMcp }));

import { parseJsonReply } from "../lib/clickup/mcp";
import { resetFailover, withFailover } from "../lib/clickup/failover";

const read = { name: "get_task", kind: "read" as const, description: "d" };
const write = { name: "update_task", kind: "write" as const, description: "d" };

afterEach(() => {
  mcp.runViaMcp.mockReset();
  resetFailover();
});

describe("ClickUp failover", () => {
  it("uses the API and never touches MCP when the API works", async () => {
    expect(await withFailover(read, {}, true, async () => "api")).toBe("api");
    expect(mcp.runViaMcp).not.toHaveBeenCalled();
  });

  it("falls back to MCP when the API token is rejected", async () => {
    mcp.runViaMcp.mockResolvedValue("mcp");
    expect(await withFailover(read, { task_id: "1" }, true, async () => { throw new Error("ClickUp 401: bad token"); })).toBe("mcp");
    expect(mcp.runViaMcp).toHaveBeenCalledWith(read, { task_id: "1" });
  });

  it("then skips the broken API for a while", async () => {
    mcp.runViaMcp.mockResolvedValue("mcp");
    await withFailover(read, {}, true, async () => { throw new Error("ClickUp 503: down"); });
    const api = vi.fn(async () => "api");
    expect(await withFailover(read, {}, true, api)).toBe("mcp");
    expect(api).not.toHaveBeenCalled();
  });

  it("does not retry request mistakes such as not found", async () => {
    await expect(withFailover(read, {}, true, async () => { throw new Error("ClickUp 404: Task not found"); })).rejects.toThrow(/404/);
    expect(mcp.runViaMcp).not.toHaveBeenCalled();
  });

  it("does not use MCP when the request is not local", async () => {
    await expect(withFailover(read, {}, false, async () => { throw new Error("ClickUp 401"); })).rejects.toThrow(/401/);
    expect(mcp.runViaMcp).not.toHaveBeenCalled();
  });

  it("never repeats a write after an ambiguous failure like a timeout", async () => {
    await expect(withFailover(write, {}, true, async () => { throw new Error("request timed out"); })).rejects.toThrow(/timed out/);
    expect(mcp.runViaMcp).not.toHaveBeenCalled();
  });

  it("retries a write through MCP when the API refused it outright", async () => {
    mcp.runViaMcp.mockResolvedValue({ ok: true });
    expect(await withFailover(write, {}, true, async () => { throw new Error("ClickUp 403: forbidden"); })).toEqual({ ok: true });
  });

  it("reports both failures when MCP is also unavailable", async () => {
    mcp.runViaMcp.mockRejectedValue(new Error("not connected"));
    await expect(withFailover(read, {}, true, async () => { throw new Error("ClickUp 401"); })).rejects.toThrow(/401.*backup also failed: not connected/);
  });

  it("leaves non-ClickUp tools alone", async () => {
    await expect(withFailover({ ...read, external: true }, {}, true, async () => { throw new Error("ClickUp 401"); })).rejects.toThrow();
    expect(mcp.runViaMcp).not.toHaveBeenCalled();
  });
});

describe("parseJsonReply", () => {
  it("extracts JSON from a fenced reply and wraps prose", () => {
    expect(parseJsonReply('```json\n{"id":"1"}\n```')).toEqual({ id: "1" });
    expect(parseJsonReply("[1,2]")).toEqual([1, 2]);
    expect(parseJsonReply("could not")).toEqual({ text: "could not" });
  });
});
