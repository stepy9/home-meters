import { buildPreview, guessColumns, splitTable } from "../bulk.js";
import { METERS, setReading } from "../data.js";
import { fmt, fmtMonth, t } from "../i18n.js";
import { getState, update } from "../store.js";
import { esc, toast } from "./dom.js";

// Shown on the entry screen only when switched on in the settings (per device; it is for catching up on history).
const enabledKey = "home-meters-bulk";
export const bulkEnabled = () => {
  try {
    return localStorage.getItem(enabledKey) === "1";
  } catch {
    return false;
  }
};
export const setBulkEnabled = (on) => {
  try {
    if (on) localStorage.setItem(enabledKey, "1");
    else localStorage.removeItem(enabledKey);
  } catch {}
};

// Kept while the app is open, so switching tabs does not lose a paste.
const ui = { open: false, text: "", columns: null, header: false, earlyToPrevious: true };

const activeMeterIds = () => METERS.filter((m) => getState().config.active[m.id]).map((m) => m.id);

function columnsHtml(rows) {
  const first = rows[0] ?? [];
  const sample = rows[ui.header ? 1 : 0] ?? [];
  const options = ["", "month", ...METERS.map((m) => m.id)];
  const label = (id) => (id === "" ? t("bulkIgnore") : id === "month" ? t("month") : t(`meter.${id}`));
  return ui.columns
    .map(
      (id, i) => `
      <label class="bulk-col">
        <span>${esc(ui.header ? first[i] || t("bulkColumn", { n: i + 1 }) : t("bulkColumn", { n: i + 1 }))}<small>${esc(sample[i] ?? "")}</small></span>
        <select data-col="${i}">${options.map((o) => `<option value="${o}" ${o === id ? "selected" : ""}>${esc(label(o))}</option>`).join("")}</select>
      </label>`,
    )
    .join("");
}

function previewHtml(preview) {
  if (!preview.meters.length || !ui.columns.includes("month")) return `<p class="warn">${esc(t("bulkNeedColumns"))}</p>`;
  const head = preview.meters.map((id) => `<th>${esc(t(`meter.${id}`))}</th>`).join("");
  const rows = preview.lines
    .map((line) => {
      const monthCell = line.monthError
        ? `<td class="st-error" title="${esc(t("bulkBadMonth"))}">${esc(line.rawMonth || "?")}</td>`
        : `<td>${line.month ? esc(fmtMonth(line.month)) : ""}${line.duplicate ? ` <small class="st-skip">${esc(t("bulkDuplicate"))}</small>` : ""}</td>`;
      const cells = line.cells
        .map((c) => {
          if (c.status === "empty") return "<td></td>";
          if (c.status === "error") return `<td class="st-error" title="${esc(t("bulkBadValue"))}">${esc(c.raw)}</td>`;
          const down = preview.decreasing.has(`${c.meter}|${c.month}`);
          const cls = line.duplicate ? "st-skip" : `st-${c.status}${down ? " st-down" : ""}`;
          const title = c.status === "change" ? t("bulkWas", { value: fmt(c.previous, 3) }) : down ? t("bulkDecreasing") : t(`bulk.${c.status}`);
          return `<td class="${cls}" title="${esc(title)}">${fmt(c.value, 3)}${down ? " ↓" : ""}</td>`;
        })
        .join("");
      return `<tr>${monthCell}${cells}</tr>`;
    })
    .join("");
  const counts = { new: 0, change: 0 };
  for (const r of preview.readings) counts[r.status] += 1;
  return `
    <div class="table-wrap"><table class="bulk-table"><thead><tr><th>${esc(t("month"))}</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="bulk-legend"><span class="st-new">■</span> ${esc(t("bulk.new"))} <span class="st-change">■</span> ${esc(t("bulk.change"))} <span class="st-same">■</span> ${esc(t("bulk.same"))} <span class="st-error">■</span> ${esc(t("bulk.error"))}</p>
    ${preview.errors ? `<p class="warn">${esc(t("bulkErrors", { count: preview.errors }))}</p>` : ""}
    ${preview.decreasing.size ? `<p class="warn">${esc(t("bulkDecreasingNote"))}</p>` : ""}
    <button class="btn primary" type="button" id="bulk-save" ${preview.readings.length ? "" : "disabled"}>${esc(t("bulkSave", { new: counts.new, change: counts.change }))}</button>`;
}

export function bulkHtml() {
  return `
    <details class="card bulk" id="bulk" ${ui.open ? "open" : ""}>
      <summary><h2>${esc(t("bulkTitle"))}</h2></summary>
      <p class="hint">${esc(t("bulkHint"))}</p>
      <textarea id="bulk-text" rows="6" spellcheck="false" autocapitalize="off" placeholder="${esc(t("bulkPlaceholder"))}">${esc(ui.text)}</textarea>
      <label class="check"><input type="checkbox" id="bulk-early" ${ui.earlyToPrevious ? "checked" : ""} />${esc(t("bulkEarly"))}</label>
      <div id="bulk-result"></div>
    </details>`;
}

function renderResult(root) {
  const out = root.querySelector("#bulk-result");
  const rows = splitTable(ui.text);
  if (!rows.length) {
    out.innerHTML = "";
    return;
  }
  if (!ui.columns || ui.columns.length !== Math.max(...rows.map((r) => r.length))) Object.assign(ui, guessColumns(rows, activeMeterIds()));
  const preview = buildPreview(getState(), rows, { columns: ui.columns, header: ui.header }, { earlyToPrevious: ui.earlyToPrevious });
  out.innerHTML = `
    <h3 class="bulk-sub">${esc(t("bulkColumns"))}</h3>
    <label class="check"><input type="checkbox" id="bulk-header" ${ui.header ? "checked" : ""} />${esc(t("bulkHeader"))}</label>
    <div class="bulk-cols">${columnsHtml(rows)}</div>
    <h3 class="bulk-sub">${esc(t("bulkPreview"))}</h3>
    ${previewHtml(preview)}`;
  out.querySelector("#bulk-header").addEventListener("change", (e) => {
    ui.header = e.target.checked;
    renderResult(root);
  });
  out.querySelectorAll("[data-col]").forEach((select) =>
    select.addEventListener("change", () => {
      const i = Number(select.dataset.col);
      // A meter or the month sits in one column only: picking it here clears it elsewhere.
      if (select.value) ui.columns = ui.columns.map((id) => (id === select.value ? "" : id));
      ui.columns[i] = select.value;
      renderResult(root);
    }),
  );
  out.querySelector("#bulk-save")?.addEventListener("click", () => {
    const now = Date.now();
    const count = preview.readings.length;
    Object.assign(ui, { text: "", columns: null, header: false });
    update((s) => preview.readings.reduce((acc, r) => setReading(acc, r, now), s));
    toast(t("bulkSaved", { count }));
  });
}

export function bindBulk(root) {
  const details = root.querySelector("#bulk");
  details.addEventListener("toggle", () => (ui.open = details.open));
  root.querySelector("#bulk-text").addEventListener("input", (e) => {
    ui.text = e.target.value;
    ui.columns = null;
    renderResult(root);
  });
  root.querySelector("#bulk-early").addEventListener("change", (e) => {
    ui.earlyToPrevious = e.target.checked;
    renderResult(root);
  });
  renderResult(root);
}
