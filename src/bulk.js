// Bulk entry: a table pasted from Excel, Google Sheets or a CSV file turned into readings. Columns are guessed
// from a header row when there is one (and can be changed in the UI); months and numbers are read in the forms
// people write them in Czech and English.
import { METERS, monthAdd, readingAt } from "./data.js";

const monthNames = [
  ["led", "jan"],
  ["úno", "uno", "feb"],
  ["bře", "bre", "mar"],
  ["dub", "apr"],
  ["kvě", "kve", "may", "máj", "maj"],
  ["čvn", "cvn", "červen", "cerven", "jun"],
  ["čvc", "cvc", "červenec", "cervenec", "jul"],
  ["srp", "aug"],
  ["zář", "zar", "sep"],
  ["říj", "rij", "oct", "okt"],
  ["lis", "nov"],
  ["pro", "dec"],
];

const pad = (m) => String(m).padStart(2, "0");
const validYear = (y) => y >= 1990 && y <= 2100;

// "2024-01", "1/2024", "01.2024", "leden 2024", "Jan 2024", or a full date ("31.1.2024", "2024-01-31", "1/31/2024"
// is not supported; day first only). A full date in the first days of a month counts for the month before when
// earlyToPrevious is on, as a reading taken on the 2nd is the state at the end of the month before.
export function parseMonth(text, { earlyToPrevious = true } = {}) {
  const s = String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  let m;
  const withDay = (y, mo, d) => {
    if (!validYear(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const month = `${y}-${pad(mo)}`;
    return earlyToPrevious && d <= 10 ? monthAdd(month, -1) : month;
  };
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return withDay(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})\. ?(\d{1,2})\. ?(\d{4})$/))) return withDay(+m[3], +m[2], +m[1]);
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})$/)) && validYear(+m[1]) && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad(m[2])}`;
  if ((m = s.match(/^(\d{1,2})[/.\- ] ?(\d{4})$/)) && validYear(+m[2]) && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad(m[1])}`;
  if ((m = s.match(/^([a-zá-ž]+)\.? ?(\d{4})$/)) && validYear(+m[2])) {
    // The longest name that starts the word: "červenec" before "červen".
    const word = m[1];
    let best = -1;
    let bestLen = 0;
    monthNames.forEach((names, i) =>
      names.forEach((name) => {
        if (word.startsWith(name) && name.length > bestLen) [best, bestLen] = [i, name.length];
      }),
    );
    if (best >= 0) return `${m[2]}-${pad(best + 1)}`;
  }
  return null;
}

// "12 345,6", "12345.6", "12,345.6", "1.234,5": the last of "," and "." is the decimal mark when both appear.
export function parseValue(text) {
  let s = String(text ?? "").trim().replace(/[\s ]/g, "").replace(/(kwh|m3|m³)$/i, "");
  if (!s) return null;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (comma >= 0) s = s.replace(",", ".");
  const value = Number(s);
  return Number.isFinite(value) ? value : NaN;
}

// Rows of cells: tab-separated (what Excel and Sheets copy), else semicolons (a Czech CSV), else commas.
export function splitTable(text) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n").filter((line) => line.trim());
  if (!lines.length) return [];
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : lines.some((l) => l.includes(";")) ? ";" : ",";
  return lines.map((line) => line.split(sep).map((cell) => cell.trim().replace(/^"(.*)"$/, "$1")));
}

const headerGuess = [
  [/měs|mes|month|datum|date|obdob/i, "month"],
  [/\bnt\b|nízk|nizk|\blt\b|low/i, "el-nt"],
  [/\bvt\b|vysok|\bht\b|high|elekt|electr|kwh/i, "el-vt"],
  [/plyn|gas/i, "gas"],
  [/vod|water/i, "water"],
];

// What each column holds: "month", a meter id, or "" (ignored); and whether the first row is a header.
export function guessColumns(rows, activeMeters) {
  const first = rows[0] ?? [];
  const isHeader = first.length > 0 && parseMonth(first[0]) == null && first.some((c) => /[a-zá-ž]/i.test(c) && Number.isNaN(parseValue(c)));
  if (isHeader) {
    const used = new Set();
    const columns = first.map((cell) => {
      const hit = headerGuess.find(([re, id]) => re.test(cell) && !used.has(id));
      if (!hit) return "";
      used.add(hit[1]);
      return hit[1];
    });
    if (columns.includes("month")) return { columns, header: true };
  }
  // No header: the month first, then the active meters in their usual order.
  const width = Math.max(...rows.map((r) => r.length));
  const order = ["month", ...activeMeters];
  return { columns: Array.from({ length: width }, (_, i) => order[i] ?? ""), header: isHeader };
}

// The readings a pasted table makes, checked against what is saved already.
// Each cell: { meter, month, value, status: "new" | "change" | "same" | "error", previous? }.
export function buildPreview(state, rows, { columns, header }, options = {}) {
  const monthCol = columns.indexOf("month");
  const meterCols = columns.map((id, i) => [id, i]).filter(([id]) => METERS.some((m) => m.id === id));
  const body = header ? rows.slice(1) : rows;
  const lines = [];
  const seen = new Map();
  for (const [index, row] of body.entries()) {
    const rawMonth = monthCol >= 0 ? row[monthCol] : "";
    const month = parseMonth(rawMonth, options);
    const cells = meterCols.map(([meter, i]) => {
      const value = parseValue(row[i]);
      if (value == null) return { meter, status: "empty" };
      if (Number.isNaN(value) || !month) return { meter, raw: row[i], status: "error" };
      const saved = readingAt(state, meter, month);
      const status = !saved ? "new" : saved.value === value ? "same" : "change";
      return { meter, month, value, status, previous: saved?.value };
    });
    const line = { index, rawMonth, month, cells, monthError: !month && cells.some((c) => c.status !== "empty"), duplicate: false };
    if (month && seen.has(month)) seen.get(month).duplicate = true;
    if (month) seen.set(month, line);
    lines.push(line);
  }
  // A month pasted twice: the later row wins, the earlier one is shown as skipped.
  const kept = lines.filter((l) => !l.duplicate);
  const readings = kept.flatMap((l) => l.cells.filter((c) => c.status === "new" || c.status === "change"));
  // A reading lower than the one before it (in the merged series) is most likely a typo or a meter swap.
  const decreasing = new Set();
  for (const [meter] of meterCols) {
    const series = new Map();
    for (const r of Object.values(state.readings)) if (r.meter === meter && !r.deleted) series.set(r.month, r.value);
    for (const l of kept) for (const c of l.cells) if (c.meter === meter && c.month) series.set(c.month, c.value);
    const sorted = [...series.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    for (let i = 1; i < sorted.length; i++) if (sorted[i][1] < sorted[i - 1][1]) decreasing.add(`${meter}|${sorted[i][0]}`);
  }
  return {
    lines,
    readings,
    meters: meterCols.map(([id]) => id),
    decreasing,
    // A row whose month cannot be read counts once, not once per cell.
    errors: lines.reduce((n, l) => n + (l.monthError ? 1 : l.cells.filter((c) => c.status === "error").length), 0),
  };
}
