import { kv } from "./kv";
import { ns } from "./auth/context";

// The audit log, kept separately for each signed-in person (see ns()).
// Where it lives (Redis, files or memory) is decided in ./kv.
export type AuditEntry = {
  at: string;
  event: "proposed" | "approved" | "rejected" | "executed" | "failed" | "blocked" | "expired";
  tool: string;
  summary: string;
  detail?: string;
};

export async function audit(entry: Omit<AuditEntry, "at">) {
  try {
    await kv().push(ns("audit"), { at: new Date().toISOString(), ...entry }, 500);
  } catch (e) {
    // A failed log write must never block or fail the action itself
    console.error("[audit] could not write:", (e as Error).message);
  }
}

export const readAudit = async (limit = 50): Promise<AuditEntry[]> => {
  try {
    return await kv().list<AuditEntry>(ns("audit"), limit);
  } catch {
    return [];
  }
};
