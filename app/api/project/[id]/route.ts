import { connection } from "next/server";
import { summarizeList } from "@/lib/clickup/data";
import { withAuth } from "@/lib/auth/guard";
import { reportError } from "@/lib/observability";

// Read-only detail for one project (list), used by the expanding project page.
export const maxDuration = 60;

async function handler(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  try {
    return Response.json(await summarizeList(id));
  } catch (e) {
    reportError(e, "api/project");
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = withAuth(handler);
