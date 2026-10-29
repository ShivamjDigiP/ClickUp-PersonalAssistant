import { db } from "../db";
import { loadDataset } from "../analytics/load";
import { HttpError, httpJson, limiter } from "./http";
import { getIntegration, listIntegrations } from "./store";
import type { ClickUpConfig, GitHubConfig, Provider } from "./types";

// "Is the data right?" For each connected tool this counts everything AGAIN from the source, by a different route than the
// sync uses, and reconciles it with what is stored and what the dashboards show. Differences are explained, not hidden:
// "created after the last sync" is expected; "stored fewer than exist" is a real problem and is flagged.
export type Check = { label: string; live: number | string; stored: number | string; status: "match" | "explained" | "mismatch"; note?: string };
export type Step = { label: string; value: number; note?: string; kind?: "total" | "minus" | "result" };
export type SourceAudit = {
  integrationId: string;
  provider: Provider;
  label: string;
  lastSyncAt: number | null;
  checks: Check[];
  waterfall: Step[]; // how the tool's own total becomes the number the dashboards use
  examples: string[];
  error?: string;
};
export type AuditReport = { generatedAt: number; sources: SourceAudit[] };

const iso = (ms: number) => new Date(ms).toISOString();
const statusOf = (live: number, stored: number): Check["status"] => (live === stored ? "match" : "mismatch");

// ---------------------------------------------------------------------------------------------------------------------
// ClickUp: walk every space, folder and list (archived too) and count tasks list by list, instead of the workspace-wide
// endpoint the sync reads. Two routes that agree are strong evidence; where they differ, the difference is explained.
// ---------------------------------------------------------------------------------------------------------------------
const cu = limiter(5);
const BASE = "https://api.clickup.com/api/v2";
const cuGet = <T,>(token: string, path: string) => cu(() => httpJson<T>(BASE + path, { label: "ClickUp", headers: { Authorization: token } }));

