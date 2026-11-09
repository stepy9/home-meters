import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, normalizeState, setBill, setConfig, setPrice, setReading, setSupplier, billsOf, stateText } from "../src/data.js";
import { benchmarks, csvExport, householdCosts, priceHistory } from "../src/household.js";

const monthAt = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
const series = (state, meter, start, values) => {
  const [y, m] = start.split("-").map(Number);
  let v = 1000;
  let s = setReading(state, { meter, month: start, value: v }, 1);
  values.forEach((used, i) => (s = setReading(s, { meter, month: monthAt(y * 12 + m + i), value: (v += used) }, 1)));
  return s;
};
const withPrice = (s, commodity, from, fields) => {
  s = setSupplier(s, { commodity, name: commodity, start: `${from}-01` }, 1);
  const sup = Object.values(s.suppliers).find((x) => x.commodity === commodity);
  return setPrice(s, { supplierId: sup.id, from, ...fields }, 1);
};

test("household costs add the commodities up and note those without a price", () => {
  let s = series(emptyState(), "el-vt", "2026-01", [100, 100]);
  s = series(s, "water", "2026-01", [10, 10]);
  s = withPrice(s, "electricity", "2026-01", { unit: 5, monthly: 100 });
  const c = householdCosts(s);
  assert.equal(c.get("2026-02").total, 600);
  assert.deepEqual(c.get("2026-02").missing, ["water"]);
});

test("benchmarks per m² and per person over the last year", () => {
  let s = series(emptyState(), "gas", "2025-11", Array(12).fill(100)); // 1200 m³ ≈ 12 720 kWh
  s = series(s, "water", "2025-11", Array(12).fill(9)); // 108 m³
  s = setConfig(s, { house: { area: 120, people: 3 } });
  const b = benchmarks(s, "2026-11");
  assert.ok(Math.abs(b.gas.perM2 - 106) < 1e-9);
  assert.equal(b.gas.level, "usual");
  assert.ok(Math.abs(b.water.litresPerDay - 108000 / 365 / 3) < 1e-9);
  assert.equal(b.electricity, undefined);
  assert.equal(normalizeState(JSON.parse(stateText(s))).config.house.people, 3);
});

test("price history steps with the price lists", () => {
  let s = withPrice(emptyState(), "water", "2026-01", { unit: 60, unitSewer: 40 });
  const sup = Object.values(s.suppliers)[0];
  s = setPrice(s, { supplierId: sup.id, from: "2026-03", unit: 70, unitSewer: 40 }, 2);
  const h = priceHistory(s, "water", "2026-04");
  assert.deepEqual(h.months, ["2026-01", "2026-02", "2026-03", "2026-04"]);
  assert.deepEqual(h.unit, [100, 100, 110, 110]);
  assert.equal(h.unitNt, null);
});

test("bills are kept and listed newest first", () => {
  let s = setBill(emptyState(), { commodity: "gas", from: "2025-01", to: "2025-12", cost: 30000, balance: -1200 }, 1);
  s = setBill(s, { commodity: "gas", from: "2026-01", to: "2026-12", cost: 28000, balance: 800 }, 2);
  const back = normalizeState(JSON.parse(stateText(s)));
  assert.deepEqual(billsOf(back, "gas").map((b) => b.balance), [800, -1200]);
  assert.throws(() => setBill(emptyState(), { commodity: "gas", from: "2026-05", to: "2026-01" }));
});

test("CSV has a row per month with readings, use and costs", () => {
  let s = series(emptyState(), "el-vt", "2026-01", [100.5]);
  s = withPrice(s, "electricity", "2026-01", { unit: 5 });
  const names = { month: "Měsíc", reading: "Stav", use: "Spotřeba", cost: "Náklady", total: "celkem", electricity: "elektřina", gas: "plyn", water: "voda", meters: { "el-vt": "VT", "el-nt": "NT", gas: "plyn", water: "voda" } };
  const lines = csvExport(s, names).replace("﻿", "").trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith("Měsíc;Stav VT;Spotřeba elektřina (kWh)"));
  assert.equal(lines[2], "2026-02;1100,5;100,5;;;;503;;;503");
});

test("small children count as 0.7, and water splits into winter and summer", () => {
  // Nov 2025 – Oct 2026: 6 m³ a month, but 12 m³ in May to September (watering).
  const values = [];
  for (let i = 0; i < 12; i++) {
    const m = ((10 + i) % 12) + 1; // the month the use is for: 11, 12, 1, …, 10
    values.push(m >= 5 && m <= 9 ? 12 : 6);
  }
  let s = series(emptyState(), "water", "2025-10", values);
  s = setConfig(s, { house: { people: 3, children: 1 } });
  const w = benchmarks(s, "2026-10").water;
  const people = 3 - 0.3;
  const winterDays = 30 + 31 + 31 + 28 + 31 + 30 + 31; // Nov–Apr and Oct
  assert.ok(Math.abs(w.winter.litresPerDay - (7 * 6000) / winterDays / people) < 1e-9);
  assert.equal(w.winter.months, 7);
  assert.equal(w.summer.months, 5);
  assert.ok(w.summer.litresPerDay > w.winter.litresPerDay * 1.9);
});
