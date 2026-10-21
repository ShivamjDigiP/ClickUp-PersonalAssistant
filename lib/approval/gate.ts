import { randomUUID } from "crypto";
import type { AuditEntry } from "../store";

// The approval gate. The LLM can only call propose(); nothing executes until
// resolve(id, "approve") is called by the user-facing API, and never in read-only mode.
export type Pending = {
  id: string;
  tool: string;
  args: unknown;
  summary: string;
  details?: string;
  createdAt: number;
};

export const TTL_MS = 15 * 60_000;

const g = globalThis as unknown as { __pending?: Map<string, Pending> };
const pending = (g.__pending ??= new Map<string, Pending>()); // survives dev hot reloads

export function propose(tool: string, args: unknown, summary: string, details?: string): Pending {
  const p: Pending = { id: randomUUID(), tool, args, summary, details, createdAt: Date.now() };
  pending.set(p.id, p);
  return p;
}

export type Deps = {
  readOnly: boolean;
  run: (tool: string, args: unknown) => Promise<unknown>;
  audit: (e: Omit<AuditEntry, "at">) => Promise<void>;
  now?: () => number;
};

export type Outcome =
  | { ok: true; result: unknown; summary: string }
  | { ok: false; error: string; summary?: string };

export async function resolve(id: string, decision: "approve" | "reject", deps: Deps): Promise<Outcome> {
  const p = pending.get(id);
  if (!p) return { ok: false, error: "Unknown or already handled action." };
  pending.delete(id); // single use: replaying the same id can never run it twice

  if (decision === "reject") {
    await deps.audit({ event: "rejected", tool: p.tool, summary: p.summary });
    return { ok: false, error: "Rejected. Nothing was changed.", summary: p.summary };
  }
  if (deps.readOnly) {
    await deps.audit({ event: "blocked", tool: p.tool, summary: p.summary, detail: "read-only mode" });
    return { ok: false, error: "Read-only mode is on. Nothing was changed.", summary: p.summary };
  }
  if ((deps.now?.() ?? Date.now()) - p.createdAt > TTL_MS) {
    await deps.audit({ event: "expired", tool: p.tool, summary: p.summary });
    return { ok: false, error: "This request expired (15 min). Ask again.", summary: p.summary };
  }

  await deps.audit({ event: "approved", tool: p.tool, summary: p.summary });
  try {
    const result = await deps.run(p.tool, p.args);
    await deps.audit({ event: "executed", tool: p.tool, summary: p.summary });
    return { ok: true, result, summary: p.summary };
  } catch (e) {
    const error = (e as Error).message;
    await deps.audit({ event: "failed", tool: p.tool, summary: p.summary, detail: error });
    return { ok: false, error, summary: p.summary };
  }
}
