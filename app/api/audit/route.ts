import { connection } from "next/server";
import { readAudit } from "@/lib/store";

export async function GET() {
  await connection();
  return Response.json(await readAudit(60));
}
