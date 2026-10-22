import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LoginForm } from "./LoginForm";
import { authEnabled, oauthEnabled, safeNext, SESSION_COOKIE } from "@/lib/auth/config";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in · ClickUp Assistant", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function LoginContent({ searchParams }: Props) {
  await connection();
  const sp = await searchParams;
  const next = safeNext(first(sp.next));

  if (!authEnabled()) redirect(next); // single-user mode: there is nothing to sign in to
  const session = await getSession((await cookies()).get(SESSION_COOKIE)?.value).catch(() => null);
  if (session) redirect(next); // already signed in

  return <LoginForm oauth={oauthEnabled()} error={first(sp.error) ?? null} next={next} />;
}

export default function LoginPage(props: Props) {
  return (
    <Suspense fallback={<div className="grid min-h-dvh place-items-center text-sm text-[var(--muted)]">Loading…</div>}>
      <LoginContent {...props} />
    </Suspense>
  );
}
