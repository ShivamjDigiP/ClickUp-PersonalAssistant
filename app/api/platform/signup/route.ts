import { connection } from "next/server";
import { z } from "zod";
import { checkOrigin } from "@/lib/auth/guard";
import { isSecure } from "@/lib/auth/config";
import { clientIp, limit } from "@/lib/ratelimit";
import { AuthError, createSession, sessionCookie, signUp } from "@/lib/platform/auth";

const Body = z.object({ email: z.string().max(200), name: z.string().max(80), password: z.string().max(200), workspaceName: z.string().max(80).optional() });

export async function POST(req: Request) {
  await connection();
  const blocked = checkOrigin(req);
  if (blocked) return blocked;
  const gate = await limit(`px-signup:${clientIp(req)}`, 5, 3600);
  if (!gate.ok) return Response.json({ error: "Too many sign-up attempts. Try again later." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Fill in your name, e-mail and password." }, { status: 400 });
  try {
    const { userId, workspaceId } = await signUp(parsed.data);
    const { token, expiresAt } = createSession(userId, workspaceId);
    return Response.json({ ok: true, role: "owner", destination: "/cxo" }, { status: 201, headers: { "Set-Cookie": sessionCookie(token, expiresAt, isSecure(req)) } });
  } catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.code === "taken" ? 409 : e.code === "closed" || e.code === "domain" ? 403 : 400 });
    throw e;
  }
}
