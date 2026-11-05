"use client";

import { createClient } from "@/lib/supabase/client";

// Client fetch for the /api/lead-finder routes. A tab left open for hours can
// send a request after the access token expired; the middleware normally
// refreshes it, but if a request still comes back 401 we refresh the session
// in the browser (the refresh token lives in the same cookies) and retry once.
// Only when that refresh fails is the session really gone: SessionExpiredError,
// so callers can keep their state (the run is saved server-side) and ask the
// user to sign in again instead of losing their place.

export class SessionExpiredError extends Error {
  constructor() {
    super("Your sign-in expired. Sign in again in a new tab, then come back here. Nothing was lost.");
    this.name = "SessionExpiredError";
  }
}

const isAuthFailure = (res: Response) =>
  res.status === 401 || (res.redirected && new URL(res.url).pathname.startsWith("/login"));

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (!isAuthFailure(res)) return res;
  const { error } = await createClient().auth.refreshSession();
  if (error) throw new SessionExpiredError();
  const retry = await fetch(input, init);
  if (isAuthFailure(retry)) throw new SessionExpiredError();
  return retry;
}

// Per-user "last opened run" (Lead Finder reopens it when there's no ?run=).
// localStorage can throw (private windows, blocked storage); it's only a
// convenience, the server falls back to the user's most recent run.
const key = (memberId: string) => `lf:last_run:${memberId}`;

export function readLastRun(memberId: string | null | undefined): string | null {
  if (!memberId) return null;
  try {
    return window.localStorage.getItem(key(memberId));
  } catch {
    return null;
  }
}

export function writeLastRun(memberId: string | null | undefined, runId: string) {
  if (!memberId) return;
  try {
    window.localStorage.setItem(key(memberId), runId);
  } catch {}
}

// Per-user last searched place (launch pad prefill after a search). Same
// localStorage caveats as the last run: a convenience only.
export type LastPlace = { state: string; city: string; zip: string };
const placeKey = (memberId: string) => `lf:last_place:${memberId}`;

export function readLastPlace(memberId: string | null | undefined): LastPlace | null {
  if (!memberId) return null;
  try {
    const raw = window.localStorage.getItem(placeKey(memberId));
    const p = raw ? (JSON.parse(raw) as Partial<LastPlace>) : null;
    return p && typeof p.state === "string" ? { state: p.state, city: p.city ?? "", zip: p.zip ?? "" } : null;
  } catch {
    return null;
  }
}

export function writeLastPlace(memberId: string | null | undefined, place: LastPlace) {
  if (!memberId) return;
  try {
    window.localStorage.setItem(placeKey(memberId), JSON.stringify(place));
  } catch {}
}
