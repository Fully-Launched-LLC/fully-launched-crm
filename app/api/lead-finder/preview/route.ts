import { previewHtml } from "@/lib/lead-finder/preview";
import { requireMember } from "@/lib/lead-finder/http";

// GET /api/lead-finder/preview?name=...&type=...: Matteo's instant mockup
// site. Login-only for now (public share links are a later task).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireMember();
  } catch {
    return new Response("Sign in with a team account to see previews.", { status: 401 });
  }
  const q = new URL(request.url).searchParams;
  const name = q.get("name");
  if (!name) {
    return new Response('Missing business name. Open this from a lead\'s "Preview site" button.', { status: 400 });
  }
  const html = previewHtml({
    name,
    type: q.get("type") ?? undefined,
    phone: q.get("phone") ?? undefined,
    address: q.get("address") ?? undefined,
    rating: q.get("rating") ?? undefined,
    reviews: q.get("reviews") ?? undefined,
    mapsUrl: q.get("mapsUrl") ?? undefined,
    hours: q.get("hours") ?? undefined,
  });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex",
      // No scripts in the mockup; block any that slipped in.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:",
    },
  });
}
