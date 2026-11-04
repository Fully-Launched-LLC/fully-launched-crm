import { createClient } from "@/lib/supabase/server";
import { stepRun } from "@/lib/lead-finder/runner";
import { errorResponse, requireMember } from "@/lib/lead-finder/http";

// POST /api/lead-finder/runs/[id]/step: do about 20s of work on the run
// (searches, then website scans). The page calls this in a loop. "busy"
// means another tab holds the run's lease right now.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const member = await requireMember();
    return Response.json(await stepRun(createClient(), member, params.id));
  } catch (e) {
    return errorResponse(e);
  }
}
