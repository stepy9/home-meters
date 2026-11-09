import { BarController, BarElement, CategoryScale, Chart, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip } from "chart.js";
import { COMMODITIES, SUPPLIED, toQuarters, priceAt, supplierAt, suppliersOf, byYear, change, commodityConsumption, metersOf, yearTotal } from "../data.js";
import { fmt, fmtMonth, fmtPct, t, unitLabel } from "../i18n.js";
import { getState } from "../store.js";
import { cssVar, esc } from "./dom.js";
import { commodityIcon } from "./icons.js";
import { advanceBalance, commodityCosts } from "../costs.js";
import { currentMonth } from "./month-picker.js";
import { contractHtml, priceSummary } from "./suppliers.js";

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
const ui = { commodity: saved.commodity ?? "electricity", gasInKwh: saved.gasInKwh ?? false, money: saved.money ?? false, quarters: saved.quarters ?? false, year: null, compared: null };
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const periodLabels = () => (ui.quarters ? QUARTERS : t("months"));
const remember = () => {
  try {
    localStorage.setItem(viewKey, JSON.stringify({ commodity: ui.commodity, gasInKwh: ui.gasInKwh, money: ui.money, quarters: ui.quarters }));
  } catch {}
};

const charts = [];
const destroyCharts = () => charts.splice(0).forEach((c) => c.destroy());

const commodityColor = { electricity: "--electricity", gas: "--gas", water: "--water" };
// Years by how recent they are: blue, orange, green, magenta, gold, teal, so the newest few always contrast most.
const yearColor = (years, year) => {
  return cssVar(`--year-${years.indexOf(year) % 6}`);
};

const unitOf = () => (ui.money ? "Kč" : ui.commodity === "electricity" ? "kWh" : ui.commodity === "gas" && ui.gasInKwh ? "kWh" : "m³");
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
    for (const { index, name } of marks) {
      const x = scales.x.getPixelForTick(index) - step / 2;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      // The name beside the line, kept inside the chart.
      const width = ctx.measureText(name).width;
      const left = x + 4 + width > chartArea.right ? x - 4 - width : x + 4;
      ctx.fillText(name, left, chartArea.top + 10);
    }
    ctx.restore();
  },
});

function yearChart(canvas, state, row) {
  const meters = metersOf(state, ui.commodity);
  const split = !ui.money && meters.length > 1;
  // Supplier changes in the shown year (the very first supplier is not a change).
  const marks = SUPPLIED.includes(ui.commodity)
    ? suppliersOf(state, ui.commodity)
        .slice(1)
        .filter((s) => Number(s.from.slice(0, 4)) === ui.year)
        .map((s) => ({ index: Math.floor((Number(s.from.slice(5)) - 1) / (ui.quarters ? 3 : 1)), name: s.name }))
    : [];
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
        maintainAspectRatio: false,
        scales: { ...axis(), x: { stacked: split, grid: { display: false } }, y: { ...axis().y, stacked: split } },
        plugins: { legend: { display: split, position: "bottom" }, tooltip },
        layout: { padding: { top: marks.length ? 14 : 0 } },
      },
      plugins: [supplierMarks(marks)],
    }),
  );
}

function compareChart(canvas, years, table) {
  const shown = years.filter((y) => ui.compared.has(y));
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
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: axis(),
        plugins: { legend: { display: false }, tooltip },
      },
    }),
  );
}

function tableHtml(years, table) {
  const cols = years.slice(0, 6);
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
  const totals = cols.map((y) => `<td>${fmt(yearTotal(table.get(y)).total, 0)}</td>`).join("");
  const estimated = cols.some((y) => table.get(y).some((c) => c?.estimated));
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>${esc(unitOf())}</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>${esc(t("total"))}</td>${totals}</tr></tfoot>
    </table></div>
    ${estimated ? `<p class="hint">${esc(t("estimated"))}</p>` : ""}`;
}

// The year's total, and against the previous year over the same months only, so a running year compares fairly.
// Advances paid against the costs over the same months: an estimate of the overpayment or the extra to pay.
function advanceHtml(state, year) {
  const b = advanceBalance(state, ui.commodity, year);
  if (!b.months || !b.paid) return "";
  const over = b.balance >= 0;
  return `<div class="stat"><div class="label">${esc(t("advancesYear", { year }))}</div><div class="value ${over ? "down" : "up"}">${over ? "+" : "−"}${fmt(Math.abs(b.balance), 0)} Kč</div><div class="sub">${esc(t(over ? "overpaid" : "underpaid"))} · ${fmt(b.paid, 0)} / ${fmt(b.cost, 0)} Kč</div></div>`;
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
    <div class="stat"><div class="label">${esc(t("total"))} ${year}</div><div class="value">${fmt(total, 0)}</div><div class="sub">${esc(unitOf())} · ${esc(t("perMonth", { months }))}</div></div>
    ${compare}
    ${ui.money ? advanceHtml(state, year) : ""}
  </div>`;
}

