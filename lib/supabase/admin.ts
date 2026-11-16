import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role Supabase client: BYPASSES RLS. Only for server-to-server
// routes with no user session (the Stripe webhook), which must authenticate
// the caller themselves first, and for one narrow user-facing write: the
// invoice route's payment_status update after its Admin/Manager check
// (migration 042). Never use it for anything a user's session can do, never
// import it from a client component, and never give the key a NEXT_PUBLIC_
// prefix.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
