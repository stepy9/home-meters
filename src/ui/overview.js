import { BarController, BarElement, CategoryScale, Chart, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip } from "chart.js";
import { COMMODITIES, SUPPLIED, toQuarters, priceAt, supplierAt, suppliersOf, upgradesOf, upgradeKindsLabel, byYear, change, commodityConsumption, metersOf, projectYear, yearTotal } from "../data.js";
import { fmt, fmtMonth, fmtPct, t, unitLabel, cur } from "../i18n.js";
import { getState } from "../store.js";
import { cssVar, esc } from "./dom.js";
import { commodityIcon } from "./icons.js";
import { advanceBalance, billingPeriod, commodityCosts, forecastBilling } from "../costs.js";
import { currentMonth } from "./month-picker.js";
import { baseLoad, emissions, goalProgress } from "../insights.js";
import { contractHtml, contractPeriod, priceSummary } from "./suppliers.js";
import { noticesHtml } from "./notices.js";
import { bindOffers, offersHtml } from "./offers.js";
import { upgradesOverviewHtml } from "./upgrades.js";
import { drawHousehold, householdHtml } from "./household.js";
import { bindBills, billsHtml } from "./bills.js";
import { priceHistory } from "../household.js";
import { monthlyDegreeDays, perDegreeDays } from "../weather.js";
import { cardFull, cardHidden, cardOrder } from "./layout.js";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, LineController, LineElement, PointElement, Tooltip, Legend);

const viewKey = "home-meters-overview";
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(viewKey)) ?? {};
  } catch {
    return {};
  }
})();
// money: costs in Kč instead of consumption.
// quarters: charts and table by quarter instead of by month.
const ui = { commodity: saved.commodity ?? "electricity", gasInKwh: saved.gasInKwh ?? false, gasWeather: saved.gasWeather ?? false, money: saved.money ?? false, quarters: saved.quarters ?? false, year: null, compared: null, open: null };
// Years a card shows on the page: older ones only crowd the chart and the table. The maximized card (a modal) shows all.
const RECENT_YEARS = 5;
const recent = (years) => years.slice(0, RECENT_YEARS);
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const periodLabels = () => (ui.quarters ? QUARTERS : t("months"));
const remember = () => {
  try {
    localStorage.setItem(viewKey, JSON.stringify({ commodity: ui.commodity, gasInKwh: ui.gasInKwh, gasWeather: ui.gasWeather, money: ui.money, quarters: ui.quarters }));
  } catch {}
};

const charts = [];
const destroyCharts = () => charts.splice(0).forEach((c) => c.destroy());
// The view is rebuilt on every switch; charts the switch did not touch are redrawn without the animation, so they stay put.
let still = new Set();
const motion = (chart) => (still.has(chart) ? { animation: false } : {});
const rerender = (view, ...untouched) => {
  still = new Set(untouched);
  renderOverview(view);
  still = new Set();
};

const commodityColor = { electricity: "--electricity", gas: "--gas", water: "--water" };
// Years by how recent they are: blue, orange, green, magenta, gold, teal, so the newest few always contrast most.
const yearColor = (years, year) => {
  const i = years.indexOf(year);
  // Six distinct colors; any older year is muted rather than repeating a newer year's color.
  return cssVar(i < 6 ? `--year-${i}` : "--muted");
};

const weatherOn = () => ui.commodity === "gas" && ui.gasWeather && !ui.money;
const unitOf = () =>
  ui.money ? cur() : ui.commodity === "electricity" ? "kWh" : ui.commodity === "gas" && ui.gasInKwh ? (weatherOn() ? t("perDD", { unit: "kWh" }) : "kWh") : weatherOn() ? t("perDD", { unit: "m³" }) : "m³";

// Degree days for the place in the settings, fetched once per place and kept while the app is open.
const weather = { key: null, data: null, loading: false, error: null };
function loadWeather(location, from, to, redraw) {
  const key = `${location.lat},${location.lon},${from},${to}`;
  if (weather.key === key && (weather.data || weather.loading || weather.error)) return;
  Object.assign(weather, { key, data: null, loading: true, error: null });
  monthlyDegreeDays(location, from, to)
    .then((data) => Object.assign(weather, { data, loading: false }))
    .catch((error) => Object.assign(weather, { error: error.message, loading: false }))
    .finally(() => weather.key === key && redraw());
}
// Kč as whole crowns; consumption to a tenth.
const fmtVal = (v) => fmt(v, ui.money ? 0 : 1);

