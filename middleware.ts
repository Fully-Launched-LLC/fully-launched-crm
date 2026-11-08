import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

// Server-to-server routes skip the session check entirely — they have no user
// session, and the login redirect would swallow them:
// - /api/keep-alive: Vercel cron (vercel.json)
// - /api/webhooks/*: third-party webhooks (Stripe, Cal.com, ...). Each
//   handler must authenticate the request itself (e.g. verify the provider's
//   signature) since nothing upstream does.
// - /sign/*, /api/sign/*: the public Deal Desk signing page and its routes.
//   Clients have no CRM account; every handler checks the signing token
//   itself (hashed lookup, expiry, revocation) and rate-limits per IP.
// - /manifest.json, /sw.js: PWA files. Browsers fetch the manifest without
//   cookies, so the login redirect would break installing. Icons are
//   covered by the image-extension rule.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/keep-alive|api/webhooks/|api/sign/|sign/|pdfjs/|manifest\\.json|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)",
  ],
};
