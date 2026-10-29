import { analyzeTeam, capacityOver, forecastCompletion, type PersonCard } from "./capability";
import { DAY, WEEK, type Dataset, type Role } from "./types";
import { round } from "./stats";

// One place that turns the dataset into everything a dashboard (and the CXO chat) shows, so the numbers always agree.
export type Risk = { personId: string; name: string; kind: "overdue" | "no_output" | "quiet" | "down" | "prs"; message: string };

export type Overview = {
  days: number;
  generatedAt: number;
  hasData: boolean;
  totals: {
    people: number;
    assigned: number;
    completed: number;
    completedPrev: number;
    openNow: number;
    overdueOpen: number;
    onTimeRate: number | null;
    commits: number;
    mergeCommits: number;
    prsMerged: number;
    prsOpenNow: number;
  };
  // plain counts of what is going on, in place of any grading
  pulse: { active7d: number; withOverdue: number; withOpenPrs: number };
  cards: (Omit<PersonCard, "profile" | "metrics"> & {
    metrics: PersonCard["metrics"];
    history: { weeks: number; samples: number; confidence: PersonCard["profile"]["confidence"] };
    weekly: number[]; // completed per week, for the sparkline
    capacity14d: { low: number; likely: number; high: number } | null;
  })[];
  quality: { importedTasks: number; importDays: string[] };
  risks: Risk[];
  weekly: { weekStart: number; completed: number; commits: number }[]; // team trend, last 12 weeks
};

// Only the people with this role, and only their work: so "developers" really means developers everywhere on the page.
export function onlyRole(ds: Dataset, role: Role): Dataset {
  const ids = new Set(ds.people.filter((p) => p.role === role).map((p) => p.id));
  return { ...ds, people: ds.people.filter((p) => ids.has(p.id)), tasks: ds.tasks.filter((t) => ids.has(t.personId)), commits: ds.commits.filter((c) => ids.has(c.personId)), prs: ds.prs.filter((p) => ids.has(p.personId)) };
}

export function buildOverview(ds: Dataset, now: number, days: number, role?: Role): Overview {
  if (role) ds = onlyRole(ds, role);
  // the most active first: what they finished plus their commits and merged pull requests in the period
  const volume = (c: PersonCard) => c.metrics.current.completed + c.metrics.current.commits + c.metrics.current.prsMerged;
  const cards = analyzeTeam(ds, now, days).sort((a, b) => volume(b) - volume(a) || a.person.name.localeCompare(b.person.name));
  const sum = (f: (c: PersonCard) => number) => cards.reduce((n, c) => n + f(c), 0);
  const withRate = cards.filter((c) => c.metrics.current.onTimeRate !== null && c.metrics.current.completed > 0);
  const weightTotal = withRate.reduce((n, c) => n + c.metrics.current.completed, 0);

  const pulse = {
    active7d: ds.people.filter((p) => ds.tasks.some((t) => t.personId === p.id && !t.imported && t.doneAt !== undefined && t.doneAt > now - WEEK && t.doneAt <= now) || ds.commits.some((c) => c.personId === p.id && c.at > now - WEEK && c.at <= now)).length,
    withOverdue: cards.filter((c) => c.metrics.current.overdueOpen > 0).length,
    withOpenPrs: cards.filter((c) => c.metrics.current.prsOpenNow > 0).length,
  };

  const risks: Risk[] = [];
  for (const c of cards) {
    const name = c.person.name;
    // the same plain facts shown on the person's page: only the ones that need attention are listed here
    const kinds: Record<string, Risk["kind"]> = { overdue: "overdue", nothing: "no_output", quiet: "quiet", down: "down", prs: "prs" };
    for (const n of c.notes) if (n.tone === "attention" && kinds[n.key]) risks.push({ personId: c.person.id, name, kind: kinds[n.key], message: `${name}: ${n.text}` });
  }

  const weeks = Array.from({ length: 12 }, (_, i) => {
    const end = now - (11 - i) * WEEK;
    const start = end - WEEK;
    return {
      weekStart: start,
      completed: ds.tasks.filter((t) => !t.imported && t.doneAt !== undefined && t.doneAt >= start && t.doneAt < end).length,
      commits: ds.commits.filter((c) => c.at >= start && c.at < end).length,
    };
  });

  return {
    days,
    generatedAt: now,
    hasData: ds.people.length > 0 && (ds.tasks.length > 0 || ds.commits.length > 0),
    totals: {
      people: ds.people.length,
      assigned: sum((c) => c.metrics.current.assigned),
      completed: sum((c) => c.metrics.current.completed),
      completedPrev: sum((c) => c.metrics.previous.completed),
      openNow: sum((c) => c.metrics.current.openNow),
      overdueOpen: sum((c) => c.metrics.current.overdueOpen),
      onTimeRate: weightTotal ? round(withRate.reduce((n, c) => n + c.metrics.current.onTimeRate! * c.metrics.current.completed, 0) / weightTotal, 2) : null,
      commits: sum((c) => c.metrics.current.commits),
      prsMerged: sum((c) => c.metrics.current.prsMerged),
      mergeCommits: sum((c) => c.metrics.current.mergeCommits),
      prsOpenNow: sum((c) => c.metrics.current.prsOpenNow),
    },
    pulse,
    quality: ds.quality ?? { importedTasks: 0, importDays: [] },
    cards: cards.map(({ profile, ...c }) => ({
      ...c,
      weekly: profile.weekly,
      history: { weeks: profile.weeksOfHistory, samples: profile.samples, confidence: profile.confidence },
      capacity14d: profile.confidence === "none" ? null : (({ low, likely, high }) => ({ low, likely, high }))(capacityOver(ds, c.person, 14, now)),
    })),
    risks,
    weekly: weeks,
  };
}

// "Their open work, when is it done?" for the developer page: forecast over the tasks they have open right now.
export function personForecast(ds: Dataset, personId: string, now: number) {
  const person = ds.people.find((p) => p.id === personId);
  if (!person) return null;
  const open = ds.tasks.filter((t) => t.personId === personId && t.doneAt === undefined && t.createdAt <= now).length;
  return { openTasks: open, forecast: open > 0 ? forecastCompletion(ds, person, open, now) : null, capacity: capacityOver(ds, person, 14, now), daysSinceJoined: Math.round((now - person.startDate) / DAY) };
}
