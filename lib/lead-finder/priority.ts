import type { ServiceKey } from "@/lib/lead-finder/types";

// priority_score (0 to 95): who to call first. Sits alongside Matteo's lead
// score (which rewards the number and size of gaps) and doesn't replace it.
//
// The best leads are established businesses missing one or two of our
// branches: they can pay, and the pitch is specific. Businesses missing
// everything, or with few reviews, rank lower.
//
//   fit (branches missing, from the scan's tags):
//     0 -> priority 0 (nothing to sell)
//     1 -> 40, 2 -> 45, 3 -> 25, 4 -> 10
//   establishment:
//     rating >= 4.0 and 25+ reviews     -> 40
//     rating >= 3.5 and 10+ reviews     -> 20
//     anything less (or no rating)      -> 5
//   tiebreak: round(lead score / 10)    -> 0 to 10
//
// e.g. established + 2 gaps: 85 to 95; established + 4 gaps: 50 to 60;
//      under 10 reviews + 2 gaps: 50 to 60; under 10 reviews + 4 gaps: 15 to 25.
// Documented in CLAUDE.md (Lead Finder). Change both together.

const FIT_POINTS: Record<number, number> = { 0: 0, 1: 40, 2: 45, 3: 25, 4: 10 };

export function priorityScore(input: {
  services: ServiceKey[];
  rating: number | "N/A" | null;
  reviews: number | null;
  score: number;
}): number {
  const gaps = input.services.length;
  if (gaps === 0) return 0;
  const rating = typeof input.rating === "number" ? input.rating : 0;
  const reviews = input.reviews ?? 0;
  const established =
    rating >= 4.0 && reviews >= 25 ? 40 : rating >= 3.5 && reviews >= 10 ? 20 : 5;
  const tiebreak = Math.round(Math.max(0, Math.min(100, input.score)) / 10);
  return (FIT_POINTS[gaps] ?? 0) + established + tiebreak;
}
