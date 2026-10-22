import * as Sentry from "@sentry/nextjs";
import { DATA_COLLECTION, IGNORED_ERRORS, scrubEvent } from "@/lib/sentryScrub";

// Browser-side error reporting. Does nothing unless NEXT_PUBLIC_SENTRY_DSN is set.
// Session Replay is deliberately NOT enabled: it records the screen, which would capture people's ClickUp data.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: 0.05,
  dataCollection: DATA_COLLECTION,
  ignoreErrors: IGNORED_ERRORS,
  beforeSend: (event) => scrubEvent(event),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
