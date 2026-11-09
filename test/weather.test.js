import test from "node:test";
import assert from "node:assert/strict";
import { degreeDays, perDegreeDays } from "../src/weather.js";

test("degree days count only days below 13 °C, as 19 °C minus the mean", () => {
  const dd = degreeDays([
    { date: "2026-01-01", mean: -1 },
    { date: "2026-01-02", mean: 4 },
    { date: "2026-01-03", mean: 13 },
    { date: "2026-02-01", mean: 12.9 },
    { date: "2026-02-02", mean: null },
  ]);
  assert.equal(dd.get("2026-01"), 20 + 15);
  assert.ok(Math.abs(dd.get("2026-02") - 6.1) < 1e-9);
});

test("gas per 100 degree days, heating months only", () => {
  const use = new Map([
    ["2026-01", { total: 120, parts: { gas: 120 }, estimated: false }],
    ["2026-07", { total: 25, parts: { gas: 25 }, estimated: false }],
  ]);
  const per = perDegreeDays(use, new Map([["2026-01", 600], ["2026-07", 5]]));
  assert.equal(per.get("2026-01").total, 20);
  assert.equal(per.get("2026-01").degreeDays, 600);
  assert.equal(per.has("2026-07"), false);
});
