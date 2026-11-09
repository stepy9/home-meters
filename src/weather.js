// Gas use against the weather: heating degree days per month from daily mean temperatures (Open-Meteo, free and
// without a key), so a mild winter does not look like saving. Degree days (denostupně) the Czech way: over days
// with a mean below 13 °C, the sum of 19 °C minus the day's mean.
import { monthAdd } from "./data.js";

export const INDOOR = 19;
export const HEATING_LIMIT = 13;
// Months with fewer degree days hardly heat; gas then goes to water and cooking, and per degree day means nothing.
export const MIN_DEGREE_DAYS = 60;

// month -> degree days, from daily means [{ date: "YYYY-MM-DD", mean }].
export function degreeDays(days) {
  const out = new Map();
  for (const { date, mean } of days) {
    if (mean == null) continue;
    const month = date.slice(0, 7);
    out.set(month, (out.get(month) ?? 0) + (mean < HEATING_LIMIT ? INDOOR - mean : 0));
  }
  return out;
}

// Gas per 100 degree days, per month: { total, parts, estimated } like consumption; heating months only.
export function perDegreeDays(consumption, dd) {
  const out = new Map();
  for (const [month, row] of consumption) {
    const d = dd.get(month);
    if (!d || d < MIN_DEGREE_DAYS) continue;
    const k = 100 / d;
    out.set(month, { total: row.total * k, parts: Object.fromEntries(Object.entries(row.parts).map(([m, v]) => [m, v * k])), estimated: row.estimated, degreeDays: d });
  }
  return out;
}

export async function searchPlaces(name, lang = "cs") {
  const url = `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name, count: "6", language: lang, format: "json" })}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo ${response.status}`);
  const data = await response.json();
  return (data.results ?? []).map((r) => ({ name: [r.name, r.admin1, r.country].filter(Boolean).join(", "), lat: Math.round(r.latitude * 1000) / 1000, lon: Math.round(r.longitude * 1000) / 1000 }));
}

// Degree days for whole months in a range, cached per place on this device: past complete months do not
// change, so only months not yet cached (and the latest, which may have been partial) are fetched.
const cacheKey = (lat, lon) => `home-meters-dd-${lat},${lon}`;
const readCache = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? {};
  } catch {
    return {};
  }
};

export async function monthlyDegreeDays({ lat, lon }, from, to, today = new Date()) {
  const key = cacheKey(lat, lon);
  const cache = readCache(key);
  // The archive lags a few days behind: months ending within the last week are left for later.
  const lastDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
  const lastComplete = monthAdd(`${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}`, lastDay.getDate() === new Date(lastDay.getFullYear(), lastDay.getMonth() + 1, 0).getDate() ? 0 : -1);
  const end = to < lastComplete ? to : lastComplete;
  const wanted = [];
  for (let m = from; m <= end; m = monthAdd(m, 1)) wanted.push(m);
  const missing = wanted.filter((m) => cache[m] == null);
  if (missing.length) {
    const lastOfMonth = (m) => `${m}-${String(new Date(Number(m.slice(0, 4)), Number(m.slice(5)), 0).getDate()).padStart(2, "0")}`;
    const params = new URLSearchParams({ latitude: lat, longitude: lon, start_date: `${missing[0]}-01`, end_date: lastOfMonth(missing.at(-1)), daily: "temperature_2m_mean", timezone: "Europe/Prague" });
    const response = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`);
    if (!response.ok) throw new Error(`Open-Meteo ${response.status}`);
    const data = await response.json();
    const days = data.daily.time.map((date, i) => ({ date, mean: data.daily.temperature_2m_mean[i] }));
    for (const [m, d] of degreeDays(days)) if (missing.includes(m)) cache[m] = Math.round(d * 10) / 10;
    try {
      localStorage.setItem(key, JSON.stringify(cache));
    } catch {}
  }
  return new Map(wanted.filter((m) => cache[m] != null).map((m) => [m, cache[m]]));
}
