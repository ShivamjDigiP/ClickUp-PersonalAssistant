import { createHash } from "crypto";
import { z } from "zod";
import { generate, type Message } from "../llm";
import type { PersonCard } from "./capability";
import { round } from "./stats";
import { LEVEL_LABEL, ROLE_LABEL, periodLabel } from "./types";

// The LLM never computes anything. It receives numbers the engine already produced and writes the explanation.
// Anything it says is checked: a number that is not in its input is rejected, and if it keeps failing a
// rule-based text (built from the same numbers) is shown instead, so the CXO never sees an invented figure.
export type InsightInput = {
  person: { name: string; role: string | null; designation: string; daysSinceFirstInteraction: number };
  periodDays: number;
  periodLabel: string; // say this in words ("the last 30 days" or "all time"), never the number of days of an all-time window
  usesCode: boolean; // false for people whose work is tasks only
  teamSize: number;
  completedNow: number;
  completedBefore: number;
  completedChange: number;
  assigned: number;
  tasksFinishedInPeriod: number; // every finished task, the same figure the page shows
  tasksFromBulkImport: number; // of those, tasks closed by a data import: counted above, but not used for pace or on-time numbers
  openNow: number;
  overdueOpen: number;
  onTimePercent: number | null;
  reworkPercent: number | null;
  tasksPerWeek: number;
  medianDaysToFinish: number | null;
  commits: number;
  mergeCommits: number; // of the commits, the ones that only merge one branch into another
  prsMerged: number;
  prsOpenNow: number;
  medianHoursToMerge: number | null;
  historyConfidence: string;
};

const pct = (n: number | null) => (n === null ? null : Math.round(n * 100));

export function buildInsightInput(card: PersonCard, teamSize: number, now: number, tasks?: { finished: number; fromImport: number; open: number }): InsightInput {
  const m = card.metrics.current;
  return {
    person: { name: card.person.name, role: card.person.role ? ROLE_LABEL[card.person.role] : null, designation: LEVEL_LABEL[card.person.level], daysSinceFirstInteraction: Math.round((now - card.person.startDate) / 86_400_000) },
    periodDays: m.days,
    periodLabel: periodLabel(m.days),
    usesCode: card.usesCode,
    teamSize,
    completedNow: m.completed,
    completedBefore: card.metrics.previous.completed,
    completedChange: card.completedDelta,
    assigned: m.assigned,
    tasksFinishedInPeriod: tasks?.finished ?? m.completed + m.importedDone,
    tasksFromBulkImport: tasks?.fromImport ?? m.importedDone,
    openNow: tasks?.open ?? m.openNow,
    overdueOpen: m.overdueOpen,
    onTimePercent: pct(m.onTimeRate),
    reworkPercent: pct(m.reworkRate),
    tasksPerWeek: m.throughputPerWeek,
    medianDaysToFinish: m.cycleDaysMedian,
    commits: m.commits,
    mergeCommits: m.mergeCommits,
    prsMerged: m.prsMerged,
    prsOpenNow: m.prsOpenNow,
    medianHoursToMerge: m.prCycleHoursMedian,
    historyConfidence: card.profile.confidence,
  };
}

const Reply = z.object({
  headline: z.string().min(1).max(200),
  doingWell: z.array(z.string().max(220)).max(4),
  risks: z.array(z.string().max(220)).max(4),
  actions: z.array(z.string().max(220)).max(3),
});
export type Insight = z.infer<typeof Reply>;
export type InsightResult = { insight: Insight; source: "ai" | "rules"; engine?: string };

const SYSTEM = `You write a short, factual account of what ONE person did, for their CXO or manager. You describe work; you never rate or rank a person.
You are given a JSON object of numbers that were already computed. You do not calculate anything.
Rules:
- Name the period with periodLabel; never mention periodDays.
- Use ONLY numbers that appear in the JSON. Never create, estimate, add up or round new numbers. If you need a figure that is not there, describe it in words.
- Base every statement on the data. No guesses about personality, effort, attitude or personal life.
- Commits and pull requests describe activity, not value: do not praise or criticise someone for counts alone. Lines of code are not provided and must never be mentioned.
- completedNow and tasksPerWeek use only tasks with reliable dates. tasksFinishedInPeriod is every finished task (the figure the manager sees); when tasksFromBulkImport is above zero, say that those tasks came from a data import and are not used for pace or on-time numbers.
- If historyConfidence is "none" or "low", say plainly that there is not enough history to judge fairly.
- Say what they did (tasks finished, commits, pull requests) and what is still open. There is no score or ranking in this product: never invent one and never compare the person with others or with a "typical" level. Do NOT hand out grades or labels (no "exceeding", "on track", "needs support", "underperforming"). Where something looks stuck or slow, name the fact (for example overdue tasks, pull requests waiting) and suggest a concrete question or action for the manager.
- person.role says what they do (Developer, Designer, Client-Success, Manager) and person.designation their seniority (Junior, Mid, Senior). Write for that role: a Developer's work is tasks plus GitHub (commits, pull requests); a Designer, Client-Success or Manager person works in the task tool only, so when usesCode is false never mention commits or pull requests. Use the designation only as context for the kind of work to expect (a junior's tasks are usually smaller than a senior's); never use it, or anything else, to rank or grade.
- headline: one sentence. doingWell: up to 3 short facts about what got done. risks: up to 3 things worth a look (empty if none). actions: up to 2 concrete suggestions for the manager.
Reply with ONLY one JSON object: {"headline":"...","doingWell":["..."],"risks":["..."],"actions":["..."]}`;

// ---- grounding check -------------------------------------------------------------------------------------------

