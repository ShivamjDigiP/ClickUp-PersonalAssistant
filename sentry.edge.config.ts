import * as Sentry from "@sentry/nextjs";
import { DATA_COLLECTION, IGNORED_ERRORS, scrubEvent } from "@/lib/sentryScrub";

// Same settings for the edge runtime (this app currently has no edge code; kept so adding some is covered).
const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: 0.1,
  dataCollection: DATA_COLLECTION,
  ignoreErrors: IGNORED_ERRORS,
  beforeSend: (event) => scrubEvent(event),
});