function chartDefaults() {
  Chart.defaults.color = cssVar("--muted");
  Chart.defaults.borderColor = cssVar("--border");
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
}

const axis = () => ({
  x: { grid: { display: false } },
  y: { beginAtZero: true, ticks: { callback: (v) => fmt(v, 0) } },
});
const tooltip = { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? "–" : `${fmtVal(ctx.parsed.y)} ${unitOf()}`}` } };

// A dashed line before the month a supplier started in the shown year, with the supplier's name at the top.
const supplierMarks = (marks) => ({
  id: "supplierMarks",
  afterDatasetsDraw(chart) {
    if (!marks.length) return;
    const { ctx, chartArea, scales } = chart;
    const step = scales.x.getPixelForTick(1) - scales.x.getPixelForTick(0);
    ctx.save();
    ctx.strokeStyle = cssVar("--text");
    ctx.fillStyle = cssVar("--text");
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.font = `600 11px ${Chart.defaults.font.family}`;
    marks.forEach(({ index, color, after }, n) => {
      // A supplier from the start of its month, an upgrade at the end of the month it was done in.
      const x = scales.x.getPixelForTick(index) + (after ? step / 2 : -step / 2);
      ctx.strokeStyle = color ?? cssVar("--text");
      ctx.fillStyle = color ?? cssVar("--text");
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      // A numbered badge on top of the line; the names are listed under the chart.
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, chartArea.top - 9, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = cssVar("--surface");
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(n + 1), x, chartArea.top - 8.5);
      ctx.setLineDash([4, 4]);
    });
    ctx.restore();
  },
});

// Supplier changes and house upgrades in the shown year, in month order: { index, name, color, after, month }.
function chartMarks(state) {
  // Supplier changes in the shown year (the very first supplier is not a change).
  const marks = SUPPLIED.includes(ui.commodity)
    ? suppliersOf(state, ui.commodity)
        .slice(1)
        .filter((s) => Number(s.from.slice(0, 4)) === ui.year)
        .map((s) => ({ index: Math.floor((Number(s.from.slice(5)) - 1) / (ui.quarters ? 3 : 1)), name: s.name, month: s.from, supplier: true }))
    : [];
  // House upgrades in the shown year, in the commodity's color.
  for (const u of upgradesOf(state, ui.commodity).filter((u) => Number(u.month.slice(0, 4)) === ui.year))
    marks.push({ index: Math.floor((Number(u.month.slice(5)) - 1) / (ui.quarters ? 3 : 1)), name: u.name || upgradeKindsLabel(u, t), color: cssVar(commodityColor[ui.commodity]), after: true, month: u.month });
  return marks.sort((a, b) => a.month.localeCompare(b.month));
}

function marksLegendHtml(marks) {
  if (!marks.length) return "";
  return `<ol class="mark-legend">${marks.map((m) => `<li><span class="mark-badge" style="background:${m.color ?? cssVar("--text")}">${marks.indexOf(m) + 1}</span><span>${esc(m.name)} <span class="hint">· ${esc(m.supplier ? t("markSupplier", { month: fmtMonth(m.month) }) : fmtMonth(m.month))}</span></span></li>`).join("")}</ol>`;
}

function yearChart(canvas, state, row) {
  const meters = metersOf(state, ui.commodity);
  const split = !ui.money && meters.length > 1;
  const marks = chartMarks(state);
  const datasets = split
    ? meters.map((m, i) => ({
        label: t(`short.${m.id}`),
        data: row.map((cell) => cell?.parts[m.id] ?? null),
        backgroundColor: cssVar(i === 0 ? "--electricity" : "--electricity-2"),
        borderRadius: 4,
        stack: "s",
      }))
    : [{ label: ui.money ? t("costs") : t(ui.commodity), data: row.map((cell) => cell?.total ?? null), backgroundColor: cssVar(commodityColor[ui.commodity]), borderRadius: 4 }];
  charts.push(
    new Chart(canvas, {
      type: "bar",
      data: { labels: periodLabels(), datasets },
      options: {
        ...motion("year"),
        maintainAspectRatio: false,
        scales: { ...axis(), x: { stacked: split, grid: { display: false } }, y: { ...axis().y, stacked: split } },
        plugins: { legend: { display: split, position: "bottom" }, tooltip },
        layout: { padding: { top: marks.length ? 20 : 0 } },
      },
      plugins: [supplierMarks(marks)],
    }),
  );
}

function compareChart(canvas, years, table, list = recent(years), key = "compare") {
  const shown = list.filter((y) => ui.compared.has(y));
  charts.push(
    new Chart(canvas, {
      type: "line",
      data: {
        labels: periodLabels(),
        datasets: shown.map((year) => ({
          label: String(year),
          data: table.get(year).map((cell) => cell?.total ?? null),
          borderColor: yearColor(years, year),
          backgroundColor: yearColor(years, year),
          borderWidth: year === years[0] ? 3.5 : 2,
          // Years older than the two newest are dashed, so lines that cross stay apart.
          borderDash: years.indexOf(year) >= 2 ? [6, 4] : [],
          pointRadius: year === years[0] ? 4 : 3,
          tension: 0.25,
          spanGaps: false,
        })),
      },
      options: {
        ...motion(key),
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: axis(),
        plugins: { legend: { display: false }, tooltip },
      },
    }),
  );
}

// The unit price month by month from the price lists, stepped where it changed.
function priceChartHtml(state) {
  if (!SUPPLIED.includes(ui.commodity)) return "";
  const h = priceHistory(state, ui.commodity, currentMonth());
  if (!h || h.months.length < 2) return "";
  const known = h.unit.filter((v) => v != null);
  const first = known[0];
  const last = known.at(-1);
  const delta = first ? last / first - 1 : null;
  const unit = ui.commodity === "water" ? `${cur()}/m³` : `${cur()}/kWh`;
  return `<section class="card"><h2>${esc(t("priceChartTitle"))}</h2>
    <p class="hint">${esc(t(ui.commodity === "water" ? "priceChartWater" : ui.commodity === "gas" ? "priceChartGas" : "priceChartEl", { first: fmt(first, 2), last: fmt(last, 2), unit, from: fmtMonth(h.months[0]) }))}${delta ? ` <strong class="${delta > 0 ? "up" : "down"}">${fmtPct(delta)}</strong>` : ""}</p>
    <div class="chart-box"><canvas id="price-chart"></canvas></div></section>`;
}

function priceChart(canvas, state) {
  const h = priceHistory(state, ui.commodity, currentMonth());
  const unit = ui.commodity === "water" ? `${cur()}/m³` : `${cur()}/kWh`;
  const datasets = [{ label: ui.commodity === "electricity" ? t("short.el-vt") : t(ui.commodity), data: h.unit, borderColor: cssVar(commodityColor[ui.commodity]), backgroundColor: cssVar(commodityColor[ui.commodity]), stepped: true, pointRadius: 0, borderWidth: 2.5 }];
  if (h.unitNt) datasets.push({ label: t("short.el-nt"), data: h.unitNt, borderColor: cssVar("--electricity-2"), backgroundColor: cssVar("--electricity-2"), stepped: true, pointRadius: 0, borderWidth: 2 });
  charts.push(
    new Chart(canvas, {
      type: "line",
      data: { labels: h.months.map((m) => `${t("months")[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`), datasets },
      options: {
        ...motion("price"),
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } }, y: { beginAtZero: true, ticks: { callback: (v) => fmt(v, 2) } } },
        plugins: { legend: { display: datasets.length > 1, position: "bottom" }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? "–" : `${fmt(ctx.parsed.y, 2)} ${unit}`}` } } },
      },
    }),
  );
}

