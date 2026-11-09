import { CONTRACT_WARN_DAYS, SUPPLIED, daysUntil, deleteSupplier, setSupplier, supplierAt, suppliersOf } from "../data.js";
import { fmtDate, fmtMonth, t } from "../i18n.js";
import { getState, update } from "../store.js";
import { esc, toast } from "./dom.js";
import { commodityIcon } from "./icons.js";
import { currentMonth } from "./month-picker.js";

// The suppliers section of the settings: electricity and gas each with their own list (newest first) and a
// form to add or edit one. editing: null (form closed) or { commodity, id } with id null for a new one.
let editing = null;

const trash =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

// "Fixed price ends 31. 12. 2026 (in 52 days)", flagged when it ends within the warning window or has ended,
// but only for the current supplier: a past one replaced since needs no attention.
export function contractHtml(supplier, { current = true } = {}) {
  if (!supplier.contractEnd) return "";
  const days = daysUntil(supplier.contractEnd);
  const cls = !current ? "" : days < 0 ? "contract-past" : days <= CONTRACT_WARN_DAYS ? "contract-soon" : "";
  const when = days < 0 ? t("contractEnded") : days === 0 ? t("contractToday") : t("contractIn", { days });
  return `<span class="contract ${cls}">${esc(t("contractEnd"))} ${esc(fmtDate(supplier.contractEnd))} (${esc(when)})</span>`;
}

const pointLabel = (commodity) => t(commodity === "gas" ? "pointGas" : "pointElectricity");

function itemHtml(s) {
  const current = supplierAt(getState(), s.commodity, currentMonth())?.id === s.id;
  const details = [s.product, `${t("since")} ${fmtMonth(s.from)}`].filter(Boolean).map(esc).join(" · ");
  return `
    <div class="supplier-item">
      <div class="supplier-main">
        <strong>${esc(s.name)}</strong>
        <div class="hint">${details}</div>
        ${contractHtml(s, { current })}
      </div>
      <button type="button" class="mp-link" data-edit-supplier="${esc(s.id)}" data-commodity-of="${s.commodity}">${esc(t("edit"))}</button>
    </div>`;
}

const options = (values, selected, label = (v) => v) =>
  values.map((v) => `<option value="${v}" ${String(v) === String(selected) ? "selected" : ""}>${esc(label(v))}</option>`).join("");
const pad = (n) => String(n).padStart(2, "0");
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const monthsLong = (v) => t("monthsLong")[Number(v) - 1];

function formHtml(commodity, s) {
  const from = s?.from ?? currentMonth();
  const thisYear = Number(currentMonth().slice(0, 4));
  const [endY, endM, endD] = s?.contractEnd ? s.contractEnd.split("-") : ["", "", ""];
  // A name typed for the other commodity is offered here too: often the same company supplies both.
  const names = [...new Set(SUPPLIED.flatMap((c) => suppliersOf(getState(), c)).map((x) => x.name))];
  return `
    <form class="supplier-form" id="supplier-form" novalidate>
      <h3 class="bulk-sub">${esc(s ? t("supplierEdit") : t("supplierAdd"))}</h3>
      <label class="field" for="sup-name">${esc(t("supplierName"))}</label>
      <input type="text" id="sup-name" name="name" list="sup-names" autocomplete="off" value="${esc(s?.name ?? "")}" />
      <datalist id="sup-names">${names.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
      <label class="field">${esc(t("supplierFrom"))}</label>
      <div class="two-cols">
        <select name="fromMonth" aria-label="${esc(t("month"))}">${options(range(1, 12).map(pad), from.slice(5), monthsLong)}</select>
        <select name="fromYear" aria-label="${esc(t("year"))}">${options(range(thisYear - 25, thisYear + 1).reverse(), from.slice(0, 4))}</select>
      </div>
      <label class="field" for="sup-product">${esc(t("supplierProduct"))}</label>
      <input type="text" id="sup-product" name="product" value="${esc(s?.product ?? "")}" />
      <label class="field">${esc(t("contractEnd"))}</label>
      <div class="three-cols">
        <select name="endDay" aria-label="${esc(t("day"))}"><option value="">–</option>${options(range(1, 31).map(pad), endD)}</select>
        <select name="endMonth" aria-label="${esc(t("month"))}"><option value="">–</option>${options(range(1, 12).map(pad), endM, monthsLong)}</select>
        <select name="endYear" aria-label="${esc(t("year"))}"><option value="">–</option>${options(range(thisYear - 2, thisYear + 6), endY)}</select>
      </div>
      <label class="field" for="sup-point">${esc(pointLabel(commodity))}</label>
      <input type="text" id="sup-point" name="point" autocomplete="off" ${commodity === "gas" ? 'autocapitalize="characters"' : 'inputmode="numeric"'} value="${esc(s?.point ?? "")}" />
      <label class="field" for="sup-customer">${esc(t("customerNo"))}</label>
      <input type="text" id="sup-customer" name="customerNo" autocomplete="off" value="${esc(s?.customerNo ?? "")}" />
      <label class="field" for="sup-note">${esc(t("note"))}</label>
      <textarea id="sup-note" name="note" rows="3">${esc(s?.note ?? "")}</textarea>
      <p class="warn" id="sup-error" hidden></p>
      <div class="form-actions">
        ${s ? `<button type="button" class="btn danger icon-btn" id="sup-delete" title="${esc(t("delete"))}" aria-label="${esc(t("delete"))}">${trash}</button>` : ""}
        <button type="button" class="btn" id="sup-cancel">${esc(t("cancel"))}</button>
        <button type="submit" class="btn primary">${esc(t("save"))}</button>
      </div>
    </form>`;
}

