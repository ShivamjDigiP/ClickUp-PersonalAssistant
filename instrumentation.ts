import * as Sentry from "@sentry/nextjs";

// Next.js calls register() once when the server starts: load the right Sentry setup for this runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

// Reports errors that Next.js catches while rendering pages and running API routes.
export const onRequestError = Sentry.captureRequestError;
