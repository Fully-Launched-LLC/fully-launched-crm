import "server-only";
import type { SalesFlags } from "@/components/sales/SalesFlags";

// Only whether a key is set, never the key.
export function salesFlags(): SalesFlags {
  return { apollo: !!process.env.APOLLO_API_KEY?.trim() };
}
