import { RetryButton } from "./RetryButton";

// Shown by the service worker when the app is opened without a connection.
export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <div className="orb mx-auto h-20 w-20" aria-hidden />
        <h1 className="mt-8 text-3xl font-light">You’re offline</h1>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-[var(--muted)]">
          ClickUp Assistant needs a connection to read your projects and tasks. Nothing was changed. Reconnect and try again.
        </p>
        <RetryButton />
      </div>
    </main>
  );
}
