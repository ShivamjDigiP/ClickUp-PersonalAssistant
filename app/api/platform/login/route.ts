import { connection } from "next/server";
import { z } from "zod";
import { checkOrigin } from "@/lib/auth/guard";
import { isSecure } from "@/lib/auth/config";
import { clientIp, limit } from "@/lib/ratelimit";
import { authenticate, createSession, normalizeEmail, resolveSession, sessionCookie } from "@/lib/platform/auth";

const Body = z.object({ email: z.string().max(200), password: z.string().max(200) });

export async function POST(req: Request) {
  await connection();
  const blocked = checkOrigin(req);
  if (blocked) return blocked;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter your e-mail and password." }, { status: 400 });
  // limits per address AND per e-mail, so neither one machine nor one targeted account can be hammered
  const [byIp, byEmail] = await Promise.all([limit(`px-login-ip:${clientIp(req)}`, 30, 600), limit(`px-login-email:${normalizeEmail(parsed.data.email)}`, 8, 600)]);
  if (!byIp.ok || !byEmail.ok) return Response.json({ error: "Too many attempts. Wait a few minutes and try again." }, { status: 429 });

  const who = await authenticate(parsed.data.email, parsed.data.password);
  if (!who) return Response.json({ error: "E-mail or password is wrong." }, { status: 401 }); // same message either way
  const { token, expiresAt } = createSession(who.userId, who.workspaceId);
  // where this account belongs: the team dashboards, or the personal assistant for plain team members
  const role = resolveSession(token)?.role;
  return Response.json({ ok: true, role, destination: role === "developer" ? "/" : "/cxo" }, { headers: { "Set-Cookie": sessionCookie(token, expiresAt, isSecure(req)) } });
}