function tableHtml(years, table, cols = recent(years)) {
  const head = cols.map((y) => `<th>${y}</th>`).join("");
  const cell = (row, i, y) => {
    const cur = row[i];
    if (!cur) return "<td>–</td>";
    const prevYear = table.get(y - 1);
    const prev = prevYear?.[i];
    // Quarters compare only when both cover the same number of months (a running quarter would look far lower).
    const comparable = prev && (cur.months ?? 3) === (prev.months ?? 3);
    const delta = comparable ? change(cur, prev) : null;
    const deltaHtml = delta == null ? "" : `<small class="${delta > 0 ? "up" : "down"}">${fmtPct(delta)}</small>`;
    // A quarter not yet complete says how many of its months are in.
    const partial = cur.months != null && cur.months < 3 ? ` <small class="muted">${cur.months}/3</small>` : "";
    return `<td>${fmtVal(cur.total)}${cur.estimated ? "*" : ""}${partial}${deltaHtml}</td>`;
  };
  const rows = periodLabels()
    .map((name, i) => `<tr><td>${esc(name)}</td>${cols.map((y) => cell(table.get(y), i, y)).join("")}</tr>`)
    .join("");
  // Per degree day a sum means nothing: the average month instead.
  const totals = cols.map((y) => { const { total, months } = yearTotal(table.get(y)); return `<td>${fmt(weatherOn() ? (months ? total / months : 0) : total, weatherOn() ? 1 : 0)}</td>`; }).join("");
  const estimated = cols.some((y) => table.get(y).some((c) => c?.estimated));
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>${esc(unitOf())}</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>${esc(t(weatherOn() ? "average" : "total"))}</td>${totals}</tr></tfoot>
    </table></div>
    ${estimated ? `<p class="hint">${esc(t("estimated"))}</p>` : ""}`;
}

// The year's total, and against the previous year over the same months only, so a running year compares fairly.
// Advances paid against the costs over the same months: an estimate of the overpayment or the extra to pay.
// "9/2025 – 8/2026", or just the year for a calendar-year period.
const periodLabel = ({ from, to }) => (from.endsWith("-01") && to.endsWith("-12") ? from.slice(0, 4) : `${Number(from.slice(5))}/${from.slice(0, 4)} – ${Number(to.slice(5))}/${to.slice(0, 4)}`);

function advanceHtml(state, year) {
  // The billing period that ends in the shown year.
  const period = billingPeriod(state, ui.commodity, year);
  const b = advanceBalance(state, ui.commodity, period);
  if (!b.months || !b.paid) return "";
  const over = b.balance >= 0;
  return `<div class="stat"><div class="label">${esc(t("advancesYear", { year: periodLabel(period) }))}</div><div class="value ${over ? "down" : "up"}">${over ? "+" : "−"}${fmt(Math.abs(b.balance), 0)} ${cur()}</div><div class="sub">${esc(t(over ? "overpaid" : "underpaid"))} · ${fmt(b.paid, 0)} / ${fmt(b.cost, 0)} ${cur()}</div></div>`;
}

// The current year's total expected, its missing months taken from last year at this year's pace.
function projectionHtml(table, year) {
  if (weatherOn() || year !== Number(currentMonth().slice(0, 4))) return "";
  const p = projectYear(table.get(year), table.get(year - 1));
  if (!p) return "";
  const last = yearTotal(table.get(year - 1)).total;
  const d = last > 0 ? p.total / last - 1 : null;
  return `<div class="stat"><div class="label">${esc(t("projectedYear", { year }))}</div><div class="value">~${fmt(p.total, 0)}</div><div class="sub">${esc(unitOf())}${d == null ? "" : ` · ${fmtPct(d)} ${esc(t("vsLastYear", { year: year - 1 }))}`}</div></div>`;
}

function statsHtml(table, year, state) {
  const row = table.get(year);
  const { total, months } = yearTotal(row);
  const prev = table.get(year - 1);
  let compare = "";
  if (prev) {
    const same = row.map((cell, i) => (cell && prev[i] ? [cell.total, prev[i].total] : null)).filter(Boolean);
    const a = same.reduce((s, [x]) => s + x, 0);
    const b = same.reduce((s, [, y]) => s + y, 0);
    if (b > 0) {
      const d = a / b - 1;
      compare = `<div class="stat"><div class="label">${esc(t("vsLastYear", { year: year - 1 }))}</div><div class="value ${d > 0 ? "up" : "down"}">${fmtPct(d)}</div><div class="sub">${fmt(a, 0)} / ${fmt(b, 0)} ${esc(unitOf())}</div></div>`;
    }
  }
  return `<div class="stats">
    <div class="stat"><div class="label">${esc(t(weatherOn() ? "average" : "total"))} ${year}</div><div class="value">${fmt(weatherOn() ? (months ? total / months : 0) : total, weatherOn() ? 1 : 0)}</div><div class="sub">${esc(unitOf())} · ${esc(t("perMonth", { months }))}</div></div>
    ${compare}
    ${projectionHtml(table, year)}
    ${ui.money ? advanceHtml(state, year) : ""}
  </div>`;
}

// The billing period now running, the months to come estimated from a year earlier: expected use and cost, the
// advances, the likely result and a suggested advance when the current one is off.
function forecastHtml(state) {
  if (!SUPPLIED.includes(ui.commodity)) return "";
  const f = forecastBilling(state, ui.commodity, currentMonth());
  if (!f || !f.estimatedMonths) return "";
  const stat = (label, value, sub = "", cls = "") => `<div class="stat"><div class="label">${esc(label)}</div><div class="value ${cls}">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  // Gas as on the meter, in m³, with the kWh it is billed by below.
  const usage =
    ui.commodity === "gas"
      ? stat(t("forecastUsage"), `~${fmt(f.usage / state.config.gasKwhFactor, 0)}`, `m³ · ${fmt(f.usage, 0)} kWh`)
      : stat(t("forecastUsage"), `~${fmt(f.usage, 0)}`, ui.commodity === "water" ? "m³" : "kWh");
  const cells = [usage];
  if (f.cost != null) {
    cells.push(stat(t("forecastCost"), `~${fmt(f.cost, 0)}`, cur()));
    const over = f.balance >= 0;
    cells.push(stat(t(over ? "overpaid" : "underpaid"), `${over ? "+" : "−"}${fmt(Math.abs(f.balance), 0)} ${cur()}`, esc(t("forecastPaid", { paid: fmt(f.paid, 0) })), over ? "down" : "up"));
  }
  const a = f.advance;
  // Suggest a different advance only when it is off by more than a rounding step.
  const suggest = a.suggested != null && a.now != null && Math.abs(a.suggested - a.now) >= 100;
  return `
    <section class="card">
      <h2>${esc(t("forecastTitle", { period: periodLabel(f.period) }))}</h2>
      <p class="hint">${esc(t("forecastHint", { actual: f.actualMonths, estimated: f.estimatedMonths }))}</p>
      <div class="stats">${cells.join("")}</div>
      ${suggest ? `<p class="suggest ${a.suggested > a.now ? "up" : "down"}">${esc(t("forecastAdvance", { suggested: fmt(a.suggested, 0), now: fmt(a.now, 0), per: t(`per.${a.per}`) }))}</p>` : ""}
    </section>`;
}

