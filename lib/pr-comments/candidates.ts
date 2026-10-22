import { clickup } from "../clickup/client";
import { isDone, myTasks } from "../clickup/me";
import { currentUser, defaultTeamId } from "../clickup/resolve";
import { assertRepo, github, linkedTaskIds, listMyPrs } from "../git/github";

// What the "Comment from PRs" dialog shows: the person's tasks to choose from, and PRs to tick for the chosen task.
// Only identifiers and titles leave the server.
export type TaskOption = { id: string; name: string; status: string; list: string; url: string };
export type PrOption = {
  key: string;
  repo: string;
  number: number;
  title: string;
  state: "open" | "merged" | "closed";
  url: string;
  linked: boolean; // the PR itself names the chosen task (id in title, description or branch)
};

const MAX_TASK_OPTIONS = 300;
const RECENT_DONE_DAYS = 90;

export async function listTasks(): Promise<TaskOption[]> {
  const [me, teamId] = await Promise.all([currentUser(), defaultTeamId()]);
  const since = Date.now() - RECENT_DONE_DAYS * 86_400_000;
  return (await myTasks(teamId, Number(me.id)))
    .filter((t) => !isDone(t) || Number(t.date_updated) >= since)
    .sort((a, b) => Number(b.date_updated) - Number(a.date_updated))
    .slice(0, MAX_TASK_OPTIONS)
    .map((t) => ({ id: String(t.id).toLowerCase(), name: t.name, status: t.status?.status ?? "", list: t.list?.name ?? "", url: t.url }));
}

// PRs to choose from. Ones that name the chosen task come first and are ready ticked by the dialog.
export async function listPrs(repos: string[], days: number, taskId?: string): Promise<PrOption[]> {
  const prs = (await listMyPrs("all", days, repos, 50)).map((p) => ({
    key: `${p.repo}#${p.number}`,
    repo: p.repo,
    number: p.number,
    title: p.title,
    state: (p.state === "merged" ? "merged" : p.state === "open" ? "open" : "closed") as PrOption["state"],
    url: p.url,
    linked: !!taskId && p.clickup_task_ids.includes(taskId.toLowerCase()),
  }));
  return prs.sort((a, b) => Number(b.linked) - Number(a.linked));
}

// A single PR by pasted link: it may be someone else's or older than the chosen days.
export async function lookupPr(repo: string, number: number, taskId?: string): Promise<PrOption> {
  assertRepo(repo);
  const pr = await github<any>(`/repos/${repo}/pulls/${number}`);
  return {
    key: `${repo}#${number}`,
    repo,
    number,
    title: pr.title,
    state: pr.merged_at ? "merged" : pr.state === "open" ? "open" : "closed",
    url: pr.html_url,
    linked: !!taskId && linkedTaskIds(pr.title, pr.body, pr.head?.ref).includes(taskId.toLowerCase()),
  };
}

// Confirms a pasted ClickUp task exists and is readable, so a typo cannot reach the comment step.
export async function lookupTask(id: string): Promise<TaskOption> {
  const t = await clickup<any>(`/task/${id}`);
  return { id: String(t.id).toLowerCase(), name: t.name, status: t.status?.status ?? "", list: t.list?.name ?? "", url: t.url };
}
