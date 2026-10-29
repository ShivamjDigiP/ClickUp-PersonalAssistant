// "last N days" from a query string. 0 means everything on record. Anything unexpected falls back to 30.
export const RANGES = [7, 30, 90, 365, 0] as const;
export function daysParam(req: Request, fallback = 30): number {
  const raw = new URL(req.url).searchParams.get("days");
  const n = raw === null ? NaN : Number(raw);
  return (RANGES as readonly number[]).includes(n) ? n : fallback;
}
