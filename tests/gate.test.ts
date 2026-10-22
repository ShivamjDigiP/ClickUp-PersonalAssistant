import { describe, expect, it, vi } from "vitest";
import { propose, resolve, TTL_MS } from "../lib/approval/gate";

// Tests never touch real storage: pending approvals live in memory here
process.env.KV_BACKEND = "memory";

const deps = (over: Partial<Parameters<typeof resolve>[2]> = {}) => ({
  run: vi.fn(async () => ({ done: true })),
  audit: vi.fn(async () => {}),
  ...over,
});

describe("approval gate", () => {
  it("does not execute on propose, only after approve", async () => {
    const d = deps();
    const p = await propose("update_task", { task_id: "1", status: "done" }, "Update task");
    expect(d.run).not.toHaveBeenCalled();
    const out = await resolve(p.id, "approve", d);
    expect(out.ok).toBe(true);
    expect(d.run).toHaveBeenCalledWith("update_task", { task_id: "1", status: "done" });
  });

  it("reject never executes", async () => {
    const d = deps();
    const p = await propose("add_comment", {}, "Comment");
    const out = await resolve(p.id, "reject", d);
    expect(out.ok).toBe(false);
    expect(d.run).not.toHaveBeenCalled();
  });

  it("is single-use: replaying an id cannot run twice", async () => {
    const d = deps();
    const p = await propose("update_task", {}, "Update");
    await resolve(p.id, "approve", d);
    const again = await resolve(p.id, "approve", d);
    expect(again.ok).toBe(false);
    expect(d.run).toHaveBeenCalledTimes(1);
  });

  it("expired proposals do not execute", async () => {
    const d = deps({ now: () => Date.now() + TTL_MS + 1000 });
    const p = await propose("update_task", {}, "Update");
    const out = await resolve(p.id, "approve", d);
    expect(out.ok).toBe(false);
    expect(d.run).not.toHaveBeenCalled();
  });

  it("unknown ids are refused", async () => {
    const out = await resolve("nope", "approve", deps());
    expect(out.ok).toBe(false);
  });

  it("failures are reported and audited", async () => {
    const d = deps({ run: vi.fn(async () => { throw new Error("ClickUp 400"); }) });
    const p = await propose("update_task", {}, "Update");
    const out = await resolve(p.id, "approve", d);
    expect(out).toMatchObject({ ok: false, error: "ClickUp 400" });
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ event: "failed" }));
  });
});
