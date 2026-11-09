import { CONTRACT_WARN_DAYS, SUPPLIED, daysUntil, deleteSupplier, setSupplier, suppliersOf } from "../data.js";
import { fmtDate, fmtMonth, t } from "../i18n.js";
import { getState, update } from "../store.js";
import { esc, toast } from "./dom.js";
import { commodityIcon } from "./icons.js";
import { currentMonth } from "./month-picker.js";

// The suppliers section of the settings: a list of every supplier, newest first, and a form to add or edit one.
// editing: null (form closed), "new", or a supplier id.
let editing = null;

const allSuppliers = (state) => {
  const seen = new Map();
  for (const c of SUPPLIED) for (const s of suppliersOf(state, c)) seen.set(s.id, s);
  return [...seen.values()].sort((a, b) => (a.from < b.from ? 1 : -1));
};

// "Fixation until 31. 12. 2026 (in 52 days)", flagged when it ends within the warning window or has ended.
export function contractHtml(supplier) {
  if (!supplier.contractEnd) return "";
  const days = daysUntil(supplier.contractEnd);
  const cls = days < 0 ? "contract-past" : days <= CONTRACT_WARN_DAYS ? "contract-soon" : "";
  const when = days < 0 ? t("contractEnded") : days === 0 ? t("contractToday") : t("contractIn", { days });
  return `<span class="contract ${cls}">${esc(t("contractEnd"))} ${esc(fmtDate(supplier.contractEnd))} (${esc(when)})</span>`;
}

function itemHtml(s) {
  const icons = s.commodities.map((c) => `<span class="supplier-c" style="color:var(--${c})">${commodityIcon(c)}</span>`).join("");
  const details = [s.product, `${t("since")} ${fmtMonth(s.from)}`].filter(Boolean).map(esc).join(" · ");
  return `
    <div class="supplier-item">
      <div class="supplier-icons">${icons}</div>
      <div class="supplier-main">
        <strong>${esc(s.name)}</strong>
        <div class="hint">${details}</div>
        ${contractHtml(s)}
      </div>
      <button type="button" class="mp-link" data-edit-supplier="${esc(s.id)}">${esc(t("edit"))}</button>
    </div>`;
}

const monthOptions = (selected) => t("monthsLong").map((name, i) => `<option value="${String(i + 1).padStart(2, "0")}" ${selected === i + 1 ? "selected" : ""}>${esc(name)}</option>`).join("");
const yearOptions = (selected) => {
  const last = Number(currentMonth().slice(0, 4)) + 1;
  return Array.from({ length: 25 }, (_, i) => last - i)
    .map((y) => `<option value="${y}" ${selected === y ? "selected" : ""}>${y}</option>`)
    .join("");
};

