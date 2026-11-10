import { cur } from "./i18n.js";
// The whole household: what electricity, gas and water cost together per month, use per m² and per person over
// the last twelve months, and a CSV of everything per month.
import { commodityCosts } from "./costs.js";
import { COMMODITIES, METERS, SUPPLIED, commodityConsumption, monthAdd, priceAt, readingKey } from "./data.js";

// month -> { total, parts: { electricity, gas, water }, missing: [commodities with use but no price] }.
export function householdCosts(state) {
  const out = new Map();
  for (const c of SUPPLIED) {
    for (const [month, row] of commodityCosts(state, c)) {
      const cell = out.get(month) ?? { total: 0, parts: {}, missing: [] };
      if (row) {
        cell.parts[c] = row.total;
        cell.total += row.total;
      } else cell.missing.push(c);
      out.set(month, cell);
    }
  }
  return out;
}

// Use over the twelve months up to a month (gas in kWh), with how many months each has: { electricity, gas, water }
// each { total, months, perYear }.
export function lastYearUse(state, month) {
  const out = {};
  for (const c of COMMODITIES) {
    const used = commodityConsumption(state, c, { gasInKwh: c === "gas" });
    let total = 0;
    let months = 0;
    for (let k = 0; k < 12; k++) {
      const row = used.get(monthAdd(month, -k));
      if (row) {
        total += row.total;
        months += 1;
      }
    }
    out[c] = { total, months, perYear: months ? (total * 12) / months : null };
  }
  return out;
}

// Rough Czech references, to say whether a house uses a lot or little (orientation only).
// Gas for heating per m² a year: under 50 kWh a low-energy house, 50–100 economical, 100–150 usual, above wasteful.
export const GAS_CLASSES = [
  [50, "low"],
  [100, "good"],
  [150, "usual"],
  [Infinity, "high"],
];
export const WATER_LITRES_PER_DAY = 89; // average per person in Czechia
export const ELECTRICITY_PER_PERSON = 1000; // kWh a year, a household that does not heat with electricity

// A small child (under six) uses about 70 % of what an adult does.
export const CHILD_WEIGHT = 0.7;
// Months without watering the garden: October to April.
const WINTER = new Set(["10", "11", "12", "01", "02", "03", "04"]);

// Water a day per person over the given months of the last year: { litresPerDay, months }.
function waterPerDay(state, month, people, keep) {
  const used = commodityConsumption(state, "water");
  let total = 0;
  let days = 0;
  let months = 0;
  for (let k = 0; k < 12; k++) {
    const m = monthAdd(month, -k);
    const row = used.get(m);
    if (!row || !keep(m.slice(5))) continue;
    total += row.total;
    days += new Date(Number(m.slice(0, 4)), Number(m.slice(5)), 0).getDate();
    months += 1;
  }
  return months ? { litresPerDay: (total * 1000) / days / people, months } : null;
}

export function benchmarks(state, month) {
  const { area, children } = state.config.house ?? {};
  // People as adults: small children count less.
  const people = state.config.house?.people ? state.config.house.people - Math.min(children ?? 0, state.config.house.people) * (1 - CHILD_WEIGHT) : null;
  const use = lastYearUse(state, month);
  const out = {};
  if (use.gas.perYear != null && area) {
    const perM2 = use.gas.perYear / area;
    out.gas = { perM2, months: use.gas.months, level: GAS_CLASSES.find(([limit]) => perM2 < limit)[1] };
  }
  if (use.water.perYear != null && people) {
    const litres = (use.water.perYear * 1000) / 365 / people;
    const winter = waterPerDay(state, month, people, (mm) => WINTER.has(mm));
    const summer = waterPerDay(state, month, people, (mm) => !WINTER.has(mm));
    out.water = { perPerson: use.water.perYear / people, litresPerDay: litres, months: use.water.months, ratio: litres / WATER_LITRES_PER_DAY, winter, summer };
  }
  if (use.electricity.perYear != null && people) {
    const perPerson = use.electricity.perYear / people;
    out.electricity = { perPerson, perM2: area ? use.electricity.perYear / area : null, months: use.electricity.months, ratio: perPerson / ELECTRICITY_PER_PERSON };
  }
  return out;
}

// The unit price over time, month by month from the first price list: { months, unit: [..], unitNt: [..] }.
// Electricity: the high and low tariff; gas per kWh; water and sewage together per m³.
export function priceHistory(state, commodity, to) {
  const all = Object.values(state.prices ?? {}).filter((p) => !p.deleted && state.suppliers[p.supplierId]?.commodity === commodity);
  if (!all.length) return null;
  const from = all.map((p) => p.from).sort()[0];
  const months = [];
  const unit = [];
  const unitNt = [];
  for (let m = from; m <= to; m = monthAdd(m, 1)) {
    const p = priceAt(state, commodity, m);
    months.push(m);
    unit.push(p?.unit == null ? null : commodity === "water" ? p.unit + (p.unitSewer ?? 0) : p.unit);
    unitNt.push(p?.unitNt ?? null);
  }
  return { months, unit, unitNt: unitNt.some((v) => v != null) ? unitNt : null };
}

// Everything per month as CSV for Excel (Czech: semicolons and a decimal comma): readings, use and costs.
export function csvExport(state, names) {
  const used = Object.fromEntries(COMMODITIES.map((c) => [c, commodityConsumption(state, c)]));
  const gasKwh = commodityConsumption(state, "gas", { gasInKwh: true });
  const costs = householdCosts(state);
  const months = new Set();
  for (const r of Object.values(state.readings)) if (!r.deleted) months.add(r.month);
  const sorted = [...months].sort();
  const num = (v, digits = 2) => (v == null ? "" : String(Math.round(v * 10 ** digits) / 10 ** digits).replace(".", ","));
  const meters = METERS.filter((m) => sorted.some((month) => state.readings[readingKey(m.id, month)] && !state.readings[readingKey(m.id, month)].deleted));
  const header = [
    names.month,
    ...meters.map((m) => `${names.reading} ${names.meters[m.id]}`),
    `${names.use} ${names.electricity} (kWh)`,
    `${names.use} ${names.gas} (m3)`,
    `${names.use} ${names.gas} (kWh)`,
    `${names.use} ${names.water} (m3)`,
    ...SUPPLIED.map((c) => `${names.cost} ${names[c]} (${cur()})`),
    `${names.cost} ${names.total} (${cur()})`,
  ];
  const rows = sorted.map((month) => {
    const reading = (id) => {
      const r = state.readings[readingKey(id, month)];
      return r && !r.deleted ? num(r.value, 3) : "";
    };
    const cost = costs.get(month);
    return [
      month,
      ...meters.map((m) => reading(m.id)),
      num(used.electricity.get(month)?.total),
      num(used.gas.get(month)?.total),
      num(gasKwh.get(month)?.total),
      num(used.water.get(month)?.total),
      ...SUPPLIED.map((c) => num(cost?.parts[c], 0)),
      cost && Object.keys(cost.parts).length ? num(cost.total, 0) : "",
    ];
  });
  const line = (cells) => cells.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(";");
  return "﻿" + [header, ...rows].map(line).join("\r\n") + "\r\n";
}
