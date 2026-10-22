"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Last line of defence: if something crashes while the page is being drawn, report it and show a calm message
// instead of a blank screen. (It replaces the whole page, so it brings its own <html> and <body>.)
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" data-theme="dark">
      <body style={{ margin: 0, background: "#060a18", color: "#e8ecff", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
          <div>
            <h1 style={{ fontWeight: 300, fontSize: 28, margin: 0 }}>Something went wrong</h1>
            <p style={{ color: "#8b93b8", fontSize: 14, maxWidth: 320, margin: "12px auto 0", lineHeight: 1.6 }}>
              The problem has been reported. Nothing in ClickUp was changed. Please try again.
            </p>
            {error.digest && <p style={{ color: "#8b93b8", fontSize: 11, marginTop: 12 }}>Reference: {error.digest}</p>}
            <button
              onClick={reset}
              style={{ marginTop: 24, border: 0, borderRadius: 999, padding: "12px 28px", fontSize: 14, fontWeight: 600, color: "#0f172a", background: "linear-gradient(90deg,#7df0d0,#a99bff,#ffd98a)", cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
