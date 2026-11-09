// The data: one reading (the meter's state at the end of a month) per meter and month. Consumption is the
// difference between two readings; months skipped in between share it evenly. Every record carries the time
// it was last changed, so two copies (this browser and Dropbox) merge record by record, the newer one winning.
// Suppliers (electricity and gas) are records of their own, each valid from a month until the next one starts.

// Version 2 added suppliers. An app that only knows version 1 refuses version 2 data instead of syncing it
// and dropping the suppliers.
export const DATA_VERSION = 2;
export const SUPPLIED = ["electricity", "gas"];

export const METERS = [
  { id: "el-vt", commodity: "electricity", unit: "kWh" },
  { id: "el-nt", commodity: "electricity", unit: "kWh" },
  { id: "gas", commodity: "gas", unit: "m3" },
  { id: "water", commodity: "water", unit: "m3" },
];
export const COMMODITIES = ["electricity", "gas", "water"];
export const meterById = (id) => METERS.find((meter) => meter.id === id);

export const defaultConfig = () => ({
  active: { "el-vt": true, "el-nt": false, gas: true, water: true },
  gasKwhFactor: 10.6,
  updatedAt: 0,
});
export const emptyState = () => ({ version: DATA_VERSION, readings: {}, suppliers: {}, config: defaultConfig() });

export const readingKey = (meter, month) => `${meter}|${month}`;

// Months as "YYYY-MM".
const monthIndex = (month) => {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + m - 1;
};
const monthOf = (index) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
export const monthAdd = (month, n) => monthOf(monthIndex(month) + n);
export const monthDiff = (from, to) => monthIndex(to) - monthIndex(from);
export const isMonth = (value) => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

// Anything read from storage or a file, cleaned to the shape above; what does not fit is dropped.
export function normalizeState(raw) {
  const state = emptyState();
  if (!raw || typeof raw !== "object") return state;
  if (raw.version > DATA_VERSION) throw new Error("newer-version");
  for (const [key, r] of Object.entries(raw.readings ?? {})) {
    if (!r || !meterById(r.meter) || !isMonth(r.month) || key !== readingKey(r.meter, r.month)) continue;
    const updatedAt = isNumber(r.updatedAt) ? r.updatedAt : 0;
    if (r.deleted) state.readings[key] = { meter: r.meter, month: r.month, deleted: true, updatedAt };
    else if (isNumber(r.value)) state.readings[key] = setReading(emptyState(), r, updatedAt).readings[key];
  }
  for (const [id, r] of Object.entries(raw.suppliers ?? {})) {
    if (!r || r.id !== id) continue;
    const updatedAt = isNumber(r.updatedAt) ? r.updatedAt : 0;
    if (r.deleted) state.suppliers[id] = { id, deleted: true, updatedAt };
    else {
      const supplier = cleanSupplier(r, updatedAt);
      if (supplier) state.suppliers[id] = supplier;
    }
  }
  const c = raw.config ?? {};
  for (const meter of METERS) if (typeof c.active?.[meter.id] === "boolean") state.config.active[meter.id] = c.active[meter.id];
  if (isNumber(c.gasKwhFactor) && c.gasKwhFactor > 0) state.config.gasKwhFactor = c.gasKwhFactor;
  if (isNumber(c.updatedAt)) state.config.updatedAt = c.updatedAt;
  return state;
}

export function mergeStates(a, b) {
  if (!b) return a;
  if (!a) return b;
  const readings = { ...a.readings };
  for (const [key, r] of Object.entries(b.readings)) if (!readings[key] || r.updatedAt > readings[key].updatedAt) readings[key] = r;
  const suppliers = { ...a.suppliers };
  for (const [id, r] of Object.entries(b.suppliers ?? {})) if (!suppliers[id] || r.updatedAt > suppliers[id].updatedAt) suppliers[id] = r;
  const config = b.config.updatedAt > a.config.updatedAt ? b.config : a.config;
  return { version: DATA_VERSION, readings, suppliers, config };
}

// The same state always gives the same text, so comparing texts tells whether anything changed.
export function stateText(state) {
  const readings = Object.fromEntries(Object.keys(state.readings).sort().map((key) => [key, state.readings[key]]));
  const suppliers = Object.fromEntries(Object.keys(state.suppliers ?? {}).sort().map((id) => [id, state.suppliers[id]]));
  return JSON.stringify({ version: DATA_VERSION, readings, suppliers, config: state.config }, null, 1);
}

export function setReading(state, { meter, month, value, oldFinal, newStart }, now = Date.now()) {
  const reading = { meter, month, value, updatedAt: now };
  if (isNumber(oldFinal)) Object.assign(reading, { oldFinal, newStart: isNumber(newStart) ? newStart : 0 });
  return { ...state, readings: { ...state.readings, [readingKey(meter, month)]: reading } };
}

export function deleteReading(state, meter, month, now = Date.now()) {
  return { ...state, readings: { ...state.readings, [readingKey(meter, month)]: { meter, month, deleted: true, updatedAt: now } } };
}

export function setConfig(state, changes, now = Date.now()) {
  return { ...state, config: { ...state.config, ...changes, active: { ...state.config.active, ...changes.active }, updatedAt: now } };
}

export const readingsOf = (state, meter) =>
  Object.values(state.readings)
    .filter((r) => r.meter === meter && !r.deleted)
    .sort((x, y) => (x.month < y.month ? -1 : 1));

export const readingAt = (state, meter, month) => {
  const r = state.readings[readingKey(meter, month)];
  return r && !r.deleted ? r : null;
};

