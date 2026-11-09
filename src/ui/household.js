import { Chart } from "chart.js";
import { SUPPLIED, byYear, monthAdd, yearTotal } from "../data.js";
import { benchmarks, householdCosts } from "../household.js";
import { fmt, fmtPct, t } from "../i18n.js";
import { cssVar, esc } from "./dom.js";
import { commodityIcon } from "./icons.js";
import { currentMonth } from "./month-picker.js";

// The household tab of the overview: what electricity, gas and water cost together, by month and by year, and
// how the use compares per m² and per person.
const hh = { year: null };
const kc = (v) => `${fmt(v, 0)} Kč`;
const color = (c) => cssVar(`--${c}`);

// A year's months and the same months a year earlier (a running year compares fairly).
function sameMonths(table, year) {
  const row = table.get(year);
  const prev = table.get(year - 1);
  if (!prev) return null;
  let a = 0;
  let b = 0;
  row.forEach((cell, i) => {
    if (cell && prev[i]) {
      a += cell.total;
      b += prev[i].total;
    }
  });
  return b > 0 ? { now: a, before: b, change: a / b - 1 } : null;
}

function benchmarkHtml(state) {
  const { area, people } = state.config.house ?? {};
  if (!area && !people) return `<section class="card"><h2>${esc(t("benchTitle"))}</h2><p class="hint">${esc(t("benchNoHouse"))} <a href="#settings" data-settings-section="house">${esc(t("tabSettings"))}</a></p></section>`;
  const b = benchmarks(state, monthAdd(currentMonth(), -1));
  const rows = [];
  const months = (m) => (m < 12 ? ` <span class="hint">${esc(t("benchMonths", { months: m }))}</span>` : "");
  if (b.gas)
    rows.push(`<div class="bench-row"><span class="bench-icon" style="color:${color("gas")}">${commodityIcon("gas")}</span><div><strong>${fmt(b.gas.perM2, 0)} kWh/m² ${esc(t("perYearShort"))}</strong>${months(b.gas.months)}<div class="hint">${esc(t(`bench.gas.${b.gas.level}`))}</div></div></div>`);
  if (b.electricity)
    rows.push(`<div class="bench-row"><span class="bench-icon" style="color:${color("electricity")}">${commodityIcon("electricity")}</span><div><strong>${fmt(b.electricity.perPerson, 0)} kWh ${esc(t("perPersonYear"))}</strong>${months(b.electricity.months)}<div class="hint">${esc(t("bench.electricity", { pct: fmtPct(b.electricity.ratio - 1) }))}</div></div></div>`);
  if (b.water)
    rows.push(`<div class="bench-row"><span class="bench-icon" style="color:${color("water")}">${commodityIcon("water")}</span><div><strong>${fmt(b.water.litresPerDay, 0)} l ${esc(t("perPersonDay"))}</strong> <span class="hint">(${fmt(b.water.perPerson, 1)} m³ ${esc(t("perPersonYear"))})</span>${months(b.water.months)}<div class="hint">${esc(t("bench.water", { pct: fmtPct(b.water.ratio - 1) }))}</div></div></div>`);
  const house = [area && `${fmt(area, 0)} m²`, people && t("benchPeople", { people })].filter(Boolean).join(" · ");
  return `<section class="card"><h2>${esc(t("benchTitle"))}</h2><p class="hint">${esc(t("benchHint", { house }))}</p>${rows.join("") || `<p class="hint">${esc(t("noData"))}</p>`}</section>`;
}

