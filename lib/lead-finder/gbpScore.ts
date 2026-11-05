import type { ScannedPlace } from "@/lib/lead-finder/types";

// Google Business Profile completeness (audit dossier). Every Places result
// has a profile, so this scores how complete it is, out of 100. Change the
// code and CLAUDE.md (Sales > Google profile score) together.
//   hours 15, website linked 15, phone 15,
//   photos 15 (10 or more 15, 5+ 10, 1+ 5; Places returns at most 10),
//   reviews 15 (50+ 15, 25+ 10, 10+ 5, 1+ 2), rating 10 (4.5+ 10, 4.0+ 7, 3.5+ 4),
//   newest review 5 (within 90 days 5, within a year 2),
//   business description 5, categories 5 (2 or more).

export type GbpCheck = { label: string; value: string; earned: number; possible: number; missing: string };

export function gbpChecks(p: ScannedPlace, now = Date.now()): GbpCheck[] {
  const photos = p.photos ?? 0;
  const rating = typeof p.rating === "number" ? p.rating : null;
  const latest = p.gbp?.latestReviewAt ? new Date(p.gbp.latestReviewAt) : null;
  const days = latest ? (now - latest.getTime()) / 86_400_000 : null;
  const cats = p.gbp?.categories ?? (p.category ? [p.category.toLowerCase()] : []);
  const phone = p.phone && p.phone !== "No phone listed";
  const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return [
    { label: "Hours listed", value: p.hours?.length ? "Yes" : "No", earned: p.hours?.length ? 15 : 0, possible: 15, missing: "No opening hours on the Google profile" },
    { label: "Website linked", value: p.website ? "Yes" : "No", earned: p.website ? 15 : 0, possible: 15, missing: "No website linked from the Google profile" },
    { label: "Phone", value: phone ? p.phone : "None", earned: phone ? 15 : 0, possible: 15, missing: "No phone number on the Google profile" },
    {
      label: "Photos", value: photos >= 10 ? "10+" : String(photos),
      earned: photos >= 10 ? 15 : photos >= 5 ? 10 : photos >= 1 ? 5 : 0, possible: 15,
      missing: photos ? `Only ${photos} photo${photos === 1 ? "" : "s"} on the Google profile` : "No photos on the Google profile",
    },
    {
      label: "Reviews", value: String(p.reviews),
      earned: p.reviews >= 50 ? 15 : p.reviews >= 25 ? 10 : p.reviews >= 10 ? 5 : p.reviews >= 1 ? 2 : 0, possible: 15,
      missing: p.reviews ? `Only ${p.reviews} Google review${p.reviews === 1 ? "" : "s"}` : "No Google reviews yet",
    },
    {
      label: "Rating", value: rating != null ? rating.toFixed(1) : "None",
      earned: rating == null ? 0 : rating >= 4.5 ? 10 : rating >= 4 ? 7 : rating >= 3.5 ? 4 : 0, possible: 10,
      missing: rating == null ? "No rating yet" : `Rating is ${rating.toFixed(1)}`,
    },
    {
      label: "Newest review", value: latest ? fmtDate(latest) : "Unknown",
      earned: days == null ? 0 : days <= 90 ? 5 : days <= 365 ? 2 : 0, possible: 5,
      missing: latest ? `No reviews since ${fmtDate(latest)}` : "No recent reviews found",
    },
    {
      label: "Business description", value: p.gbp ? (p.gbp.description ? "Yes" : "No") : "Unknown",
      earned: p.gbp?.description ? 5 : 0, possible: 5, missing: "No business description on the Google profile",
    },
    {
      label: "Categories", value: cats.length ? cats.slice(0, 4).join(", ") : "None",
      earned: cats.length >= 2 ? 5 : 0, possible: 5, missing: "Only one category on the Google profile",
    },
  ];
}

export function gbpScore(p: ScannedPlace): number {
  return gbpChecks(p).reduce((a, c) => a + c.earned, 0);
}
