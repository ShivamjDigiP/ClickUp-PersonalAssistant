import { db } from "../db";

// Merge commits only join one branch into another: they are not something a person wrote. So by default they are left out of
// every number, list and chart on the platform. The GitHub integration has one setting, "Do not count merge commits",
// ticked by default; unticking it brings them back everywhere.
//
// The setting belongs to the integration, and an integration covers certain repositories (recorded at its last full sync),
// so the rule is decided per repository: merge commits are shown only for repositories covered by an integration where the
// box is unticked. An integration that has not recorded its repositories yet applies its setting to all of them.
export const EXCLUDE_MERGES_DEFAULT = true;

export function mergeCommitsShown(workspaceId: string): (repo: string) => boolean {
  const d = db();
  const integrations = d.prepare("SELECT id, config_json FROM integrations WHERE workspace_id = ? AND provider = 'github'").all(workspaceId) as { id: string; config_json: string }[];
  const shown = new Set<string>();
  let all = false;
  for (const i of integrations) {
    let cfg: { excludeMergeCommits?: boolean } = {};
    try {
      cfg = JSON.parse(i.config_json || "{}");
    } catch {
      /* unreadable config: keep the default */
    }
    if ((cfg.excludeMergeCommits ?? EXCLUDE_MERGES_DEFAULT) !== false) continue;
    const repos = d.prepare("SELECT repo FROM integration_repos WHERE integration_id = ?").all(i.id) as { repo: string }[];
    if (repos.length === 0) all = true;
    for (const r of repos) shown.add(r.repo.toLowerCase());
  }
  return (repo) => all || shown.has(repo.toLowerCase());
}
