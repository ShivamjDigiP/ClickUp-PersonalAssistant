import * as Sentry from "@sentry/nextjs";
import { DATA_COLLECTION, IGNORED_ERRORS, scrubEvent } from "@/lib/sentryScrub";

// Server-side error reporting (API routes, server-rendered pages). Does nothing unless a DSN is configured.
const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: 0.1, // a sample of requests for performance, not all
  dataCollection: DATA_COLLECTION,
  ignoreErrors: IGNORED_ERRORS,
  beforeSend: (event) => scrubEvent(event),
});
