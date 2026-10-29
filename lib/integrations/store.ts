import { randomUUID } from "node:crypto";
import { db } from "../db";
import { authEnabled } from "../auth/config";
import { decrypt, encrypt } from "../auth/crypto";
import type { Provider } from "./types";

export const DEFAULT_WORKSPACE = "ws_default";

export function ensureWorkspace(id = DEFAULT_WORKSPACE, name = "My workspace") {
  db().prepare("INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, ?, ?)").run(id, name, Date.now());
  return id;
}

// Tokens are encrypted at rest whenever AUTH_SECRET is set (as for the other stored secrets); local dev without it stores plain text.
const seal = (v: string) => (authEnabled() ? `enc:${encrypt(v)}` : `plain:${v}`);
const open = (v: string) => (v.startsWith("enc:") ? decrypt(v.slice(4)) : v.replace(/^plain:/, ""));

export type IntegrationRow = {
  id: string;
  workspaceId: string;
  provider: Provider;
  label: string;
  config: Record<string, unknown>;
  status: string;
  lastSyncAt: number | null;
  lastError: string | null;
};

const rowOf = (r: any): IntegrationRow => ({
  id: r.id,
  workspaceId: r.workspace_id,
  provider: r.provider,
  label: r.label,
  config: JSON.parse(r.config_json || "{}"),
  status: r.status,
  lastSyncAt: r.last_sync_at,
  lastError: r.last_error,
});

export function saveIntegration(i: { workspaceId: string; provider: Provider; label: string; config: Record<string, unknown>; secret: string }): string {
  const existing = db().prepare("SELECT id FROM integrations WHERE workspace_id = ? AND provider = ? AND label = ?").get(i.workspaceId, i.provider, i.label) as { id: string } | undefined;
  if (existing) {
    db().prepare("UPDATE integrations SET config_json = ?, secret = ?, status = 'new', last_error = NULL WHERE id = ?").run(JSON.stringify(i.config), seal(i.secret), existing.id);
    return existing.id;
  }
  const id = randomUUID();
  db()
    .prepare("INSERT INTO integrations (id, workspace_id, provider, label, config_json, secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, i.workspaceId, i.provider, i.label, JSON.stringify(i.config), seal(i.secret), Date.now());
  return id;
}

// Never includes the secret: this is what goes to the browser.
export const listIntegrations = (workspaceId: string): IntegrationRow[] =>
  (db().prepare("SELECT * FROM integrations WHERE workspace_id = ? ORDER BY created_at").all(workspaceId) as any[]).map(rowOf);

export function getIntegration(id: string, workspaceId: string): (IntegrationRow & { secret: string }) | null {
  const r = db().prepare("SELECT * FROM integrations WHERE id = ? AND workspace_id = ?").get(id, workspaceId) as any;
  if (!r) return null;
  try {
    return { ...rowOf(r), secret: open(r.secret) };
  } catch {
    // saved under a different AUTH_SECRET: say what to do instead of failing with a cryptic error
    throw new Error("The saved token can no longer be read (the server's AUTH_SECRET changed). Reconnect this integration with a fresh token.");
  }
}

// Changes settings of a connected tool without touching its token. Only known, validated keys.
export function updateIntegrationConfig(id: string, workspaceId: string, patch: { excludeMergeCommits?: boolean; repos?: string[] }): boolean {
  const row = db().prepare("SELECT provider, config_json FROM integrations WHERE id = ? AND workspace_id = ?").get(id, workspaceId) as { provider: string; config_json: string } | undefined;
  if (!row) return false;
  if (patch.excludeMergeCommits !== undefined && row.provider !== "github") return false; // merge commits are a GitHub notion
  if (patch.repos !== undefined && row.provider !== "github") return false; // the repository list is a GitHub notion
  const next = { ...JSON.parse(row.config_json || "{}"), ...(patch.excludeMergeCommits !== undefined ? { excludeMergeCommits: patch.excludeMergeCommits } : {}), ...(patch.repos !== undefined ? { repos: [...new Set(patch.repos)] } : {}) };
  db().prepare("UPDATE integrations SET config_json = ? WHERE id = ? AND workspace_id = ?").run(JSON.stringify(next), id, workspaceId);
  return true;
}

export const removeIntegration = (id: string, workspaceId: string) => void db().prepare("DELETE FROM integrations WHERE id = ? AND workspace_id = ?").run(id, workspaceId);
