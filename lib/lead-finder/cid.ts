// Google Maps "cid" (customer id): a stable decimal id for one Maps listing.
// Google's place id isn't in Matteo's legacy CSV, but its "Google Maps Link"
// (a googleMapsUri) carries the cid, so leads.external_ids.cid lets old CSV
// rows dedupe against new Lead Finder results (unique index leads_cid_key).
//
// Handles:
//   https://maps.google.com/?cid=12345678901234567890
//   ...?ludocid=12345...
//   .../maps/place/...data=!...!1s0x880e4d...:0x1a2b3c4d5e6f7a8b...  (hex
//     feature id; the part after the colon is the cid in hex)
export function extractCid(url: string | null | undefined): string | null {
  if (!url) return null;
  const decimal = url.match(/[?&](?:cid|ludocid)=(\d{5,25})/i);
  if (decimal) return stripZeros(decimal[1]);
  const hex = url.match(/0x[0-9a-f]+:0x([0-9a-f]{1,16})/i);
  if (hex) {
    try {
      return BigInt("0x" + hex[1]).toString(10);
    } catch {
      return null;
    }
  }
  return null;
}

function stripZeros(s: string): string {
  const t = s.replace(/^0+/, "");
  return t || "0";
}