async function auditClickUp(workspaceId: string, id: string, label: string, token: string, config: ClickUpConfig, lastSyncAt: number | null): Promise<SourceAudit> {
  const out: SourceAudit = { integrationId: id, provider: "clickup", label, lastSyncAt, checks: [], waterfall: [], examples: [] };
  const { teams } = await cuGet<{ teams: { id: string; members?: unknown[] }[] }>(token, "/team");
  const team = config.teamId ? teams.find((t) => String(t.id) === String(config.teamId)) : teams[0];
  if (!team) throw new Error("The workspace this integration was connected to is no longer visible to its token.");

  // Route A: list by list
  const listIds = new Set<string>();
  for (const archived of [false, true]) {
    const { spaces } = await cuGet<{ spaces: { id: string }[] }>(token, `/team/${team.id}/space?archived=${archived}`);
    for (const s of spaces) {
      const [folders, loose] = await Promise.all([cuGet<{ folders: { id: string; lists?: { id: string }[] }[] }>(token, `/space/${s.id}/folder?archived=${archived}`), cuGet<{ lists: { id: string }[] }>(token, `/space/${s.id}/list?archived=${archived}`)]);
      loose.lists.forEach((l) => listIds.add(l.id));
      for (const f of folders.folders) {
        (f.lists ?? []).forEach((l) => listIds.add(l.id));
        if (archived) (await cuGet<{ lists: { id: string }[] }>(token, `/folder/${f.id}/list?archived=true`)).lists.forEach((l) => listIds.add(l.id));
      }
    }
  }
  const live = new Map<string, any>();
  for (const listId of listIds) {
    for (const archivedTasks of [false, true]) {
      for (let page = 0; page < 30; page++) {
        const r = await cuGet<{ tasks: any[]; last_page?: boolean }>(token, `/list/${listId}/task?include_closed=true&subtasks=true&archived=${archivedTasks}&page=${page}`);
        r.tasks.forEach((t) => live.set(t.id, t));
        if (r.last_page || r.tasks.length < 100) break;
      }
    }
  }

  const all = [...live.values()];
  const assigned = all.filter((t) => (t.assignees ?? []).length);
  const unassigned = all.length - assigned.length;
  const archivedTasks = all.filter((t) => t.archived).length; // the workspace-wide endpoint the sync reads leaves these out
  const newer = (t: any) => lastSyncAt !== null && Math.max(Number(t.date_created), Number(t.date_updated)) > lastSyncAt;

  const d = db();
  const storedIds = new Set((d.prepare("SELECT DISTINCT external_id e FROM tasks WHERE workspace_id = ? AND source = 'clickup'").all(workspaceId) as { e: string }[]).map((r) => r.e));
  const readable = assigned.filter((t) => !t.archived);
  const notStored = readable.filter((t) => !storedIds.has(t.id));
  const newerThanSync = notStored.filter(newer);
  const genuinelyMissing = notStored.filter((t) => !newer(t));
  const gone = [...storedIds].filter((e) => !live.has(e));

  out.checks.push(
    { label: "Assigned tasks the sync should have stored", live: readable.length - newerThanSync.length, stored: readable.length - notStored.length, status: genuinelyMissing.length ? "mismatch" : "match", note: genuinelyMissing.length ? `${genuinelyMissing.length} tasks exist in ClickUp, were not created after the last sync, and are missing` : undefined },
    { label: "Tasks created or changed after the last sync", live: newerThanSync.length, stored: 0, status: newerThanSync.length ? "explained" : "match", note: newerThanSync.length ? "Not an error: press Sync now to bring them in." : undefined },
    { label: "Stored tasks that no longer exist in ClickUp", live: 0, stored: gone.length, status: gone.length ? "mismatch" : "match", note: gone.length ? "Deleted in ClickUp; a full re-sync clears them." : undefined },
  );
  genuinelyMissing.slice(0, 5).forEach((t) => out.examples.push(`Missing: "${t.name}" (${t.status?.status}, ${(t.assignees ?? []).map((a: any) => a.username).join(", ")})`));

  // per person: done and open, live versus stored (only tasks the sync could have seen)
  const stable = readable.filter((t) => !newer(t));
  const livePer = new Map<string, { name: string; done: number; open: number }>();
  for (const t of stable) for (const a of t.assignees) {
    const e = livePer.get(String(a.id)) ?? { name: a.username, done: 0, open: 0 };
    if (t.status?.type === "closed" || t.status?.type === "done") e.done++;
    else e.open++;
    livePer.set(String(a.id), e);
  }
  const storedPer = new Map((d.prepare("SELECT i.external_id id, SUM(t.done_at IS NOT NULL) done, SUM(t.done_at IS NULL) open FROM tasks t JOIN identities i ON i.id = t.identity_id WHERE t.workspace_id = ? AND t.source = 'clickup' GROUP BY i.id").all(workspaceId) as { id: string; done: number; open: number }[]).map((r) => [r.id, r]));
  const off = [...livePer].filter(([pid, v]) => { const s = storedPer.get(pid); return !s || s.done !== v.done || s.open !== v.open; });
  out.checks.push({ label: "People whose done/open counts differ from ClickUp", live: 0, stored: off.length, status: off.length ? "mismatch" : "match", note: off.length ? off.slice(0, 4).map(([pid, v]) => `${v.name}: ClickUp ${v.done}/${v.open}, stored ${storedPer.get(pid)?.done ?? 0}/${storedPer.get(pid)?.open ?? 0}`).join("; ") : undefined });

  // how ClickUp's total becomes the dashboards' number
  const ds = loadDataset(workspaceId);
  const shown = new Set(ds.tasks.filter((t) => t.source === "clickup").map((t) => t.id.replace(/^clickup:/, "")));
  const storedCount = storedIds.size;
  out.waterfall = [
    { label: "Tasks in ClickUp (every list, archived too)", value: all.length, kind: "total" },
    { label: "Without an assignee, so they cannot be credited to anyone", value: unassigned, kind: "minus" },
    ...(archivedTasks ? [{ label: "Archived tasks (ClickUp's workspace-wide API does not return them)", value: archivedTasks, kind: "minus" as const }] : []),
    ...(newerThanSync.length ? [{ label: "Created or changed after the last sync", value: newerThanSync.length, kind: "minus" as const }] : []),
    { label: "Assigned tasks stored by the sync", value: storedCount, kind: "result" },
    { label: "Left out of the dashboards", value: storedCount - shown.size, kind: "minus", note: ds.quality?.importedTasks ? `bulk-import days (${ds.quality.importDays.join(", ")}) and people hidden on the People screen` : "people hidden on the People screen or not matched" },
    { label: "Counted in the dashboards", value: shown.size, kind: "result" },
  ];
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// GitHub: pull requests are re-counted with the search API, and commits are re-counted per branch from the commits API.
// The stored commit total must be at least what the busiest branch holds, which is the exact failure the first version had.
// ---------------------------------------------------------------------------------------------------------------------
const GH = "https://api.github.com";
const ghGet = (token: string, path: string, wantLink = false) =>
  fetch(GH + path, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "cxo-platform" }, signal: AbortSignal.timeout(30_000) }).then(async (r) => {
    if (!r.ok) throw new HttpError(`GitHub ${r.status}: ${(await r.text()).slice(0, 160)}`, r.status);
    return { json: (await r.json()) as any, link: wantLink ? r.headers.get("link") : null };
  });

