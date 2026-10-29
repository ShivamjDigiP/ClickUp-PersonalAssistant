import { randomUUID } from "node:crypto";
import { db, tx } from "../db";
import { clickupAdapter } from "./clickup";
import { githubAdapter } from "./github";
import { jiraAdapter } from "./jira";
import { backfillStartDates, hintKey, linkIdentities } from "./identity";
import { getIntegration } from "./store";
import type { Adapter, Provider, SyncBatch } from "./types";

export const ADAPTERS: Record<Provider, Adapter<any>> = { clickup: clickupAdapter, github: githubAdapter, jira: jiraAdapter };

const DAY = 86_400_000;
export const FIRST_SYNC_DAYS = 120; // enough for the 90-day view plus the period before it
const OVERLAP = 2 * DAY; // re-read a little before the last sync so a late edit is never missed

export type SyncResult = { ok: true; counts: Record<string, number>; notes: string[] } | { ok: false; error: string };

// After a FULL sync: remember which repositories this integration covers and drop commits and pull requests from repositories
// that no integration in the workspace covers any more. Returns how many rows were removed.
export function pruneUncoveredRepos(workspaceId: string, integrationId: string, repos: string[]): number {
  return tx(() => {
    const d = db();
    d.prepare("DELETE FROM integration_repos WHERE integration_id = ?").run(integrationId);
    const ins = d.prepare("INSERT OR IGNORE INTO integration_repos (integration_id, workspace_id, repo) VALUES (?, ?, ?)");
    for (const r of repos) ins.run(integrationId, workspaceId, r);
    const covered = "SELECT repo FROM integration_repos WHERE workspace_id = ?";
    const c = d.prepare(`DELETE FROM commits WHERE workspace_id = ? AND repo NOT IN (${covered})`).run(workspaceId, workspaceId).changes;
    const p = d.prepare(`DELETE FROM pull_requests WHERE workspace_id = ? AND repo NOT IN (${covered})`).run(workspaceId, workspaceId).changes;
    return Number(c) + Number(p);
  });
}

// Saves a batch in ONE transaction: it lands completely or not at all. Re-running the same batch changes nothing
// (rows are keyed by the tool's own ids), which is what makes syncing safe to repeat.
export function saveBatch(workspaceId: string, batch: SyncBatch, now: number) {
  return tx(() => {
    const d = db();
    const ids = linkIdentities(workspaceId, [...batch.people, ...batch.tasks.map((t) => t.assignee), ...batch.commits.map((c) => c.author).filter((a) => !!a), ...batch.prs.map((p) => p.author).filter((a) => !!a)] as any, now);

    const upTask = d.prepare(
      `INSERT INTO tasks (id, workspace_id, source, external_id, identity_id, project, title, priority, stage, created_at, started_at, done_at, due_at, reopened, url, updated_at, status, parent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET project=excluded.project, title=excluded.title, priority=excluded.priority, stage=excluded.stage,
         created_at=excluded.created_at, started_at=COALESCE(excluded.started_at, tasks.started_at), done_at=excluded.done_at,
         due_at=excluded.due_at, reopened=COALESCE(excluded.reopened, tasks.reopened), url=excluded.url, updated_at=excluded.updated_at, status=excluded.status, parent=excluded.parent`,
    );
    const owners = new Map<string, string[]>(); // task -> its current assignees, to drop rows of people no longer assigned
    for (const t of batch.tasks) {
      const identityId = ids.get(hintKey(t.assignee))!;
      const id = `${workspaceId}:${t.source}:${t.externalId}:${identityId}`;
      upTask.run(id, workspaceId, t.source, t.externalId, identityId, t.project, t.title, t.priority, t.stage, t.createdAt, t.startedAt ?? null, t.doneAt ?? null, t.dueAt ?? null, t.reopened ?? null, t.url ?? null, t.updatedAt, t.status ?? null, t.parent ?? null);
      const k = `${t.source}\u0000${t.externalId}`;
      owners.set(k, [...(owners.get(k) ?? []), id]);
    }
    const del = d.prepare("SELECT id FROM tasks WHERE workspace_id = ? AND source = ? AND external_id = ?");
    const rm = d.prepare("DELETE FROM tasks WHERE id = ?");
    for (const [k, keep] of owners) {
      const [source, external] = k.split("\u0000");
      for (const row of del.all(workspaceId, source, external) as { id: string }[]) if (!keep.includes(row.id)) rm.run(row.id);
    }

    const upCommit = d.prepare(
      `INSERT INTO commits (workspace_id, repo, sha, identity_id, at, additions, deletions, task_ref, message, files_changed, parents, pr_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, repo, sha) DO UPDATE SET identity_id=excluded.identity_id, at=excluded.at, additions=excluded.additions, deletions=excluded.deletions,
         task_ref=excluded.task_ref, message=excluded.message, files_changed=COALESCE(excluded.files_changed, commits.files_changed),
         parents=COALESCE(excluded.parents, commits.parents), pr_number=COALESCE(excluded.pr_number, commits.pr_number)`,
    );
    for (const c of batch.commits)
      upCommit.run(workspaceId, c.repo, c.sha, c.author ? ids.get(hintKey(c.author))! : null, c.at, c.additions, c.deletions, c.taskRef ?? null, c.message, c.filesChanged ?? null, c.parents ?? null, c.prNumber ?? null);

    const upPr = d.prepare(
      `INSERT INTO pull_requests (workspace_id, repo, number, identity_id, title, opened_at, first_review_at, merged_at, additions, deletions, task_ref,
                                 state, base_branch, head_branch, labels, files_changed, commit_count, review_rounds, approvals, reviewed, changelog_items)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, repo, number) DO UPDATE SET identity_id=excluded.identity_id, title=excluded.title, first_review_at=excluded.first_review_at,
         merged_at=excluded.merged_at, additions=excluded.additions, deletions=excluded.deletions, task_ref=excluded.task_ref, state=excluded.state,
         base_branch=excluded.base_branch, head_branch=excluded.head_branch, labels=excluded.labels, files_changed=excluded.files_changed,
         commit_count=excluded.commit_count, review_rounds=excluded.review_rounds, approvals=excluded.approvals, reviewed=excluded.reviewed, changelog_items=excluded.changelog_items`,
    );
    for (const p of batch.prs)
      upPr.run(
        workspaceId, p.repo, p.number, p.author ? ids.get(hintKey(p.author))! : null, p.title, p.openedAt, p.firstReviewAt ?? null, p.mergedAt ?? null, p.additions, p.deletions, p.taskRef ?? null,
        p.state, p.baseBranch, p.headBranch, p.labels.join(","), p.filesChanged ?? null, p.commitCount, p.reviewRounds, p.approvals, p.reviewed ? 1 : 0, p.changelogItems,
      );

    backfillStartDates(workspaceId);
    return { people: ids.size, tasks: batch.tasks.length, commits: batch.commits.length, prs: batch.prs.length };
  });
}

