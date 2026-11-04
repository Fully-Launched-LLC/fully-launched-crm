import "server-only";
import { getCurrentTeamMember } from "@/lib/auth";
import { HttpError } from "@/lib/lead-finder/runner";
import { LeadFinderConfigError } from "@/lib/lead-finder/google";
import type { TeamMember } from "@/lib/types";

// Shared by the /api/lead-finder routes. The middleware already requires a
// session; this also requires a roster entry (the RLS identity rule).
export async function requireMember(): Promise<TeamMember> {
  const member = await getCurrentTeamMember();
  if (!member) throw new HttpError(401, "Sign in with a team account to use the Lead Finder.");
  return member;
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof LeadFinderConfigError) return Response.json({ error: e.message }, { status: 500 });
  console.error("[lead-finder]", e);
  return Response.json({ error: (e as Error)?.message || "Something went wrong." }, { status: 500 });
}
