// Unusual consumption: the latest month of each commodity against what is usual for it, to catch a leak, a
// running toilet or a typo in a reading early.
import { COMMODITIES, commodityConsumption, monthAdd } from "./data.js";

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
