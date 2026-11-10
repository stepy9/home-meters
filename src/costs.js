// Costs from consumption and prices: per month, what the kWh (gas: m³ turned into kWh; water: m³ at the water
// and sewage charge) cost at the price that applied then, plus that month's fixed fees; and what was paid in advances against it.
import { ADVANCE_PERIODS, commodityConsumption, monthAdd, monthDiff, monthlyAdvance, offersOf, priceAt } from "./data.js";

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

const pad = (n) => String(n).padStart(2, "0");

// The billing period (twelve months) ending in a year: { from, to } as months. With the billing end in December
// it is the calendar year.
export function billingPeriod(state, commodity, endYear) {
  const to = `${endYear}-${pad(state.config.billingEnd?.[commodity] ?? 12)}`;
  return { from: monthAdd(to, -11), to };
}

// The billing period a month falls in. Shorter periods (a quarter, half a year) end in the billing-end month and
// every so many months from it: with December and quarters, in March, June, September and December.
export function billingPeriodOf(state, commodity, month) {
  const end = state.config.billingEnd?.[commodity] ?? 12;
  const length = state.config.billingMonths?.[commodity] ?? 12;
  let to = month;
  while ((((Number(to.slice(5)) - end) % length) + length) % length !== 0) to = monthAdd(to, 1);
  return { from: monthAdd(to, 1 - length), to };
}

// The advance paid in a month: none in a billing period's last month when the bill comes instead.
const advanceIn = (state, commodity, month, price) =>
  state.config.billingSkipsAdvance?.[commodity] && billingPeriodOf(state, commodity, month).to === month ? 0 : (monthlyAdvance(price) ?? 0);

const monthsOf = ({ from, to }) => Array.from({ length: monthDiff(from, to) + 1 }, (_, i) => monthAdd(from, i));

// For a billing period (or a calendar year): what the months with a known cost cost, what was paid in advances
// over the same months, and the difference (positive: an overpayment to get back; negative: to pay extra).
// Months without an advance set count as nothing paid.
export function advanceBalance(state, commodity, period, costs = commodityCosts(state, commodity)) {
  if (typeof period === "number") period = { from: `${period}-01`, to: `${period}-12` };
  let cost = 0;
  let paid = 0;
  let months = 0;
  let missing = 0;
  for (const month of monthsOf(period)) {
    if (!costs.has(month)) continue;
    const row = costs.get(month);
    if (!row) {
      missing += 1;
      continue;
    }
    cost += row.total;
    paid += advanceIn(state, commodity, month, priceAt(state, commodity, month));
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

// The whole billing period a month falls in, the months not yet in estimated: each as the same month a year
// earlier, or (without one) as the average month of the last year; priced at the latest price by then.
// { period, actualMonths, estimatedMonths, usage, cost, paid, balance, advance: { now, suggested, per } }.
// cost and the rest are null without prices.
export function forecastBilling(state, commodity, month) {
  const period = billingPeriodOf(state, commodity, month);
  const used = commodityConsumption(state, commodity, { gasInKwh: commodity === "gas" });
  const known = [...used.keys()].sort();
  const last = known.at(-1);
  if (!last) return null;
  const recent = known.slice(-12).map((m) => used.get(m));
  const average = recent.length
    ? {
        total: recent.reduce((sum, r) => sum + r.total, 0) / recent.length,
        parts: Object.fromEntries(Object.keys(recent.at(-1).parts).map((k) => [k, recent.reduce((sum, r) => sum + (r.parts[k] ?? 0), 0) / recent.length])),
      }
    : null;
  let usage = 0;
  let cost = 0;
  let paid = 0;
  let priced = true;
  let actualMonths = 0;
  let estimatedMonths = 0;
  for (const m of monthsOf(period)) {
    let row = used.get(m);
    if (row) actualMonths += 1;
    else {
      row = used.get(monthAdd(m, -12)) ?? average;
      if (!row) continue;
      estimatedMonths += 1;
    }
    usage += row.total;
    const price = priceAt(state, commodity, m);
    if (!price || price.unit == null) priced = false;
    else {
      cost += monthCost(commodity, row, price).total;
      paid += advanceIn(state, commodity, m, price);
    }
  }
  const nowPrice = priceAt(state, commodity, month);
  const per = ADVANCE_PERIODS[nowPrice?.advancePeriod ?? "month"];
  // A suggested advance that covers the forecast cost, rounded up to a hundred crowns per payment.
  // Without an advance in the period's last month, the other months cover it.
  const paying = monthDiff(period.from, period.to) + 1 - (state.config.billingSkipsAdvance?.[commodity] ? 1 : 0);
  const suggested = priced ? Math.ceil(((cost / Math.max(paying, 1)) * per) / 100) * 100 : null;
  return {
    period,
    actualMonths,
    estimatedMonths,
    usage,
    cost: priced ? cost : null,
    paid: priced ? paid : null,
    balance: priced ? paid - cost : null,
    advance: { now: nowPrice?.advance ?? null, suggested, per: nowPrice?.advancePeriod ?? "month" },
  };
}
