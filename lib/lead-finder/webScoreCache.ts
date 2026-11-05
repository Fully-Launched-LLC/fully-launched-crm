import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PageSpeed, WebScoreCache } from "@/lib/lead-finder/types";
import { WEB_SCORE_TTL_MS } from "@/lib/lead-finder/websiteScore";

// PageSpeed results for the full website score, cached 30 days per website
// without a table of their own: stored as webScore in every
// lead_finder_results.payload for that place and in the Sales record's
// leads.scan_tags. Writes run as the signed-in user, so RLS applies (results:
// the run's owner or Admin/Manager; leads: owner, unowned or Admin/Manager);
// a blocked write just means the next viewer may run PageSpeed again.

export async function cachedWebScore(supabase: SupabaseClient, url: string): Promise<WebScoreCache | null> {
  const since = Date.now() - WEB_SCORE_TTL_MS;
  const pick = (rows: { w: WebScoreCache | null }[] | null) =>
    (rows ?? []).map((r) => r.w).find((w) => w && new Date(w.at).getTime() > since) ?? null;
  const [{ data: res }, { data: leads }] = await Promise.all([
    supabase.from("lead_finder_results").select("w:payload->webScore").eq("payload->>website", url).not("payload->webScore", "is", null).limit(20),
    supabase.from("leads").select("w:scan_tags->webScore").eq("website", url).not("scan_tags->webScore", "is", null).limit(20),
  ]);
  return pick(res as { w: WebScoreCache | null }[] | null) ?? pick(leads as { w: WebScoreCache | null }[] | null);
}

export function toCache(url: string, speed: PageSpeed): WebScoreCache | null {
  if (speed.error) return null;
  return {
    url,
    at: new Date().toISOString(),
    speed: {
      performance: speed.performance ?? null,
      seo: speed.seo ?? null,
      accessibility: speed.accessibility ?? null,
      bestPractices: speed.bestPractices ?? null,
      loadTime: speed.loadTime ?? null,
    },
  };
}

export async function storeWebScore(supabase: SupabaseClient, placeId: string, w: WebScoreCache): Promise<void> {
  const { data: rows } = await supabase
    .from("lead_finder_results")
    .select("id, payload")
    .eq("google_place_id", placeId);
  for (const r of rows ?? []) {
    await supabase.from("lead_finder_results").update({ payload: { ...(r.payload as object), webScore: w } }).eq("id", r.id);
  }
  const { data: leads } = await supabase.from("leads").select("id, scan_tags").eq("google_place_id", placeId);
  for (const l of leads ?? []) {
    await supabase.from("leads").update({ scan_tags: { ...((l.scan_tags as object) ?? {}), webScore: w } }).eq("id", l.id);
  }
}
