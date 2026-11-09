"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Projects nav badge (Admins): deals the client signed that wait for our
// countersignature (deals.status = 'signed'). One deal links straight to its
// project. Refreshed on navigation, on window focus and every 5 minutes.
export function useAwaitingCountersign(enabled: boolean, pathname: string) {
  const [state, setState] = useState<{ count: number; projectId: string | null }>({ count: 0, projectId: null });
  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    let live = true;
    const load = async () => {
      const { data } = await supabase.from("deals").select("project_id").eq("status", "signed").limit(50);
      if (!live) return;
      const rows = data ?? [];
      setState({ count: rows.length, projectId: rows.length === 1 ? rows[0].project_id : null });
    };
    void load();
    const t = setInterval(load, 5 * 60 * 1000);
    window.addEventListener("focus", load);
    return () => {
      live = false;
      clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [enabled, pathname]);
  return state;
}
