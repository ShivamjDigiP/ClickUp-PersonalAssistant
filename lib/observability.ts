import * as Sentry from "@sentry/nextjs";

// Reports an error to Sentry (when it is configured) and to the server log. Many routes catch their errors and answer
// with a friendly message, which would hide them from Sentry; they call this first. Returns Sentry's event id (or
// undefined) so the person can quote it. Expected errors (revoked token, rate limits, ...) are dropped by the
// ignore-list in lib/sentryScrub.ts.
export function reportError(e: unknown, where: string): string | undefined {
  console.error(`[${where}]`, e instanceof Error ? e.message : String(e));
  try {
    return Sentry.withScope((scope) => {
      scope.setTag("where", where);
      return Sentry.captureException(e);
    });
  } catch {
    return undefined; // error reporting must never break the request it is reporting on
  }
}

export const setReportingUser = (id: string) => {
  try {
    Sentry.getIsolationScope().setUser({ id }); // the ClickUp user id only: no name, email or address
  } catch {
    /* ignore */
  }
};
