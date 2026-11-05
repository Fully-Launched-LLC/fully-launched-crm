import { createClient } from "@/lib/supabase/server";
import { pageSpeed } from "@/lib/lead-finder/google";
import { errorResponse, requireMember } from "@/lib/lead-finder/http";
import { HttpError } from "@/lib/lead-finder/runner";
import { cachedWebScore, storeWebScore, toCache } from "@/lib/lead-finder/webScoreCache";

// POST /api/lead-finder/website-score { placeId, website }
// The full website score's PageSpeed part, run in the background when a
// business is opened in the Sales side preview. Cached 30 days per website
// (lib/lead-finder/webScoreCache.ts): a cached result costs nothing.
// Returns { webScore } or { error }.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await requireMember();
    const { placeId, website } = (await request.json()) as { placeId?: string; website?: string };
    if (!placeId || !website || !/^https?:\/\//i.test(website)) throw new HttpError(400, "Missing website.");
    const supabase = createClient();
    const cached = await cachedWebScore(supabase, website);
    if (cached) {
      await storeWebScore(supabase, placeId, cached);
      return Response.json({ webScore: cached, cached: true });
    }
    const speed = await pageSpeed(website, 55_000);
    const w = toCache(website, speed);
    if (!w) return Response.json({ error: speed.error ?? "PageSpeed check failed." }, { status: 502 });
    await storeWebScore(supabase, placeId, w);
    return Response.json({ webScore: w, cached: false });
  } catch (e) {
    return errorResponse(e);
  }
}
