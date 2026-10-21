import type { ListSummary } from "./clickup/data";

// Chart payloads are built from fetched ClickUp data (never written by the LLM),
// so what you see in a chart is exactly what ClickUp returned.
export type Datum = { label: string; value: number; color?: string };
export type Chart = {
  kind: "donut" | "bars" | "stats";
  title: string;
  data: Datum[];
  center?: string; // text shown inside a donut
};

export function chartsFromSummary(s: ListSummary): Chart[] {
  const out: Chart[] = [];
  const statuses = Object.entries(s.byStatus).map(([label, value]) => ({ label, value }));
  if (statuses.length) out.push({ kind: "donut", title: `${s.name} · by status`, data: statuses, center: `${s.progress}%` });

  const people = Object.entries(s.byAssignee)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  if (people.length) out.push({ kind: "bars", title: `${s.name} · open tasks per person`, data: people });

  out.push({
    kind: "stats",
    title: `${s.name} · attention`,
    data: [
      { label: "Overdue", value: s.overdue.length, color: "var(--coral)" },
      { label: "Due in 7 days", value: s.dueSoon.length, color: "var(--amber)" },
      { label: "Stale 7d+", value: s.stale.length, color: "var(--violet)" },
    ],
  });
  return out;
}
