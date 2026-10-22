// When should a person's daily digest go out? Pure date logic, so it can be tested without any server.
export type Prefs = { hour: number; tz: string; weekdaysOnly: boolean };

// An unknown time zone name must never crash the scheduler: fall back to UTC.
export function safeTz(tz?: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz || "UTC";
  } catch {
    return "UTC";
  }
}

export function localParts(now: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTz(tz),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`, // the person's calendar date, e.g. 2026-10-22
    hour: Number(p.hour) % 24,
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
  };
}

export const localDate = (ms: number, tz: string) => localParts(new Date(ms), tz).date;

// The scheduler runs about once an hour and can run late, so a digest may go out up to 2 hours after the chosen hour,
// but never twice on the same local day, and never on weekends if the person asked for weekdays only.
const LATE_TOLERANCE_HOURS = 2;

export function shouldSend(now: Date, prefs: Prefs, lastSentDate?: string): boolean {
  const p = localParts(now, prefs.tz);
  if (prefs.weekdaysOnly && (p.weekday === 0 || p.weekday === 6)) return false;
  if (p.date === lastSentDate) return false;
  return p.hour >= prefs.hour && p.hour <= prefs.hour + LATE_TOLERANCE_HOURS;
}

export const validHour = (h: unknown): h is number => typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23;
