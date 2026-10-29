import { changelogItems } from "../analytics/changes";
import { httpJson, limiter } from "./http";
import {
  emptyBatch,
  isBot,
  taskRefOf,
  type Adapter,
  type GitHubConfig,
  type NormCommit,
  type NormPr,
  type PersonHint,
} from "./types";

// GitHub for the CXO platform: the commits and pull requests of a whole organisation or a list of repositories.
//
// WHERE COMMITS COME FROM matters. Real teams do not commit to the default branch: work happens on personal and feature
// branches and lands on develop/staging through pull requests, so reading only the default branch missed almost everything
// (70 commits seen where the pull requests alone held about 1,750). Commits are therefore collected from
//   1. every pull request's own commits (this is where almost all of the work is), and
//   2. direct pushes to the default branch and to every branch pull requests merge into: only commits that belong to NO
//      pull request, so nothing is counted twice,
// and de-duplicated by commit id.
const REST = "https://api.github.com";
const GQL = "https://api.github.com/graphql";
const headers = (secret: string) => ({
  Authorization: `Bearer ${secret}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "cxo-platform",
});

const rest = <T>(
  secret: string,
  path: string,
  params: Record<string, string | number> = {},
) => {
  const url = new URL(REST + path);
  for (const [k, v] of Object.entries(params))
    url.searchParams.set(k, String(v));
  return httpJson<T>(url, { label: "GitHub", headers: headers(secret) });
};
const gql = async <T>(
  secret: string,
  query: string,
  variables: Record<string, unknown>,
) => {
  const res = await httpJson<{ data?: T; errors?: { message: string }[] }>(
    GQL,
    {
      label: "GitHub",
      method: "POST",
      headers: headers(secret),
      body: { query, variables },
      timeoutMs: 90_000,
    },
  );
  if (res.errors?.length && !res.data)
    throw new Error(
      `GitHub: ${res.errors
        .map((e) => e.message)
        .join("; ")
        .slice(0, 300)}`,
    );
  return res.data as T;
};

const COMMIT_FIELDS = `oid authoredDate messageHeadline changedFilesIfAvailable additions deletions parents { totalCount } author { email name user { login } }`;

// Newest-updated first, so reading stops as soon as a page is older than the sync window.
export const PRS_QUERY = `
query($owner:String!, $name:String!, $after:String) {
  repository(owner:$owner, name:$name) {
    defaultBranchRef { name }
    pullRequests(first:25, after:$after, orderBy:{field:UPDATED_AT, direction:DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title body state createdAt updatedAt mergedAt baseRefName headRefName changedFiles additions deletions
        labels(first:6) { nodes { name } }
        author { login ... on User { name } }
        reviews(first:50) { nodes { state submittedAt } }
        commits(first:100) { totalCount pageInfo { hasNextPage endCursor } nodes { commit { ${COMMIT_FIELDS} } } }
      }
    }
  }
}`;

export const BRANCH_QUERY = `
query($owner:String!, $name:String!, $ref:String!, $since:GitTimestamp!, $after:String) {
  repository(owner:$owner, name:$name) {
    ref(qualifiedName:$ref) { target { ... on Commit {
      history(since:$since, first:100, after:$after) {
        pageInfo { hasNextPage endCursor }
        nodes { ${COMMIT_FIELDS} associatedPullRequests(first:1) { totalCount } }
      }
    } } }
  }
}`;

// The rest of a pull request that has more than 100 commits (the first query returns the first 100).
export const MORE_COMMITS_QUERY = `
query($owner:String!, $name:String!, $number:Int!, $after:String) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      commits(first:100, after:$after) { pageInfo { hasNextPage endCursor } nodes { commit { ${COMMIT_FIELDS} } } }
    }
  }
}`;

const REPO_PARALLEL = 3; // repositories read at once: faster, and well inside GitHub's limits
const MAX_EXTRA_COMMIT_PAGES = 8;
const MAX_PR_PAGES = 24; // 600 pull requests per repository per sync
const MAX_BRANCH_PAGES = 5; // 500 direct commits per branch
const MAX_BRANCHES = 8;

type GCommit = {
  oid: string;
  authoredDate: string;
  messageHeadline: string;
  changedFilesIfAvailable?: number | null;
  additions: number;
  deletions: number;
  parents?: { totalCount: number };
  author?: {
    email?: string;
    name?: string;
    user?: { login?: string } | null;
  } | null;
  associatedPullRequests?: { totalCount: number };
};
type GPr = {
  number: number;
  title: string;
  body?: string | null;
  state: "OPEN" | "MERGED" | "CLOSED";
  createdAt: string;
  updatedAt: string;
  mergedAt?: string | null;
  baseRefName: string;
  headRefName: string;
  changedFiles?: number;
  additions: number;
  deletions: number;
  labels?: { nodes: { name: string }[] };
  author?: { login?: string; name?: string } | null;
  reviews?: { nodes: { state: string; submittedAt?: string | null }[] };
  commits?: {
    totalCount: number;
    pageInfo?: { hasNextPage: boolean; endCursor: string | null };
    nodes: { commit: GCommit }[];
  };
};

// "12345+octocat@users.noreply.github.com" says who it is even though the real email is private
const noreplyLogin = (email?: string) =>
  email?.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i)?.[1];

export function commitAuthor(c: GCommit): PersonHint | null {
  const login = c.author?.user?.login ?? noreplyLogin(c.author?.email);
  if (!login || isBot(login)) return null; // no GitHub account to attribute to, or a bot
  const email =
    c.author?.email && !/noreply/i.test(c.author.email)
      ? c.author.email.toLowerCase()
      : undefined;
  return {
    provider: "github",
    externalId: login,
    login,
    name: c.author?.name || undefined,
    email,
  };
}

export async function listRepos(
  secret: string,
  config: GitHubConfig,
  since: number,
): Promise<string[]> {
  if (config.repos?.length) return config.repos;
  const max = config.maxRepos ?? 25;
  const items = config.org
    ? await rest<any[]>(secret, `/orgs/${config.org}/repos`, {
        type: "all",
        sort: "pushed",
        per_page: 100,
      })
    : await rest<any[]>(secret, "/user/repos", {
        sort: "pushed",
        affiliation: "owner,organization_member",
        per_page: 100,
      });
  return items
    .filter((r) => !r.archived && !r.fork && Date.parse(r.pushed_at) >= since)
    .slice(0, max)
    .map((r) => r.full_name as string);
}

export type AccessibleRepo = { name: string; private: boolean; archived: boolean; fork: boolean; pushedAt: number | null };
const MAX_ACCESSIBLE = 300;

// Every repository this token can read (an organisation's, or the user's own), newest activity first, so the person
// connecting can choose which ones count instead of getting everything.
export async function listAccessibleRepos(secret: string, org?: string): Promise<AccessibleRepo[]> {
  const out: AccessibleRepo[] = [];
  for (let page = 1; out.length < MAX_ACCESSIBLE; page++) {
    const items = org
      ? await rest<any[]>(secret, `/orgs/${org}/repos`, { type: "all", sort: "pushed", per_page: 100, page })
      : await rest<any[]>(secret, "/user/repos", { sort: "pushed", affiliation: "owner,organization_member", per_page: 100, page });
    for (const r of items)
      out.push({ name: r.full_name as string, private: !!r.private, archived: !!r.archived, fork: !!r.fork, pushedAt: r.pushed_at ? Date.parse(r.pushed_at) : null });
    if (items.length < 100) break;
  }
  return out.slice(0, MAX_ACCESSIBLE);
}

const toCommit = (repo: string, c: GCommit, prNumber?: number): NormCommit => ({
  repo,
  sha: c.oid,
  author: commitAuthor(c),
  at: Date.parse(c.authoredDate),
  message: c.messageHeadline,
  filesChanged: c.changedFilesIfAvailable ?? undefined,
  parents: c.parents?.totalCount,
  prNumber,
  additions: c.additions,
  deletions: c.deletions,
  taskRef: taskRefOf(c.messageHeadline),
});

export const githubAdapter: Adapter<GitHubConfig> = {
  provider: "github",

  async validate(config, secret) {
    try {
      const me = await rest<{ login: string }>(secret, "/user");
      if (config.org) await rest(secret, `/orgs/${config.org}`);
      return {
        ok: true,
        account: `${me.login}${config.org ? ` · org ${config.org}` : ""}`,
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async sync(config, secret, { since }) {
    const batch = emptyBatch();
    const repos = await listRepos(secret, config, since);
    if (!repos.length)
      batch.notes.push(
        "No repositories with recent activity were found for this token.",
      );
    const people = new Map<string, PersonHint>();
    const note = (p: PersonHint | null) => p && people.set(p.externalId, p);

    const pool = limiter(REPO_PARALLEL);
    await Promise.all(
      repos.map((repo) =>
        pool(async () => {
          const [owner, name] = repo.split("/");
          try {
            const commits = new Map<string, NormCommit>(); // by commit id: a commit in two places is still one commit
            const branches = new Set<string>();
            let after: string | null = null;
            let defaultBranch = "";

            // 1. pull requests, newest-updated first, with their own commits and reviews
            for (let page = 0; page < MAX_PR_PAGES; page++) {
              const data: any = await gql(secret, PRS_QUERY, {
                owner,
                name,
                after,
              });
              defaultBranch ||= data.repository?.defaultBranchRef?.name ?? "";
              const conn = data.repository?.pullRequests;
              const nodes: GPr[] = conn?.nodes ?? [];
              for (const p of nodes) {
                if (Date.parse(p.updatedAt) < since) continue;
                const login = p.author?.login;
                const author: PersonHint | null =
                  login && !isBot(login)
                    ? {
                        provider: "github",
                        externalId: login,
                        login,
                        name: p.author?.name || undefined,
                      }
                    : null;
                note(author);
                const reviews = (p.reviews?.nodes ?? []).filter(
                  (r) => r.state !== "PENDING" && r.submittedAt,
                );
                const first = reviews
                  .map((r) => Date.parse(r.submittedAt!))
                  .sort((a, b) => a - b)[0];
                const pr: NormPr = {
                  repo,
                  number: p.number,
                  author,
                  title: p.title,
                  state:
                    p.state === "MERGED"
                      ? "merged"
                      : p.state === "CLOSED"
                        ? "closed"
                        : "open",
                  baseBranch: p.baseRefName,
                  headBranch: p.headRefName,
                  labels: (p.labels?.nodes ?? []).map((l) => l.name),
                  openedAt: Date.parse(p.createdAt),
                  firstReviewAt: first,
                  mergedAt: p.mergedAt ? Date.parse(p.mergedAt) : undefined,
                  filesChanged: p.changedFiles,
                  commitCount: p.commits?.totalCount ?? 0,
                  reviewRounds: reviews.filter(
                    (r) => r.state === "CHANGES_REQUESTED",
                  ).length,
                  approvals: reviews.filter((r) => r.state === "APPROVED")
                    .length,
                  reviewed: reviews.length > 0,
                  changelogItems: changelogItems(p.body),
                  additions: p.additions,
                  deletions: p.deletions,
                  taskRef: taskRefOf(p.title, p.headRefName),
                };
                batch.prs.push(pr);
                if (p.baseRefName) branches.add(p.baseRefName);
                const take = (nodes: { commit: GCommit }[]) => {
                  for (const { commit } of nodes) {
                    if (Date.parse(commit.authoredDate) < since) continue; // an old commit that this PR merely carries
                    const c = toCommit(repo, commit, p.number);
                    note(c.author);
                    if (!commits.has(c.sha)) commits.set(c.sha, c);
                  }
                };
                take(p.commits?.nodes ?? []);
                // a long-running branch can hold hundreds of commits: keep reading its pages
                let more = p.commits?.pageInfo?.hasNextPage
                  ? p.commits.pageInfo.endCursor
                  : null;
                for (
                  let extra = 0;
                  more && extra < MAX_EXTRA_COMMIT_PAGES;
                  extra++
                ) {
                  const page: any = await gql(secret, MORE_COMMITS_QUERY, {
                    owner,
                    name,
                    number: p.number,
                    after: more,
                  });
                  const conn2 = page.repository?.pullRequest?.commits;
                  take(conn2?.nodes ?? []);
                  more = conn2?.pageInfo?.hasNextPage
                    ? conn2.pageInfo.endCursor
                    : null;
                }
                if (more)
                  batch.notes.push(
                    `${repo} #${p.number}: ${p.commits?.totalCount} commits; only the first ${(MAX_EXTRA_COMMIT_PAGES + 1) * 100} were read.`,
                  );
              }
              const oldest = nodes[nodes.length - 1];
              if (
                !conn?.pageInfo?.hasNextPage ||
                !oldest ||
                Date.parse(oldest.updatedAt) < since
              )
                break; // reached PRs older than the window
              after = conn.pageInfo.endCursor;
              if (page === MAX_PR_PAGES - 1)
                batch.notes.push(
                  `${repo}: more than ${MAX_PR_PAGES * 25} pull requests in the period; only the newest were read.`,
                );
            }

            // 2. direct pushes: commits on the default branch and on the branches PRs merge into that belong to NO pull request
            if (defaultBranch) branches.add(defaultBranch);
            for (const branch of [...branches].slice(0, MAX_BRANCHES)) {
              let cursor: string | null = null;
              for (let page = 0; page < MAX_BRANCH_PAGES; page++) {
                const data: any = await gql(secret, BRANCH_QUERY, {
                  owner,
                  name,
                  ref: `refs/heads/${branch}`,
                  since: new Date(since).toISOString(),
                  after: cursor,
                });
                const history = data.repository?.ref?.target?.history;
                for (const c of (history?.nodes ?? []) as GCommit[]) {
                  if (
                    (c.associatedPullRequests?.totalCount ?? 0) > 0 ||
                    commits.has(c.oid)
                  )
                    continue; // already counted through its pull request
                  const row = toCommit(repo, c);
                  note(row.author);
                  commits.set(row.sha, row);
                }
                if (!history?.pageInfo?.hasNextPage) break;
                cursor = history.pageInfo.endCursor;
                if (page === MAX_BRANCH_PAGES - 1)
                  batch.notes.push(
                    `${repo} (${branch}): more than ${MAX_BRANCH_PAGES * 100} direct commits; only the newest were read.`,
                  );
              }
            }
            batch.commits.push(...commits.values());
          } catch (e) {
            // one unreadable repository (no access, empty) must not lose the rest
            batch.notes.push(
              `${repo} skipped: ${(e as Error).message.slice(0, 160)}`,
            );
          }
        }),
      ),
    );
    batch.people = [...people.values()];
    batch.repos = repos;
    return batch;
  },
};
