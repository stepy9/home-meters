import test from "node:test";
import assert from "node:assert/strict";
import {
  byYear,
  change,
  commodityConsumption,
  deleteReading,
  emptyState,
  meterConsumption,
  mergeStates,
  monthAdd,
  normalizeState,
  setConfig,
  setReading,
  stateText,
} from "../src/data.js";

const withReadings = (list) => list.reduce((state, r, i) => setReading(state, r, i + 1), emptyState());

test("months add across years", () => {
  assert.equal(monthAdd("2025-12", 1), "2026-01");
  assert.equal(monthAdd("2026-01", -1), "2025-12");
  assert.equal(monthAdd("2026-03", 14), "2027-05");
});

test("consumption is the difference between readings", () => {
  const state = withReadings([
    { meter: "water", month: "2026-01", value: 100 },
    { meter: "water", month: "2026-02", value: 104.5 },
    { meter: "water", month: "2026-03", value: 110 },
  ]);
  const used = meterConsumption(state, "water");
  assert.deepEqual([...used.keys()], ["2026-02", "2026-03"]);
  assert.equal(used.get("2026-02").value, 4.5);
  assert.equal(used.get("2026-03").estimated, false);
});

test("a gap between readings is shared evenly and marked estimated", () => {
  const state = withReadings([
    { meter: "gas", month: "2026-01", value: 1000 },
    { meter: "gas", month: "2026-04", value: 1090 },
  ]);
  const used = meterConsumption(state, "gas");
  assert.deepEqual([...used.keys()], ["2026-02", "2026-03", "2026-04"]);
  for (const v of used.values()) assert.deepEqual(v, { value: 30, estimated: true });
});

test("a meter swap counts the old meter's end and the new meter's start", () => {
  const state = withReadings([
    { meter: "water", month: "2026-01", value: 980 },
    { meter: "water", month: "2026-02", value: 3, oldFinal: 990, newStart: 0 },
  ]);
  assert.equal(meterConsumption(state, "water").get("2026-02").value, 13);
});

test("electricity sums VT and NT; gas converts to kWh", () => {
  let state = withReadings([
    { meter: "el-vt", month: "2026-01", value: 100 },
    { meter: "el-vt", month: "2026-02", value: 300 },
    { meter: "el-nt", month: "2026-01", value: 50 },
    { meter: "el-nt", month: "2026-02", value: 100 },
    { meter: "gas", month: "2026-01", value: 10 },
    { meter: "gas", month: "2026-02", value: 20 },
  ]);
  const el = commodityConsumption(state, "electricity").get("2026-02");
  assert.equal(el.total, 250);
  assert.deepEqual(el.parts, { "el-vt": 200, "el-nt": 50 });
  state = setConfig(state, { gasKwhFactor: 10 });
  assert.equal(commodityConsumption(state, "gas", { gasInKwh: true }).get("2026-02").total, 100);
});

test("years are tabled by month and compared", () => {
  const state = withReadings([
    { meter: "water", month: "2024-12", value: 0 },
    { meter: "water", month: "2025-01", value: 10 },
    { meter: "water", month: "2025-12", value: 100 },
    { meter: "water", month: "2026-01", value: 112 },
  ]);
  const { years, table } = byYear(commodityConsumption(state, "water"));
  assert.deepEqual(years, [2026, 2025]);
  assert.equal(table.get(2026)[0].total, 12);
  assert.ok(Math.abs(change(table.get(2026)[0], table.get(2025)[0]) - 0.2) < 1e-9);
});

test("merging keeps the newer record and deletions travel", () => {
  const base = setReading(emptyState(), { meter: "gas", month: "2026-01", value: 1 }, 10);
  const here = setReading(base, { meter: "gas", month: "2026-01", value: 2 }, 20);
  const there = deleteReading(base, "gas", "2026-01", 30);
  const merged = mergeStates(here, there);
  assert.equal(merged.readings["gas|2026-01"].deleted, true);
  assert.equal(meterConsumption(merged, "gas").size, 0);
  assert.equal(stateText(mergeStates(there, here)), stateText(merged));
});

test("normalizing drops what does not fit and round-trips", () => {
  const state = setReading(emptyState(), { meter: "water", month: "2026-05", value: 7 }, 5);
  assert.equal(stateText(normalizeState(JSON.parse(stateText(state)))), stateText(state));
  const dirty = normalizeState({ readings: { x: { meter: "nope", month: "2026-01", value: 1 } }, config: { gasKwhFactor: -1 } });
  assert.deepEqual(dirty.readings, {});
  assert.equal(dirty.config.gasKwhFactor, 10.6);
  assert.throws(() => normalizeState({ version: 3 }));
  assert.doesNotThrow(() => normalizeState({ version: 1 }));
});

test("months sum into quarters, partial ones marked", async () => {
  const { toQuarters } = await import("../src/data.js");
  const m = (total, extra = {}) => ({ total, parts: { a: total }, estimated: false, ...extra });
  const q = toQuarters([m(1), m(2), m(3), m(4), null, m(6, { estimated: true }), null, null, null, m(10), null, null]);
  assert.deepEqual(q[0], { total: 6, parts: { a: 6 }, estimated: false, months: 3 });
  assert.equal(q[1].total, 10);
  assert.equal(q[1].months, 2);
  assert.equal(q[1].estimated, true);
  assert.equal(q[2], null);
  assert.equal(q[3].months, 1);
});
