import test from "node:test";
import assert from "node:assert/strict";
import { missingReadings, reminderCalendar } from "../src/reminder.js";
import { emptyState, setConfig, setReading } from "../src/data.js";

test("missing last month's reading for active meters that have readings", () => {
  let s = emptyState();
  s = setReading(s, { meter: "gas", month: "2026-09", value: 1 }, 1);
  s = setReading(s, { meter: "water", month: "2026-09", value: 1 }, 1);
  s = setReading(s, { meter: "water", month: "2026-10", value: 2 }, 1);
  assert.deepEqual(missingReadings(s, "2026-11"), { month: "2026-10", meters: ["gas"] });
  // Electricity HT has no readings at all, so it is not nagged about; a switched-off meter neither.
  s = setConfig(s, { active: { gas: false } });
  assert.deepEqual(missingReadings(s, "2026-11").meters, []);
});

test("the calendar event repeats monthly on the day with an alert", () => {
  const ics = reminderCalendar({ day: 2, title: "Odečet, měřáků", description: "a;b", url: "https://x/", now: new Date(2026, 10, 9, 12) });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /RRULE:FREQ=MONTHLY;BYMONTHDAY=2\r\n/);
  // Past the 2nd this month: it starts next month.
  assert.match(ics, /DTSTART:20261202T090000\r\n/);
  // Commas and semicolons in text are escaped with a backslash.
  assert.ok(ics.includes(String.raw`SUMMARY:Odečet\, měřáků` + "\r\n"));
  assert.ok(ics.includes(String.raw`DESCRIPTION:a\;b` + "\r\n"));
  assert.match(ics, /BEGIN:VALARM[\s\S]*TRIGGER:PT0M[\s\S]*END:VALARM/);
});