function groupHtml(state, commodity) {
  const list = suppliersOf(state, commodity).reverse();
  const open = editing?.commodity === commodity;
  const current = open && editing.id ? state.suppliers[editing.id] : null;
  return `
    <div class="supplier-group">
      <h3 class="supplier-group-title"><span class="supplier-c" style="color:var(--${commodity})">${commodityIcon(commodity)}</span>${esc(t(commodity))}</h3>
      ${list.length ? list.map(itemHtml).join("") : `<p class="hint">${esc(t("suppliersEmptyOne"))}</p>`}
      ${open ? formHtml(commodity, current) : `<div class="btn-row"><button type="button" class="btn" data-add-supplier="${commodity}">+ ${esc(t("supplierAdd"))}</button></div>`}
    </div>`;
}

export function suppliersHtml() {
  const state = getState();
  return `
    <section class="card" id="suppliers">
      <h2>${esc(t("suppliers"))}</h2>
      <p class="hint">${esc(t("suppliersHint"))}</p>
      ${SUPPLIED.map((c) => groupHtml(state, c)).join("")}
    </section>`;
}

export function bindSuppliers(root, rerender) {
  const section = root.querySelector("#suppliers");
  section.querySelectorAll("[data-add-supplier]").forEach((b) =>
    b.addEventListener("click", () => {
      editing = { commodity: b.dataset.addSupplier, id: null };
      rerender();
      root.querySelector("#sup-name")?.focus();
    }),
  );
  section.querySelectorAll("[data-edit-supplier]").forEach((b) =>
    b.addEventListener("click", () => {
      editing = { commodity: b.dataset.commodityOf, id: b.dataset.editSupplier };
      rerender();
      root.querySelector("#supplier-form")?.scrollIntoView({ block: "start", behavior: "smooth" });
    }),
  );
  const form = section.querySelector("#supplier-form");
  if (!form) return;
  form.querySelector("#sup-cancel").addEventListener("click", () => {
    editing = null;
    rerender();
  });
  form.querySelector("#sup-delete")?.addEventListener("click", () => {
    const s = getState().suppliers[editing.id];
    if (!confirm(t("supplierDeleteConfirm", { name: s.name }))) return;
    const id = editing.id;
    editing = null;
    update((state) => deleteSupplier(state, id));
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const error = form.querySelector("#sup-error");
    const show = (key) => {
      error.textContent = t(key);
      error.hidden = false;
    };
    error.hidden = true;
    if (!String(data.get("name")).trim()) return show("supplierInvalid");
    // The contract end is all three parts or none, and a real date (no 31 February).
    const [d, m, y] = ["endDay", "endMonth", "endYear"].map((k) => data.get(k));
    let contractEnd = "";
    if (d || m || y) {
      const date = new Date(Number(y), Number(m) - 1, Number(d));
      if (!d || !m || !y || date.getDate() !== Number(d)) return show("contractInvalid");
      contractEnd = `${y}-${m}-${d}`;
    }
    const fields = {
      id: editing.id ?? undefined,
      commodity: editing.commodity,
      name: data.get("name"),
      from: `${data.get("fromYear")}-${data.get("fromMonth")}`,
      product: data.get("product"),
      contractEnd,
      point: data.get("point"),
      customerNo: data.get("customerNo"),
      note: data.get("note"),
    };
    editing = null;
    update((state) => setSupplier(state, fields));
    toast(t("saved"));
  });
}
