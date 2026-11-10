// A year's goal, the electricity drawn all the time, and the carbon a year's electricity and gas emitted.
import { commodityCosts } from "./costs.js";
import { COMMODITIES, byYear, commodityConsumption, monthAdd, projectYear } from "./data.js";

// kg CO2 per kWh of natural gas burnt (IPCC: 56.1 kg per GJ).
export const GAS_CO2 = 0.202;
// kg CO2 per kWh of electricity from the Czech grid, as a default the settings can change.
export const DEFAULT_ELECTRICITY_CO2 = 0.45;

// The months of a year (twelve, null where unknown) in use (gas in m³) or money.
function yearMonths(state, commodity, kind, year) {
  const source = kind === "cost" ? commodityCosts(state, commodity) : commodityConsumption(state, commodity);
  const clean = new Map([...source].filter(([, row]) => row));
  const { table } = byYear(clean);
  return { months: table.get(year) ?? null, prev: table.get(year - 1) ?? null };
}

// How a year stands against its goal: { goal, actual, expected, projected, months }. Expected is the part of the
// goal the months known should have used, shaped by last year (more gas in winter), else evenly; projected is
// the year's likely total. null without a goal or a month known.
export function goalProgress(state, commodity, kind, year) {
  const goal = state.config.goals?.[commodity]?.[kind];
  if (!goal) return null;
  const { months, prev } = yearMonths(state, commodity, kind, year);
  if (!months?.some(Boolean)) return null;
  const known = months.map((m, i) => (m ? i : null)).filter((i) => i != null);
  const actual = known.reduce((s, i) => s + months[i].total, 0);
  const prevTotal = prev?.every(Boolean) ? prev.reduce((s, m) => s + m.total, 0) : 0;
  const share = prevTotal > 0 ? known.reduce((s, i) => s + prev[i].total, 0) / prevTotal : known.length / 12;
  const projection = projectYear(months, prev);
  const projected = known.length === 12 ? actual : projection ? projection.total : share > 0 ? actual / share : null;
  return { goal, actual, expected: goal * share, projected, months: known.length };
}

// The electricity drawn all the time (fridge, router, standby), from the lowest measured month of the twelve up to
// a month: { watts, month, kwhYear }. An upper bound, as that month had some use on top. null with under six months.
export function baseLoad(state, month) {
  const used = commodityConsumption(state, "electricity");
  const from = monthAdd(month, -12);
  const months = [...used].filter(([m, row]) => m > from && m <= month && !row.estimated && row.total > 0);
  if (months.length < 6) return null;
  const [low, row] = months.reduce((a, b) => (b[1].total < a[1].total ? b : a));
  const [y, m] = low.split("-").map(Number);
  const hours = new Date(y, m, 0).getDate() * 24;
  const watts = (row.total / hours) * 1000;
  return { watts, month: low, kwhYear: (watts * 8760) / 1000 };
}

// A year's emissions in kg CO2: { electricity, gas, total }, each null when nothing is known that year.
export function emissions(state, year) {
  const sum = (commodity, opts) => {
    const rows = [...commodityConsumption(state, commodity, opts)].filter(([m]) => m.startsWith(`${year}-`));
    return rows.length ? rows.reduce((s, [, r]) => s + r.total, 0) : null;
  };
  const el = sum("electricity");
  const gas = sum("gas", { gasInKwh: true });
  const factor = state.config.co2Electricity ?? DEFAULT_ELECTRICITY_CO2;
  const electricity = el == null ? null : el * factor;
  const gasKg = gas == null ? null : gas * GAS_CO2;
  if (electricity == null && gasKg == null) return null;
  return { electricity, gas: gasKg, total: (electricity ?? 0) + (gasKg ?? 0) };
}

const roundTo = (value, step) => Math.round(value / step) * step;
const STEP = { usage: { electricity: 10, gas: 10, water: 1 }, cost: { electricity: 100, gas: 100, water: 100 } };

// Goals from the data: per commodity the use and costs of the last twelve months known, rounded. A commodity or
// kind without twelve months in a row (or without prices, for costs) is left out. { electricity: { usage, cost } }.
export function suggestGoals(state) {
  const out = {};
  for (const commodity of COMMODITIES) {
    for (const kind of ["usage", "cost"]) {
      const source = kind === "cost" ? commodityCosts(state, commodity) : commodityConsumption(state, commodity);
      const months = [...source.keys()].filter((m) => source.get(m)).sort();
      const last = months.at(-1);
      if (!last) continue;
      const year = Array.from({ length: 12 }, (_, i) => source.get(monthAdd(last, -i)));
      if (!year.every(Boolean)) continue;
      const total = year.reduce((s, r) => s + r.total, 0);
      if (total > 0) (out[commodity] ??= {})[kind] = roundTo(total, STEP[kind][commodity]);
    }
  }
  return out;
}
