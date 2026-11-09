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

test("a quarterly or yearly advance counts per month", () => {
  let s = home();
  s = setPrice(s, { id: "w1", supplierId: "wt", from: "2020-01", unit: 60, unitSewer: 50, advance: 1800, advancePeriod: "quarter" }, 4);
  const b = advanceBalance(s, "water", 2026);
  close(b.paid, 2 * 600);
  s = setPrice(s, { id: "w1", supplierId: "wt", from: "2020-01", unit: 60, advance: 7200, advancePeriod: "year" }, 5);
  close(advanceBalance(s, "water", 2026).paid, 2 * 600);
  assert.equal(setPrice(s, { id: "w1", supplierId: "wt", from: "2020-01", advancePeriod: "week" }).prices.w1.advancePeriod, "month");
});

test("offers compare on the last twelve months at the current price", async () => {
  const { compareOffers } = await import("../src/costs.js");
  const { setOffer, deleteOffer } = await import("../src/data.js");
  let s = home();
  s = setOffer(s, { id: "a", commodity: "electricity", name: "Levná", tariff: "D25d", unit: 4, unitNt: 2, monthly: 300 }, 7);
  s = setOffer(s, { id: "b", commodity: "electricity", name: "Drahá", tariff: "D02d", unit: 6, unitNt: 9, monthly: 100 }, 7);
  const r = compareOffers(s, "electricity", "2026-03");
  assert.equal(r.months, 3);
  // Usage Jan–Mar: HT 200+150+100, LT 100+50+50.
  close(r.usage, 650);
  close(r.current.cost, 450 * 4 + 200 * 2.5 + 3 * 400);
  assert.deepEqual(r.offers.map((o) => o.offer.id), ["a", "b"]);
  close(r.offers[0].cost, 450 * 4 + 200 * 2 + 3 * 300);
  close(r.offers[0].diff, r.offers[0].cost - r.current.cost);
  // A one-tariff offer prices LT kWh at the HT price.
  close(r.offers[1].cost, 650 * 6 + 3 * 100);
  assert.equal(compareOffers(deleteOffer(s, "a", 8), "electricity", "2026-03").offers.length, 1);
});

test("billing periods end in the chosen month", async () => {
  const { billingPeriod, billingPeriodOf } = await import("../src/costs.js");
  let s = home();
  assert.deepEqual(billingPeriod(s, "gas", 2026), { from: "2026-01", to: "2026-12" });
  s = setConfig(s, { billingEnd: { gas: 8 } });
  assert.equal(s.config.billingEnd.electricity, 12);
  assert.deepEqual(billingPeriod(s, "gas", 2026), { from: "2025-09", to: "2026-08" });
  assert.deepEqual(billingPeriodOf(s, "gas", "2026-08"), { from: "2025-09", to: "2026-08" });
  assert.deepEqual(billingPeriodOf(s, "gas", "2026-09"), { from: "2026-09", to: "2027-08" });
  assert.equal(normalizeState(JSON.parse(stateText(s))).config.billingEnd.gas, 8);
});

test("the billing forecast fills the months to come from a year earlier", async () => {
  const { forecastBilling } = await import("../src/costs.js");
  let s = emptyState();
  // Water 2025 all year, 2026 to March: 10 m³ a month in 2025, 12 in 2026.
  const list = [["2024-12", 0]];
  let v = 0;
  for (let m = 1; m <= 12; m++) list.push([`2025-${String(m).padStart(2, "0")}`, (v += 10)]);
  for (let m = 1; m <= 3; m++) list.push([`2026-${String(m).padStart(2, "0")}`, (v += 12)]);
  s = readings(s, "water", list);
  s = setSupplier(s, { id: "wt", commodity: "water", name: "PVK", from: "2020-01" }, 2);
  s = setPrice(s, { id: "w1", supplierId: "wt", from: "2020-01", unit: 100, advance: 3000, advancePeriod: "quarter" }, 3);
  const f = forecastBilling(s, "water", "2026-04");
  assert.deepEqual(f.period, { from: "2026-01", to: "2026-12" });
  assert.equal(f.actualMonths, 3);
  assert.equal(f.estimatedMonths, 9);
  close(f.usage, 3 * 12 + 9 * 10);
  close(f.cost, (3 * 12 + 9 * 10) * 100);
  close(f.paid, 12 * 1000);
  close(f.balance, 12000 - 12600);
  // A quarterly advance covering 12 600 Kč a year: 3 150, rounded up to 3 200.
  assert.equal(f.advance.suggested, 3200);
  assert.equal(f.advance.per, "quarter");
});