// The selected year against its goal, the electricity drawn all the time and the year's emissions.
function insightsHtml(state) {
  const year = ui.year ?? Number(currentMonth().slice(0, 4));
  const stat = (label, value, sub = "", cls = "") => `<div class="stat"><div class="label">${esc(label)}</div><div class="value ${cls}">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  const kind = ui.money ? "cost" : "usage";
  const unit = ui.money ? cur() : ui.commodity === "electricity" ? "kWh" : "m³";
  const parts = [];
  const g = goalProgress(state, ui.commodity, kind, year);
  if (g) {
    const ahead = g.actual > g.expected;
    const pct = Math.min(100, (g.actual / g.goal) * 100);
    const mark = Math.min(100, (g.expected / g.goal) * 100);
    parts.push(`<div class="goal">
      <div class="goal-line"><span>${esc(t("goalLabel", { year }))}</span><strong>${fmt(g.actual, 0)} / ${fmt(g.goal, 0)} ${esc(unit)}</strong></div>
      <div class="goal-bar ${ahead ? "up" : "down"}"><span style="width:${pct}%"></span><i style="left:${mark}%" title="${esc(t("goalExpected"))}"></i></div>
      <p class="hint">${esc(t(ahead ? "goalOver" : "goalUnder", { diff: fmt(Math.abs(g.actual - g.expected), 0), unit }))}${g.projected != null && g.months < 12 ? " " + esc(t("goalProjected", { value: fmt(g.projected, 0), unit })) : ""}</p>
    </div>`);
  }
  const stats = [];
  if (ui.commodity === "electricity" && !ui.money) {
    const last = year === Number(currentMonth().slice(0, 4)) ? currentMonth() : `${year}-12`;
    const b = baseLoad(state, last);
    if (b) stats.push(stat(t("baseLoad"), `~${fmt(b.watts, 0)} W`, esc(t("baseLoadSub", { kwh: fmt(b.kwhYear, 0), month: fmtMonth(b.month) }))));
  }
  const e = ui.commodity !== "water" ? emissions(state, year) : null;
  const kg = e?.[ui.commodity];
  if (kg != null) stats.push(stat(t("co2", { year }), `${fmt(kg / 1000, 2)} t`, esc(t("co2Sub", { total: fmt(e.total / 1000, 2) }))));
  if (stats.length) parts.push(`<div class="stats">${stats.join("")}</div>`);
  if (weatherOn()) return "";
  return `<section class="card"><h2>${esc(t("insightsTitle", { year }))}</h2>${parts.join("")}${g ? "" : `<p class="hint">${esc(t("goalNone"))} <a href="#settings" data-settings-section="general">${esc(t("tabSettings"))}</a></p>`}</section>`;
}

// The current supplier, with the contract end and current prices; a hint to add one when there is none.
function supplierCardHtml(state) {
  if (!SUPPLIED.includes(ui.commodity)) return "";
  const s = supplierAt(state, ui.commodity, currentMonth());
  if (!s) return `<section class="card supplier-card"><p class="hint">${esc(t("supplierNone"))} <a href="#settings" data-settings-section="suppliers">${esc(t("tabSettings"))}</a></p></section>`;
  const point = s.point;
  const price = priceAt(state, ui.commodity, currentMonth());
  const details = [s.product, contractPeriod(s), point && ui.commodity !== "water" && `${ui.commodity === "gas" ? "EIC" : "EAN"} ${point}`].filter(Boolean).map(esc).join(" · ");
  return `
    <section class="card supplier-card">
      <div class="hint">${esc(t("supplier"))}</div>
      <strong class="supplier-name">${esc(s.name)}</strong>
      <div class="hint">${details}</div>
      ${contractHtml(s)}
      ${price ? `<div class="price-now">${esc(priceSummary(ui.commodity, price))}</div>` : ""}
    </section>`;
}

function renderHousehold(view, state) {
  const tabs = [...COMMODITIES, "home"].map((c) => `<button type="button" data-commodity="${c}" aria-pressed="${c === ui.commodity}" style="--c:${cssVar(commodityColor[c] ?? "--accent")}">${commodityIcon(c)}<span>${esc(t(c === "home" ? "householdTab" : c))}</span></button>`).join("");
  const { html, row } = householdHtml(state);
  view.innerHTML = `${noticesHtml()}<div class="segmented">${tabs}</div>${html}`;
  drawHousehold(view, charts, row, () => renderOverview(view));
  bindTabs(view);
}

function bindTabs(view) {
  view.querySelectorAll("[data-commodity]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.commodity = b.dataset.commodity;
      ui.compared = null;
      remember();
      renderOverview(view);
    }),
  );
}

export function renderOverview(view) {
  destroyCharts();
  chartDefaults();
  const state = getState();
  if (ui.commodity === "home") return renderHousehold(view, state);
  // Costs leave out months without a known price; how many is said below the chart.
  let missingPrices = 0;
  let consumption;
  if (ui.money) {
    consumption = new Map();
    for (const [month, row] of commodityCosts(state, ui.commodity)) {
      if (row) consumption.set(month, row);
      else missingPrices += 1;
    }
  } else consumption = commodityConsumption(state, ui.commodity, { gasInKwh: ui.gasInKwh });
  // Gas against the weather: per 100 degree days, heating months only, once the weather is in.
  let weatherNote = "";
  // With the weather in, the note goes into the chart card it explains.
  let weatherInCard = "";
  if (weatherOn()) {
    const location = state.config.location;
    const months = [...consumption.keys()].sort();
    if (!location) weatherNote = `<p class="info-note">${esc(t("weatherNoPlace"))} <a href="#settings" data-settings-section="house">${esc(t("tabSettings"))}</a></p>`;
    else if (months.length) {
      loadWeather(location, months[0], months.at(-1), () => renderOverview(view));
      if (weather.data) {
        consumption = perDegreeDays(consumption, weather.data);
        weatherInCard = `<p class="hint chart-note">${esc(t("weatherHint", { place: location.name }))}</p>`;
      } else {
        weatherNote = `<p class="info-note">${esc(weather.error ? t("weatherError", { error: weather.error }) : t("weatherLoading"))}</p>`;
        consumption = new Map();
      }
    }
  }
  let upgradeDd = null;
  if (ui.commodity === "gas" && state.config.location && upgradesOf(state, "gas").length) {
    const months = [...commodityConsumption(state, "gas").keys()].sort();
    if (months.length) {
      loadWeather(state.config.location, months[0], months.at(-1), () => renderOverview(view));
      upgradeDd = weather.data;
    }
  }
  const { years, table } = byYear(consumption);
  const shown = ui.quarters ? new Map(years.map((y) => [y, toQuarters(table.get(y))])) : table;
  if (!years.includes(ui.year)) ui.year = years[0] ?? null;
  if (!ui.compared || ![...ui.compared].some((y) => years.includes(y))) ui.compared = new Set(years.slice(0, 3));

  const tabs = [...COMMODITIES, "home"].map((c) => `<button type="button" data-commodity="${c}" aria-pressed="${c === ui.commodity}" style="--c:${cssVar(commodityColor[c] ?? "--accent")}">${commodityIcon(c)}<span>${esc(t(c === "home" ? "householdTab" : c))}</span></button>`).join("");
  const moneyToggle = `<div class="segmented">${[false, true].map((m) => `<button type="button" data-money="${m}" aria-pressed="${m === ui.money}">${esc(t(m ? "viewCosts" : "viewUsage"))}</button>`).join("")}</div>`;
  const gasToggle =
    ui.commodity === "gas" && !ui.money
      ? `<div class="segmented">${["m3", "kWh"].map((u) => `<button type="button" data-gas-unit="${u}" aria-pressed="${(u === "kWh") === ui.gasInKwh}">${unitLabel(u)}</button>`).join("")}</div><button type="button" class="toggle-chip" data-gas-weather aria-pressed="${ui.gasWeather}"><span class="toggle-box" aria-hidden="true"></span>${esc(t("weatherToggle"))}</button>`
      : "";
  const periodToggle = `<div class="segmented">${[false, true].map((q) => `<button type="button" data-quarters="${q}" aria-pressed="${q === ui.quarters}">${esc(t(q ? "viewQuarters" : "viewMonths"))}</button>`).join("")}</div>`;
  // All the view switches in one toolbar: one row on a wide screen, wrapping on a phone.
  const unitToggle = `<div class="toolbar">${moneyToggle}${periodToggle}${gasToggle}</div>`;
  const yearChips = (attr, isOn, color, list = years) =>
    `<div class="chips">${list.map((y) => `<button type="button" class="chip" ${attr}="${y}" aria-pressed="${isOn(y)}" style="color:${color(y)}">${y}</button>`).join("")}</div>`;

  // A heading with a button: on the page it maximizes the card into a modal, in the modal it closes it.
  const cardHead = (title, card, inModal = false) => {
    const label = esc(t(inModal ? "collapseCard" : "expandCard"));
    const btn = `<button type="button" class="card-max" ${inModal ? "data-close-modal" : `data-open="${card}"`} title="${label}" aria-label="${label}">${inModal ? "✕" : "⤢"}</button>`;
    return `<div class="card-head"><h2>${esc(t(title))}</h2>${btn}</div>`;
  };
  // The maximized card: all the years, over the whole page.
  const modalHtml = () => {
    if (!years.length || !ui.open) return "";
    const body =
      ui.open === "compare"
        ? `${cardHead("compareChart", "compare", true)}${yearChips("data-compare", (y) => ui.compared.has(y), (y) => yearColor(years, y))}<div class="chart-box"><canvas id="compare-chart-all"></canvas></div>`
        : `${cardHead("compareTable", "table", true)}${tableHtml(years, shown, years)}`;
    return `<dialog class="card-modal"><div class="card">${body}</div></dialog>`;
  };

  // The cards in the order set in Settings; each is empty where it does not apply.
  const cards = {
    supplier: () => supplierCardHtml(state),
    forecast: () => forecastHtml(state),
    insights: () => insightsHtml(state),
    year: () => (years.length ? `
      <section class="card">
        <h2>${esc(t(ui.money ? (ui.quarters ? "quarterCosts" : "yearCosts") : ui.quarters ? "quarterChart" : "yearChart"))}</h2>
        ${weatherInCard}
        ${yearChips("data-year", (y) => y === ui.year, () => cssVar("--text"))}
        ${statsHtml(table, ui.year, state)}
        <div class="chart-box" style="margin-top:12px"><canvas id="year-chart"></canvas></div>
        ${marksLegendHtml(chartMarks(state))}
      </section>` : ""),
    compare: () => (years.length ? `
      <section class="card">
        ${cardHead("compareChart", "compare")}
        ${yearChips("data-compare", (y) => ui.compared.has(y), (y) => yearColor(years, y), recent(years))}
        <div class="chart-box"><canvas id="compare-chart"></canvas></div>
      </section>` : ""),
    table: () => (years.length ? `
      <section class="card">
        ${cardHead("compareTable", "table")}
        ${tableHtml(years, shown)}
      </section>` : ""),
    upgrades: () => (ui.money ? "" : upgradesOverviewHtml(state, ui.commodity, upgradeDd)),
    bills: () => (ui.money && SUPPLIED.includes(ui.commodity) ? billsHtml(state, ui.commodity) : ""),
    price: () => (ui.money ? priceChartHtml(state) : ""),
    offers: () => (ui.money ? offersHtml(ui.commodity) : ""),
  };
  // A card set to the full width spans both columns on a wide screen.
  const cardsHtml = cardOrder()
    .filter((c) => !cardHidden(c))
    .map((c) => (cardFull(c) ? cards[c]().replace('<section class="card', '<section class="card full') : cards[c]()))
    .join("");

  view.innerHTML = `
    ${noticesHtml()}
    <div class="segmented">${tabs}</div>
    ${unitToggle}
    ${weatherNote}
    ${years.length || weatherOn() ? "" : `<p class="info-note">${esc(t(ui.money ? "noCosts" : "noData"))}${ui.money ? ` <a href="#settings" data-settings-section="suppliers">${esc(t("tabSettings"))}</a>` : ""}</p>`}
    ${ui.money && missingPrices && years.length ? `<p class="info-note">${esc(t("missingPrices", { months: missingPrices }))} <a href="#settings" data-settings-section="suppliers">${esc(t("tabSettings"))}</a></p>` : ""}
    ${cardsHtml}
    ${modalHtml()}
`;

  if (years.length) {
    // A card hidden in Settings has no canvas.
    if (view.querySelector("#year-chart")) yearChart(view.querySelector("#year-chart"), state, shown.get(ui.year));
    if (view.querySelector("#compare-chart")) compareChart(view.querySelector("#compare-chart"), years, shown);
  }
  const modal = view.querySelector(".card-modal");
  if (modal) {
    modal.showModal();
    if (ui.open === "compare") compareChart(view.querySelector("#compare-chart-all"), years, shown, years, "compare-all");
    // Esc, the close button or a click on the dimmed page around it.
    modal.addEventListener("close", () => {
      ui.open = null;
      // The page shows the recent years only: keep those switched on, or start over.
      const kept = [...ui.compared].filter((y) => recent(years).includes(y));
      ui.compared = kept.length ? new Set(kept) : null;
      rerender(view, "year", "price", "compare");
    });
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });
    modal.querySelector("[data-close-modal]").addEventListener("click", () => modal.close());
  }

  bindOffers(view, () => renderOverview(view));
  bindBills(view, () => renderOverview(view));
  if (view.querySelector("#price-chart")) priceChart(view.querySelector("#price-chart"), state);
  bindTabs(view);
  view.querySelectorAll("[data-money]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.money = b.dataset.money === "true";
      ui.compared = null;
      remember();
      renderOverview(view);
    }),
  );
  view.querySelectorAll("[data-quarters]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.quarters = b.dataset.quarters === "true";
      remember();
      renderOverview(view);
    }),
  );
  view.querySelector("[data-gas-weather]")?.addEventListener("click", () => {
    ui.gasWeather = !ui.gasWeather;
    ui.compared = null;
    remember();
    renderOverview(view);
  });
  view.querySelectorAll("[data-gas-unit]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.gasInKwh = b.dataset.gasUnit === "kWh";
      remember();
      renderOverview(view);
    }),
  );
  view.querySelectorAll("[data-year]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.year = Number(b.dataset.year);
      rerender(view, "compare", "price");
    }),
  );
  view.querySelectorAll("[data-open]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.open = b.dataset.open;
      rerender(view, "year", "price", "compare");
    }),
  );
  view.querySelectorAll("[data-compare]").forEach((b) =>
    b.addEventListener("click", () => {
      const y = Number(b.dataset.compare);
      if (ui.compared.has(y) && ui.compared.size > 1) ui.compared.delete(y);
      else ui.compared.add(y);
      rerender(view, "year", "price", ...(ui.open ? ["compare"] : []));
    }),
  );
}

export const leaveOverview = destroyCharts;
