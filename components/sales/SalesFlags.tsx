"use client";

import { createContext, useContext } from "react";

// Server-computed feature flags for Sales (side preview, dossier). Pages
// set them from env presence on the server; secrets never reach the browser.
//   apollo: APOLLO_API_KEY is set ("Find owner contact" shows).
export type SalesFlags = { apollo: boolean };

const Ctx = createContext<SalesFlags>({ apollo: false });

export function SalesFlagsProvider({ flags, children }: { flags: SalesFlags; children: React.ReactNode }) {
  return <Ctx.Provider value={flags}>{children}</Ctx.Provider>;
}

export const useSalesFlags = () => useContext(Ctx);
