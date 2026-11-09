// The data: one reading (the meter's state at the end of a month) per meter and month. Consumption is the
// difference between two readings; months skipped in between share it evenly. Every record carries the time
// it was last changed, so two copies (this browser and Dropbox) merge record by record, the newer one winning.

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
export const emptyState = () => ({ version: 1, readings: {}, config: defaultConfig() });

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
  if (raw.version > 1) throw new Error("newer-version");
  for (const [key, r] of Object.entries(raw.readings ?? {})) {
    if (!r || !meterById(r.meter) || !isMonth(r.month) || key !== readingKey(r.meter, r.month)) continue;
    const updatedAt = isNumber(r.updatedAt) ? r.updatedAt : 0;
    if (r.deleted) state.readings[key] = { meter: r.meter, month: r.month, deleted: true, updatedAt };
    else if (isNumber(r.value)) state.readings[key] = setReading(emptyState(), r, updatedAt).readings[key];
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
  const config = b.config.updatedAt > a.config.updatedAt ? b.config : a.config;
  return { version: 1, readings, config };
}

// The same state always gives the same text, so comparing texts tells whether anything changed.
export function stateText(state) {
  const readings = Object.fromEntries(Object.keys(state.readings).sort().map((key) => [key, state.readings[key]]));
  return JSON.stringify({ version: 1, readings, config: state.config }, null, 1);
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
  return { meters, config: state.config.updatedAt > 0 };
}

// Keys of records that differ between two states (what one has to take from the other), and whether the config does.
export function changedKeys(from, to) {
  const keys = Object.keys(to.readings).filter((k) => JSON.stringify(from?.readings[k]) !== JSON.stringify(to.readings[k]));
  const config = JSON.stringify(from?.config) !== JSON.stringify(to.config);
  return { readings: keys.length, config };
}
