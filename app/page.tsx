import { Suspense } from "react";
import { Shell } from "@/components/Shell";

// The app is fully interactive and per-user, so it renders on the client behind a Suspense boundary
// (needed because it creates random ids and reads the clock while rendering).
export default function Home() {
  return (
    <Suspense fallback={<div className="grid h-screen place-items-center text-sm text-[var(--muted)]">Loading…</div>}>
      <Shell />
    </Suspense>
  );
}
