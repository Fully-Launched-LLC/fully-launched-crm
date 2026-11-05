import { pageSpeed } from "@/lib/lead-finder/google";
import { errorResponse, requireMember } from "@/lib/lead-finder/http";
import { HttpError } from "@/lib/lead-finder/runner";
import { createClient } from "@/lib/supabase/server";
import { storeWebScore, toCache } from "@/lib/lead-finder/webScoreCache";

// POST /api/lead-finder/pagespeed { url, placeId? }: part 2 of an audit.
// Free (PageSpeed quota), uses GOOGLE_PAGESPEED_API_KEY. With placeId the
// result is also cached for the full website score (webScoreCache.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await requireMember();
    const { url, placeId } = (await request.json()) as { url?: string; placeId?: string };
    if (!url || !/^https?:\/\//i.test(url)) throw new HttpError(400, "Missing website.");
    // 55s, not Matteo's 60: the function itself stops at 60.
    const speed = await pageSpeed(url, 55_000);
    const w = placeId ? toCache(url, speed) : null;
    if (w && placeId) await storeWebScore(createClient(), placeId, w).catch(() => {});
    return Response.json(speed);
  } catch (e) {
    return errorResponse(e);
  }
}
