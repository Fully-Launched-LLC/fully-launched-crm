import "server-only";

// Stripe hook point, called by the sign route after a client signs.
// No Stripe code in this build.
export async function onDealSigned(dealId: string): Promise<void> {
  // TODO(Stripe): deposit invoice for 50% of the selected one-time items
  //   (deal_signatures.selections + deal_line_items, totals() in
  //   lib/deals/money.ts), sent like the existing Deposit invoice
  //   (app/api/projects/[id]/invoice).
  // TODO(Stripe): subscription for the selected monthly items (Stripe Piece 2
  //   in CLAUDE.md; automatic charging needs its own decision first).
  void dealId;
}
