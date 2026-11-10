// The year's report as a page to print or save as PDF (the browser's print dialog does both).
import { yearReport } from "../report.js";
import { cur, fmt, fmtDate, fmtPct, t } from "../i18n.js";
import { getState } from "../store.js";
import { esc } from "./dom.js";

const unitOf = (c) => (c === "electricity" ? "kWh" : "m³");
const digits = (c) => (c === "water" ? 1 : 0);
const change = (a, b) => (a != null && b > 0 ? fmtPct(a / b - 1) : "–");
const num = (v, d = 0) => (v == null ? "–" : fmt(v, d));

function reportHtml(r) {
  const vs = esc(t("vsLastYear", { year: r.year - 1 }));
  const summary = r.commodities
    .map(
      ({ commodity: c, totals: x, goal }) => `<tr>
      <th>${esc(t(c))}</th>
      <td>${num(x.usage, digits(c))} ${unitOf(c)}${x.months < 12 ? ` <small>(${x.months} ${esc(t("reportMonths"))})</small>` : ""}</td>
      <td>${change(x.nowUsage, x.prevUsage)}</td>
      <td>${goal?.usage ? `${fmt(goal.usage, 0)} ${unitOf(c)}` : "–"}</td>
      <td>${num(x.cost)} ${esc(cur())}</td>
      <td>${change(x.nowCost, x.prevCost)}</td>
      <td>${goal?.cost ? `${fmt(goal.cost, 0)} ${esc(cur())}` : "–"}</td>
    </tr>`,
    )
    .join("");
  const head = r.commodities.map(({ commodity: c }) => `<th>${esc(t(c))} (${unitOf(c)})</th><th>${esc(cur())}</th>`).join("");
  const rows = t("monthsLong")
    .map((name, i) => {
      const cells = r.commodities
        .map((c) => {
          const u = c.usage[i];
          return `<td>${u ? `${fmt(u.value, digits(c.commodity))}${u.estimated ? "*" : ""}` : "–"}</td><td>${num(c.cost[i])}</td>`;
        })
        .join("");
      return `<tr><th>${esc(name)}</th>${cells}<td><strong>${num(r.costs[i])}</strong></td></tr>`;
    })
    .join("");
  const totals = r.commodities.map((c) => `<td>${num(c.totals.usage, digits(c.commodity))}</td><td>${num(c.totals.cost)}</td>`).join("");
  const e = r.emissions;
  const anyEstimated = r.commodities.some((c) => c.usage.some((u) => u?.estimated));
  return `
    <h1>${esc(t("reportTitle", { year: r.year }))}</h1>
    <p class="report-meta">${esc(t("reportMade", { date: fmtDate(new Date().toISOString().slice(0, 10)) }))}</p>
    <h2>${esc(t("reportSummary"))}</h2>
    <table>
      <thead><tr><th></th><th>${esc(t("reportUse"))}</th><th>${vs}</th><th>${esc(t("reportGoal"))}</th><th>${esc(t("costs"))}</th><th>${vs}</th><th>${esc(t("reportGoal"))}</th></tr></thead>
      <tbody>${summary}</tbody>
      <tfoot><tr><th>${esc(t("total"))}</th><td></td><td></td><td></td><td>${fmt(r.total, 0)} ${esc(cur())}</td><td>${change(r.nowShared, r.prevTotal)}</td><td></td></tr></tfoot>
    </table>
    <p class="report-meta">${esc(t("reportCompare"))}</p>
    ${e ? `<p>${esc(t("reportCo2", { total: fmt(e.total / 1000, 2), el: fmt((e.electricity ?? 0) / 1000, 2), gas: fmt((e.gas ?? 0) / 1000, 2) }))}</p>` : ""}
    <h2>${esc(t("reportByMonth"))}</h2>
    <table>
      <thead><tr><th>${esc(t("month"))}</th>${head}<th>${esc(t("total"))} ${esc(cur())}</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th>${esc(t("total"))}</th>${totals}<td>${fmt(r.total, 0)}</td></tr></tfoot>
    </table>
    ${anyEstimated ? `<p class="report-meta">${esc(t("reportEstimated"))}</p>` : ""}`;
}

// Puts the report in the page, opens the print dialog and takes it away afterwards.
export function printReport(year) {
  document.querySelector("#print-report")?.remove();
  const el = Object.assign(document.createElement("section"), { id: "print-report", innerHTML: reportHtml(yearReport(getState(), year)) });
  document.body.append(el);
  document.body.classList.add("printing");
  window.addEventListener(
    "afterprint",
    () => {
      el.remove();
      document.body.classList.remove("printing");
    },
    { once: true },
  );
  window.print();
}
