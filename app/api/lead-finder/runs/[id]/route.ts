import { createClient } from "@/lib/supabase/server";
import { getRun, runProgress, runResults } from "@/lib/lead-finder/runner";
import { errorResponse, requireMember } from "@/lib/lead-finder/http";

// GET /api/lead-finder/runs/[id]            run + progress + results
// GET /api/lead-finder/runs/[id]?results=0  run + progress only (polling)
// Results are checked against existing leads on every read.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireMember();
    const supabase = createClient();
    const run = await getRun(supabase, params.id);
    const progress = await runProgress(supabase, run);
    const wantResults = new URL(request.url).searchParams.get("results") !== "0";
    const results = wantResults ? await runResults(supabase, run.id) : null;
    return Response.json({ run, progress, results });
  } catch (e) {
    return errorResponse(e);
  }
}
