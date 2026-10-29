import { DAY, WEEK, type Dataset, type Priority, type TaskRec } from "./types";
import { median, percentile, round } from "./stats";
import type { ChangeKind, Scope } from "./changes";

export const emptyKinds = (): Record<ChangeKind, number> => ({ feature: 0, fix: 0, refactor: 0, docs: 0, test: 0, chore: 0, merge: 0, revert: 0, other: 0 });
export const emptySizes = (): Record<Scope, number> => ({ small: 0, medium: 0, large: 0, bulk: 0 });

// Every number the CXO sees comes from here: plain arithmetic over normalized records, no AI.
export const PRIORITY_WEIGHT: Record<Priority, number> = { urgent: 4, high: 3, normal: 2, low: 1 };
const ON_TIME_GRACE = DAY; // finishing within a day of the due date still counts as on time

export type PeriodMetrics = {
  days: number;
  effectiveDays: number; // the part of the period the person had been around (a 3-week-old account is not measured over 90 days)
  assigned: number; // tasks that landed on the person in the period
  importedDone: number; // tasks closed in the period by a bulk import: counted in the task lists, not in the numbers below
  completed: number;
  completedPoints: number; // priority-weighted, so finishing urgent work counts for more than trivial work
  openNow: number;
  overdueOpen: number;
  completionRate: number | null; // completed / (completed + still open that were assigned in the period)
  onTimeRate: number | null; // among completed tasks that had a due date
  withDueDate: number; // how many completed tasks that is (a rate over one or two tasks says little)
  reworkRate: number | null; // share of completed tasks that were reopened
  cycleDaysMedian: number | null; // started -> done
  cycleDaysP80: number | null;
  throughputPerWeek: number;
  // Code: what was done and how smoothly it shipped. Lines of code are deliberately absent.
  commits: number; // everything attributed to them, merge commits included
  mergeCommits: number; // of those, the commits that only merge one branch into another
  meaningfulCommits: number; // without merges and housekeeping (version bumps, formatting)
  commitKinds: Record<ChangeKind, number>;
  vagueCommits: number; // messages like "wip" or "update": work that cannot be understood from its history
  activeDays: number; // distinct days with a commit or a completed task
  prsMerged: number; // pull requests of their own work (promotions between environments are counted separately)
  prsOpened: number; // opened in the period
  prsOpenNow: number; // still open
  prsClosedUnmerged: number; // closed without being merged
  promotionsMerged: number;
  prsBySize: Record<Scope, number>; // by how far each reached (files touched and changelog items)
  reviewedShare: number | null; // of merged PRs, the share that anyone reviewed
  firstPassRate: number | null; // of reviewed merged PRs, the share approved without a request for changes
  avgReviewRounds: number | null; // requests for changes per reviewed merged PR
  prCycleHoursMedian: number | null; // opened -> merged
  reviewWaitHoursMedian: number | null; // opened -> first review
};

export type PersonMetrics = { personId: string; now: number; current: PeriodMetrics; previous: PeriodMetrics };

const inWindow = (t: number | undefined, from: number, to: number) => t !== undefined && t >= from && t < to;
const dayKey = (ms: number) => Math.floor(ms / DAY);
const hours = (ms: number) => ms / 3_600_000;