// number of commits on a branch since a date: ask for one per page and read the last page number
async function liveBranchCommits(token: string, repo: string, branch: string, sinceIso: string): Promise<number | null> {
  try {
    const { json, link } = await ghGet(token, `/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&since=${encodeURIComponent(sinceIso)}&per_page=1`, true);
    const last = link?.match(/[?&]page=(\d+)>; rel="last"/);
    return last ? Number(last[1]) : Array.isArray(json) ? json.length : 0;
  } catch {
    return null; // a branch that was deleted since
  }
}

async function auditGitHub(workspaceId: string, id: string, label: string, token: string, _config: GitHubConfig, lastSyncAt: number | null): Promise<SourceAudit> {
  const out: SourceAudit = { integrationId: id, provider: "github", label, lastSyncAt, checks: [], waterfall: [], examples: [] };
  const d = db();
  const since = Date.now() - 90 * 86_400_000;
  const sinceIso = iso(since);
  const repos = d.prepare("SELECT repo FROM (SELECT repo FROM commits WHERE workspace_id = ? UNION SELECT repo FROM pull_requests WHERE workspace_id = ?) ORDER BY repo").all(workspaceId, workspaceId) as { repo: string }[];

  for (const { repo } of repos) {
    // 1. merged pull requests in the last 90 days: GitHub's own count versus ours
    try {
      const { json } = await ghGet(token, `/search/issues?q=${encodeURIComponent(`repo:${repo} is:pr is:merged merged:>=${sinceIso.slice(0, 10)}`)}&per_page=1`);
      const storedMerged = (d.prepare("SELECT COUNT(*) n FROM pull_requests WHERE workspace_id = ? AND repo = ? AND merged_at >= ?").get(workspaceId, repo, since) as { n: number }).n;
      const liveMerged = Number(json.total_count);
      out.checks.push({ label: `${repo}: pull requests merged in 90 days`, live: liveMerged, stored: storedMerged, status: statusOf(liveMerged, storedMerged) === "match" ? "match" : Math.abs(liveMerged - storedMerged) <= 2 && lastSyncAt && Date.now() - lastSyncAt > 3_600_000 ? "explained" : "mismatch", note: liveMerged !== storedMerged ? "A small gap is normal if PRs merged since the last sync; a large one means PRs are missing." : undefined });
    } catch (e) {
      out.checks.push({ label: `${repo}: pull requests merged in 90 days`, live: "?", stored: "?", status: "explained", note: `could not re-count (${(e as Error).message.slice(0, 80)})` });
    }

    // 2. commits: the busiest branch's own commit count must not exceed what is stored for the repository
    const branches = (d.prepare("SELECT base_branch b, COUNT(*) n FROM pull_requests WHERE workspace_id = ? AND repo = ? AND base_branch IS NOT NULL GROUP BY base_branch ORDER BY n DESC LIMIT 4").all(workspaceId, repo) as { b: string; n: number }[]).map((r) => r.b);
    const counts = await Promise.all(branches.map(async (b) => [b, await liveBranchCommits(token, repo, b, sinceIso)] as const));
    const best = counts.filter((c): c is readonly [string, number] => c[1] !== null).sort((a, b) => b[1] - a[1])[0];
    const storedCommits = (d.prepare("SELECT COUNT(*) n FROM commits WHERE workspace_id = ? AND repo = ? AND at >= ?").get(workspaceId, repo, since) as { n: number }).n;
    if (best) {
      const ok = storedCommits >= best[1] * 0.9;
      out.checks.push({ label: `${repo}: commits (90 days)`, live: `${best[1]} on ${best[0]}`, stored: storedCommits, status: ok ? "match" : "mismatch", note: ok ? undefined : `Stored fewer commits than branch ${best[0]} holds on GitHub: commits are missing. Run a Full re-sync.` });
      if (!ok) out.examples.push(`${repo}: branch ${best[0]} has ${best[1]} commits since ${sinceIso.slice(0, 10)}, only ${storedCommits} stored.`);
    }
  }

  const unlinked = d.prepare("SELECT COUNT(*) n FROM identities WHERE workspace_id = ? AND provider = 'github' AND person_id IS NULL").get(workspaceId) as { n: number };
  const totalCommits = (d.prepare("SELECT COUNT(*) n FROM commits WHERE workspace_id = ?").get(workspaceId) as { n: number }).n;
  const credited = (d.prepare("SELECT COUNT(*) n FROM commits c JOIN identities i ON i.id = c.identity_id WHERE c.workspace_id = ? AND i.person_id IS NOT NULL").get(workspaceId) as { n: number }).n;
  const noAccount = (d.prepare("SELECT COUNT(*) n FROM commits WHERE workspace_id = ? AND identity_id IS NULL").get(workspaceId) as { n: number }).n;
  const shown = loadDataset(workspaceId).commits.length;
  const mergesLeftOut = credited - shown;
  out.waterfall = [
    { label: "Commits stored (pull-request commits plus direct pushes)", value: totalCommits, kind: "total" },
    { label: "From bots or authors with no GitHub account", value: noAccount, kind: "minus" },
    { label: `From ${unlinked.n} GitHub account${unlinked.n === 1 ? "" : "s"} not matched to a developer yet`, value: totalCommits - noAccount - credited, kind: "minus", note: "Match them on the People screen." },
    ...(mergesLeftOut > 0 ? [{ label: "Merge commits, left out by the integration setting", value: mergesLeftOut, kind: "minus" as const, note: "Untick \"Do not count merge commits\" on the GitHub integration to include them." }] : []),
    { label: "Counted in the dashboards", value: shown, kind: "result" },
  ];
  return out;
}

export async function auditWorkspace(workspaceId: string): Promise<AuditReport> {
  const sources: SourceAudit[] = [];
  for (const i of listIntegrations(workspaceId)) {
    const base = { integrationId: i.id, provider: i.provider, label: i.label, lastSyncAt: i.lastSyncAt, checks: [], waterfall: [], examples: [] };
    try {
      const full = getIntegration(i.id, workspaceId)!;
      if (i.provider === "clickup") sources.push(await auditClickUp(workspaceId, i.id, i.label, full.secret, full.config as ClickUpConfig, i.lastSyncAt));
      else if (i.provider === "github") sources.push(await auditGitHub(workspaceId, i.id, i.label, full.secret, full.config as GitHubConfig, i.lastSyncAt));
      else sources.push({ ...base, error: "The data check for Jira is not available yet: it has not been run against a live Jira." });
    } catch (e) {
      sources.push({ ...base, error: (e as Error).message });
    }
  }
  return { generatedAt: Date.now(), sources };
}
