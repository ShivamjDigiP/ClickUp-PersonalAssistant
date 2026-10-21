import { connection } from "next/server";
import { summarizeList } from "@/lib/clickup/data";

// Read-only detail for one project (list), used by the expanding project page.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  try {
    return Response.json(await summarizeList(id));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
