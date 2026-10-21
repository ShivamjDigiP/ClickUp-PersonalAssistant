// Same three colours as the design: teal = on track, amber = at risk, coral = behind.
export const HEALTH_COLOR = { on_track: "#2fe0b0", at_risk: "#ffa63d", behind: "#ff5d73" } as const;
export const HEALTH_LABEL = { on_track: "On track", at_risk: "At risk", behind: "Behind" } as const;

type Rankable = { health: keyof typeof HEALTH_COLOR; overdue: number; total: number; progress: number };

// Smart ordering: what needs attention first (behind > at risk > on track, then most overdue, then biggest).
export function byAttention<T extends Rankable>(projects: T[]): T[] {
  const rank = { behind: 2, at_risk: 1, on_track: 0 } as const;
  return [...projects].sort(
    (a, b) => rank[b.health] - rank[a.health] || b.overdue - a.overdue || b.total - a.total,
  );
}

export const shortName = (s: string, max = 16) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
