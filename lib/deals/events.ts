import "server-only";

type Db = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

// Deal activity log. App users insert as themselves (RLS "team insert as
// self"); the sign routes pass actor null with the service role.
export async function logDealEvent(
  db: Db,
  dealId: string,
  actor: string | null,
  kind: string,
  details: Record<string, unknown> = {}
) {
  const { error } = await db.from("deal_events").insert({ deal_id: dealId, actor, kind, details });
  if (error) console.error("[deal-docs] event not logged", kind, error.message);
}
