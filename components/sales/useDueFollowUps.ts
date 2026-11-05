"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SALES_SOURCES } from "@/lib/sales/outcomes";

// Count of my due follow-ups for the Sales nav badge: Sales businesses
// assigned to me (leads.owner) with next_action_at today or earlier (my
// day). Refreshed on navigation, on window focus and every 5 minutes.
export function useDueFollowUps(memberId: string | null, pathname: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!memberId) return;
    const supabase = createClient();
    let live = true;
    const load = async () => {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      const { count: n } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("owner", memberId)
        .in("source", SALES_SOURCES as unknown as string[])
        .lte("next_action_at", end.toISOString());
      if (live) setCount(n ?? 0);
    };
    void load();
    const t = setInterval(load, 5 * 60 * 1000);
    window.addEventListener("focus", load);
    return () => {
      live = false;
      clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [memberId, pathname]);
  return count;
}
