import { DAY, type Dataset, type Quality } from "./types";
import { median } from "./stats";

// Migrations (e.g. a Jira import) create or close hundreds of tasks in one day. The tasks are real and are still counted
// and listed (so totals match the task tool), but their dates are not real: left in the speed, on-time and throughput
// numbers they would show a huge burst of "completed" tasks, instant cycle times and wrong on-time rates.
// A day counts as an import day only when it is a huge outlier AND looks like a migration, so a genuine release day
// with many closures is not affected. Flagged tasks are counted and reported, never silently hidden.
export type { Quality };

const MIN_BULK = 25; // fewer tasks than this on one day is never treated as an import
const OUTLIER = 6; // ... and it must be this many times a normal day

const dayOf = (ms: number) => Math.floor(ms / DAY);
const iso = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);

function bulkDays(times: number[]): Set<number> {
  const perDay = new Map<number, number>();
  times.forEach((t) => perDay.set(dayOf(t), (perDay.get(dayOf(t)) ?? 0) + 1));
  const typical = median([...perDay.values()]) ?? 0;
  return new Set([...perDay].filter(([, n]) => n >= MIN_BULK && n >= OUTLIER * Math.max(typical, 1)).map(([d]) => d));
}

// Marks tasks from a bulk import with `imported: true`. Nothing is removed.
export function flagImportedTasks(ds: Dataset): Dataset & { quality: Quality } {
  const createdBulk = bulkDays(ds.tasks.map((t) => t.createdAt));
  const doneBulk = bulkDays(ds.tasks.filter((t) => t.doneAt !== undefined).map((t) => t.doneAt!));
  const importDays = new Set<number>(createdBulk);

  // closed in bulk: only an import if most of that day's closures were also created within a day of being closed
  for (const d of doneBulk) {
    const closed = ds.tasks.filter((t) => t.doneAt !== undefined && dayOf(t.doneAt) === d);
    const instant = closed.filter((t) => t.doneAt! - t.createdAt < DAY).length;
    if (instant / closed.length >= 0.5) importDays.add(d);
  }

  const isImported = (t: Dataset["tasks"][number]) =>
    createdBulk.has(dayOf(t.createdAt)) || (t.doneAt !== undefined && importDays.has(dayOf(t.doneAt)) && t.doneAt - t.createdAt < DAY);
  const tasks = ds.tasks.map((t) => (isImported(t) ? { ...t, imported: true } : t));
  return { ...ds, tasks, quality: { importedTasks: tasks.filter((t) => t.imported).length, importDays: [...importDays].sort().map(iso) } };
}

export const cleanDataset = flagImportedTasks;
