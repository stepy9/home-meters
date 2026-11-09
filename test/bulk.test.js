import test from "node:test";
import assert from "node:assert/strict";
import { buildPreview, guessColumns, parseMonth, parseValue, splitTable } from "../src/bulk.js";
import { emptyState, setReading } from "../src/data.js";

test("months in the usual forms", () => {
  for (const [text, month] of [
    ["2024-01", "2024-01"],
    ["2024/3", "2024-03"],
    ["1/2024", "2024-01"],
    ["01.2024", "2024-01"],
    ["leden 2024", "2024-01"],
    ["Červen 2024", "2024-06"],
    ["červenec 2024", "2024-07"],
    ["Jul 2024", "2024-07"],
    ["říj. 2025", "2025-10"],
    ["31.1.2024", "2024-01"],
    ["2024-01-31", "2024-01"],
  ])
    assert.equal(parseMonth(text), month, text);
  assert.equal(parseMonth("2.2.2024"), "2024-01");
  assert.equal(parseMonth("2.2.2024", { earlyToPrevious: false }), "2024-02");
  assert.equal(parseMonth("hello"), null);
  assert.equal(parseMonth("13/2024"), null);
});

test("numbers with Czech and English separators", () => {
  assert.equal(parseValue("12 345,6"), 12345.6);
  assert.equal(parseValue("12345.6"), 12345.6);
  assert.equal(parseValue("12,345.6"), 12345.6);
  assert.equal(parseValue("1.234,5"), 1234.5);
  assert.equal(parseValue("120 m3"), 120);
  assert.equal(parseValue(""), null);
  assert.ok(Number.isNaN(parseValue("abc")));
});

test("Excel paste with a header is mapped by column names", () => {
  const rows = splitTable("Měsíc\tPlyn m3\tVoda\tElektřina VT\n1/2024\t1 000,5\t200\t5000\n2/2024\t1100\t207\t5200\n");
  const cols = guessColumns(rows, ["el-vt", "gas", "water"]);
  assert.deepEqual(cols, { columns: ["month", "gas", "water", "el-vt"], header: true });
  const preview = buildPreview(emptyState(), rows, cols);
  assert.equal(preview.readings.length, 6);
  assert.equal(preview.errors, 0);
  assert.deepEqual(preview.readings[0], { meter: "gas", month: "2024-01", value: 1000.5, status: "new", previous: undefined });
});

test("no header: month then active meters; semicolon CSV", () => {
  const rows = splitTable("2024-01;5000;1000;200\n2024-02;5200;1100;207");
  const cols = guessColumns(rows, ["el-vt", "gas", "water"]);
  assert.deepEqual(cols, { columns: ["month", "el-vt", "gas", "water"], header: false });
});

test("preview tells new, changed, same, errors, duplicates and drops", () => {
  let state = setReading(emptyState(), { meter: "gas", month: "2024-01", value: 1000 }, 1);
  state = setReading(state, { meter: "gas", month: "2024-02", value: 1100 }, 1);
  const rows = splitTable("2024-01\t1000\n2024-02\t1150\n2024-03\t900\nxx\t5\n2024-04\tabc\n2024-05\t1300\n2024-05\t1310");
  const p = buildPreview(state, rows, { columns: ["month", "gas"], header: false });
  const status = p.lines.map((l) => (l.duplicate ? "dup" : l.monthError ? "month" : l.cells[0].status));
  assert.deepEqual(status, ["same", "change", "new", "month", "error", "dup", "new"]);
  assert.equal(p.errors, 2);
  assert.deepEqual(p.readings.map((r) => r.month), ["2024-02", "2024-03", "2024-05"]);
  assert.equal(p.readings.at(-1).value, 1310);
  assert.ok(p.decreasing.has("gas|2024-03"));
});
