import { proposeFromReport } from "@/lib/sync/propose";
import { withAuth } from "@/lib/auth/guard";

export const maxDuration = 60;

async function handler(req: Request) {
  const { reportId, itemIds } = (await req.json().catch(() => ({}))) as { reportId?: string; itemIds?: unknown };
  if (!reportId || !Array.isArray(itemIds)) return Response.json({ error: "Nothing selected." }, { status: 400 });
  try {
    const proposals = await proposeFromReport(reportId, itemIds.map(String));
    return Response.json({ proposals });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export const POST = withAuth(handler);
