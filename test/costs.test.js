import test from "node:test";
import assert from "node:assert/strict";
import { advanceBalance, commodityCosts } from "../src/costs.js";
import { deletePrice, emptyState, mergeStates, normalizeState, priceAt, setConfig, setPrice, setReading, setSupplier, stateText } from "../src/data.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

const readings = (state, meter, list) => list.reduce((s, [month, value]) => setReading(s, { meter, month, value }, 1), state);

function home() {
  let s = emptyState();
  s = readings(s, "el-vt", [["2025-12", 1000], ["2026-01", 1200], ["2026-02", 1350], ["2026-03", 1450]]);
  s = readings(s, "el-nt", [["2025-12", 500], ["2026-01", 600], ["2026-02", 650], ["2026-03", 700]]);
  s = readings(s, "gas", [["2025-12", 100], ["2026-01", 200], ["2026-02", 280]]);
  s = readings(s, "water", [["2025-12", 10], ["2026-01", 15], ["2026-02", 21]]);
  s = setConfig(s, { gasKwhFactor: 10 });
  s = setSupplier(s, { id: "el", commodity: "electricity", name: "ČEZ", from: "2024-01" }, 2);
  s = setSupplier(s, { id: "gs", commodity: "gas", name: "ČEZ", from: "2024-01" }, 2);
  s = setSupplier(s, { id: "wt", commodity: "water", name: "PVK", from: "2020-01" }, 2);
  s = setPrice(s, { id: "e1", supplierId: "el", from: "2025-01", tariff: "D25d", unit: 5, unitNt: 3, monthly: 400, advance: 1500 }, 3);
  s = setPrice(s, { id: "e2", supplierId: "el", from: "2026-03", tariff: "D25d", unit: 4, unitNt: 2.5, monthly: 400, advance: 1200 }, 3);
  s = setPrice(s, { id: "g1", supplierId: "gs", from: "2025-01", unit: 1.5, monthly: 150, advance: 1000 }, 3);
  s = setPrice(s, { id: "w1", supplierId: "wt", from: "2020-01", unit: 60, unitSewer: 50, advance: 600 }, 3);
  return s;
}

test("the price that applied: supplier then, its latest period by then", () => {
  const s = home();
  assert.equal(priceAt(s, "electricity", "2026-02").id, "e1");
  assert.equal(priceAt(s, "electricity", "2026-03").id, "e2");
  assert.equal(priceAt(s, "electricity", "2024-06"), null);
});

test("electricity costs high and low tariff apart, plus the fixed fees", () => {
  const costs = commodityCosts(home(), "electricity");
  // Jan: 200 kWh HT × 5 + 100 kWh LT × 3 + 400
  close(costs.get("2026-01").total, 200 * 5 + 100 * 3 + 400);
  // Mar: new prices
  close(costs.get("2026-03").total, 100 * 4 + 50 * 2.5 + 400);
});

test("gas costs per kWh from m³; water per m³ at water plus sewage charge", () => {
  const s = home();
  close(commodityCosts(s, "gas").get("2026-01").total, 100 * 10 * 1.5 + 150);
  close(commodityCosts(s, "water").get("2026-02").total, 6 * (60 + 50));
});

test("months without a price have no cost and are counted as missing", () => {
  const s = deletePrice(home(), "g1", 9);
  assert.equal(commodityCosts(s, "gas").get("2026-01"), null);
  const balance = advanceBalance(s, "gas", 2026);
  assert.equal(balance.missing, 2);
  assert.equal(balance.months, 0);
});

test("advances against costs over the same months", () => {
  const b = advanceBalance(home(), "electricity", 2026);
  const cost = 200 * 5 + 100 * 3 + 400 + (150 * 5 + 50 * 3 + 400) + (100 * 4 + 50 * 2.5 + 400);
  close(b.cost, cost);
  close(b.paid, 1500 + 1500 + 1200);
  close(b.balance, 1500 + 1500 + 1200 - cost);
  assert.equal(b.months, 3);
});

test("prices are cleaned, merged and round-trip", () => {
  const s = home();
  assert.equal(s.prices.g1.unitNt, null, "no LT price without a two-tariff rate");
  assert.equal(setPrice(s, { id: "x", supplierId: "el", from: "2026-05", breaker: "3×25 A" }).prices.x.breaker, "3×25 A");
  assert.equal(setPrice(s, { id: "x", supplierId: "el", from: "2026-05", breaker: "3×99 A" }).prices.x.breaker, "");
  assert.throws(() => setPrice(s, { supplierId: "el", from: "2026" }));
  const merged = mergeStates(s, deletePrice(s, "e2", 99));
  assert.equal(merged.prices.e2.deleted, true);
  assert.equal(stateText(normalizeState(JSON.parse(stateText(merged)))), stateText(merged));
});
