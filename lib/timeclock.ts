import type { TimeEntry, TimeEntryNet, TimeEntryType } from "@/lib/types";

// Time clock rules (migration 014 enforces the server side of each).

// Order and values mirror the time_entry_type enum.
export const ENTRY_TYPES: TimeEntryType[] = [
  "project",
  "management",
  "sales",
  "internal",
];

export const ENTRY_TYPE_LABELS: Record<TimeEntryType, string> = {
  project: "Project",
  management: "Management",
  sales: "Sales",
  internal: "Internal",
};

// "I got distracted" deducts this many minutes from the open entry.
export const DISTRACTED_MINUTES = 10;
// How long the Undo toast stays up. The server allows undo for 60 seconds
// (time_adjustments "creator undo" policy), so a slow click still works.
export const UNDO_TOAST_MS = 10_000;
// Open longer than this -> "Forgot to clock out?". Entries never auto-close.
export const FORGOT_TO_CLOCK_OUT_HOURS = 12;

// Minimum trimmed length of the clock-out accomplishment note; mirrors
// time_entries_accomplished_check (migration 015).
export const ACCOMPLISHED_MIN_CHARS = 5;

export function isValidAccomplished(text: string) {
  return text.trim().length >= ACCOMPLISHED_MIN_CHARS;
}

// Projects you can clock time against: everything not finished or lost.
export const INACTIVE_PROJECT_STAGES = ["Complete", "Lost"];

export function isForgotten(entry: Pick<TimeEntry, "clock_in" | "clock_out">, now = Date.now()) {
  return (
    entry.clock_out === null &&
    now - new Date(entry.clock_in).getTime() > FORGOT_TO_CLOCK_OUT_HOURS * 3_600_000
  );
}

// Management time only counts toward pay once an Admin approves it.
export function countsTowardPay(entry: Pick<TimeEntry, "entry_type" | "approved_at">) {
  return entry.entry_type !== "management" || entry.approved_at !== null;
}

export function needsApproval(entry: Pick<TimeEntry, "entry_type" | "approved_at">) {
  return entry.entry_type === "management" && entry.approved_at === null;
}

// Live net seconds for an open entry: elapsed minus deductions, floored at 0
// (same rule as the time_entries_net view).
export function liveNetSeconds(
  entry: Pick<TimeEntryNet, "clock_in" | "adjustment_minutes">,
  now = Date.now()
) {
  const elapsed = Math.floor((now - new Date(entry.clock_in).getTime()) / 1000);
  return Math.max(0, elapsed + entry.adjustment_minutes * 60);
}

