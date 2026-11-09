import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, normalizeState, setPrice, setReading, setSupplier, setUpgrade, upgradesOf } from "../src/data.js";
import { upgradeImpact, upgradePayback } from "../src/upgrades.js";

const monthAt = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
// Monthly use from a start month, as readings.
const series = (state, meter, start, values) => {
  const [y, m] = start.split("-").map(Number);
  let v = 1000;
  let s = setReading(state, { meter, month: start, value: v }, 1);
  values.forEach((used, i) => (s = setReading(s, { meter, month: monthAt(y * 12 + m + i), value: (v += used) }, 1)));
  return s;
};

test("upgrades are cleaned, kept through normalize and listed newest first", () => {
  let s = setUpgrade(emptyState(), { kinds: ["windows", "doors"], month: "2025-05", name: "Okna", cost: 200000, subsidy: 50000, affects: ["gas", "bogus"] }, 5);
  s = setUpgrade(s, { kind: "solar", month: "2026-03", affects: ["electricity"] }, 6);
  const back = normalizeState(JSON.parse(JSON.stringify(s)));
  const list = upgradesOf(back);
  assert.deepEqual(list.map((u) => u.kinds), [["solar"], ["windows", "doors"]]);
  assert.deepEqual(list[1].affects, ["gas"]);
  assert.deepEqual(upgradesOf(back, "gas").map((u) => u.kinds), [["windows", "doors"]]);
  assert.throws(() => setUpgrade(emptyState(), { kind: "nope", month: "2025-05" }));
});

test("impact compares the same months a year apart and prices the saving", () => {
  // 24 months of water at 10 m³, then a saving device in month 13 and 8 m³ afterwards.
  const values = [...Array(12).fill(10), 10, ...Array(11).fill(8)];
  let s = series(emptyState(), "water", "2024-12", values);
  s = setSupplier(s, { commodity: "water", name: "VaK", start: "2020-01-01" }, 1);
  const supplier = Object.values(s.suppliers)[0];
  s = setPrice(s, { supplierId: supplier.id, from: "2020-01", unit: 60, unitSewer: 40 }, 1);
  const u = { month: "2026-01", cost: 2400, subsidy: null };
  const i = upgradeImpact(s, u, "water", { month: "2026-12" });
  assert.equal(i.pairs, 10);
  assert.ok(Math.abs(i.change + 0.2) < 1e-9);
  assert.ok(Math.abs(i.saved - 24) < 1e-9);
  assert.ok(Math.abs(i.savedMoney - 2400) < 1e-6);
  assert.ok(Math.abs(upgradePayback(u, [i]).years - 1) < 1e-9);
  // Too soon after the upgrade: not enough months yet.
  assert.equal(upgradeImpact(s, u, "water", { month: "2026-03" }).pending, true);
});

test("gas per degree day takes out a milder winter", () => {
  const values = Array(24).fill(100);
  const s = series(emptyState(), "gas", "2024-12", values);
  // The same gas after the upgrade in a 20 % milder winter: per degree day that is 25 % more, not a saving.
  const dd = new Map();
  for (let i = 0; i < 25; i++) {
    const m = monthAt(2024 * 12 + 11 + i);
    dd.set(m, m >= "2026-01" ? 400 : 500);
  }
  const i = upgradeImpact(s, { month: "2025-12" }, "gas", { month: "2026-12", dd });
  assert.equal(i.byWeather, true);
  assert.ok(Math.abs(i.change - 0.25) < 1e-9);
  assert.ok(Math.abs(upgradeImpact(s, { month: "2025-12" }, "gas", { month: "2026-12" }).change) < 1e-9);
});
