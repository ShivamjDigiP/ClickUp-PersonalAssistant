import { DAY, type CommitRec, type Dataset, type Level, type Person, type Priority, type PrRec, type TaskRec } from "./types";
import { mulberry32 } from "./stats";
import type { ChangeKind } from "./changes";

// Realistic made-up history so the analysis can be built, tested and demoed before any real integration is connected.
// Each profile is deliberately different, so the model has something to tell apart.
type Profile = {
  id: string;
  name: string;
  level: Level;
  joinedDaysAgo: number;
  tasksPerWeek: number;
  onTime: number; // chance a task is finished by its due date
  rework: number; // chance a finished task comes back
  cycleDays: number; // typical start->done
  commitsPerDay: number;
  linesPerCommit: number;
  reviewWaitHours: number;
};

export const PROFILES: Profile[] = [
  { id: "p-aria", name: "Aria Shah", level: "senior", joinedDaysAgo: 900, tasksPerWeek: 5.5, onTime: 0.92, rework: 0.03, cycleDays: 2, commitsPerDay: 3.2, linesPerCommit: 70, reviewWaitHours: 3 },
  { id: "p-ben", name: "Ben Carter", level: "mid", joinedDaysAgo: 500, tasksPerWeek: 3.2, onTime: 0.78, rework: 0.08, cycleDays: 3.5, commitsPerDay: 2.2, linesPerCommit: 90, reviewWaitHours: 8 },
  { id: "p-chen", name: "Chen Wei", level: "junior", joinedDaysAgo: 260, tasksPerWeek: 1.4, onTime: 0.45, rework: 0.28, cycleDays: 7, commitsPerDay: 1.1, linesPerCommit: 140, reviewWaitHours: 20 },
  { id: "p-dara", name: "Dara Okafor", level: "senior", joinedDaysAgo: 1200, tasksPerWeek: 3.0, onTime: 0.85, rework: 0.05, cycleDays: 2.8, commitsPerDay: 1.4, linesPerCommit: 55, reviewWaitHours: 4 },
  // joined three weeks ago: the model must say "not enough history" instead of judging
  { id: "p-eli", name: "Eli Novak", level: "mid", joinedDaysAgo: 21, tasksPerWeek: 2.0, onTime: 0.7, rework: 0.1, cycleDays: 4, commitsPerDay: 1.5, linesPerCommit: 80, reviewWaitHours: 10 },
];

const PRIORITIES: Priority[] = ["urgent", "high", "normal", "normal", "normal", "low"];
const PROJECTS = ["Imported from Jira", "Mobile App", "Admin Portal"];
const HISTORY_DAYS = 150;

export function seedDataset(now: number, seed = 42): Dataset {
  const rand = mulberry32(seed);
  const people: Person[] = [];
  const tasks: TaskRec[] = [];
  const commits: CommitRec[] = [];
  const prs: PrRec[] = [];
  let n = 0;

  for (const p of PROFILES) {
    people.push({ id: p.id, name: p.name, level: p.level, role: "developer", startDate: now - p.joinedDaysAgo * DAY });
    const from = now - Math.min(p.joinedDaysAgo, HISTORY_DAYS) * DAY;

    // tasks: arrive at the person's rate, each one finished (or not yet) following their habits
    const total = Math.round((((now - from) / DAY) * p.tasksPerWeek) / 7);
    for (let i = 0; i < total; i++) {
      const created = from + rand() * (now - from - DAY);
      const started = created + rand() * 1.5 * DAY;
      const cycle = Math.max(0.3, p.cycleDays * (0.5 + rand())) * DAY;
      const due = created + (3 + rand() * 6) * DAY;
      const doneAt = started + cycle;
      const late = rand() > p.onTime;
      const finishedAt = late ? Math.max(doneAt, due + (1 + rand() * 4) * DAY) : Math.min(doneAt, due);
      const open = finishedAt > now;
      tasks.push({
        id: `t${++n}`,
        personId: p.id,
        project: PROJECTS[Math.floor(rand() * PROJECTS.length)],
        title: `Task ${n}`,
        priority: PRIORITIES[Math.floor(rand() * PRIORITIES.length)],
        stage: open ? (started > now ? "todo" : rand() > 0.5 ? "review" : "doing") : "done",
        createdAt: created,
        startedAt: started <= now ? started : undefined,
        doneAt: open ? undefined : finishedAt,
        dueAt: due,
        reopened: !open && rand() < p.rework ? 1 : 0,
      });
    }

    // commits: weekdays only, a few per day, with linked task ids sometimes
    for (let d = from; d < now; d += DAY) {
      const dow = new Date(d).getUTCDay();
      if (dow === 0 || dow === 6 || rand() < 0.1) continue;
      const count = Math.round(p.commitsPerDay * (0.4 + rand() * 1.2));
      for (let c = 0; c < count; c++) {
        // mostly real changes; people with more rework write vaguer messages and make more merge/housekeeping commits
        const r = rand();
        const kind: ChangeKind = r < 0.08 + p.rework ? "merge" : r < 0.14 + p.rework ? "chore" : r < 0.5 ? "feature" : r < 0.85 ? "fix" : "refactor";
        commits.push({ personId: p.id, repo: "acme/app", sha: `${p.id}-${commits.length}`, at: d + (9 + rand() * 9) * 3_600_000, message: kind === "merge" ? "Merge branch develop" : `${kind}: change ${commits.length}`, kind, trivial: kind === "merge" || kind === "chore", vague: rand() < p.rework, filesChanged: 1 + Math.floor(rand() * 8) });
      }
      // roughly one merged PR every other working day for the busier people
      if (rand() < Math.min(0.6, p.tasksPerWeek / 8)) {
        const opened = d + 10 * 3_600_000;
        const review = opened + p.reviewWaitHours * (0.5 + rand()) * 3_600_000;
        const files = 1 + Math.floor(rand() * 25);
        prs.push({
          personId: p.id, repo: "acme/app", number: prs.length + 1, title: `Change ${prs.length + 1}`, state: "merged", openedAt: opened, firstReviewAt: review, mergedAt: review + (2 + rand() * 20) * 3_600_000,
          kind: rand() < 0.5 ? "feature" : "fix", scope: files <= 3 ? "small" : files <= 15 ? "medium" : "large", filesChanged: files, commitCount: 1 + Math.floor(rand() * 6),
          reviewRounds: rand() < p.rework * 2 ? 1 + Math.floor(rand() * 2) : 0, approvals: 1, reviewed: true, promotion: false,
        });
      }
    }
  }
  return { people, tasks: tasks.sort((a, b) => a.createdAt - b.createdAt), commits, prs: prs.filter((x) => x.mergedAt! <= now) };
}
