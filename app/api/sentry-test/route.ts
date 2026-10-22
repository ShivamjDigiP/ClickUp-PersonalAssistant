import { withAuth } from "@/lib/auth/guard";

// Safe way to check that error reporting works: sign in, then open /api/sentry-test. It throws on purpose, and an
// error called "Sentry test error" should appear in your Sentry project within a minute. It does nothing else.
export const GET = withAuth(() => {
  throw new Error("Sentry test error: deliberate, triggered from /api/sentry-test");
});
