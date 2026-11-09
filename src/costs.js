// Costs from consumption and prices: per month, what the kWh (gas: m³ turned into kWh; water: m³ at the water
// and sewage charge) cost at the price that applied then, plus that month's fixed fees; and what was paid in advances against it.
import { commodityConsumption, monthlyAdvance, offersOf, priceAt } from "./data.js";

// What a month's consumption (a row of commodityConsumption, gas in kWh) costs at a price (a price period or
// an offer): { total, parts: { energy, fixed } }.
export function monthCost(commodity, row, price) {
  let energy;
  if (commodity === "electricity") {
    // Without a low-tariff price the low-tariff kWh cost the same as the high-tariff ones.
    energy = (row.parts["el-vt"] ?? 0) * price.unit + (row.parts["el-nt"] ?? 0) * (price.unitNt ?? price.unit);
  } else if (commodity === "water") {
    energy = row.total * (price.unit + (price.unitSewer ?? 0));
  } else energy = row.total * price.unit;
  const fixed = price.monthly ?? 0;
  return { total: energy + fixed, parts: { energy, fixed } };
}

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
    out.set(month, { ...monthCost(commodity, row, price), estimated: row.estimated });
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
    paid += monthlyAdvance(priceAt(state, commodity, month)) ?? 0;
    months += 1;
  }
  return { cost, paid, balance: paid - cost, months, missing };
}

// The last twelve months with consumption priced at the current price list and at each offer, so offers compare
// on the same use: { months, usage, current: { price, cost } | null, offers: [{ offer, cost, diff }] cheapest first }.
// diff is against the current price (negative: the offer is cheaper).
export function compareOffers(state, commodity, month) {
  const used = commodityConsumption(state, commodity, { gasInKwh: commodity === "gas" });
  const months = [...used.keys()].filter((m) => m <= month).sort().slice(-12);
  const rows = months.map((m) => used.get(m));
  const usage = rows.reduce((sum, r) => sum + r.total, 0);
  const priced = (price) => (price && price.unit != null ? rows.reduce((sum, r) => sum + monthCost(commodity, r, price).total, 0) : null);
  const currentPrice = priceAt(state, commodity, month);
  const current = currentPrice && currentPrice.unit != null ? { price: currentPrice, cost: priced(currentPrice) } : null;
  const offers = offersOf(state, commodity)
    .map((offer) => {
      const cost = priced(offer);
      return { offer, cost, diff: cost != null && current ? cost - current.cost : null };
    })
    .sort((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity));
  return { months: months.length, usage, current, offers };
}
