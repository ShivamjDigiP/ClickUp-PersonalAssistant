// What may leave the app inside an error report. Reports go to Sentry, a third party, so they must never contain
// ClickUp tokens, cookies, request bodies (chat questions, task text) or the person's email.
// Pure functions with no Sentry import, so they are easy to test and safe to use in every runtime.

// Errors that are expected in normal use and would only create noise: a revoked token, a missing or private list,
// ClickUp's rate limit, a person closing the page mid-request, flaky networks.
export const IGNORED_ERRORS: (string | RegExp)[] = [
  /^ClickUp (401|403|404|429)\b/,
  /Please sign in/i,
  /AbortError|The operation was aborted|The user aborted a request/i,
  /Failed to fetch|NetworkError|Load failed|network connection was lost/i,
  /ResizeObserver loop/i,
  /Rate limit|Daily quota exhausted|free daily quota/i, // the AI provider's free-tier limits
];

// Sentry v11 collects headers, cookies, request bodies, query strings, user info and local variables BY DEFAULT.
// Everything is switched off here, so a report holds the error, the stack and the route, and nothing about the person
// or their ClickUp data. (scrubEvent below is a second layer in case anything slips through.)
export const DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [] as ("incomingRequest" | "outgoingRequest" | "incomingResponse" | "outgoingResponse")[],
  urlQueryParams: false,
  stackFrameVariables: false,
  queues: false,
  databaseQueryData: false,
  genAI: { inputs: false, outputs: false },
};

const TOKEN = /\b(pk_[A-Za-z0-9_]{6,}|Bearer\s+[A-Za-z0-9._~+/=-]{12,})/g;
const REDACTED = "[redacted]";
export const scrubText = (s: string) => s.replace(TOKEN, REDACTED);

type AnyEvent = {
  request?: { headers?: unknown; cookies?: unknown; data?: unknown; query_string?: unknown; url?: string };
  user?: { id?: string; email?: unknown; username?: unknown; ip_address?: unknown };
  message?: string;
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: { message?: string; data?: unknown }[];
  extra?: unknown;
};

export function scrubEvent<T extends object>(input: T): T {
  const event = input as AnyEvent; // works on whatever event shape the SDK hands us; returns the same object
  if (event.request) {
    delete event.request.headers; // Authorization, Cookie, ...
    delete event.request.cookies;
    delete event.request.data; // chat questions, task text, pasted tokens
    delete event.request.query_string;
  }
  if (event.user) event.user = event.user.id ? { id: String(event.user.id) } : undefined; // an id only: no email, name or IP
  if (event.message) event.message = scrubText(event.message);
  for (const v of event.exception?.values ?? []) if (v.value) v.value = scrubText(v.value);
  for (const b of event.breadcrumbs ?? []) {
    if (b.message) b.message = scrubText(b.message);
    delete b.data; // fetch breadcrumbs carry URLs and parameters
  }
  delete event.extra;
  return input;
}