function formHtml(s) {
  const from = s?.from ?? currentMonth();
  const has = (c) => (s ? s.commodities.includes(c) : true);
  const names = [...new Set(allSuppliers(getState()).map((x) => x.name))];
  return `
    <form class="supplier-form" id="supplier-form" novalidate>
      <h3 class="bulk-sub">${esc(s ? t("supplierEdit") : t("supplierAdd"))}</h3>
      <div class="check-row">
        ${SUPPLIED.map((c) => `<label class="check"><input type="checkbox" name="commodity" value="${c}" ${has(c) ? "checked" : ""} /><span class="supplier-c" style="color:var(--${c})">${commodityIcon(c)}</span>${esc(t(c))}</label>`).join("")}
      </div>
      <label class="field" for="sup-name">${esc(t("supplierName"))}</label>
      <input type="text" id="sup-name" name="name" list="sup-names" autocomplete="off" value="${esc(s?.name ?? "")}" />
      <datalist id="sup-names">${names.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
      <label class="field">${esc(t("supplierFrom"))}</label>
      <div class="two-cols">
        <select name="fromMonth" aria-label="${esc(t("month"))}">${monthOptions(Number(from.slice(5)))}</select>
        <select name="fromYear" aria-label="${esc(t("year"))}">${yearOptions(Number(from.slice(0, 4)))}</select>
      </div>
      <label class="field" for="sup-product">${esc(t("supplierProduct"))}</label>
      <input type="text" id="sup-product" name="product" value="${esc(s?.product ?? "")}" />
      <label class="field" for="sup-end">${esc(t("contractEnd"))}</label>
      <input type="date" id="sup-end" name="contractEnd" value="${esc(s?.contractEnd ?? "")}" />
      <div class="point" data-point="electricity"><label class="field" for="sup-ean">${esc(t("pointElectricity"))}</label>
      <input type="text" id="sup-ean" name="point-electricity" inputmode="numeric" autocomplete="off" value="${esc(s?.points.electricity ?? "")}" /></div>
      <div class="point" data-point="gas"><label class="field" for="sup-eic">${esc(t("pointGas"))}</label>
      <input type="text" id="sup-eic" name="point-gas" autocapitalize="characters" autocomplete="off" value="${esc(s?.points.gas ?? "")}" /></div>
      <label class="field" for="sup-customer">${esc(t("customerNo"))}</label>
      <input type="text" id="sup-customer" name="customerNo" autocomplete="off" value="${esc(s?.customerNo ?? "")}" />
      <label class="field" for="sup-note">${esc(t("note"))}</label>
      <textarea id="sup-note" name="note" rows="3">${esc(s?.note ?? "")}</textarea>
      <p class="warn" id="sup-error" hidden></p>
      <div class="form-actions">
        ${s ? `<button type="button" class="btn danger icon-btn" id="sup-delete" title="${esc(t("delete"))}" aria-label="${esc(t("delete"))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button>` : ""}
        <button type="button" class="btn" id="sup-cancel">${esc(t("cancel"))}</button>
        <button type="submit" class="btn primary">${esc(t("save"))}</button>
      </div>
    </form>`;
}

export function suppliersHtml() {
  const state = getState();
  const list = allSuppliers(state);
  const current = editing && editing !== "new" ? state.suppliers[editing] : null;
  return `
    <section class="card" id="suppliers">
      <h2>${esc(t("suppliers"))}</h2>
      ${list.length ? list.map(itemHtml).join("") : `<p class="hint">${esc(t("suppliersEmpty"))}</p>`}
      ${editing ? formHtml(current) : `<div class="btn-row"><button type="button" class="btn" id="sup-add">+ ${esc(t("supplierAdd"))}</button></div>`}
    </section>`;
}

export function bindSuppliers(root, rerender) {
  const section = root.querySelector("#suppliers");
  section.querySelector("#sup-add")?.addEventListener("click", () => {
    editing = "new";
    rerender();
    root.querySelector("#sup-name")?.focus();
  });
  section.querySelectorAll("[data-edit-supplier]").forEach((b) =>
    b.addEventListener("click", () => {
      editing = b.dataset.editSupplier;
      rerender();
      root.querySelector("#supplier-form")?.scrollIntoView({ block: "start", behavior: "smooth" });
    }),
  );
  const form = section.querySelector("#supplier-form");
  if (!form) return;
  // EAN only with electricity, EIC only with gas.
  const showPoints = () => {
    const on = new Set([...form.querySelectorAll('[name="commodity"]:checked')].map((x) => x.value));
    form.querySelectorAll("[data-point]").forEach((el) => (el.hidden = !on.has(el.dataset.point)));
  };
  showPoints();
  form.addEventListener("change", showPoints);
  form.querySelector("#sup-cancel").addEventListener("click", () => {
    editing = null;
    rerender();
  });
  form.querySelector("#sup-delete")?.addEventListener("click", () => {
    const s = getState().suppliers[editing];
    if (!confirm(t("supplierDeleteConfirm", { name: s.name }))) return;
    const id = editing;
    editing = null;
    update((state) => deleteSupplier(state, id));
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const commodities = data.getAll("commodity");
    const fields = {
      id: editing === "new" ? undefined : editing,
      commodities,
      name: data.get("name"),
      from: `${data.get("fromYear")}-${data.get("fromMonth")}`,
      product: data.get("product"),
      contractEnd: data.get("contractEnd"),
      points: { electricity: data.get("point-electricity"), gas: data.get("point-gas") },
      customerNo: data.get("customerNo"),
      note: data.get("note"),
    };
    const error = form.querySelector("#sup-error");
    error.hidden = true;
    if (!commodities.length || !String(fields.name).trim()) {
      error.textContent = t("supplierInvalid");
      error.hidden = false;
      return;
    }
    editing = null;
    update((state) => setSupplier(state, fields));
    toast(t("saved"));
  });
}
