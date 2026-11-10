// Unusual consumption: the latest month of each commodity against what is usual for it, to catch a leak, a
// running toilet or a typo in a reading early.
import { COMMODITIES, commodityConsumption, meterById, meterConsumption, monthAdd, monthDiff, readingBefore, usedBetween } from "./data.js";

// Below these a jump is noise, however large in percent.
const MIN_EXTRA = { electricity: 50, gas: 15, water: 2 };
export const ANOMALY_RATIO = 1.5;

// For each commodity whose latest month (within the last two) is out of the ordinary:
// { commodity, month, value, usual, kind: "high" | "negative" }. Usual is the same month a year earlier for gas
// (it follows the season), the average of up to six months before for electricity and water.
export function findAnomalies(state, month) {
  const out = [];
  for (const commodity of COMMODITIES) {
    const used = commodityConsumption(state, commodity);
    const months = [...used.keys()].sort();
    const last = months.at(-1);
    if (!last || last < monthAdd(month, -2)) continue;
    const row = used.get(last);
    if (row.total < 0) {
      out.push({ commodity, month: last, value: row.total, usual: null, kind: "negative" });
      continue;
    }
    // A share of a gap between readings is an average, not a month to judge.
    if (row.estimated) continue;
    let usual = null;
    if (commodity === "gas") usual = used.get(monthAdd(last, -12))?.total ?? null;
    else {
      const before = months
        .filter((m) => m < last)
        .slice(-6)
        .map((m) => used.get(m))
        .filter((r) => !r.estimated && r.total >= 0);
      if (before.length >= 3) usual = before.reduce((sum, r) => sum + r.total, 0) / before.length;
    }
    if (usual == null || usual <= 0) continue;
    if (row.total > usual * ANOMALY_RATIO && row.total - usual >= MIN_EXTRA[commodity]) out.push({ commodity, month: last, value: row.total, usual, kind: "high" });
  }
  return out;
}

// A reading being typed, checked against the meter's usual use per month: well above it (a leak, or a digit too
// many) or far below it (a digit missing). The usual is the same months a year earlier for gas, the average of
// up to six measured months before for the others. Returns { kind: "high" | "low", perMonth, usual } or null.
export function checkReading(state, reading) {
  const meter = meterById(reading.meter);
  const prev = readingBefore(state, reading.meter, reading.month);
  if (!meter || !prev || !Number.isFinite(reading.value)) return null;
  if (reading.oldFinal != null && !Number.isFinite(reading.oldFinal)) return null;
  const gap = monthDiff(prev.month, reading.month);
  const used = usedBetween(prev, reading);
  if (used < 0) return null; // shown by the lower-than-last-time warning
  const perMonth = used / gap;
  const history = meterConsumption(state, reading.meter);
  let usual = null;
  if (meter.commodity === "gas") {
    const year = Array.from({ length: gap }, (_, i) => history.get(monthAdd(reading.month, -12 - i)));
    if (year.every((r) => r && r.value >= 0)) usual = year.reduce((s, r) => s + r.value, 0) / gap;
  } else {
    const before = [...history.entries()]
      .filter(([m, r]) => m <= prev.month && !r.estimated && r.value >= 0)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(-6);
    if (before.length >= 3) usual = before.reduce((s, [, r]) => s + r.value, 0) / before.length;
  }
  if (usual == null || usual <= 0) return null;
  const extra = Math.abs(perMonth - usual) * gap;
  if (extra < MIN_EXTRA[meter.commodity]) return null;
  if (perMonth > usual * ANOMALY_RATIO) return { kind: "high", perMonth, usual };
  if (perMonth < usual / 3) return { kind: "low", perMonth, usual };
  return null;
}
