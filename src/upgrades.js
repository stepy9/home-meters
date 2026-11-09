// What a house upgrade did to consumption: the same calendar months a year apart, before and after the upgrade
// month (itself left out, the work usually runs through it), so seasons cancel out. Gas can be compared per
// degree day, so a mild winter after the upgrade does not look like its saving. The saving is priced with the
// current price list, which gives a yearly saving and the years it takes to pay back the upgrade.
import { commodityConsumption, monthAdd, priceAt } from "./data.js";
import { MIN_DEGREE_DAYS } from "./weather.js";

export const MIN_PAIRS = 3;

// The price of one unit of consumption saved (gas per kWh, water with sewage, electricity at the high tariff).
const unitPrice = (commodity, price) => {
  if (!price || price.unit == null) return null;
  return commodity === "water" ? price.unit + (price.unitSewer ?? 0) : price.unit;
};

// { pairs, change, before, after, saved (per year, in the commodity's unit; gas in kWh), savedMoney, net, payback, byWeather }
export function upgradeImpact(state, upgrade, commodity, { month, dd } = {}) {
  const gas = commodity === "gas";
  const consumption = commodityConsumption(state, commodity, { gasInKwh: gas });
  const byWeather = gas && dd instanceof Map && dd.size > 0;
  let before = 0;
  let after = 0;
  let pairs = 0;
  for (let k = 1; k <= 12; k++) {
    const a = monthAdd(upgrade.month, k);
    const b = monthAdd(a, -12);
    if (b >= upgrade.month || (month && a >= month)) continue;
    const ra = consumption.get(a);
    const rb = consumption.get(b);
    if (!ra || !rb) continue;
    if (byWeather) {
      const da = dd.get(a);
      const db = dd.get(b);
      if (!(da >= MIN_DEGREE_DAYS && db >= MIN_DEGREE_DAYS)) continue;
      after += ra.total / da;
      before += rb.total / db;
    } else {
      after += ra.total;
      before += rb.total;
    }
    pairs += 1;
  }
  if (pairs < MIN_PAIRS || before <= 0) return { pairs, pending: true, byWeather };
  const change = after / before - 1;
  // A year before the upgrade, the base the change applies to (fewer months scaled up to twelve).
  let yearBase = 0;
  let months = 0;
  for (let k = 1; k <= 12; k++) {
    const r = consumption.get(monthAdd(upgrade.month, -k));
    if (r) {
      yearBase += r.total;
      months += 1;
    }
  }
  const saved = months ? (-change * yearBase * 12) / months : null;
  const up = unitPrice(commodity, priceAt(state, commodity, month ?? upgrade.month));
  const savedMoney = saved != null && up != null ? saved * up : null;
  return { pairs, change, saved, savedMoney, byWeather };
}

// All the commodities an upgrade affects together: the yearly saving in money and the payback in years.
export function upgradePayback(upgrade, impacts) {
  const known = impacts.filter((i) => i && !i.pending && i.savedMoney != null);
  if (!known.length) return null;
  const savedMoney = known.reduce((sum, i) => sum + i.savedMoney, 0);
  const net = upgrade.cost == null ? null : Math.max(0, upgrade.cost - (upgrade.subsidy ?? 0));
  return { savedMoney, net, years: net != null && savedMoney > 0 ? net / savedMoney : null };
}
