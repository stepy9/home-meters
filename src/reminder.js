// Reading reminders: which active meters lack last month's reading, and a calendar event (iCalendar) repeating
// every month on a chosen day, for the phone's calendar to remind with a notification.
import { METERS, monthAdd, readingAt, readingsOf } from "./data.js";

const pad = (n) => String(n).padStart(2, "0");

// Active meters that have readings but none for the month before the given one (a reading is the state at a
// month's end, taken early in the next).
export function missingReadings(state, month) {
  const previous = monthAdd(month, -1);
  const missing = METERS.filter((m) => state.config.active[m.id] && readingsOf(state, m.id).some((r) => r.month < previous) && !readingAt(state, m.id, previous));
  return { month: previous, meters: missing.map((m) => m.id) };
}

// An event every month on the given day at 9:00 (floating local time), with an alert at its start.
export function reminderCalendar({ day, title, description, url, now = new Date() }) {
  const start = new Date(now.getFullYear(), now.getMonth() + (now.getDate() > day ? 1 : 0), day, 9, 0);
  const local = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  // Text values escape backslash, semicolon, comma and newline (RFC 5545).
  const text = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//home-meters//reading reminder//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:home-meters-reading-${day}@stepy9.github.io`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${local(start)}`,
    `DTEND:${local(new Date(start.getTime() + 15 * 60000))}`,
    `RRULE:FREQ=MONTHLY;BYMONTHDAY=${day}`,
    `SUMMARY:${text(title)}`,
    `DESCRIPTION:${text(description)}`,
    `URL:${url}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${text(title)}`,
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
