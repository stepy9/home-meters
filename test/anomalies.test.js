import test from "node:test";
import assert from "node:assert/strict";
import { findAnomalies } from "../src/anomalies.js";
import { emptyState, setReading } from "../src/data.js";

const series = (state, meter, start, values) => {
  let v = 1000;
  let s = setReading(state, { meter, month: start, value: v }, 1);
  const [y, m] = start.split("-").map(Number);
  values.forEach((used, i) => {
    const idx = y * 12 + m - 1 + i + 1;
    const month = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
    s = setReading(s, { meter, month, value: (v += used) }, 1);
  });
  return s;
};

test("a month far above the usual is flagged, a normal one not", () => {
  let s = series(emptyState(), "water", "2026-03", [10, 11, 9, 10, 12, 10, 18]);
  const [a] = findAnomalies(s, "2026-11");
  assert.equal(a.commodity, "water");
  assert.equal(a.month, "2026-10");
  assert.equal(a.kind, "high");
  assert.ok(Math.abs(a.usual - 62 / 6) < 1e-9);
  s = series(emptyState(), "water", "2026-03", [10, 11, 9, 10, 12, 10, 13]);
  assert.deepEqual(findAnomalies(s, "2026-11"), []);
});

test("small absolute jumps and old months are left alone", () => {
  // 0.5 → 1.2 m³ is +140 %, but under 2 m³ more.
  const s = series(emptyState(), "water", "2026-03", [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.2]);
  assert.deepEqual(findAnomalies(s, "2026-11"), []);
  const old = series(emptyState(), "water", "2026-01", [10, 10, 10, 10, 30]);
  assert.deepEqual(findAnomalies(old, "2026-11"), []);
});

test("gas compares with the same month a year earlier", () => {
  const values = Array.from({ length: 12 }, (_, i) => ([0, 1, 2, 10, 11].includes(i) ? 120 : 20));
  // Jan 2025 … Dec 2025, then Jan 2026 … Oct 2026 with October at 90 (last year 20).
  const s = series(emptyState(), "gas", "2024-12", [...values, ...values.slice(0, 9), 90]);
  const [a] = findAnomalies(s, "2026-11");
  assert.equal(a.commodity, "gas");
  assert.equal(a.usual, 20);
  // A cold January at 125 against 120 is fine.
  assert.deepEqual(findAnomalies(series(emptyState(), "gas", "2024-12", [...values, 125]), "2026-02"), []);
});

test("negative consumption is flagged as a likely typo", () => {
  let s = series(emptyState(), "water", "2026-07", [10, 10]);
  s = setReading(s, { meter: "water", month: "2026-10", value: 900 }, 2);
  const [a] = findAnomalies(s, "2026-11");
  assert.equal(a.kind, "negative");
});

test("a reading being typed: far above or below the usual is flagged, a normal one not", async () => {
  const { checkReading } = await import("../src/anomalies.js");
  const s = series(emptyState(), "water", "2026-03", [10, 11, 9, 10, 12, 10]);
  const last = 1000 + 62;
  assert.equal(checkReading(s, { meter: "water", month: "2026-10", value: last + 11 }), null);
  assert.equal(checkReading(s, { meter: "water", month: "2026-10", value: last + 30 }).kind, "high");
  assert.equal(checkReading(s, { meter: "water", month: "2026-10", value: last + 1 }).kind, "low");
  // Two months since the last reading: judged per month.
  assert.equal(checkReading(s, { meter: "water", month: "2026-11", value: last + 21 }), null);
  // Lower than last time is left to its own warning; no history, no verdict.
  assert.equal(checkReading(s, { meter: "water", month: "2026-10", value: last - 5 }), null);
  assert.equal(checkReading(s, { meter: "gas", month: "2026-10", value: 5 }), null);
});
