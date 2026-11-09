// The data: one reading (the meter's state at the end of a month) per meter and month. Consumption is the
// difference between two readings; months skipped in between share it evenly. Every record carries the time
// it was last changed, so two copies (this browser and Dropbox) merge record by record, the newer one winning.
// Suppliers (electricity and gas) are records of their own, each valid from a month until the next one starts,
// and each supplier has price periods of its own (prices change during a contract too).

// Version 2 added suppliers and their prices. An app that only knows version 1 refuses version 2 data instead
// of syncing it and dropping them.
export const DATA_VERSION = 2;
// Every commodity has a supplier; water usually keeps the same one, electricity and gas can switch.
export const SUPPLIED = ["electricity", "gas", "water"];

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
  // The month (1–12) each commodity's billing period ends with; 12 is the calendar year.
  billingEnd: { electricity: 12, gas: 12, water: 12 },
  location: null,
  updatedAt: 0,
});
export const emptyState = () => ({ version: DATA_VERSION, readings: {}, suppliers: {}, prices: {}, offers: {}, config: defaultConfig() });

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
    else
      for (const part of splitDraftSupplier(r)) {
        const supplier = cleanSupplier(part, updatedAt);
        if (supplier) state.suppliers[supplier.id] = supplier;
      }
  }
  for (const [id, r] of Object.entries(raw.prices ?? {})) {
    if (!r || r.id !== id) continue;
    const updatedAt = isNumber(r.updatedAt) ? r.updatedAt : 0;
    if (r.deleted) state.prices[id] = { id, deleted: true, updatedAt };
    else {
      const price = cleanPrice(r, updatedAt);
      if (price) state.prices[id] = price;
    }
  }
  for (const [id, r] of Object.entries(raw.offers ?? {})) {
    if (!r || r.id !== id) continue;
    const updatedAt = isNumber(r.updatedAt) ? r.updatedAt : 0;
    if (r.deleted) state.offers[id] = { id, deleted: true, updatedAt };
    else {
      const offer = cleanOffer(r, updatedAt);
      if (offer) state.offers[id] = offer;
    }
  }
  const c = raw.config ?? {};
  for (const meter of METERS) if (typeof c.active?.[meter.id] === "boolean") state.config.active[meter.id] = c.active[meter.id];
  if (isNumber(c.gasKwhFactor) && c.gasKwhFactor > 0) state.config.gasKwhFactor = c.gasKwhFactor;
  // The place whose weather gas is compared against: a name and coordinates.
  if (c.location && isNumber(c.location.lat) && isNumber(c.location.lon)) state.config.location = { name: text(c.location.name, 120), lat: c.location.lat, lon: c.location.lon };
  for (const k of SUPPLIED) if (Number.isInteger(c.billingEnd?.[k]) && c.billingEnd[k] >= 1 && c.billingEnd[k] <= 12) state.config.billingEnd[k] = c.billingEnd[k];
  if (isNumber(c.updatedAt)) state.config.updatedAt = c.updatedAt;
  return state;
}

export function mergeStates(a, b) {
  if (!b) return a;
  if (!a) return b;
  // Each collection record by record, the newer change winning (a deletion is a change too).
  const merge = (x = {}, y = {}) => {
    const out = { ...x };
    for (const [key, r] of Object.entries(y)) if (!out[key] || r.updatedAt > out[key].updatedAt) out[key] = r;
    return out;
  };
  const config = b.config.updatedAt > a.config.updatedAt ? b.config : a.config;
  return {
    version: DATA_VERSION,
    readings: merge(a.readings, b.readings),
    suppliers: merge(a.suppliers, b.suppliers),
    prices: merge(a.prices, b.prices),
    offers: merge(a.offers, b.offers),
    config,
  };
}

