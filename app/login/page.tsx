import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LoginForm } from "./LoginForm";
import { authEnabled, oauthEnabled, safeNext, SESSION_COOKIE } from "@/lib/auth/config";
import { getSession } from "@/lib/auth/session";
import { resolveSession, SESSION_COOKIE as PLATFORM_COOKIE } from "@/lib/platform/auth";
import { googleEnabled } from "@/lib/platform/google";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: `Sign in · ${BRAND.name}`, robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// The one sign-in page. Someone who is already signed in is sent on to where they belong.
async function LoginContent({ searchParams }: Props) {
  await connection();
  const sp = await searchParams;
  const next = safeNext(first(sp.next));
  const jar = await cookies();

  const account = resolveSession(jar.get(PLATFORM_COOKIE)?.value);
  if (account && !first(sp.error)) redirect(account.role === "developer" ? "/" : next.startsWith("/cxo") ? next : "/cxo");

  if (!next.startsWith("/cxo")) {
    if (!authEnabled()) redirect(next); // single-user mode: the personal assistant needs no sign-in
    const session = await getSession(jar.get(SESSION_COOKIE)?.value).catch(() => null);
    if (session) redirect(next); // already signed in to the personal assistant
  }

  return <LoginForm google={googleEnabled()} oauth={oauthEnabled()} personal={authEnabled()} error={first(sp.error) ?? null} next={next} />;
}

export default function LoginPage(props: Props) {
  return (
    <Suspense fallback={<div className="grid min-h-dvh place-items-center text-sm text-[var(--muted)]">Loading…</div>}>
      <LoginContent {...props} />
    </Suspense>
  );
}
