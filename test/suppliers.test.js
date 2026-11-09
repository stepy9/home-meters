import test from "node:test";
import assert from "node:assert/strict";
import { daysUntil, deleteSupplier, emptyState, mergeStates, normalizeState, setSupplier, stateText, supplierAt, suppliersOf } from "../src/data.js";

const base = () =>
  [
    { id: "a", commodities: ["electricity", "gas"], name: "ČEZ", from: "2024-01", product: "Fix 24", contractEnd: "2025-12-31", points: { electricity: "859182400", gas: "27ZG", water: "x" } },
    { id: "b", commodities: ["electricity"], name: "Bohemia", from: "2026-01" },
  ].reduce((s, f, i) => setSupplier(s, f, i + 1), emptyState());

test("a supplier covers its commodities from its month until the next one", () => {
  const s = base();
  assert.equal(supplierAt(s, "electricity", "2023-12"), null);
  assert.equal(supplierAt(s, "electricity", "2025-06").name, "ČEZ");
  assert.equal(supplierAt(s, "electricity", "2026-03").name, "Bohemia");
  assert.equal(supplierAt(s, "gas", "2026-03").name, "ČEZ");
  assert.deepEqual(suppliersOf(s, "electricity").map((x) => x.id), ["a", "b"]);
  assert.deepEqual(suppliersOf(s, "water"), []);
  assert.deepEqual(s.suppliers.a.points, { electricity: "859182400", gas: "27ZG" });
});

test("invalid suppliers are refused", () => {
  assert.throws(() => setSupplier(emptyState(), { name: "", commodities: ["gas"], from: "2024-01" }));
  assert.throws(() => setSupplier(emptyState(), { name: "X", commodities: ["water"], from: "2024-01" }));
  assert.throws(() => setSupplier(emptyState(), { name: "X", commodities: ["gas"], from: "2024" }));
});

test("suppliers merge, delete and round-trip", () => {
  const here = setSupplier(base(), { ...base().suppliers.b, name: "Bohemia Energy" }, 50);
  const there = deleteSupplier(base(), "a", 60);
  const merged = mergeStates(here, there);
  assert.equal(merged.suppliers.b.name, "Bohemia Energy");
  assert.equal(merged.suppliers.a.deleted, true);
  assert.equal(supplierAt(merged, "gas", "2026-03"), null);
  assert.equal(stateText(normalizeState(JSON.parse(stateText(merged)))), stateText(merged));
  assert.deepEqual(normalizeState({ version: 1, readings: {} }).suppliers, {});
});

test("days until a contract ends", () => {
  const today = new Date(2026, 10, 9);
  assert.equal(daysUntil("2026-11-19", today), 10);
  assert.equal(daysUntil("2026-11-01", today), -8);
  assert.equal(daysUntil("", today), null);
});
