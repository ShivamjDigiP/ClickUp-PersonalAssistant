"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { BRAND } from "@/lib/brand";
import { api, useApi } from "./api";
import { Avatar } from "./ui";

type Me = { name: string; email: string; role: string; workspace: { id: string; name: string } };

const NAV = [
  { href: "/cxo", label: "Overview", icon: "◎", exact: true },
  { href: "/cxo/projects", label: "Projects", icon: "▦" },
  { href: "/cxo/repos", label: "Repositories", icon: "⌥" },
  { href: "/cxo/people", label: "People", icon: "☺" },
  { href: "/cxo/chat", label: "Ask AI", icon: "✦" },
  { href: "/cxo/integrations", label: "Integrations", icon: "⚙" },
];

const linkCls = (on: boolean) =>
  `flex shrink-0 items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2 text-sm transition-colors ${on ? "bg-[rgb(var(--tint)/0.12)] text-[var(--fg)]" : "text-[var(--muted)] hover:bg-[rgb(var(--tint)/0.06)] hover:text-[var(--fg)]"}`;

const Item = ({ n, on }: { n: (typeof NAV)[number]; on: boolean }) => (
  <Link href={n.href} aria-current={on ? "page" : undefined} className={linkCls(on)}>
    <span aria-hidden className="w-4 text-center text-base leading-none">{n.icon}</span>
    {n.label}
  </Link>
);

// Reading the current path makes this part wait for the browser, so it sits in its own Suspense boundary and the rest
// of the shell renders instantly. The fallback shows the same links without the highlight.
function NavLinks() {
  const path = usePathname();
  return (
    <>
      {NAV.map((n) => (
        <Item key={n.href} n={n} on={n.exact ? path === n.href : path === n.href || path.startsWith(`${n.href}/`)} />
      ))}
    </>
  );
}

// Reading the path makes this wait for the browser, so it has its own Suspense boundary (like the menu).
// The chat uses the whole area, with no page padding.
function Main({ children, me, signOut }: { children: ReactNode; me?: Me | null; signOut: () => void }) {
  const full = usePathname() === "/cxo/chat";
  return (
    <main className={full ? "min-w-0 flex-1" : "min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8"}>
      {full ? children : <div className="mx-auto max-w-6xl">{children}</div>}
      {me && !full && (
        <div className="mt-10 flex items-center justify-between border-t border-[var(--glass-border)] pt-4 text-xs text-[var(--muted)] md:hidden">
          <span>{me.name}</span>
          <button onClick={signOut} className="underline underline-offset-2">
            Sign out
          </button>
        </div>
      )}
    </main>
  );
}

export function CxoShell({ children }: { children: ReactNode }) {
  const { data: me } = useApi<Me>("/api/platform/me");
  const [leaving, setLeaving] = useState(false);

  async function signOut() {
    setLeaving(true);
    await api("/api/platform/logout", { method: "POST", body: {} }).catch(() => {});
    // a full page load on purpose: it clears everything held in memory
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="shrink-0 border-b border-[var(--glass-border)] md:sticky md:top-0 md:h-dvh md:w-60 md:border-b-0 md:border-r">
        <div className="flex items-center gap-3 px-4 py-3 md:py-5">
          <span className="orb h-8 w-8 shrink-0" style={{ animation: "none" }} aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{BRAND.name}</p>
            <p className="truncate text-[11px] text-[var(--muted)]">{me?.workspace.name ?? " "}</p>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible md:pb-0" aria-label="Sections">
          <Suspense fallback={NAV.map((n) => <Item key={n.href} n={n} on={false} />)}>
            <NavLinks />
          </Suspense>
        </nav>

        <div className="hidden border-t border-[var(--glass-border)] p-3 md:absolute md:inset-x-0 md:bottom-0 md:block">
          {me && (
            <div className="flex items-center gap-3 px-1 py-1">
              <Avatar name={me.name} size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{me.name}</p>
                <p className="truncate text-[11px] capitalize text-[var(--muted)]">{me.role}</p>
              </div>
              <button onClick={signOut} disabled={leaving} className="text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--fg)]">
                {leaving ? "…" : "Sign out"}
              </button>
            </div>
          )}
        </div>
      </aside>

      <Suspense fallback={<main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8"><div className="mx-auto max-w-6xl">{children}</div></main>}>
        <Main me={me} signOut={signOut}>{children}</Main>
      </Suspense>
    </div>
  );
}
