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
});

test("invalid suppliers are refused", () => {
  assert.throws(() => setSupplier(emptyState(), { name: "", commodity: "gas", from: "2024-01" }));
  assert.throws(() => setSupplier(emptyState(), { name: "X", commodity: "water", from: "2024-01" }));
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