export async function syncIntegration(workspaceId: string, integrationId: string, opts: { now?: number; full?: boolean } = {}): Promise<SyncResult> {
  let integ: ReturnType<typeof getIntegration>;
  try {
    integ = getIntegration(integrationId, workspaceId);
  } catch (e) {
    db().prepare("UPDATE integrations SET status = 'error', last_error = ? WHERE id = ? AND workspace_id = ?").run((e as Error).message, integrationId, workspaceId);
    return { ok: false, error: (e as Error).message };
  }
  if (!integ) return { ok: false, error: "Integration not found" };
  const now = opts.now ?? Date.now();
  const since = integ.lastSyncAt && !opts.full ? integ.lastSyncAt - OVERLAP : now - FIRST_SYNC_DAYS * DAY;
  const runId = randomUUID();
  db().prepare("INSERT INTO sync_runs (id, workspace_id, integration_id, started_at, status) VALUES (?, ?, ?, ?, 'running')").run(runId, workspaceId, integrationId, now);

  try {
    const batch = await ADAPTERS[integ.provider].sync(integ.config, integ.secret, { since, now });
    const counts: Record<string, number> = { ...saveBatch(workspaceId, batch, now) };
    const full = opts.full || !integ.lastSyncAt;
    if (full && batch.repos) {
      const removed = pruneUncoveredRepos(workspaceId, integrationId, batch.repos);
      if (removed) batch.notes.push(`Removed ${removed} commits and pull requests from repositories that are no longer connected.`);
    }
    db().prepare("UPDATE sync_runs SET finished_at = ?, status = 'ok', counts_json = ? WHERE id = ?").run(Date.now(), JSON.stringify({ ...counts, notes: batch.notes }), runId);
    db().prepare("UPDATE integrations SET status = 'ok', last_sync_at = ?, last_error = NULL WHERE id = ?").run(now, integrationId);
    return { ok: true, counts, notes: batch.notes };
  } catch (e) {
    const error = (e as Error).message;
    db().prepare("UPDATE sync_runs SET finished_at = ?, status = 'error', error = ? WHERE id = ?").run(Date.now(), error, runId);
    db().prepare("UPDATE integrations SET status = 'error', last_error = ? WHERE id = ?").run(error, integrationId);
    return { ok: false, error };
  }
}
