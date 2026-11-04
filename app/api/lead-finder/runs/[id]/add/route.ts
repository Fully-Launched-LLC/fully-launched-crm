import { createClient } from "@/lib/supabase/server";
import { addResults } from "@/lib/lead-finder/runner";
import { errorResponse, requireMember } from "@/lib/lead-finder/http";

// POST /api/lead-finder/runs/[id]/add
//   { placeIds: string[] }   add these results
//   { minPriority: number }  add every result with priority >= N
// Lead data comes from the stored scan, not the request. Saved with
// found_by = owner = the current user, source "lead_finder". Results that
// already match a lead are skipped, never merged.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const member = await requireMember();
    const body = (await request.json()) as { placeIds?: unknown; minPriority?: unknown };
    const placeIds = Array.isArray(body.placeIds) ? body.placeIds.map(String) : undefined;
    const minPriority = typeof body.minPriority === "number" ? body.minPriority : undefined;
    const summary = await addResults(createClient(), member, params.id, { placeIds, minPriority });
    return Response.json(summary);
  } catch (e) {
    return errorResponse(e);
  }
}
