import { githubToken } from "../connections/github";

const API = "https://api.github.com";

// GitHub answers 404/422 (not 403) when a token simply cannot see a private or organisation repository, which looks like
// "not found". Say what is actually going on, since the usual cause is the token's owner, not the request.
export function explain(status: number, body: string): string {
  if ([403, 404, 422].includes(status)) {
    return `GitHub ${status}: the connected token cannot see this repository or PR (or it does not exist). A fine-grained token only covers repositories owned by its "Resource owner" (your own account by default), so an organisation's repositories need the organisation chosen there, plus its approval. Easiest fix: on the Configs tab choose "Use my GitHub CLI login". Details: ${body}`;
  }
  return `GitHub ${status}: ${body}`;
}

export async function github<T = any>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const found = await githubToken();
  if (!found) throw new Error("GitHub is not connected. Ask the user to connect a token on the Configs tab.");
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${found.token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(explain(res.status, (await res.text()).slice(0, 200)));
  return res.json() as Promise<T>;
}

// ClickUp task ids as people write them in branches, titles and commits: "CU-86abc12de", or a task URL.
const TASK_REF = /(?:\bCU-|app\.clickup\.com\/t\/(?:\d+\/)?)([a-z0-9]{6,12})\b/gi;

export function linkedTaskIds(...texts: (string | null | undefined)[]): string[] {
  const ids = new Set<string>();
  for (const text of texts) for (const m of (text ?? "").matchAll(TASK_REF)) ids.add(m[1].toLowerCase());
  return [...ids];
}

// Any repository the connected token can see is fair game; the token's own permissions are the limit.
export function assertRepo(repo: string) {
  // "." and ".." are rejected: they would make the request path climb out of /repos/<owner>/<name>
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || repo.split("/").some((part) => /^\.+$/.test(part))) throw new Error(`"${repo}" is not a repository in owner/name form.`);
}

const repoOf = (repositoryUrl: string) => repositoryUrl.replace(`${API}/repos/`, "");

// `repos` limits the search to those repositories (several repo: qualifiers mean "any of these"); empty = everywhere.
export async function listMyPrs(state: "open" | "closed" | "all", days: number, repos: string[] = [], perPage = 30, withBody = false) {
  repos.forEach(assertRepo);
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const q = ["is:pr", "author:@me", ...(state === "all" ? [] : [`state:${state}`]), `updated:>=${since}`, ...repos.map((r) => `repo:${r}`)].join(" ");
  const { items } = await github<{ items: any[] }>("/search/issues", { q, sort: "updated", per_page: perPage });
  return items.map((i) => ({
    repo: repoOf(i.repository_url),
    number: i.number,
    title: i.title,
    state: i.pull_request?.merged_at ? "merged" : i.state,
    url: i.html_url,
    updated: String(i.updated_at).slice(0, 10),
    draft: !!i.draft,
    ...(withBody ? { body: String(i.body ?? "").slice(0, 800) } : {}),
    merged: i.pull_request?.merged_at ? String(i.pull_request.merged_at).slice(0, 10) : null,
    clickup_task_ids: linkedTaskIds(i.title, i.body),
  }));
}

export async function getPr(repo: string, number: number) {
  assertRepo(repo);
  const [pr, commits] = await Promise.all([
    github<any>(`/repos/${repo}/pulls/${number}`),
    github<any[]>(`/repos/${repo}/pulls/${number}/commits`, { per_page: 30 }),
  ]);
  const messages = commits.map((c) => String(c.commit.message).split("\n")[0]);
  return {
    repo,
    number,
    title: pr.title,
    state: pr.merged_at ? "merged" : pr.state,
    draft: pr.draft,
    url: pr.html_url,
    branch: pr.head.ref,
    base: pr.base.ref,
    author: pr.user?.login,
    description: String(pr.body ?? "").slice(0, 1500),
    changed_files: pr.changed_files,
    additions: pr.additions,
    deletions: pr.deletions,
    commits: messages,
    clickup_task_ids: linkedTaskIds(pr.title, pr.body, pr.head.ref, ...messages),
  };
}

export async function recentCommits(repo: string, days: number) {
  assertRepo(repo);
  const { login } = await github<{ login: string }>("/user");
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const commits = await github<any[]>(`/repos/${repo}/commits`, { author: login, since, per_page: 30 });
  return commits.map((c) => {
    const message = String(c.commit.message).split("\n")[0];
    return { sha: String(c.sha).slice(0, 7), date: String(c.commit.author.date).slice(0, 10), message, url: c.html_url, clickup_task_ids: linkedTaskIds(message) };
  });
}

// Repositories the person has recently opened PRs in: what the Sync dialog offers to pick from.
export async function recentRepos(days = 60): Promise<string[]> {
  const prs = await listMyPrs("all", days, [], 50);
  const count = new Map<string, number>();
  for (const p of prs) count.set(p.repo, (count.get(p.repo) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([repo]) => repo);
}

// The branch name often carries the task id (feature/CU-86abc...), which the PR search results do not include.
export async function branchOf(repo: string, number: number): Promise<string | null> {
  try {
    return (await github<any>(`/repos/${repo}/pulls/${number}`)).head?.ref ?? null;
  } catch {
    return null;
  }
}

export type RepoOption = { name: string; private: boolean };

// Every repository the connected token can see (own, collaborator and organisation), most recently pushed first.
// The Sync dialog lists these so nothing has to be typed.
export async function listAccessibleRepos(maxPages = 5): Promise<RepoOption[]> {
  const out: RepoOption[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await github<any[]>("/user/repos", { per_page: 100, page, sort: "pushed", affiliation: "owner,collaborator,organization_member" });
    out.push(...batch.map((r) => ({ name: String(r.full_name), private: !!r.private })));
    if (batch.length < 100) break;
  }
  return out;
}

// What the PR's own CHANGELOG.md entry says (the lines it added), which describes the change in plain words.
export async function changelogOf(repo: string, number: number): Promise<string | null> {
  try {
    const files = await github<any[]>(`/repos/${repo}/pulls/${number}/files`, { per_page: 100 });
    const file = files.find((f) => /(^|\/)changelog(\.md)?$/i.test(String(f.filename)));
    if (!file?.patch) return null;
    const added = String(file.patch)
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .map((l) => l.slice(1))
      .join("\n")
      .trim();
    return added ? added.slice(0, 1500) : null;
  } catch {
    return null;
  }
}
