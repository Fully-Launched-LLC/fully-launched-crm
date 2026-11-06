"use client";

import { useEffect, useRef } from "react";
import type { TeamMember } from "@/lib/types";
import { useOutcomeToast } from "@/components/sales/OutcomeToast";

// Side preview footer: "Book a call with Luke". The button opens his Cal.com
// scheduler in Cal.com's official embed popup (element-click: data-cal-link
// on the button, embed.js loaded once), prefilled with the business's owner
// name and email. "Copy link" copies the plain booking link to text or email.
// A completed booking calls onBooked (logs Booked call, opens Move to
// Interested).
//
// Whose calendar: the team member with SALES_CALL_EMAIL (matched on email,
// like PINNED_MEMBER_COLORS, so a rename doesn't break it); the link comes
// from team_members.booking_link, FALLBACK_LINK when it's empty.

export const SALES_CALL_EMAIL = "luke@fullylaunched.com";
const FALLBACK_LINK = "https://cal.com/luke-bothun";
const NS = "sales";

type CalApi = ((...args: unknown[]) => void) & { ns?: Record<string, (...args: unknown[]) => void>; loaded?: boolean; q?: unknown[] };
declare global {
  interface Window {
    Cal?: CalApi;
  }
}

// The business whose preview is open: the embed's booking event goes to it.
let currentOnBooked: (() => void) | null = null;
let lastBooked = 0;
const initedOrigins = new Set<string>();

// Cal.com's loader snippet (their embed docs), typed.
function ensureCal(origin: string) {
  const w = window;
  if (!w.Cal) {
    const C = w;
    const A = origin + "/embed/embed.js";
    const L = "init";
    const p = (a: { q: unknown[] }, ar: IArguments | unknown[]) => a.q.push(ar);
    const d = C.document;
    const cal = function (this: unknown) {
      // eslint-disable-next-line prefer-rest-params
      const ar = arguments;
      const self = C.Cal as CalApi & { ns: Record<string, CalApi>; q: unknown[] };
      if (!self.loaded) {
        self.ns = {};
        self.q = self.q || [];
        d.head.appendChild(d.createElement("script")).src = A;
        self.loaded = true;
      }
      if (ar[0] === L) {
        const api = function () {
          // eslint-disable-next-line prefer-rest-params
          p(api as unknown as { q: unknown[] }, arguments);
        } as unknown as CalApi & { q: unknown[] };
        const namespace = ar[1];
        api.q = api.q || [];
        if (typeof namespace === "string") {
          self.ns[namespace] = self.ns[namespace] || api;
          p(self.ns[namespace] as unknown as { q: unknown[] }, ar);
          p(self as unknown as { q: unknown[] }, ["initNamespace", namespace]);
        } else p(self as unknown as { q: unknown[] }, ar);
        return;
      }
      p(self as unknown as { q: unknown[] }, ar);
    } as unknown as CalApi;
    C.Cal = cal;
  }
  if (initedOrigins.has(origin)) return;
  initedOrigins.add(origin);
  w.Cal!("init", NS, { origin });
  const api = w.Cal!.ns![NS];
  api("ui", { hideEventTypeDetails: false, layout: "month_view" });
  const booked = () => {
    // bookingSuccessfulV2 and the older bookingSuccessful can both fire.
    if (Date.now() - lastBooked < 5000) return;
    lastBooked = Date.now();
    currentOnBooked?.();
  };
  api("on", { action: "bookingSuccessfulV2", callback: booked });
  api("on", { action: "bookingSuccessful", callback: booked });
}

function parseLink(link: string): { calLink: string; origin: string } {
  try {
    const u = new URL(link);
    const origin = u.hostname === "cal.com" || u.hostname === "www.cal.com" ? "https://app.cal.com" : u.origin;
    return { calLink: u.pathname.replace(/^\/+|\/+$/g, ""), origin };
  } catch {
    return { calLink: "luke-bothun", origin: "https://app.cal.com" };
  }
}

export default function BookCall({
  members,
  name,
  email,
  onBooked,
  compact = false,
}: {
  members: TeamMember[];
  name: string | null;
  email: string | null;
  onBooked: () => void;
  // Inside the side preview's More menu: just the two buttons.
  compact?: boolean;
}) {
  const toast = useOutcomeToast();
  const host = members.find((m) => (m.email ?? "").trim().toLowerCase() === SALES_CALL_EMAIL);
  const link = host?.booking_link?.trim() || FALLBACK_LINK;
  const hostName = host?.name?.split(" ")[0] || "Luke";
  const { calLink, origin } = parseLink(link);
  const onBookedRef = useRef(onBooked);
  onBookedRef.current = onBooked;

  useEffect(() => {
    ensureCal(origin);
  }, [origin]);

  const config = JSON.stringify({
    layout: "month_view",
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast.flash("Copied");
    } catch {
      toast.flash("Couldn't copy. The link is " + link);
    }
  }

  return (
    <div className="book-call">
      {!compact && <div className="sec-title">Book a call with {hostName}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          className="btn btn-gold"
          data-cal-namespace={NS}
          data-cal-link={calLink}
          data-cal-config={config}
          onClick={() => {
            // The embed opens the popup from this click; route its booking
            // event to this business.
            currentOnBooked = () => onBookedRef.current();
          }}
        >
          Book a call with {hostName}
        </button>
        <button type="button" className="btn" onClick={() => void copy()}>
          Copy link
        </button>
      </div>
      {!compact && (
        <p className="hint" style={{ marginTop: 6 }}>
          Finishing a booking here logs Booked call on this business.
        </p>
      )}
    </div>
  );
}
