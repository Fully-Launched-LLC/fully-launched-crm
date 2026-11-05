import type { LeadFinderRun, SearchParams, SweepParams } from "@/lib/lead-finder/types";
import { asMode, modeLabel, type SearchMode } from "@/lib/sales/searchModes";

// A run's POST /api/lead-finder/runs body, rebuilt from its params, so Re-run
// for fresh data and History > Searches "Run again" send the same request.

export type RunBody =
  | { kind: "search"; mode?: SearchMode; state: string; city: string; zip: string; type: string; depth: number; services: string[] }
  | { kind: "sweep"; mode?: SearchMode; state: string; city: string; zip: string; radius: number; services: string[]; types: string };


export function bodyFromRun(r: LeadFinderRun): RunBody {
  const p = r.params as SearchParams & SweepParams;
  return r.kind === "search"
    ? { kind: "search", mode: asMode(p.mode), state: p.state, city: p.city ?? "", zip: p.zip ?? "", type: p.type, depth: p.depth, services: p.services ?? [] }
    : { kind: "sweep", mode: asMode(p.mode), state: p.state, city: p.city ?? "", zip: p.zip ?? "", radius: p.radius, services: p.services ?? [], types: (p.types ?? []).join("\n") };
}

// "HVAC · Naperville · 20", "Area sweep · 5 mi · Wheaton" (+ " · Website" for a focus).
export function describeSearch(b: RunBody): string {
  const where = b.city || b.zip || b.state;
  const focus = b.mode && b.mode !== "all" ? modeLabel(b.mode) : null;
  if (b.kind === "search") return [b.type, where, String(b.depth), focus].filter(Boolean).join(" · ");
  const st = b.services.length === 1 && b.services[0] === "servicetitan";
  return [st ? "ServiceTitan sweep" : "Area sweep", `${b.radius} mi`, where, focus].filter(Boolean).join(" · ");
}
