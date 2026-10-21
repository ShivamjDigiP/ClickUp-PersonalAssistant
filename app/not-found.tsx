import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <p className="text-xs uppercase tracking-widest text-[var(--muted)]">Not found</p>
        <h1 className="mt-2 text-4xl font-light">We couldn’t find that project</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm text-[var(--muted)]">
          It may have been renamed, archived, or you may not have access to it.
        </p>
        <Link href="/" className="mt-6 inline-block rounded-full px-6 py-2.5 text-sm font-medium text-slate-900" style={{ background: "linear-gradient(90deg,#7df0d0,#a99bff,#ffd98a)" }}>
          Back to Pulse
        </Link>
      </div>
    </main>
  );
}