export function householdHtml(state) {
  const costs = householdCosts(state);
  const missing = new Set([...costs.values()].flatMap((c) => c.missing));
  const priced = new Map([...costs].filter(([, c]) => Object.keys(c.parts).length));
  const { years, table } = byYear(priced);
  if (!years.includes(hh.year)) hh.year = years[0] ?? null;
  let body = `<p class="empty">${esc(t("householdEmpty"))} <a href="#settings" data-settings-section="suppliers">${esc(t("tabSettings"))}</a></p>`;
  if (years.length) {
    const row = table.get(hh.year);
    const { total, months } = yearTotal(row);
    const cmp = sameMonths(table, hh.year);
    const per = SUPPLIED.map((c) => {
      const sum = row.reduce((s, cell) => s + (cell?.parts[c] ?? 0), 0);
      return sum ? `<div class="hh-part"><span style="color:${color(c)}">${commodityIcon(c)}</span>${esc(t(c))}<strong>${kc(sum)}</strong></div>` : "";
    }).join("");
    const cols = years.slice(0, 5);
    const yearSum = (y, c) => table.get(y).reduce((s, cell) => s + (c ? cell?.parts[c] ?? 0 : cell?.total ?? 0), 0);
    const tableRows = [...SUPPLIED, null]
      .map((c) => `<tr class="${c ? "" : "total-row"}"><td>${esc(c ? t(c) : t("total"))}</td>${cols.map((y) => `<td>${yearSum(y, c) ? fmt(yearSum(y, c), 0) : "–"}</td>`).join("")}</tr>`)
      .join("");
    body = `
      <section class="card">
        <h2>${esc(t("householdTitle"))}</h2>
        <div class="chips">${years.map((y) => `<button type="button" class="chip" data-hh-year="${y}" aria-pressed="${y === hh.year}">${y}</button>`).join("")}</div>
        <div class="stats">
          <div class="stat"><div class="label">${esc(t("total"))} ${hh.year}</div><div class="value">${fmt(total, 0)}</div><div class="sub">Kč · ${esc(t("perMonth", { months }))}</div></div>
          ${cmp ? `<div class="stat"><div class="label">${esc(t("vsLastYear", { year: hh.year - 1 }))}</div><div class="value ${cmp.change > 0 ? "up" : "down"}">${fmtPct(cmp.change)}</div><div class="sub">${fmt(cmp.now, 0)} / ${fmt(cmp.before, 0)} Kč</div></div>` : ""}
        </div>
        <div class="hh-parts">${per}</div>
        <div class="chart-box" style="margin-top:12px"><canvas id="hh-chart"></canvas></div>
      </section>
      <section class="card">
        <h2>${esc(t("householdYears"))}</h2>
        <div class="table-wrap"><table><thead><tr><th>Kč</th>${cols.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></div>
      </section>`;
  }
  const missingNote = missing.size ? `<p class="hint center">${esc(t("householdMissing", { list: [...missing].map((c) => t(c).toLowerCase()).join(", ") }))} <a href="#settings" data-settings-section="suppliers">${esc(t("tabSettings"))}</a></p>` : "";
  return { html: body + missingNote + benchmarkHtml(state), row: years.length ? table.get(hh.year) : null };
}

export function drawHousehold(view, charts, row, rerender) {
  view.querySelectorAll("[data-hh-year]").forEach((b) =>
    b.addEventListener("click", () => {
      hh.year = Number(b.dataset.hhYear);
      rerender();
    }),
  );
  const canvas = view.querySelector("#hh-chart");
  if (!canvas || !row) return;
  charts.push(
    new Chart(canvas, {
      type: "bar",
      data: {
        labels: t("months"),
        datasets: SUPPLIED.map((c) => ({ label: t(c), data: row.map((cell) => cell?.parts[c] ?? null), backgroundColor: color(c), borderRadius: 3, stack: "s" })),
      },
      options: {
        maintainAspectRatio: false,
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => fmt(v, 0) } } },
        plugins: {
          legend: { position: "bottom" },
          tooltip: { mode: "index", intersect: false, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? "–" : kc(ctx.parsed.y)}`, footer: (items) => `${t("total")}: ${kc(items.reduce((s, i) => s + (i.parsed.y ?? 0), 0))}` } },
        },
      },
    }),
  );
}
