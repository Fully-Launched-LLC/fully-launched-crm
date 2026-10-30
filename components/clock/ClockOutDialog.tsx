"use client";

import AccomplishedDialog from "@/components/clock/AccomplishedDialog";
import type { TimeClock } from "@/components/clock/useTimeClock";

// Opened by every Clock out button (clock.requestClockOut). Cancel keeps you
// clocked in. Rendered once per clock state: in TopNav and in ClockPanel.
export default function ClockOutDialog({ clock }: { clock: TimeClock }) {
  if (!clock.clockOutOpen || !clock.openEntry) return null;
  return (
    <AccomplishedDialog
      title="What did you accomplish?"
      confirmLabel="Clock out"
      busyLabel="Clocking out..."
      busy={clock.busy}
      error={clock.error}
      onCancel={clock.closeClockOut}
      onSubmit={async (text) => {
        if (await clock.clockOut(text)) clock.closeClockOut();
      }}
    />
  );
}