// The same state always gives the same text, so comparing texts tells whether anything changed.
export function stateText(state) {
  const readings = Object.fromEntries(Object.keys(state.readings).sort().map((key) => [key, state.readings[key]]));
  const sorted = (o = {}) => Object.fromEntries(Object.keys(o).sort().map((id) => [id, o[id]]));
  return JSON.stringify({ version: DATA_VERSION, readings, suppliers: sorted(state.suppliers), prices: sorted(state.prices), offers: sorted(state.offers), config: state.config }, null, 1);
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
  const config = { ...state.config, ...changes, active: { ...state.config.active, ...changes.active } };
  config.billingEnd = { ...state.config.billingEnd, ...changes.billingEnd };
  return { ...state, config: { ...config, updatedAt: now } };
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

// Twelve months as four quarters: totals and parts summed over the months known; a quarter with fewer than
// three months known is partial (months: how many), one with an estimated month is estimated.
export function toQuarters(months) {
  return [0, 1, 2, 3].map((q) => {
    const known = months.slice(q * 3, q * 3 + 3).filter(Boolean);
    if (!known.length) return null;
    const parts = {};
    for (const m of known) for (const [k, v] of Object.entries(m.parts ?? {})) parts[k] = (parts[k] ?? 0) + v;
    return {
      total: known.reduce((sum, m) => sum + m.total, 0),
      parts,
      estimated: known.some((m) => m.estimated),
      months: known.length,
    };
  });
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
  const live = (o = {}) => Object.values(o).filter((x) => !x.deleted).length;
  return { meters, suppliers: live(state.suppliers), prices: live(state.prices), config: state.config.updatedAt > 0 };
}

// Keys of records that differ between two states (what one has to take from the other), and whether the config does.
export function changedKeys(from, to) {
  const keys = Object.keys(to.readings).filter((k) => JSON.stringify(from?.readings[k]) !== JSON.stringify(to.readings[k]));
  const differ = (name) => Object.keys(to[name] ?? {}).filter((k) => JSON.stringify(from?.[name]?.[k]) !== JSON.stringify(to[name][k]));
  const suppliers = [...differ("suppliers"), ...differ("prices"), ...differ("offers")];
  const config = JSON.stringify(from?.config) !== JSON.stringify(to.config);
  return { readings: keys.length + suppliers.length, config };
}

const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const text = (value, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// A supplier record (one commodity, as product, fixed price and supply point differ between electricity and
// gas) with its fields in a fixed order, or null when it lacks a name, a commodity or a start.
// start: the contract's first day; from: its month, which the supplier covers from. contractEnd: the last day of
// a fixed-price contract (empty without a fixed price; never for water).
export function cleanSupplier(r, updatedAt) {
  const name = text(r.name, 80);
  // Records from before the start date kept only the month: the contract started on its first day.
  const start = isDate(r.start) ? r.start : isMonth(r.from) ? `${r.from}-01` : null;
  if (!r.id || !name || !SUPPLIED.includes(r.commodity) || !start) return null;
  const end = r.commodity !== "water" && isDate(r.contractEnd) && r.contractEnd >= start ? r.contractEnd : "";
  return {
    id: String(r.id),
    commodity: r.commodity,
    name,
    start,
    from: start.slice(0, 7),
    product: text(r.product, 80),
    contractEnd: end,
    // How many months before the fixed price ends to remind.
    remindMonths: REMIND_MONTHS.includes(r.remindMonths) ? r.remindMonths : DEFAULT_REMIND_MONTHS,
    point: text(r.point, 40),
    customerNo: text(r.customerNo, 40),
    note: text(r.note, 500),
    updatedAt,
  };
}

// An early draft kept one record for both commodities ({commodities: [...], points: {...}}): split into one each.
function splitDraftSupplier(r) {
  if (r.commodity || !Array.isArray(r.commodities)) return [r];
  return SUPPLIED.filter((c) => r.commodities.includes(c)).map((c, i) => ({ ...r, id: i === 0 ? r.id : `${r.id}-${c}`, commodity: c, point: r.points?.[c] }));
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
    .filter((s) => !s.deleted && s.commodity === commodity)
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
export const REMIND_MONTHS = [1, 2, 3, 6];
export const DEFAULT_REMIND_MONTHS = 2;

// Whether a fixed price's reminder is due: from the chosen number of months before its end (the same day of
// the month, or the month's last day when shorter).
export function reminderDue(supplier, today = new Date()) {
  if (!isDate(supplier.contractEnd)) return false;
  const [y, m, d] = supplier.contractEnd.split("-").map(Number);
  const months = supplier.remindMonths ?? DEFAULT_REMIND_MONTHS;
  const lastDay = new Date(y, m - 1 - months + 1, 0).getDate();
  const remindOn = new Date(y, m - 1 - months, Math.min(d, lastDay));
  return new Date(today.getFullYear(), today.getMonth(), today.getDate()) >= remindOn;
}

// Distribution rates (electricity): one-tariff D01d/D02d, the rest have a low tariff (NT) for some hours a day.
export const TARIFFS = [
  { id: "D01d", twoTariff: false },
  { id: "D02d", twoTariff: false },
  { id: "D25d", twoTariff: true },
  { id: "D26d", twoTariff: true },
  { id: "D27d", twoTariff: true },
  { id: "D35d", twoTariff: true },
  { id: "D45d", twoTariff: true },
  { id: "D56d", twoTariff: true },
  { id: "D57d", twoTariff: true },
  { id: "D61d", twoTariff: true },
];
// Main circuit breaker sizes (electricity): the fixed monthly fee depends on it; kept with the rate for reference.
export const BREAKERS = ["1×10 A", "1×16 A", "1×20 A", "1×25 A", "3×10 A", "3×16 A", "3×20 A", "3×25 A", "3×32 A", "3×40 A", "3×50 A", "3×63 A"];
export const isTwoTariff = (id) => TARIFFS.find((x) => x.id === id)?.twoTariff ?? false;

// Months in each advance period.
export const ADVANCE_PERIODS = { month: 1, quarter: 3, year: 12 };
// The advance as paid per month.
export const monthlyAdvance = (price) => (price?.advance == null ? null : price.advance / ADVANCE_PERIODS[price.advancePeriod ?? "month"]);

const money = (value) => (isNumber(value) && value >= 0 ? value : null);

// A price period of a supplier, valid from its month until the supplier's next one: the price with VAT per kWh
// (electricity: high tariff, and low tariff with a two-tariff rate; gas per kWh too) or per m³ for water (water
// and sewage charge), the fixed monthly fees, and the monthly advance paid. Prices may be missing (null) when only part is known.
export function cleanPrice(r, updatedAt) {
  if (!r.id || !r.supplierId || !isMonth(r.from)) return null;
  const tariff = TARIFFS.some((x) => x.id === r.tariff) ? r.tariff : "";
  return {
    id: String(r.id),
    supplierId: String(r.supplierId),
    from: r.from,
    tariff,
    breaker: BREAKERS.includes(r.breaker) ? r.breaker : "",
    unit: money(r.unit),
    unitNt: isTwoTariff(tariff) ? money(r.unitNt) : null,
    // Water: the sewage charge (stočné) per m³ beside the water charge (vodné) in unit.
    unitSewer: money(r.unitSewer),
    monthly: money(r.monthly),
    advance: money(r.advance),
    // How often the advance is paid (water is often billed quarterly or yearly); the amount is per that period.
    advancePeriod: ADVANCE_PERIODS[r.advancePeriod] ? r.advancePeriod : "month",
    updatedAt,
  };
}

export function setPrice(state, fields, now = Date.now()) {
  const id = fields.id || `p${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const price = cleanPrice({ ...fields, id }, now);
  if (!price) throw new Error("invalid-price");
  return { ...state, prices: { ...state.prices, [id]: price } };
}

export function deletePrice(state, id, now = Date.now()) {
  return { ...state, prices: { ...state.prices, [id]: { id, deleted: true, updatedAt: now } } };
}

// A supplier's price periods, oldest first.
export const pricesOf = (state, supplierId) =>
  Object.values(state.prices ?? {})
    .filter((p) => !p.deleted && p.supplierId === supplierId)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

// The price that applied to a commodity in a month: the supplier then, and its latest period started by then.
export function priceAt(state, commodity, month) {
  const supplier = supplierAt(state, commodity, month);
  if (!supplier) return null;
  return pricesOf(state, supplier.id).filter((p) => p.from <= month).at(-1) ?? null;
}

// An offer from another supplier, to compare against the current price list on the same consumption: a name and
// prices like a price period (without an advance).
export function cleanOffer(r, updatedAt) {
  const name = text(r.name, 80);
  if (!r.id || !name || !["electricity", "gas"].includes(r.commodity)) return null;
  const tariff = r.commodity === "electricity" && TARIFFS.some((x) => x.id === r.tariff) ? r.tariff : "";
  return {
    id: String(r.id),
    commodity: r.commodity,
    name,
    tariff,
    unit: money(r.unit),
    unitNt: isTwoTariff(tariff) ? money(r.unitNt) : null,
    monthly: money(r.monthly),
    note: text(r.note, 300),
    updatedAt,
  };
}

export function setOffer(state, fields, now = Date.now()) {
  const id = fields.id || `o${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const offer = cleanOffer({ ...fields, id }, now);
  if (!offer) throw new Error("invalid-offer");
  return { ...state, offers: { ...state.offers, [id]: offer } };
}

export function deleteOffer(state, id, now = Date.now()) {
  return { ...state, offers: { ...state.offers, [id]: { id, deleted: true, updatedAt: now } } };
}

export const offersOf = (state, commodity) =>
  Object.values(state.offers ?? {})
    .filter((o) => !o.deleted && o.commodity === commodity)
    .sort((a, b) => a.name.localeCompare(b.name));
