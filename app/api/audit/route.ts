import { connection } from "next/server";
import { readAudit } from "@/lib/store";
import { withAuth } from "@/lib/auth/guard";

async function handler() {
  await connection();
  return Response.json(await readAudit(60));
}

export const GET = withAuth(handler);
