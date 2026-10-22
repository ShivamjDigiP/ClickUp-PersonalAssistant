import { connection } from "next/server";
import { clickup } from "@/lib/clickup/client";
import { slimTask } from "@/lib/clickup/data";
import { withAuth } from "@/lib/auth/guard";
import { reportError } from "@/lib/observability";

// Read-only: the user's open tasks for the check-in deck, most urgent first.
export const maxDuration = 30;

async function handler() {
  await connection();
  try {
    const [{ user }, { teams }] = await Promise.all([
      clickup<{ user: any }>("/user"),
      clickup<{ teams: any[] }>("/team"),
    ]);
    const { tasks } = await clickup<{ tasks: any[] }>(`/team/${teams[0]?.id}/task`, {
      assignees: [user.id],
      subtasks: true,
      include_closed: false,
    });
    const now = Date.now();
    const cards = tasks
      .map((t) => ({
        ...slimTask(t),
        description: (t.text_content ?? "").slice(0, 140),
        space: t.space?.id,
        overdue: !!t.due_date && Number(t.due_date) < now,
        _stale: now - Number(t.date_updated),
      }))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || b._stale - a._stale)
      .slice(0, 12);
    return Response.json({ me: user.username, cards });
  } catch (e) {
    reportError(e, "api/checkin");
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = withAuth(handler);
