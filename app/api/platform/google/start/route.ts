import { connection } from "next/server";
import { appOrigin, isSecure } from "@/lib/auth/config";
import { authorizeUrl, googleEnabled, newState, STATE_COOKIE } from "@/lib/platform/google";

export async function GET(req: Request) {
  await connection();
  const origin = appOrigin(req);
  if (!googleEnabled()) return Response.redirect(`${origin}/login?error=google_unavailable`, 303);
  const state = newState();
  return new Response(null, {
    status: 303,
    headers: {
      Location: authorizeUrl(origin, state),
      // short-lived and tied to this browser: the callback only proceeds when it comes back with the same value
      "Set-Cookie": `${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${isSecure(req) ? "; Secure" : ""}`,
    },
  });
}
