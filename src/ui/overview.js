import { BarController, BarElement, CategoryScale, Chart, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip } from "chart.js";
import { COMMODITIES, byYear, change, commodityConsumption, metersOf, yearTotal } from "../data.js";
import { fmt, fmtPct, t, unitLabel } from "../i18n.js";
import { getState } from "../store.js";
import { cssVar, esc } from "./dom.js";
import { commodityIcon } from "./icons.js";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, LineController, LineElement, PointElement, Tooltip, Legend);

const viewKey = "home-meters-overview";
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(viewKey)) ?? {};
  } catch {
    return {};
  }
})();
const ui = { commodity: saved.commodity ?? "electricity", gasInKwh: saved.gasInKwh ?? false, year: null, compared: null };
const remember = () => {
  try {
    localStorage.setItem(viewKey, JSON.stringify({ commodity: ui.commodity, gasInKwh: ui.gasInKwh }));
  } catch {}
};

const charts = [];
const destroyCharts = () => charts.splice(0).forEach((c) => c.destroy());

const commodityColor = { electricity: "--electricity", gas: "--gas", water: "--water" };
// Years by how recent they are: blue, orange, green, magenta, gold, teal, so the newest few always contrast most.
const yearColor = (years, year) => {
  return cssVar(`--year-${years.indexOf(year) % 6}`);
};

const unitOf = () => (ui.commodity === "electricity" ? "kWh" : ui.commodity === "gas" && ui.gasInKwh ? "kWh" : "m³");

function chartDefaults() {
  Chart.defaults.color = cssVar("--muted");
  Chart.defaults.borderColor = cssVar("--border");
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
}

const axis = () => ({
  x: { grid: { display: false } },
  y: { beginAtZero: true, ticks: { callback: (v) => fmt(v, 0) } },
});
const tooltip = { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? "–" : `${fmt(ctx.parsed.y)} ${unitOf()}`}` } };

function yearChart(canvas, state, row) {
  const meters = metersOf(state, ui.commodity);
  const split = meters.length > 1;
  const datasets = split
    ? meters.map((m, i) => ({
        label: t(`short.${m.id}`),
        data: row.map((cell) => cell?.parts[m.id] ?? null),
        backgroundColor: cssVar(i === 0 ? "--electricity" : "--electricity-2"),
        borderRadius: 4,
        stack: "s",
      }))
    : [{ label: t(ui.commodity), data: row.map((cell) => cell?.total ?? null), backgroundColor: cssVar(commodityColor[ui.commodity]), borderRadius: 4 }];
  charts.push(
    new Chart(canvas, {
      type: "bar",
      data: { labels: t("months"), datasets },
      options: {
        maintainAspectRatio: false,
        scales: { ...axis(), x: { stacked: split, grid: { display: false } }, y: { ...axis().y, stacked: split } },
        plugins: { legend: { display: split, position: "bottom" }, tooltip },
      },
    }),
  );
}

function compareChart(canvas, years, table) {
  const shown = years.filter((y) => ui.compared.has(y));
  charts.push(
    new Chart(canvas, {
      type: "line",
      data: {
        labels: t("months"),
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
    const delta = prevYear ? change(cur, prevYear[i]) : null;
    const deltaHtml = delta == null ? "" : `<small class="${delta > 0 ? "up" : "down"}">${fmtPct(delta)}</small>`;
    return `<td>${fmt(cur.total)}${cur.estimated ? "*" : ""}${deltaHtml}</td>`;
  };
  const rows = t("months")
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
function statsHtml(table, year) {
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
  </div>`;
}

export function renderOverview(view) {
  destroyCharts();
  chartDefaults();
  const state = getState();
  const consumption = commodityConsumption(state, ui.commodity, { gasInKwh: ui.gasInKwh });
  const { years, table } = byYear(consumption);
  if (!years.includes(ui.year)) ui.year = years[0] ?? null;
  if (!ui.compared || ![...ui.compared].some((y) => years.includes(y))) ui.compared = new Set(years.slice(0, 3));

  const tabs = COMMODITIES.map((c) => `<button type="button" data-commodity="${c}" aria-pressed="${c === ui.commodity}" style="--c:${cssVar(commodityColor[c])}">${commodityIcon(c)}<span>${esc(t(c))}</span></button>`).join("");
  const unitToggle =
    ui.commodity === "gas"
      ? `<div class="segmented" style="max-width:200px">${["m3", "kWh"].map((u) => `<button type="button" data-gas-unit="${u}" aria-pressed="${(u === "kWh") === ui.gasInKwh}">${unitLabel(u)}</button>`).join("")}</div>`
      : "";
  const yearChips = (attr, isOn, color) =>
    `<div class="chips">${years.map((y) => `<button type="button" class="chip" ${attr}="${y}" aria-pressed="${isOn(y)}" style="color:${color(y)}">${y}</button>`).join("")}</div>`;

  view.innerHTML = `
    <div class="segmented">${tabs}</div>
    ${unitToggle}
    ${
      years.length
        ? `
      <section class="card">
        <h2>${esc(t("yearChart"))}</h2>
        ${yearChips("data-year", (y) => y === ui.year, () => cssVar("--text"))}
        ${statsHtml(table, ui.year)}
        <div class="chart-box" style="margin-top:12px"><canvas id="year-chart"></canvas></div>
      </section>
      <section class="card">
        <h2>${esc(t("compareChart"))}</h2>
        ${yearChips("data-compare", (y) => ui.compared.has(y), (y) => yearColor(years, y))}
        <div class="chart-box"><canvas id="compare-chart"></canvas></div>
      </section>
      <section class="card">
        <h2>${esc(t("compareTable"))}</h2>
        ${tableHtml(years, table)}
      </section>`
        : `<p class="empty">${esc(t("noData"))}</p>`
    }`;

  if (years.length) {
    yearChart(view.querySelector("#year-chart"), state, table.get(ui.year));
    compareChart(view.querySelector("#compare-chart"), years, table);
  }

  view.querySelectorAll("[data-commodity]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.commodity = b.dataset.commodity;
      ui.compared = null;
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
