import { pageSpeed } from "@/lib/lead-finder/google";
import { errorResponse, requireMember } from "@/lib/lead-finder/http";
import { HttpError } from "@/lib/lead-finder/runner";

// POST /api/lead-finder/pagespeed { url }: part 2 of an audit. Free
// (PageSpeed quota), uses GOOGLE_PAGESPEED_API_KEY.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await requireMember();
    const { url } = (await request.json()) as { url?: string };
    if (!url || !/^https?:\/\//i.test(url)) throw new HttpError(400, "Missing website.");
    // 55s, not Matteo's 60: the function itself stops at 60.
    return Response.json(await pageSpeed(url, 55_000));
  } catch (e) {
    return errorResponse(e);
  }
}
