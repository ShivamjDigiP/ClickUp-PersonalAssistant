import { randomUUID } from "crypto";
import type { AuditEntry } from "../store";
import { kv } from "../kv";
import { ns } from "../auth/context";

// The approval gate. The LLM can only call propose(); nothing executes until
// resolve(id, "approve") is called by the user-facing API, and never in read-only mode.
// Pending proposals live in shared storage (not server memory) so approving works even when the
// approve request lands on a different server instance than the one that created the proposal.
export type Pending = {
  id: string;
  tool: string;
  args: unknown;
  summary: string;
  details?: string;
  createdAt: number;
};

export const TTL_MS = 15 * 60_000;
const key = (id: string) => ns(`pending/${id}`); // per person: nobody can approve someone else's proposal

export async function propose(tool: string, args: unknown, summary: string, details?: string): Promise<Pending> {
  const p: Pending = { id: randomUUID(), tool, args, summary, details, createdAt: Date.now() };
  await kv().set(key(p.id), p, Math.ceil(TTL_MS / 1000) + 60);
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

const SAFE_ID = /^[0-9a-f-]{36}$/i;

export async function resolve(id: string, decision: "approve" | "reject", deps: Deps): Promise<Outcome> {
  if (!SAFE_ID.test(id)) return { ok: false, error: "Unknown or already handled action." };
  // take() reads and deletes in one step: single use, so replaying the same id can never run it twice
  const p = await kv().take<Pending>(key(id));
  if (!p) return { ok: false, error: "Unknown or already handled action." };

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
