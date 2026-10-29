import { ALL_DAYS, DAY, WEEK, periodLabel, type Dataset, type Level, type Person } from "./types";
import { personMetrics, weeklyThroughput, type PersonMetrics } from "./metrics";
import { clamp, hashSeed, mulberry32, percentile, round } from "./stats";

// The "capability model": a transparent statistical baseline per person, not a trained black box.
//  - What a person delivers is learned from THEIR OWN weekly history.
//  - While they have little history, the CXO-set experience level is the prior; the more completed work
//    they have, the more the baseline is their own numbers (weight = completed tasks in 90 days / 20).
//  - Forecasts resample that weekly history (Monte Carlo), so the answer is a range with a confidence, not one date.
export const LEVEL_PRIOR: Record<Level, { perWeek: number; cycleDays: number }> = {
  junior: { perWeek: 2, cycleDays: 5 },
  mid: { perWeek: 3, cycleDays: 3.5 },
  senior: { perWeek: 4, cycleDays: 2.5 },
};

export type Confidence = "none" | "low" | "medium" | "high";

export type CapabilityProfile = {
  weeksOfHistory: number; // calendar weeks since they joined (capped at 12): 20 tasks in 2 weeks is not a track record
  samples: number; // completed tasks in the last 90 days
  weight: number; // 0..1 how much the baseline is the person's own data rather than the level prior
  confidence: Confidence;
  observedPerWeek: number;
  expectedPerWeek: number;
  weekly: number[]; // completed per week over the last 12 weeks (only weeks since they joined), oldest first
};

export function capabilityProfile(ds: Dataset, person: Person, now: number): CapabilityProfile {
  const all = weeklyThroughput(ds.tasks, person.id, now, 12);
  // weeks before they joined are not zero output, just no data: only use the weeks they were here
  const present = Math.min(12, Math.max(1, Math.ceil((now - person.startDate) / WEEK)));
  const weekly = all.slice(12 - present);
  const samples = weekly.reduce((a, b) => a + b, 0);
  const observedPerWeek = samples / present;
  const weight = clamp(samples / 20);
  const prior = LEVEL_PRIOR[person.level].perWeek;
  const bySamples: Confidence = samples < 5 ? "none" : samples < 10 ? "low" : samples < 20 ? "medium" : "high";
  // calendar cap: under 4 weeks of history is at most "low", under 8 weeks at most "medium"
  const cap: Confidence = present < 4 ? "low" : present < 8 ? "medium" : "high";
  const order: Confidence[] = ["none", "low", "medium", "high"];
  return {
    weeksOfHistory: present,
    samples,
    weight,
    confidence: order[Math.min(order.indexOf(bySamples), order.indexOf(cap))],
    observedPerWeek: round(observedPerWeek, 2),
    expectedPerWeek: round(weight * observedPerWeek + (1 - weight) * prior, 2),
    weekly,
  };
}

const MAX_WEEKS = 104;

function drawWeek(profile: CapabilityProfile, prior: number, rand: () => number) {
  if (rand() < profile.weight && profile.weekly.length) return profile.weekly[Math.floor(rand() * profile.weekly.length)];
  return prior * (0.7 + 0.6 * rand()); // thin history: the level prior with some natural variation
}

export type Forecast = {
  tasks: number;
  p50: number; // epoch ms
  p80: number;
  p95: number;
  weeksP50: number;
  weeksP80: number;
  confidence: Confidence;
};

// "These N tasks: when are they done?" Uses the person's own weekly throughput; same input always gives the same answer.
export function forecastCompletion(ds: Dataset, person: Person, tasks: number, now: number, sims = 2000): Forecast | null {
  if (tasks <= 0) return null;
  const profile = capabilityProfile(ds, person, now);
  const prior = LEVEL_PRIOR[person.level].perWeek;
  const rand = mulberry32(hashSeed(`${person.id}:${tasks}:${Math.floor(now / DAY)}`));
  const results: number[] = [];
  for (let s = 0; s < sims; s++) {
    let done = 0;
    let weeks = 0;
    while (done < tasks && weeks < MAX_WEEKS) {
      const w = Math.max(0, drawWeek(profile, prior, rand));
      if (done + w >= tasks) {
        weeks += w > 0 ? (tasks - done) / w : 1;
        done = tasks;
      } else {
        done += w;
        weeks += 1;
      }
    }
    results.push(weeks);
  }
  const at = (p: number) => percentile(results, p)!;
  const date = (weeks: number) => now + weeks * WEEK;
  return {
    tasks,
    p50: date(at(0.5)),
    p80: date(at(0.8)),
    p95: date(at(0.95)),
    weeksP50: round(at(0.5)),
    weeksP80: round(at(0.8)),
    confidence: profile.confidence,
  };
}