export function periodMetrics(ds: Dataset, personId: string, from: number, to: number, since?: number): PeriodMetrics {
  const days = Math.round((to - from) / DAY);
  // rates are per week of the time they could have worked in this period, never less than a week (avoids wild numbers)
  const span = Math.min(Math.max(to - Math.max(from, since ?? from), WEEK), to - from);
  const mine = ds.tasks.filter((t) => t.personId === personId);
  // Tasks from a bulk import are real work but their dates are not (created and closed by the import, not by the person):
  // they stay in the open and overdue counts, and are left out of anything that depends on WHEN work happened.
  const dated = mine.filter((t) => !t.imported);
  const done = dated.filter((t) => inWindow(t.doneAt, from, to));
  const assigned = dated.filter((t) => inWindow(t.createdAt, from, to));
  const openAtEnd = mine.filter((t) => t.createdAt < to && (t.doneAt === undefined || t.doneAt >= to));
  const importedDone = mine.filter((t) => t.imported && inWindow(t.doneAt, from, to)).length;
  const stillOpenFromPeriod = assigned.filter((t) => t.doneAt === undefined || t.doneAt >= to).length;

  const withDue = done.filter((t) => t.dueAt !== undefined);
  const onTime = withDue.filter((t) => t.doneAt! <= t.dueAt! + ON_TIME_GRACE).length;
  const cycles = done.filter((t) => t.startedAt !== undefined).map((t) => Math.max(0, (t.doneAt! - t.startedAt!) / DAY));

  const reworkKnown = done.filter((t) => t.reopened !== undefined);
  const commits = ds.commits.filter((c) => c.personId === personId && inWindow(c.at, from, to));
  const allMerged = ds.prs.filter((p) => p.personId === personId && inWindow(p.mergedAt, from, to));
  const prs = allMerged.filter((p) => !p.promotion); // release steps between environments are not their delivery
  const reviewed = prs.filter((p) => p.reviewed);
  const prsOpened = ds.prs.filter((p) => p.personId === personId && !p.promotion && inWindow(p.openedAt, from, to));

  const active = new Set<number>([...commits.map((c) => dayKey(c.at)), ...done.map((t) => dayKey(t.doneAt!))]);
  const med = (n: number[]) => {
    const m = median(n);
    return m === null ? null : round(m);
  };

  return {
    days,
    effectiveDays: Math.round(span / DAY),
    assigned: assigned.length,
    importedDone,
    completed: done.length,
    completedPoints: done.reduce((n, t) => n + PRIORITY_WEIGHT[t.priority], 0),
    openNow: openAtEnd.length,
    overdueOpen: openAtEnd.filter((t) => t.dueAt !== undefined && t.dueAt < to).length,
    completionRate: done.length + stillOpenFromPeriod ? round(done.length / (done.length + stillOpenFromPeriod), 2) : null,
    onTimeRate: withDue.length ? round(onTime / withDue.length, 2) : null,
    withDueDate: withDue.length,
    reworkRate: reworkKnown.length ? round(reworkKnown.filter((t) => t.reopened! > 0).length / reworkKnown.length, 2) : null,
    cycleDaysMedian: med(cycles),
    cycleDaysP80: cycles.length ? round(percentile(cycles, 0.8)!) : null,
    throughputPerWeek: round((done.length / span) * WEEK, 2),
    commits: commits.length,
    mergeCommits: commits.filter((c) => c.kind === "merge").length,
    meaningfulCommits: commits.filter((c) => !c.trivial).length,
    commitKinds: commits.reduce((k, c) => ((k[c.kind]++), k), emptyKinds()),
    vagueCommits: commits.filter((c) => c.vague).length,
    activeDays: active.size,
    prsMerged: prs.length,
    prsOpened: prsOpened.length,
    prsOpenNow: ds.prs.filter((p) => p.personId === personId && !p.promotion && p.state === "open" && p.openedAt < to).length,
    prsClosedUnmerged: prsOpened.filter((p) => p.state === "closed").length,
    promotionsMerged: allMerged.length - prs.length,
    prsBySize: prs.reduce((k, p) => ((k[p.scope]++), k), emptySizes()),
    reviewedShare: prs.length ? round(reviewed.length / prs.length, 2) : null,
    firstPassRate: reviewed.length ? round(reviewed.filter((p) => p.reviewRounds === 0).length / reviewed.length, 2) : null,
    avgReviewRounds: reviewed.length ? round(reviewed.reduce((n, p) => n + p.reviewRounds, 0) / reviewed.length, 1) : null,
    prCycleHoursMedian: med(prs.map((p) => hours(p.mergedAt! - p.openedAt))),
    reviewWaitHoursMedian: med(prsOpened.filter((p) => p.firstReviewAt !== undefined).map((p) => hours(p.firstReviewAt! - p.openedAt))),
  };
}

export function personMetrics(ds: Dataset, personId: string, now: number, days = 30): PersonMetrics {
  const span = days * DAY;
  const since = ds.people.find((p) => p.id === personId)?.startDate;
  return {
    personId,
    now,
    current: periodMetrics(ds, personId, now - span, now, since),
    previous: periodMetrics(ds, personId, now - 2 * span, now - span, since),
  };
}

// Completed tasks per week for the last `weeks` weeks (oldest first). The capability model resamples these.
export function weeklyThroughput(tasks: TaskRec[], personId: string, now: number, weeks = 12): number[] {
  return Array.from({ length: weeks }, (_, i) => {
    const to = now - (weeks - 1 - i) * WEEK;
    const from = to - WEEK;
    return tasks.filter((t) => t.personId === personId && !t.imported && inWindow(t.doneAt, from, to)).length;
  });
}
