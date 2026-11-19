import { createClient } from "@/lib/supabase/server";
import { createRun, runProgress, type CreateRunBody } from "@/lib/lead-finder/runner";
import { errorResponse, requireMember } from "@/lib/lead-finder/http";

// POST /api/lead-finder/runs: start a quick search (any team member). The
// page then calls /runs/[id]/step until the run is done. Area sweeps were
// removed Nov 2026: kind "sweep" gets a 400 ("Area sweeps were removed").
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const member = await requireMember();
    const body = (await request.json()) as CreateRunBody;
    const supabase = createClient();
    const run = await createRun(supabase, member, body);
    return Response.json({ run, progress: await runProgress(supabase, run) });
  } catch (e) {
    return errorResponse(e);
  }
}