const NUM = /\d+(?:\.\d+)?/g;

function flatNumbers(value: unknown, out: Set<number> = new Set()): Set<number> {
  if (typeof value === "number" && Number.isFinite(value)) {
    out.add(value);
    out.add(Math.round(value));
    out.add(round(value, 1));
  } else if (Array.isArray(value)) value.forEach((v) => flatNumbers(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => flatNumbers(v, out));
  return out;
}

// Numbers in `text` that are not present in `input` (small counts written as digits are not exempt on purpose).
export function ungroundedNumbers(text: string, input: unknown): string[] {
  const allowed = flatNumbers(input);
  return (text.match(NUM) ?? []).filter((n) => !allowed.has(Number(n)));
}

export const insightText = (i: Insight) => [i.headline, ...i.doingWell, ...i.risks, ...i.actions].join(" \n ");

// Accepts bare JSON, fenced JSON, or the {"text":"<json>"} wrapper the local Claude provider uses.
export function parseInsightReply(raw: string): Insight {
  const extract = (text: string): any => {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("no JSON in the AI reply");
    return JSON.parse(text.slice(a, b + 1));
  };
  let v = extract(raw);
  if (typeof v.text === "string" && !("headline" in v)) v = extract(v.text);
  return Reply.parse(v);
}

// ---- rule-based fallback (same numbers, no AI) -----------------------------------------------------------------

export function ruleBasedInsight(i: InsightInput): Insight {
  if (i.historyConfidence === "none" || i.historyConfidence === "low") {
    return {
      headline: `${i.person.name} has too little history for a pattern to show yet.`,
      doingWell: [],
      risks: [],
      actions: [`Only ${i.completedNow} task${i.completedNow === 1 ? " was" : "s were"} finished in ${i.periodLabel}. Check again once more work has built up.`],
    };
  }
  // What they did, as facts. "doingWell" lists what got done; "risks" lists what is worth a look.
  const done: string[] = [];
  const look: string[] = [];
  const actions: string[] = [];
  done.push(`${i.tasksFinishedInPeriod} task${i.tasksFinishedInPeriod === 1 ? "" : "s"} finished, ${i.tasksPerWeek} a week.`);
  if (i.commits > 0 || i.prsMerged > 0) done.push(`${i.commits} commits and ${i.prsMerged} pull requests merged.`);
  if (i.onTimePercent !== null) done.push(`${i.onTimePercent}% of tasks with a due date were finished on time.`);
  if (i.completedChange > 0) done.push(`${i.completedChange} more tasks finished than in the previous period.`);
  if (i.completedChange < 0) look.push(`${-i.completedChange} fewer tasks finished than in the previous period.`);
  if (i.reworkPercent !== null && i.reworkPercent > 20) look.push(`${i.reworkPercent}% of finished tasks were reopened.`);
  if (i.overdueOpen > 0) look.push(`${i.overdueOpen} open task${i.overdueOpen === 1 ? " is" : "s are"} past the due date.`);
  if (i.prsOpenNow > 0) look.push(`${i.prsOpenNow} pull request${i.prsOpenNow === 1 ? " is" : "s are"} still open.`);
  if (look.length) actions.push("Ask what is blocking the open work and whether any of it can be made smaller.");
  return {
    headline: `${i.person.name} finished ${i.completedNow} task${i.completedNow === 1 ? "" : "s"} in ${i.periodLabel}${i.completedChange !== 0 ? `, ${Math.abs(i.completedChange)} ${i.completedChange > 0 ? "more" : "fewer"} than before` : ""}.`,
    doingWell: done.slice(0, 3),
    risks: look.slice(0, 3),
    actions: actions.slice(0, 2),
  };
}

// ---- main entry --------------------------------------------------------------------------------------------------

export type InsightCache = { get(hash: string): Promise<Insight | null>; set(hash: string, value: Insight): Promise<void> };
type Gen = (system: string, contents: Message[], tools: [], opts?: { local?: boolean; onEngine?: (e: { id: string }) => void }) => Promise<Message>;

export const inputHash = (i: InsightInput) => createHash("sha256").update(JSON.stringify(i)).digest("hex").slice(0, 32);

export async function generateInsight(
  input: InsightInput,
  opts: { local?: boolean; cache?: InsightCache; gen?: Gen; attempts?: number } = {},
): Promise<InsightResult> {
  const hash = inputHash(input);
  const hit = await opts.cache?.get(hash);
  if (hit) return { insight: hit, source: "ai" };
  if (input.historyConfidence === "none" || input.historyConfidence === "low") return { insight: ruleBasedInsight(input), source: "rules" };

  const gen = opts.gen ?? (generate as unknown as Gen);
  let engine: string | undefined;
  let feedback = "";
  for (let attempt = 0; attempt < (opts.attempts ?? 2); attempt++) {
    try {
      const reply = await gen(SYSTEM, [{ role: "user", parts: [{ text: `DATA:\n${JSON.stringify(input)}${feedback}` }] }], [], {
        local: opts.local,
        onEngine: (e) => (engine = e.id),
      });
      const insight = parseInsightReply(reply.parts.map((p) => p.text ?? "").join(""));
      const bad = ungroundedNumbers(insightText(insight), input);
      if (bad.length === 0) {
        await opts.cache?.set(hash, insight);
        return { insight, source: "ai", engine };
      }
      feedback = `\n\nYour previous answer used numbers that are not in the DATA (${bad.join(", ")}). Rewrite using only numbers from DATA, or describe them in words.`;
    } catch {
      /* unusable reply or provider error: try again, then fall back */
    }
  }
  return { insight: ruleBasedInsight(input), source: "rules" };
}
