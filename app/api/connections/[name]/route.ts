import { SECRET_PROVIDERS } from "@/lib/connections/providers";
import { durableStorage, removeSecret, saveSecret } from "@/lib/connections/secrets";
import { resetCooldowns } from "@/lib/llm";
import { withAuth } from "@/lib/auth/guard";

type Ctx = { params: Promise<{ name: string }> };

// Connect or replace: the secret is verified with the provider first and only saved if it works.
// It is never returned to the browser.
async function connect(req: Request, { params }: Ctx) {
  const { name } = await params;
  const validate = Object.hasOwn(SECRET_PROVIDERS, name) ? SECRET_PROVIDERS[name] : null;
  if (!validate) return Response.json({ error: "Unknown connection." }, { status: 404 });

  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  const value = (token ?? "").trim();
  if (!value) return Response.json({ error: "Paste a key first." }, { status: 400 });

  const check = await validate(value);
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });
  await saveSecret(name, value);
  resetCooldowns(); // a new key deserves a fresh try even if the old one had been rate-limited
  return Response.json({
    ok: true,
    next: durableStorage() ? "Saved to your account. It stays connected after restarts and sign-out." : "Saved, but this server has no permanent storage (Redis), so it will be forgotten on restart.",
  });
}

// Disconnect only removes a key saved from this page; the one in .env.local is untouched and takes over again.
async function disconnect(_req: Request, { params }: Ctx) {
  const { name } = await params;
  if (!Object.hasOwn(SECRET_PROVIDERS, name)) return Response.json({ error: "Unknown connection." }, { status: 404 });
  await removeSecret(name);
  resetCooldowns();
  return Response.json({ ok: true });
}

export const POST = withAuth(connect);
export const DELETE = withAuth(disconnect);