// The current supplier, with the contract end and current prices; a hint to add one when there is none.
function supplierCardHtml(state) {
  if (!SUPPLIED.includes(ui.commodity)) return "";
  const s = supplierAt(state, ui.commodity, currentMonth());
  if (!s) return `<section class="card supplier-card"><p class="hint">${esc(t("supplierNone"))} <a href="#settings">${esc(t("tabSettings"))}</a></p></section>`;
  const point = s.point;
  const price = priceAt(state, ui.commodity, currentMonth());
  const details = [s.product, `${t("since")} ${fmtMonth(s.from)}`, point && ui.commodity !== "water" && `${ui.commodity === "gas" ? "EIC" : "EAN"} ${point}`].filter(Boolean).map(esc).join(" · ");
  return `
    <section class="card supplier-card">
      <div class="hint">${esc(t("supplier"))}</div>
      <strong class="supplier-name">${esc(s.name)}</strong>
      <div class="hint">${details}</div>
      ${contractHtml(s)}
      ${price ? `<div class="price-now">${esc(priceSummary(ui.commodity, price))}</div>` : ""}
    </section>`;
}

export function renderOverview(view) {
  destroyCharts();
  chartDefaults();
  const state = getState();
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
  const { years, table } = byYear(consumption);
  const shown = ui.quarters ? new Map(years.map((y) => [y, toQuarters(table.get(y))])) : table;
  if (!years.includes(ui.year)) ui.year = years[0] ?? null;
  if (!ui.compared || ![...ui.compared].some((y) => years.includes(y))) ui.compared = new Set(years.slice(0, 3));

  const tabs = COMMODITIES.map((c) => `<button type="button" data-commodity="${c}" aria-pressed="${c === ui.commodity}" style="--c:${cssVar(commodityColor[c])}">${commodityIcon(c)}<span>${esc(t(c))}</span></button>`).join("");
  const moneyToggle = `<div class="segmented">${[false, true].map((m) => `<button type="button" data-money="${m}" aria-pressed="${m === ui.money}">${esc(t(m ? "viewCosts" : "viewUsage"))}</button>`).join("")}</div>`;
  const gasToggle =
    ui.commodity === "gas" && !ui.money
      ? `<div class="segmented">${["m3", "kWh"].map((u) => `<button type="button" data-gas-unit="${u}" aria-pressed="${(u === "kWh") === ui.gasInKwh}">${unitLabel(u)}</button>`).join("")}</div>`
      : "";
  const periodToggle = `<div class="segmented">${[false, true].map((q) => `<button type="button" data-quarters="${q}" aria-pressed="${q === ui.quarters}">${esc(t(q ? "viewQuarters" : "viewMonths"))}</button>`).join("")}</div>`;
  const unitToggle = `<div class="view-row">${moneyToggle}${periodToggle}</div>${gasToggle ? `<div class="view-row">${gasToggle}</div>` : ""}`;
  const yearChips = (attr, isOn, color) =>
    `<div class="chips">${years.map((y) => `<button type="button" class="chip" ${attr}="${y}" aria-pressed="${isOn(y)}" style="color:${color(y)}">${y}</button>`).join("")}</div>`;

  view.innerHTML = `
    <div class="segmented">${tabs}</div>
    ${unitToggle}
    ${supplierCardHtml(state)}
    ${
      years.length
        ? `
      <section class="card">
        <h2>${esc(t(ui.money ? (ui.quarters ? "quarterCosts" : "yearCosts") : ui.quarters ? "quarterChart" : "yearChart"))}</h2>
        ${yearChips("data-year", (y) => y === ui.year, () => cssVar("--text"))}
        ${statsHtml(table, ui.year, state)}
        <div class="chart-box" style="margin-top:12px"><canvas id="year-chart"></canvas></div>
      </section>
      <section class="card">
        <h2>${esc(t("compareChart"))}</h2>
        ${yearChips("data-compare", (y) => ui.compared.has(y), (y) => yearColor(years, y))}
        <div class="chart-box"><canvas id="compare-chart"></canvas></div>
      </section>
      <section class="card">
        <h2>${esc(t("compareTable"))}</h2>
        ${tableHtml(years, shown)}
      </section>`
        : `<p class="empty">${esc(t(ui.money ? "noCosts" : "noData"))}</p>`
    }
    ${ui.money && missingPrices ? `<p class="hint center">${esc(t("missingPrices", { months: missingPrices }))} <a href="#settings">${esc(t("tabSettings"))}</a></p>` : ""}`;

  if (years.length) {
    yearChart(view.querySelector("#year-chart"), state, shown.get(ui.year));
    compareChart(view.querySelector("#compare-chart"), years, shown);
  }

  view.querySelectorAll("[data-commodity]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.commodity = b.dataset.commodity;
      ui.compared = null;
      remember();
      renderOverview(view);
    }),
  );
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
      renderOverview(view);
    }),
  );
  view.querySelectorAll("[data-compare]").forEach((b) =>
    b.addEventListener("click", () => {
      const y = Number(b.dataset.compare);
      if (ui.compared.has(y) && ui.compared.size > 1) ui.compared.delete(y);
      else ui.compared.add(y);
      renderOverview(view);
    }),
  );
}

export const leaveOverview = destroyCharts;
