import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, normalizeState, setConfig, setReading } from "../src/data.js";
import { baseLoad, emissions, goalProgress, GAS_CO2 } from "../src/insights.js";

// Readings so that each month from a start uses the given amounts.
const series = (state, meter, start, used) => {
  let [y, m] = start.split("-").map(Number);
  let v = 1000;
  let s = setReading(state, { meter, month: start, value: v }, 1);
  for (const u of used) {
    m += 1;
    if (m > 12) [y, m] = [y + 1, 1];
    s = setReading(s, { meter, month: `${y}-${String(m).padStart(2, "0")}`, value: (v += u) }, 1);
  }
  return s;
};

test("goals survive normalize and setConfig changes one at a time", () => {
  let s = setConfig(emptyState(), { goals: { gas: { usage: 900 } } });
  s = setConfig(s, { goals: { gas: { cost: 20000 } } });
  assert.deepEqual(s.config.goals.gas, { usage: 900, cost: 20000 });
  const back = normalizeState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back.config.goals.gas, { usage: 900, cost: 20000 });
  assert.deepEqual(back.config.goals.water, { usage: null, cost: null });
});

test("goal progress: shaped by last year, projected to the year's end", () => {
  // 2025: 200 a month in Jan–Mar, 50 the rest (1050); 2026: Jan–Mar 220 each.
  let s = series(emptyState(), "gas", "2024-12", [200, 200, 200, 50, 50, 50, 50, 50, 50, 50, 50, 50, 220, 220, 220]);
  s = setConfig(s, { goals: { gas: { usage: 1000 } } });
  const g = goalProgress(s, "gas", "usage", 2026);
  assert.equal(g.actual, 660);
  assert.ok(Math.abs(g.expected - (1000 * 600) / 1050) < 1e-9);
  assert.ok(Math.abs(g.projected - (660 + 450 * 1.1)) < 1e-9);
  assert.equal(goalProgress(s, "electricity", "usage", 2026), null);
});

test("base load from the lowest measured month, needing half a year", () => {
  const s = series(emptyState(), "el-vt", "2026-01", [300, 280, 250, 220, 72, 200]);
  const b = baseLoad(s, "2026-07");
  assert.equal(b.month, "2026-06");
  assert.ok(Math.abs(b.watts - (72 / 720) * 1000) < 1e-9);
  assert.equal(baseLoad(series(emptyState(), "el-vt", "2026-01", [300, 280]), "2026-03"), null);
});

test("emissions of a year: electricity by its factor, gas by kWh", () => {
  let s = series(emptyState(), "el-vt", "2025-12", [100, 100]);
  s = series(s, "gas", "2025-12", [10]);
  const e = emissions(s, 2026);
  assert.ok(Math.abs(e.electricity - 200 * 0.45) < 1e-9);
  assert.ok(Math.abs(e.gas - 10 * 10.6 * GAS_CO2) < 1e-9);
  assert.equal(emissions(setConfig(s, { co2Electricity: 0.1 }), 2026).electricity, 20);
  assert.equal(emissions(s, 2020), null);
});

test("suggested goals: the last twelve months, rounded; too little data suggests nothing", async () => {
  const { suggestGoals } = await import("../src/insights.js");
  const s = series(emptyState(), "water", "2025-01", Array(13).fill(10.4));
  assert.deepEqual(suggestGoals(s), { water: { usage: 125 } });
  assert.deepEqual(suggestGoals(series(emptyState(), "water", "2025-01", Array(11).fill(10))), {});
});

test("yearly report: totals, the year before and household costs per month", async () => {
  const { yearReport, reportYears } = await import("../src/report.js");
  const s = series(emptyState(), "water", "2024-12", Array(24).fill(10));
  assert.deepEqual(reportYears(s), [2026, 2025]);
  const r = yearReport(s, 2026);
  assert.equal(r.commodities.length, 1);
  assert.equal(r.commodities[0].totals.usage, 120);
  assert.equal(r.commodities[0].totals.prevUsage, 120);
  assert.equal(r.costs.every((c) => c == null), true);
  assert.equal(yearReport(s, 2020).commodities.length, 0);
});
