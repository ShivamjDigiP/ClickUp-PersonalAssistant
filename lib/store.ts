import { kv } from "./kv";
import { ns } from "./auth/context";

// Settings and the audit log, kept separately for each signed-in person (see ns()).
// Where they live (Redis, files or memory) is decided in ./kv.
export type Settings = { readOnly: boolean };

// Safe default: read-only until the user switches writes on. If storage is unreachable we also fall back to
// read-only (never to "writes allowed").
export async function getSettings(): Promise<Settings> {
  try {
    const s = await kv().get<Settings>(ns("settings"));
    return typeof s?.readOnly === "boolean" ? s : { readOnly: true };
  } catch (e) {
    console.error("[settings] could not read, assuming read-only:", (e as Error).message);
    return { readOnly: true };
  }
}
export const setSettings = (s: Settings) => kv().set(ns("settings"), s);

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
