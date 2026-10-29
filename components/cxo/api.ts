"use client";

import { useCallback, useEffect, useState } from "react";

// Talks to the CXO API. A 401 means the platform session ended: go to the sign-in page and come back afterwards.
export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function toSignIn() {
  if (typeof window === "undefined" || window.location.pathname.startsWith("/login")) return;
  // a full page load on purpose: it drops every piece of signed-in state held in memory
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
}

export async function api<T = unknown>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection and try again.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    toSignIn();
    throw new ApiError("Please sign in.", 401);
  }
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Something went wrong (HTTP ${res.status}).`, res.status);
  return data as T;
}

type Result<T> = { key: string; data: T | null; error: string | null };

// Loads a URL, and again when the URL changes (for example a different period) or reload() is called. `data` keeps the
// previous result while the next one loads, so the screen never flashes empty when switching periods.
export function useApi<T>(url: string | null) {
  const [tick, setTick] = useState(0);
  const [res, setRes] = useState<Result<T>>({ key: "", data: null, error: null });
  const key = `${url}#${tick}`;

  useEffect(() => {
    if (!url) return;
    let live = true;
    api<T>(url)
      .then((d) => live && setRes({ key, data: d, error: null }))
      .catch((e: ApiError) => live && e.status !== 401 && setRes((r) => ({ key, data: r.data, error: e.message })));
    return () => {
      live = false;
    };
  }, [url, key]);

  const reload = useCallback(() => {
    setTick((t) => t + 1);
    return Promise.resolve();
  }, []);

  return { data: res.data, error: res.error, loading: !!url && res.key !== key, reload };
}
