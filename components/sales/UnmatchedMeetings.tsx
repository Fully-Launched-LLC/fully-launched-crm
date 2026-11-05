"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TeamMember } from "@/lib/types";
import LocalDateTime from "@/components/LocalDateTime";

// History > Unmatched meetings (Admin/Manager): meeting_notes the sync
// couldn't match to a business (no attendee email or title match; Granola
// titles should read "Business name, contact name"). "Link to business"
// searches the Sales businesses and calls link_meeting() (migration 022,
// Admin/Manager only), which sets the meeting's business and logs the
// Meeting held touch.

type Note = {
  id: string;
  title: string | null;
  started_at: string | null;
  creator_email: string | null;
  attendees: unknown;
  source_url: string | null;
};
type Biz = { id: string; name: string; city: string | null };

function attendeeEmails(a: unknown): string[] {
  if (!Array.isArray(a)) return [];
  return a
    .map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? String((x as { email?: string }).email ?? "") : ""))
    .filter((e) => e.includes("@") && !/@fullylaunched\.com$/i.test(e));
}

export default function UnmatchedMeetings({
  members,
  businesses,
  onLinked,
}: {
  members: TeamMember[];
  businesses: Biz[];
  onLinked: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("meeting_notes")
      .select("id, title, started_at, creator_email, attendees, source_url")
      .is("lead_id", null)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(50);
    if (error) setMsg({ tone: "error", text: error.message });
    setNotes((data ?? []) as Note[]);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const needle = q.trim().toLowerCase();
  const matches = needle
    ? businesses.filter((b) => b.name.toLowerCase().includes(needle)).slice(0, 8)
    : [];

  async function link(noteId: string, biz: Biz) {
    setMsg(null);
    const { error } = await supabase.rpc("link_meeting", { p_meeting_id: noteId, p_lead_id: biz.id });
    if (error) return setMsg({ tone: "error", text: error.message });
    setMsg({ tone: "ok", text: `Linked to ${biz.name}. The meeting is on its timeline.` });
    setLinking(null);
    setQ("");
    setNotes((prev) => (prev ?? []).filter((n) => n.id !== noteId));
    onLinked();
  }

  if (notes === null || (notes.length === 0 && !msg)) return null;
  const creator = (email: string | null) =>
    members.find((m) => (m.email ?? "").toLowerCase() === (email ?? "").toLowerCase())?.name ?? email ?? "Unknown";

  return (
    <section className="panel unmatched" aria-label="Unmatched meetings">
      <div className="um-head">
        <div>
          <div className="kicker">Unmatched meetings</div>
          <p className="meta">
            Meeting notes we couldn&apos;t match to a business. Granola titles should read &quot;Business name, contact name&quot;.
          </p>
        </div>
      </div>
      {msg && <p className={msg.tone === "ok" ? "ok-msg" : "error"} style={{ margin: "0 16px 10px" }}>{msg.text}</p>}
      <ul>
        {notes.map((n) => (
          <li key={n.id}>
            <div className="um-row">
              <div style={{ minWidth: 0 }}>
                <b>{n.title || "Untitled meeting"}</b>
                <div className="meta">
                  {n.started_at && <LocalDateTime iso={n.started_at} />} · {creator(n.creator_email)}
                  {attendeeEmails(n.attendees).length > 0 && <> · {attendeeEmails(n.attendees).join(", ")}</>}
                  {n.source_url && (
                    <>
                      {" "}· <a href={n.source_url} target="_blank" rel="noopener noreferrer">Open in Granola</a>
                    </>
                  )}
                </div>
              </div>
              {linking !== n.id && (
                <button type="button" className="btn" onClick={() => { setLinking(n.id); setQ(""); setMsg(null); }}>
                  Link to business
                </button>
              )}
            </div>
            {linking === n.id && (
              <div className="um-link">
                <input
                  className="field"
                  autoFocus
                  placeholder="Search Sales businesses…"
                  aria-label="Search businesses"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setLinking(null)}
                />
                {matches.map((b) => (
                  <button key={b.id} type="button" className="um-pick" onClick={() => void link(n.id, b)}>
                    {b.name}
                    {b.city && <span className="meta"> · {b.city}</span>}
                  </button>
                ))}
                {needle && matches.length === 0 && <span className="meta">No Sales business matches.</span>}
                <button type="button" className="btn" onClick={() => setLinking(null)}>Cancel</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
