// Costs from consumption and prices: per month, what the kWh (gas: m³ turned into kWh; water: m³ at the water
// and sewage charge) cost at the price that applied then, plus that month's fixed fees; and what was paid in advances against it.
import { commodityConsumption, priceAt } from "./data.js";

// month -> { total, parts: { energy, fixed }, estimated, missing } where missing marks a month whose price
// is not known (it then has no cost and is left out of totals).
export function commodityCosts(state, commodity) {
  const used = commodityConsumption(state, commodity, { gasInKwh: commodity === "gas" });
  const out = new Map();
  for (const [month, row] of used) {
    const price = priceAt(state, commodity, month);
    if (!price || price.unit == null) {
      out.set(month, null);
      continue;
    }
    let energy;
    if (commodity === "electricity") {
      // Without a low-tariff price the low-tariff kWh cost the same as the high-tariff ones.
      energy = (row.parts["el-vt"] ?? 0) * price.unit + (row.parts["el-nt"] ?? 0) * (price.unitNt ?? price.unit);
    } else if (commodity === "water") {
      energy = row.total * (price.unit + (price.unitSewer ?? 0));
    } else energy = row.total * price.unit;
    const fixed = price.monthly ?? 0;
    out.set(month, { total: energy + fixed, parts: { energy, fixed }, estimated: row.estimated });
  }
  return out;
}

// For a calendar year: what the months with a known cost cost, what was paid in advances over the same months,
// and the difference (positive: an overpayment to get back; negative: to pay extra). Months without an advance
// set count as nothing paid.
export function advanceBalance(state, commodity, year, costs = commodityCosts(state, commodity)) {
  let cost = 0;
  let paid = 0;
  let months = 0;
  let missing = 0;
  for (let m = 1; m <= 12; m++) {
    const month = `${year}-${String(m).padStart(2, "0")}`;
    if (!costs.has(month)) continue;
    const row = costs.get(month);
    if (!row) {
      missing += 1;
      continue;
    }
    cost += row.total;
    paid += priceAt(state, commodity, month)?.advance ?? 0;
    months += 1;
  }
  return { cost, paid, balance: paid - cost, months, missing };
}