// The latest reading before a month, to show beside the form and check against.
export const readingBefore = (state, meter, month) => readingsOf(state, meter).filter((r) => r.month < month).at(-1) ?? null;

// What a reading used since the one before: across a meter swap, what the old meter ran up to its final state
// plus what the new one ran from its starting state.
export const usedBetween = (prev, cur) => (isNumber(cur.oldFinal) ? cur.oldFinal - prev.value + (cur.value - cur.newStart) : cur.value - prev.value);

// month -> { value, estimated }, estimated when it is a share of a gap between readings.
export function meterConsumption(state, meter) {
  const out = new Map();
  const readings = readingsOf(state, meter);
  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1];
    const cur = readings[i];
    const gap = monthDiff(prev.month, cur.month);
    const share = usedBetween(prev, cur) / gap;
    for (let k = 1; k <= gap; k++) out.set(monthAdd(prev.month, k), { value: share, estimated: gap > 1 });
  }
  return out;
}

// Meters of a commodity that are switched on or have readings.
export const metersOf = (state, commodity) =>
  METERS.filter((m) => m.commodity === commodity && (state.config.active[m.id] || readingsOf(state, m.id).length > 0));

// month -> { total, parts: {meterId: value}, estimated } for a commodity; gas optionally in kWh.
export function commodityConsumption(state, commodity, { gasInKwh = false } = {}) {
  const factor = commodity === "gas" && gasInKwh ? state.config.gasKwhFactor : 1;
  const out = new Map();
  for (const meter of metersOf(state, commodity)) {
    for (const [month, { value, estimated }] of meterConsumption(state, meter.id)) {
      const row = out.get(month) ?? { total: 0, parts: {}, estimated: false };
      row.total += value * factor;
      row.parts[meter.id] = value * factor;
      row.estimated ||= estimated;
      out.set(month, row);
    }
  }
  return out;
}

// The years present, newest first, and per year twelve months (null where nothing is known).
export function byYear(consumption) {
  const years = [...new Set([...consumption.keys()].map((m) => Number(m.slice(0, 4))))].sort((a, b) => b - a);
  const table = new Map(
    years.map((year) => [year, Array.from({ length: 12 }, (_, i) => consumption.get(`${year}-${String(i + 1).padStart(2, "0")}`) ?? null)]),
  );
  return { years, table };
}

// The year's total and how many months it covers.
export const yearTotal = (months) => {
  const known = months.filter(Boolean);
  return { total: known.reduce((sum, m) => sum + m.total, 0), months: known.length };
};

// Change against the same month a year earlier, as a fraction, or null.
export const change = (cur, prev) => (cur && prev && prev.total > 0 ? cur.total / prev.total - 1 : null);

// What a sync left the same everywhere: per meter how many readings and the latest month; whether settings were set.
export function syncSummary(state) {
  const meters = Object.fromEntries(
    METERS.map((m) => {
      const list = readingsOf(state, m.id);
      return [m.id, { count: list.length, last: list.at(-1)?.month ?? null }];
    }),
  );
  return { meters, suppliers: Object.values(state.suppliers ?? {}).filter((x) => !x.deleted).length, config: state.config.updatedAt > 0 };
}

// Keys of records that differ between two states (what one has to take from the other), and whether the config does.
export function changedKeys(from, to) {
  const keys = Object.keys(to.readings).filter((k) => JSON.stringify(from?.readings[k]) !== JSON.stringify(to.readings[k]));
  const suppliers = Object.keys(to.suppliers ?? {}).filter((k) => JSON.stringify(from?.suppliers?.[k]) !== JSON.stringify(to.suppliers[k]));
  const config = JSON.stringify(from?.config) !== JSON.stringify(to.config);
  return { readings: keys.length + suppliers.length, config };
}

const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const text = (value, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// A supplier record with its fields in a fixed order, or null when it lacks a name, a commodity or a start.
export function cleanSupplier(r, updatedAt) {
  const commodities = SUPPLIED.filter((c) => r.commodities?.includes(c));
  const name = text(r.name, 80);
  if (!r.id || !name || !commodities.length || !isMonth(r.from)) return null;
  const points = {};
  for (const c of commodities) if (text(r.points?.[c], 40)) points[c] = text(r.points[c], 40);
  return {
    id: String(r.id),
    commodities,
    name,
    from: r.from,
    product: text(r.product, 80),
    contractEnd: isDate(r.contractEnd) ? r.contractEnd : "",
    points,
    customerNo: text(r.customerNo, 40),
    note: text(r.note, 500),
    updatedAt,
  };
}

export function setSupplier(state, fields, now = Date.now()) {
  const id = fields.id || `s${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const supplier = cleanSupplier({ ...fields, id }, now);
  if (!supplier) throw new Error("invalid-supplier");
  return { ...state, suppliers: { ...state.suppliers, [id]: supplier } };
}

export function deleteSupplier(state, id, now = Date.now()) {
  return { ...state, suppliers: { ...state.suppliers, [id]: { id, deleted: true, updatedAt: now } } };
}

// A commodity's suppliers, oldest first.
export const suppliersOf = (state, commodity) =>
  Object.values(state.suppliers ?? {})
    .filter((s) => !s.deleted && s.commodities.includes(commodity))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

// Who supplied a commodity in a month: the latest that started by then.
export const supplierAt = (state, commodity, month) => suppliersOf(state, commodity).filter((s) => s.from <= month).at(-1) ?? null;

// Whole days from today until a contract ends (negative once it has), or null without an end date.
export function daysUntil(date, today = new Date()) {
  if (!isDate(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - start) / 86400000);
}
export const CONTRACT_WARN_DAYS = 60;
