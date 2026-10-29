import { connection } from "next/server";
import { checkOrigin } from "@/lib/auth/guard";
import { isSecure } from "@/lib/auth/config";
import { clearCookie, cookieValue, destroySession, SESSION_COOKIE } from "@/lib/platform/auth";

export async function POST(req: Request) {
  await connection();
  const blocked = checkOrigin(req);
  if (blocked) return blocked;
  const token = cookieValue(req.headers.get("cookie"), SESSION_COOKIE);
  if (token) destroySession(token);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearCookie(isSecure(req)) } });
}
