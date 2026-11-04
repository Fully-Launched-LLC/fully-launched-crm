import { createClient } from "@/lib/supabase/server";
import { cancelRun } from "@/lib/lead-finder/runner";
import { errorResponse, requireMember } from "@/lib/lead-finder/http";

// POST /api/lead-finder/runs/[id]/cancel: the runner or an Admin/Manager.
// Results found so far are kept.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const member = await requireMember();
    return Response.json({ run: await cancelRun(createClient(), member, params.id) });
  } catch (e) {
    return errorResponse(e);
  }
}