// 4521 -> "1:15:21"
export function formatTimer(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// 125 -> "2h 05m", 45 -> "45m", -30 -> "-30m"
export function formatMinutes(minutes: number) {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}m`;
  return `${sign}${h}h ${String(m).padStart(2, "0")}m`;
}

// Pay-period math (timesheet weeks, "today" totals, and Phase 2 payouts) is
// bucketed in one fixed timezone for every viewer, so an entry lands in the
// same week no matter who is looking. Times are still *displayed* in the
// viewer's local timezone.
export const PAY_TIMEZONE = "America/Chicago";

// A calendar date in PAY_TIMEZONE, "YYYY-MM-DD".
export type PayDate = string;

const payPartsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: PAY_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function payParts(instant: number) {
  const parts: Record<string, number> = {};
  for (const p of payPartsFmt.formatToParts(new Date(instant))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return parts;
}

// PAY_TIMEZONE's offset from UTC at `instant`, in ms (negative for Chicago).
function payOffsetMs(instant: number) {
  const p = payParts(instant);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant;
}

function parsePayDate(date: PayDate) {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

// The PAY_TIMEZONE calendar date an instant falls on.
export function payDateOf(instant: Date | number = Date.now()): PayDate {
  const p = payParts(typeof instant === "number" ? instant : instant.getTime());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

// Calendar arithmetic on a PayDate (DST-proof: no instants involved).
export function shiftPayDate(date: PayDate, days: number): PayDate {
  const { y, m, d } = parsePayDate(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// 00:00 in PAY_TIMEZONE on `date`, as an instant. Chicago's DST switches
// happen at 2am, so midnight always exists exactly once.
export function payMidnight(date: PayDate): Date {
  const { y, m, d } = parsePayDate(date);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - payOffsetMs(guess);
  return new Date(guess - payOffsetMs(first));
}

// Start of the current pay day, for "today" totals.
export function startOfPayDay() {
  return payMidnight(payDateOf());
}

// Monday of the pay week containing `date`.
export function payWeekMonday(date: PayDate): PayDate {
  return shiftPayDate(date, -payWeekday(date));
}

const PAY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A real YYYY-MM-DD calendar date (rejects 2026-02-31).
export function isPayDate(value: unknown): value is PayDate {
  if (typeof value !== "string" || !PAY_DATE_RE.test(value)) return false;
  return shiftPayDate(value, 0) === value;
}

export function firstOfMonth(date: PayDate): PayDate {
  return `${date.slice(0, 7)}-01`;
}

// Last day of the month containing `date`.
export function lastOfMonth(date: PayDate): PayDate {
  const { y, m } = parsePayDate(date);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// Whole PAY_TIMEZONE days, inclusive: `from` 00:00 to the day after `to`
// 00:00 (end exclusive).
export function payDayRange(from: PayDate, to: PayDate) {
  return { start: payMidnight(from), end: payMidnight(shiftPayDate(to, 1)) };
}

// Day-of-week index for a PayDate, Mon = 0.
export function payWeekday(date: PayDate) {
  const { y, m, d } = parsePayDate(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

// Timesheets range presets. Every range is whole PAY_TIMEZONE days,
// inclusive, so it serializes as ?from=YYYY-MM-DD&to=YYYY-MM-DD.
export type RangePreset = "this-week" | "last-week" | "this-month" | "last-month";
export type PayRange = { from: PayDate; to: PayDate };

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  "this-week": "This week",
  "last-week": "Last week",
  "this-month": "This month",
  "last-month": "Last month",
};

export function presetRange(preset: RangePreset, today: PayDate = payDateOf()): PayRange {
  switch (preset) {
    case "this-week": {
      const from = payWeekMonday(today);
      return { from, to: shiftPayDate(from, 6) };
    }
    case "last-week": {
      const from = shiftPayDate(payWeekMonday(today), -7);
      return { from, to: shiftPayDate(from, 6) };
    }
    case "this-month":
      return { from: firstOfMonth(today), to: lastOfMonth(today) };
    case "last-month": {
      const prev = shiftPayDate(firstOfMonth(today), -1);
      return { from: firstOfMonth(prev), to: lastOfMonth(prev) };
    }
  }
}

export function matchPreset(range: PayRange, today: PayDate = payDateOf()): RangePreset | null {
  for (const preset of Object.keys(RANGE_PRESET_LABELS) as RangePreset[]) {
    const r = presetRange(preset, today);
    if (r.from === range.from && r.to === range.to) return preset;
  }
  return null;
}

// Monday through Sunday: the ranges Prev/Next step through.
export function isWholeWeek(range: PayRange) {
  return payWeekday(range.from) === 0 && shiftPayDate(range.from, 6) === range.to;
}

// Validated range from URL params; anything missing or invalid falls back
// to this week.
export function parsePayRange(from: unknown, to: unknown): PayRange {
  if (isPayDate(from) && isPayDate(to) && from <= to) return { from, to };
  return presetRange("this-week");
}

// "Oct 26" for a PayDate, independent of the viewer's timezone.
export function formatPayDate(date: PayDate, opts: Intl.DateTimeFormatOptions = {}) {
  const { y, m, d } = parsePayDate(date);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...opts,
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// ISO timestamp <-> <input type="datetime-local"> value, in local time.
export function toLocalInputValue(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function fromLocalInputValue(value: string) {
  return value ? new Date(value).toISOString() : null;
}

// Postgres errors from the clock -> something readable.
export function friendlyClockError(error: { code?: string; message: string }) {
  if (error.code === "23505") return "You're already clocked in.";
  if (error.code === "23514" && error.message.includes("accomplished")) {
    return `Say what you accomplished (at least ${ACCOMPLISHED_MIN_CHARS} characters).`;
  }
  return error.message;
}
