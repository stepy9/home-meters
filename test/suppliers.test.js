import test from "node:test";
import assert from "node:assert/strict";
import { daysUntil, deleteSupplier, emptyState, mergeStates, normalizeState, setSupplier, stateText, supplierAt, suppliersOf } from "../src/data.js";

const base = () =>
  [
    { id: "a", commodity: "electricity", name: "ČEZ", from: "2024-01", product: "Fix 24", contractEnd: "2025-12-31", point: "859182400" },
    { id: "g", commodity: "gas", name: "ČEZ", from: "2024-01", product: "Plyn Fix", contractEnd: "2026-06-30", point: "27ZG" },
    { id: "b", commodity: "electricity", name: "Bohemia", from: "2026-01" },
  ].reduce((s, f, i) => setSupplier(s, f, i + 1), emptyState());

test("a supplier covers its commodity from its month until the next one", () => {
  const s = base();
  assert.equal(supplierAt(s, "electricity", "2023-12"), null);
  assert.equal(supplierAt(s, "electricity", "2025-06").product, "Fix 24");
  assert.equal(supplierAt(s, "electricity", "2026-03").name, "Bohemia");
  assert.equal(supplierAt(s, "gas", "2026-03").product, "Plyn Fix");
  assert.deepEqual(suppliersOf(s, "electricity").map((x) => x.id), ["a", "b"]);
  assert.deepEqual(suppliersOf(s, "water"), []);
  assert.ok(setSupplier(emptyState(), { name: "PVK", commodity: "water", from: "2020-01" }));
});

test("invalid suppliers are refused", () => {
  assert.throws(() => setSupplier(emptyState(), { name: "", commodity: "gas", from: "2024-01" }));
  assert.throws(() => setSupplier(emptyState(), { name: "X", commodity: "heat", from: "2024-01" }));
  assert.throws(() => setSupplier(emptyState(), { name: "X", commodity: "gas", from: "2024" }));
});

test("suppliers merge, delete and round-trip", () => {
  const here = setSupplier(base(), { ...base().suppliers.b, name: "Bohemia Energy" }, 50);
  const there = deleteSupplier(base(), "g", 60);
  const merged = mergeStates(here, there);
  assert.equal(merged.suppliers.b.name, "Bohemia Energy");
  assert.equal(merged.suppliers.g.deleted, true);
  assert.equal(supplierAt(merged, "gas", "2026-03"), null);
  assert.equal(stateText(normalizeState(JSON.parse(stateText(merged)))), stateText(merged));
  assert.deepEqual(normalizeState({ version: 1, readings: {} }).suppliers, {});
});

test("a draft record for both commodities is split into one each", () => {
  const draft = { version: 2, suppliers: { x: { id: "x", commodities: ["electricity", "gas"], name: "ČEZ", from: "2024-10", points: { electricity: "859", gas: "27ZG" }, updatedAt: 5 } } };
  const s = normalizeState(draft);
  assert.deepEqual(Object.keys(s.suppliers).sort(), ["x", "x-gas"]);
  assert.equal(s.suppliers.x.commodity, "electricity");
  assert.equal(s.suppliers.x.point, "859");
  assert.equal(s.suppliers["x-gas"].point, "27ZG");
});

test("days until a contract ends", () => {
  const today = new Date(2026, 10, 9);
  assert.equal(daysUntil("2026-11-19", today), 10);
  assert.equal(daysUntil("2026-11-01", today), -8);
  assert.equal(daysUntil("", today), null);
});

test("a contract has a start day, and an end only with a fixed price", () => {
  const s = setSupplier(emptyState(), { id: "x", commodity: "gas", name: "ČEZ", start: "2024-10-15", contractEnd: "2026-12-31" }, 1);
  assert.equal(s.suppliers.x.from, "2024-10");
  assert.equal(s.suppliers.x.start, "2024-10-15");
  assert.equal(s.suppliers.x.contractEnd, "2026-12-31");
  // An end before the start is dropped; water never has one; an old record with only the month starts on the 1st.
  assert.equal(setSupplier(emptyState(), { id: "y", commodity: "gas", name: "A", start: "2026-01-01", contractEnd: "2025-01-01" }).suppliers.y.contractEnd, "");
  assert.equal(setSupplier(emptyState(), { id: "w", commodity: "water", name: "PVK", start: "2020-01-01", contractEnd: "2030-01-01" }).suppliers.w.contractEnd, "");
  assert.equal(normalizeState({ version: 2, suppliers: { o: { id: "o", commodity: "gas", name: "Old", from: "2023-05" } } }).suppliers.o.start, "2023-05-01");
});

test("the reminder starts the chosen months before the fixed price ends", async () => {
  const { reminderDue } = await import("../src/data.js");
  const s = { contractEnd: "2026-12-31", remindMonths: 3 };
  // 31 December minus 3 months: 30 September (September has no 31st) is the day it starts.
  assert.equal(reminderDue(s, new Date(2026, 8, 29, 23)), false);
  assert.equal(reminderDue(s, new Date(2026, 8, 30)), true);
  assert.equal(reminderDue({ contractEnd: "2026-12-31", remindMonths: 3 }, new Date(2026, 9, 1)), true);
  assert.equal(reminderDue({ contractEnd: "2026-12-31", remindMonths: 6 }, new Date(2026, 6, 1)), true);
  assert.equal(reminderDue({ contractEnd: "2026-12-31", remindMonths: 6 }, new Date(2026, 5, 29)), false);
  assert.equal(reminderDue({ contractEnd: "" }, new Date()), false);
  assert.equal(setSupplier(emptyState(), { id: "x", commodity: "gas", name: "A", start: "2024-01-01", remindMonths: 5 }).suppliers.x.remindMonths, 2);
});