// "How much can they take on over the next N days?" Range of tasks completed, from the same resampling.
export function capacityOver(ds: Dataset, person: Person, days: number, now: number, sims = 2000) {
  const profile = capabilityProfile(ds, person, now);
  const prior = LEVEL_PRIOR[person.level].perWeek;
  const rand = mulberry32(hashSeed(`cap:${person.id}:${days}:${Math.floor(now / DAY)}`));
  const out: number[] = [];
  for (let s = 0; s < sims; s++) {
    let total = 0;
    for (let left = days / 7; left > 0; left -= 1) total += Math.max(0, drawWeek(profile, prior, rand)) * Math.min(1, left);
    out.push(total);
  }
  return { days, low: round(percentile(out, 0.2)!), likely: round(percentile(out, 0.5)!), high: round(percentile(out, 0.8)!), confidence: profile.confidence };
}

// ---- what is going on ---------------------------------------------------------------------------------------------
//
// There is NO score, ranking or grade anywhere. People are not machines to be rated: the platform shows what each person
// did (tasks, commits, pull requests) and, where something is worth a conversation, says so in plain words.

export type Note = { key: string; text: string; tone: "info" | "attention" };

export type PersonCard = {
  person: Person;
  metrics: PersonMetrics;
  profile: CapabilityProfile;
  usesCode: boolean; // has commits or pull requests (a developer); designers and others work in the task tool only
  notes: Note[]; // what is going on, as plain facts
  completedDelta: number; // completed now vs the previous period
};

// The role says what is followed: developers through tasks and GitHub work, everyone else through tasks. Until a role is set,
// anyone with commits or pull requests is treated as a developer.
const hasCode = (ds: Dataset, person: Person) => (person.role ? person.role === "developer" : ds.commits.some((c) => c.personId === person.id) || ds.prs.some((p) => p.personId === person.id));

export function personCard(ds: Dataset, person: Person, now: number, days: number): PersonCard {
  const metrics = personMetrics(ds, person.id, now, days);
  const profile = capabilityProfile(ds, person, now);
  const usesCode = hasCode(ds, person);
  const cur = metrics.current;

  const notes: Note[] = [];
  const mine = ds.tasks.filter((t) => t.personId === person.id && !t.imported);
  const lastDone = Math.max(0, ...mine.filter((t) => t.doneAt !== undefined && t.doneAt <= now).map((t) => t.doneAt!));
  const lastCommit = Math.max(0, ...ds.commits.filter((x) => x.personId === person.id && x.at <= now).map((x) => x.at));
  const quietDays = Math.floor((now - Math.max(lastDone, lastCommit)) / DAY);
  if (cur.overdueOpen > 0) notes.push({ key: "overdue", tone: "attention", text: `${cur.overdueOpen} open task${cur.overdueOpen === 1 ? " is" : "s are"} past the due date.` });
  if (cur.openNow > 0 && cur.completed === 0 && profile.confidence !== "none") notes.push({ key: "nothing", tone: "attention", text: `Nothing finished in ${periodLabel(days)}, with ${cur.openNow} task${cur.openNow === 1 ? "" : "s"} open.` });
  else if (Math.max(lastDone, lastCommit) > 0 && quietDays >= 7 && cur.openNow > 0) notes.push({ key: "quiet", tone: "attention", text: `No finished task or commit for ${quietDays} days.` });
  const completedDelta = cur.completed - metrics.previous.completed;
  const comparable = days < ALL_DAYS; // "all time" has no period before it to compare with
  if (comparable && metrics.previous.completed >= 3 && completedDelta <= -Math.ceil(metrics.previous.completed / 2)) notes.push({ key: "down", tone: "attention", text: `${-completedDelta} fewer tasks finished than in the period before (${cur.completed} against ${metrics.previous.completed}).` });
  else if (comparable && completedDelta >= 3) notes.push({ key: "up", tone: "info", text: `${completedDelta} more tasks finished than in the period before (${cur.completed} against ${metrics.previous.completed}).` });
  if (usesCode && cur.prsOpenNow > 0) {
    const oldest = Math.max(...ds.prs.filter((p) => p.personId === person.id && !p.promotion && p.state === "open").map((p) => Math.floor((now - p.openedAt) / DAY)));
    notes.push({ key: "prs", tone: oldest >= 7 ? "attention" : "info", text: `${cur.prsOpenNow} pull request${cur.prsOpenNow === 1 ? " is" : "s are"} open${oldest >= 7 ? `, the oldest for ${oldest} days` : ""}.` });
  }
  return { person, metrics, profile, usesCode, notes, completedDelta };
}

// Everyone, in alphabetical order. The order says nothing about anyone.
export function analyzeTeam(ds: Dataset, now: number, days = 30): PersonCard[] {
  return ds.people.map((p) => personCard(ds, p, now, days)).sort((a, b) => a.person.name.localeCompare(b.person.name));
}
