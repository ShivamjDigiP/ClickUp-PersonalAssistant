import { clickup } from "../clickup/client";
import { localDate } from "./schedule";
import type { Payload } from "./send";

// Builds the text of one person's daily digest from their open ClickUp tasks. Must run "as" that person (see runAs),
// so the ClickUp calls use their token. Dates are judged in THEIR time zone: "due today" means today where they are.
export type Digest = Payload & { counts: { overdue: number; dueToday: number; dueSoon: number; open: number } };

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

async function openTasks(teamId: string, userId: number | string) {
  const out: any[] = [];
  for (let page = 0; page < 3; page++) {
    const d = await clickup<{ tasks: any[] }>(`/team/${teamId}/task`, { assignees: [userId], include_closed: false, subtasks: true, page });
    out.push(...d.tasks);
    if (d.tasks.length < 100) break;
  }
  return out;
}

export async function buildDigest(opts: { name: string; tz: string; now?: Date }): Promise<Digest> {
  const now = opts.now ?? new Date();
  const [{ user }, { teams }] = await Promise.all([clickup<{ user: any }>("/user"), clickup<{ teams: any[] }>("/team")]);
  const team = teams[0];
  const tasks = team ? await openTasks(String(team.id), user.id) : [];

  const today = localDate(now.getTime(), opts.tz);
  const weekAhead = localDate(now.getTime() + 7 * 86_400_000, opts.tz);

  let overdue = 0;
  let dueToday = 0;
  let dueSoon = 0;
  const urgent: { due: number; name: string }[] = [];
  for (const t of tasks) {
    if (!t.due_date) continue;
    const due = Number(t.due_date);
    const day = localDate(due, opts.tz); // ISO dates compare correctly as plain text
    if (day < today) {
      overdue++;
      urgent.push({ due, name: String(t.name) });
    } else if (day === today) {
      dueToday++;
      urgent.push({ due, name: String(t.name) });
    } else if (day <= weekAhead) dueSoon++;
  }
  urgent.sort((a, b) => a.due - b.due);

  const parts = [overdue && `${overdue} overdue`, dueToday && `${dueToday} due today`, dueSoon && `${dueSoon} due this week`].filter(Boolean);
  const first = opts.name.split(" ")[0] || "there";
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: opts.tz, hour: "numeric", hourCycle: "h23" }).format(now));

  const body = parts.length
    ? `${parts.join(" · ")}${urgent[0] ? `\nMost urgent: ${short(urgent[0].name, 70)}` : ""}`
    : tasks.length
      ? `Nothing is due. ${tasks.length} open task${tasks.length === 1 ? "" : "s"} in progress.`
      : "No open tasks. Enjoy the quiet.";

  return {
    title: `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Hello"}, ${first}`,
    body,
    url: "/?tab=me",
    tag: "daily-digest", // a newer digest replaces yesterday's instead of piling up
    counts: { overdue, dueToday, dueSoon, open: tasks.length },
  };
}
