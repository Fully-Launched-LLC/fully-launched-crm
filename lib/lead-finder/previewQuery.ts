// Shared (client + server): builds the /api/lead-finder/preview query.
// "No phone listed" (the scanner's placeholder) is sent as blank so the
// mockup doesn't show a Call button with no number.
export function previewQuery(p: {
  name: string;
  type?: string;
  phone?: string;
  address?: string;
  rating?: number | string;
  reviews?: number;
  mapsUrl?: string;
  hours?: string[] | null;
}): string {
  return new URLSearchParams({
    name: p.name,
    type: p.type || "",
    phone: p.phone && p.phone !== "No phone listed" ? p.phone : "",
    address: p.address || "",
    rating: String(p.rating ?? ""),
    reviews: String(p.reviews ?? ""),
    mapsUrl: p.mapsUrl || "",
    hours: (p.hours || []).join("||"),
  }).toString();
}
