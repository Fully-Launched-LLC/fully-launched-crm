import { googlePlaceDetails } from "@/lib/lead-finder/google";
import { scanPlace } from "@/lib/lead-finder/scanner";
import { previewQuery } from "@/lib/lead-finder/previewQuery";
import { errorResponse, requireMember } from "@/lib/lead-finder/http";
import { HttpError } from "@/lib/lead-finder/runner";

// POST /api/lead-finder/audit { placeId, type }
// Part 1 of an audit (Matteo's /api/audit): fresh Place Details (1 Google
// call) + a website scan. PageSpeed is part 2 (/api/lead-finder/pagespeed),
// its own request so each stays under the 60s limit with Matteo's 60s
// PageSpeed timeout intact. Recommendations and the call script are built
// from both (lib/lead-finder/recommendations.ts, callScript.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await requireMember();
    const { placeId, type } = (await request.json()) as { placeId?: string; type?: string };
    if (!placeId) throw new HttpError(400, "Missing business id.");
    const place = await googlePlaceDetails(placeId);
    const lead = await scanPlace(place, type || "", { deadline: Date.now() + 50_000 });
    const realSite = !!lead.website && lead.websiteStatus !== "Social page only" && lead.websiteStatus !== "Broken";
    const previewUrl =
      "/api/lead-finder/preview?" +
      previewQuery({ ...lead, type: type || lead.category });
    return Response.json({ lead, speedUrl: realSite ? lead.website : null, previewUrl });
  } catch (e) {
    return errorResponse(e);
  }
}
