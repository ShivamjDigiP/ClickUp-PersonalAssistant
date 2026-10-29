import { httpJson } from "./http";
import { emptyBatch, priorityOf, stageOfStatus, type Adapter, type JiraConfig, type NormTask, type PersonHint } from "./types";

// Jira Cloud for the CXO platform: issues assigned to people, with real start and reopen history from the changelog.
// NOTE: written against Atlassian's published REST v3 docs and covered by mocked-response tests; it has not been run
// against a live Jira yet (no credentials were available). First live run: connect, press "Test", then sync, and check
// the counts against Jira.
//
// Only *.atlassian.net sites are accepted: the site name comes from user input and becomes a server-side request URL,
// so arbitrary hosts would let someone aim this server at internal addresses.
const SITE = /^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$/i;
export const cleanSite = (site: string) => site.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();

const auth = (cfg: JiraConfig, token: string) => ({ Authorization: `Basic ${Buffer.from(`${cfg.email}:${token}`).toString("base64")}` });
const base = (cfg: JiraConfig) => {
  const site = cleanSite(cfg.site);
  if (!SITE.test(site)) throw new Error("Jira site must look like yourcompany.atlassian.net");
  return `https://${site}`;
};

type Issue = {
  id: string;
  key: string;
  fields: {
    summary?: string;
    created?: string;
    updated?: string;
    duedate?: string | null;
    resolutiondate?: string | null;
    status?: { name?: string; statusCategory?: { key?: string } };
    priority?: { name?: string } | null;
    project?: { name?: string };
    assignee?: { accountId: string; displayName?: string; emailAddress?: string } | null;
    parent?: { key?: string } | null;
  };
  changelog?: { histories?: { created: string; items: { field: string; fromString?: string; toString?: string }[] }[] };
};

const FIELDS = ["summary", "created", "updated", "duedate", "resolutiondate", "status", "priority", "project", "assignee", "parent"];

// Walk the status changes in time order: when work first started, when it was finished, how many times it came back.
export function historyOf(issue: Issue) {
  const moves = (issue.changelog?.histories ?? [])
    .flatMap((h) => h.items.filter((i) => i.field === "status").map((i) => ({ at: Date.parse(h.created), from: i.fromString ?? "", to: i.toString ?? "" })))
    .sort((a, b) => a.at - b.at);
  const wasDone = (s: string) => stageOfStatus(s) === "done";
  const working = (s: string) => ["doing", "review"].includes(stageOfStatus(s));
  const startedAt = moves.find((m) => working(m.to))?.at;
  const reopened = moves.filter((m) => wasDone(m.from) && !wasDone(m.to)).length;
  const lastDone = [...moves].reverse().find((m) => wasDone(m.to))?.at;
  return { startedAt, reopened, lastDone };
}

export function toTask(issue: Issue, site: string, now: number): NormTask | null {
  const f = issue.fields;
  const a = f.assignee;
  if (!a) return null;
  const done = f.status?.statusCategory?.key === "done";
  const h = historyOf(issue);
  const stage = done ? "done" : stageOfStatus(f.status?.name ?? "") === "todo" && f.status?.statusCategory?.key === "indeterminate" ? "doing" : stageOfStatus(f.status?.name ?? "");
  return {
    source: "jira",
    externalId: issue.key,
    assignee: { provider: "jira", externalId: a.accountId, name: a.displayName, email: a.emailAddress?.toLowerCase() },
    project: f.project?.name ?? "No project",
    title: f.summary ?? issue.key,
    priority: priorityOf(f.priority?.name),
    stage,
    status: f.status?.name ?? "",
    parent: f.parent?.key,
    createdAt: Date.parse(f.created ?? "") || now,
    startedAt: h.startedAt,
    doneAt: done ? (f.resolutiondate ? Date.parse(f.resolutiondate) : (h.lastDone ?? Date.parse(f.updated ?? ""))) || undefined : undefined,
    dueAt: f.duedate ? Date.parse(`${f.duedate}T23:59:59Z`) : undefined,
    reopened: h.reopened, // Jira's changelog makes this exact
    url: `https://${site}/browse/${issue.key}`,
    updatedAt: Date.parse(f.updated ?? "") || now,
  };
}

export const jiraAdapter: Adapter<JiraConfig> = {
  provider: "jira",

  async validate(config, secret) {
    try {
      const me = await httpJson<{ displayName?: string; emailAddress?: string }>(`${base(config)}/rest/api/3/myself`, { label: "Jira", headers: auth(config, secret) });
      return { ok: true, account: `${me.displayName ?? me.emailAddress ?? config.email} · ${cleanSite(config.site)}` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async sync(config, secret, { since, now }) {
    const batch = emptyBatch();
    const root = base(config);
    const site = cleanSite(config.site);
    const day = new Date(since).toISOString().slice(0, 10);
    const projects = config.projects?.length ? ` AND project in (${config.projects.map((p) => `"${p.replace(/"/g, "")}"`).join(",")})` : "";
    // touched since the last sync, plus everything not finished yet (old open work still counts as workload)
    const jql = `(updated >= "${day}" OR statusCategory != Done) AND assignee is not EMPTY${projects} ORDER BY updated DESC`;
    const people = new Map<string, PersonHint>();

    let next: string | undefined;
    for (let page = 0; page < 30; page++) {
      const res: { issues: Issue[]; nextPageToken?: string } = await httpJson(`${root}/rest/api/3/search/jql`, {
        label: "Jira",
        method: "POST",
        headers: auth(config, secret),
        body: { jql, fields: FIELDS, expand: "changelog", maxResults: 100, ...(next ? { nextPageToken: next } : {}) },
      });
      for (const issue of res.issues) {
        const t = toTask(issue, site, now);
        if (!t) continue;
        batch.tasks.push(t);
        people.set(t.assignee.externalId, t.assignee);
      }
      next = res.nextPageToken;
      if (!next) break;
    }
    if (next) batch.notes.push("Jira: stopped after 3000 issues; narrow the projects to read the rest.");
    batch.people = [...people.values()];
    return batch;
  },
};
