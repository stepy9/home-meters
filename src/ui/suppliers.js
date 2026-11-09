import {
  DEFAULT_REMIND_MONTHS,
  REMIND_MONTHS,
  reminderDue,
  ADVANCE_PERIODS,
  BREAKERS,
  SUPPLIED,
  TARIFFS,
  daysUntil,
  deletePrice,
  deleteSupplier,
  isTwoTariff,
  pricesOf,
  setPrice,
  setSupplier,
  supplierAt,
  suppliersOf,
} from "../data.js";
import { fmtDate, fmtMonth, lang, t } from "../i18n.js";
import { getState, update } from "../store.js";
import { esc, parseNumber, toast } from "./dom.js";
import { commodityIcon } from "./icons.js";
import { currentMonth } from "./month-picker.js";

// The suppliers section of the settings: electricity, gas and water each with their own list of suppliers
// (newest first), each supplier with its own price list over time.
// editing: null or { commodity, id } (id null for a new supplier); the supplier form is open.
// pricesOpen: the supplier whose price list is shown; editingPrice: null or { supplierId, id } (id null: new).
let editing = null;
let pricesOpen = null;
let editingPrice = null;

const trash =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
const deleteButton = (id) => `<button type="button" class="btn danger icon-btn" id="${id}" title="${esc(t("delete"))}" aria-label="${esc(t("delete"))}">${trash}</button>`;

// "Fixed price ends 31. 12. 2026 (in 52 days)", flagged when it ends within the warning window or has ended,
// but only for the current supplier: a past one replaced since needs no attention.
export function contractHtml(supplier, { current = true } = {}) {
  if (!supplier.contractEnd) return "";
  const days = daysUntil(supplier.contractEnd);
  const cls = !current ? "" : days < 0 ? "contract-past" : reminderDue(supplier) ? "contract-soon" : "";
  const when = days < 0 ? t("contractEnded") : days === 0 ? t("contractToday") : t("contractIn", { days });
  return `<span class="contract ${cls}">${esc(t("contractEnd"))} ${esc(fmtDate(supplier.contractEnd))} (${esc(when)})</span>`;
}

// Prices in a line: "D25d · VT 5,12 · NT 3,40 Kč/kWh · 450 Kč/měs. · záloha 1 500 Kč".
export function priceSummary(commodity, p) {
  if (!p) return "";
  // Unit prices always to the haléř (5,40), fees in whole crowns.
  const kc = (v, digits = 2) => `${new Intl.NumberFormat(lang === "cs" ? "cs-CZ" : "en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)} Kč`;
  const parts = [];
  if (commodity === "electricity") {
    if (p.tariff) parts.push(p.tariff);
    if (p.breaker) parts.push(p.breaker);
    if (p.unit != null) parts.push(p.unitNt != null ? `${t("short.el-vt")} ${kc(p.unit)} · ${t("short.el-nt")} ${kc(p.unitNt)}/kWh` : `${kc(p.unit)}/kWh`);
  } else if (commodity === "gas") {
    if (p.unit != null) parts.push(`${kc(p.unit)}/kWh`);
  } else {
    if (p.unit != null) parts.push(`${t("waterCharge")} ${kc(p.unit)}`);
    if (p.unitSewer != null) parts.push(`${t("sewerCharge")} ${kc(p.unitSewer)}`);
    if (p.unit != null || p.unitSewer != null) parts[parts.length - 1] += "/m³";
  }
  if (p.monthly != null) parts.push(`${kc(p.monthly, 0)}${t("perMonthShort")}`);
  if (p.advance != null) parts.push(`${t("advance").toLowerCase()} ${kc(p.advance, 0)}${t(`per.${p.advancePeriod ?? "month"}`)}`);
  return parts.join(" · ");
}

const pointLabel = (commodity) => t(commodity === "gas" ? "pointGas" : "pointElectricity");

const options = (values, selected, label = (v) => v) =>
  values.map((v) => `<option value="${v}" ${String(v) === String(selected) ? "selected" : ""}>${esc(label(v))}</option>`).join("");
const pad = (n) => String(n).padStart(2, "0");
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const monthsLong = (v) => t("monthsLong")[Number(v) - 1];
const thisYear = () => Number(currentMonth().slice(0, 4));

const fromSelects = (from) => `
  <div class="two-cols">
    <select name="fromMonth" aria-label="${esc(t("month"))}">${options(range(1, 12).map(pad), from.slice(5), monthsLong)}</select>
    <select name="fromYear" aria-label="${esc(t("year"))}">${options(range(thisYear() - 25, thisYear() + 1).reverse(), from.slice(0, 4))}</select>
  </div>`;

// A date as day, month and year selects named <prefix>Day/Month/Year; with optional the empty choice too.
const dateSelects = (prefix, date, { optional = false, years }) => {
  const [y, m, d] = date ? date.split("-") : ["", "", ""];
  const empty = optional ? '<option value="">–</option>' : "";
  return `
  <div class="three-cols">
    <select name="${prefix}Day" aria-label="${esc(t("day"))}">${empty}${options(range(1, 31).map(pad), d)}</select>
    <select name="${prefix}Month" aria-label="${esc(t("month"))}">${empty}${options(range(1, 12).map(pad), m, monthsLong)}</select>
    <select name="${prefix}Year" aria-label="${esc(t("year"))}">${empty}${options(years, y)}</select>
  </div>`;
};

// The date picked in such selects: "" when all are empty, null when only some are or it does not exist (31 February).
function readDate(data, prefix) {
  const [d, m, y] = ["Day", "Month", "Year"].map((k) => data.get(prefix + k) ?? "");
  if (!d && !m && !y) return "";
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (!d || !m || !y || date.getDate() !== Number(d)) return null;
  return `${y}-${m}-${d}`;
}

// "1. 10. 2024 – 31. 12. 2026 · fixed price" or "since 1. 10. 2024 · no fixed price" (water: just the start).
export function contractPeriod(s) {
  const start = fmtDate(s.start ?? `${s.from}-01`);
  if (s.commodity === "water") return `${t("since")} ${start}`;
  return s.contractEnd ? `${start} – ${fmtDate(s.contractEnd)} · ${t("withFixation")}` : `${t("since")} ${start} · ${t("noFixation")}`;
}

// ---- Price list of a supplier ----

const numberField = (name, label, value, unit) => `
  <div class="price-field">
    <label class="field" for="pr-${name}">${esc(label)}</label>
    <div class="meter-input"><input type="text" inputmode="decimal" id="pr-${name}" name="${name}" value="${value == null ? "" : esc(String(value).replace(".", ","))}" /><span class="unit">${esc(unit)}</span></div>
  </div>`;

function priceFormHtml(supplier, p) {
  const c = supplier.commodity;
  const from = p?.from ?? (pricesOf(getState(), supplier.id).length ? currentMonth() : supplier.from);
  // A new period starts from the previous one's values: usually only some of them change.
  const last = p ?? pricesOf(getState(), supplier.id).at(-1) ?? null;
  const tariff = last?.tariff ?? "";
  const fields =
    c === "electricity"
      ? `
      <label class="field" for="pr-tariff">${esc(t("tariff"))}</label>
      <select id="pr-tariff" name="tariff"><option value="">–</option>${TARIFFS.map((x) => `<option value="${x.id}" ${x.id === tariff ? "selected" : ""}>${x.id} – ${esc(t(`tariff.${x.id}`))}</option>`).join("")}</select>
      <label class="field" for="pr-breaker">${esc(t("breaker"))}</label>
      <select id="pr-breaker" name="breaker"><option value="">–</option>${BREAKERS.map((x) => `<option value="${x}" ${x === (last?.breaker ?? "") ? "selected" : ""}>${x}</option>`).join("")}</select>
      <p class="warn" id="pr-nt-warn" hidden>${esc(t("tariffNtWarning"))}</p>
      ${numberField("unit", t("priceVt"), last?.unit, "Kč/kWh")}
      <div data-nt>${numberField("unitNt", t("priceNt"), last?.unitNt, "Kč/kWh")}</div>`
      : c === "gas"
        ? numberField("unit", t("priceGas"), last?.unit, "Kč/kWh")
        : `${numberField("unit", t("waterCharge"), last?.unit, "Kč/m³")}${numberField("unitSewer", t("sewerCharge"), last?.unitSewer, "Kč/m³")}`;
  return `
    <form class="price-form" id="price-form" novalidate>
      <h4 class="price-title">${esc(p ? t("priceEdit") : t("priceAdd"))}</h4>
      <label class="field">${esc(t("priceFrom"))}</label>
      ${fromSelects(from)}
      ${fields}
      ${numberField("monthly", t("priceMonthly"), last?.monthly, t("kcPerMonth"))}
      ${numberField("advance", t("advance"), last?.advance, c === "water" ? "Kč" : t("kcPerMonth"))}
      ${
        c === "water"
          ? `<label class="field" for="pr-advancePeriod">${esc(t("advancePeriod"))}</label>
      <select id="pr-advancePeriod" name="advancePeriod">${Object.keys(ADVANCE_PERIODS).map((k) => `<option value="${k}" ${k === (last?.advancePeriod ?? "month") ? "selected" : ""}>${esc(t(`period.${k}`))}</option>`).join("")}</select>`
          : ""
      }
      <p class="hint">${esc(t(c === "water" ? "priceHintWater" : "priceHint"))}</p>
      <p class="warn" id="pr-error" hidden></p>
      <div class="form-actions">
        ${p ? deleteButton("pr-delete") : ""}
        <button type="button" class="btn" id="pr-cancel">${esc(t("cancel"))}</button>
        <button type="submit" class="btn primary">${esc(t("save"))}</button>
      </div>
    </form>`;
}

function pricesHtml(supplier) {
  const list = pricesOf(getState(), supplier.id).reverse();
  const editingHere = editingPrice?.supplierId === supplier.id;
  const rows = list
    .map(
      (p) => `
      <div class="price-row">
        <div><strong>${esc(t("since"))} ${esc(fmtMonth(p.from))}</strong><div class="hint">${esc(priceSummary(supplier.commodity, p) || t("priceEmpty"))}</div></div>
        <button type="button" class="mp-link" data-edit-price="${esc(p.id)}">${esc(t("edit"))}</button>
      </div>`,
    )
    .join("");
  return `
    <div class="price-list">
      ${rows || `<p class="hint">${esc(t("pricesNone"))}</p>`}
      ${editingHere ? priceFormHtml(supplier, editingPrice.id ? getState().prices[editingPrice.id] : null) : `<button type="button" class="btn small" data-add-price="${esc(supplier.id)}">+ ${esc(t("priceAdd"))}</button>`}
    </div>`;
}

// ---- Suppliers ----

function itemHtml(s) {
  const state = getState();
  const current = supplierAt(state, s.commodity, currentMonth())?.id === s.id;
  const details = [s.product, contractPeriod(s)].filter(Boolean).map(esc).join(" · ");
  const prices = pricesOf(state, s.id);
  const latest = prices.filter((p) => p.from <= currentMonth()).at(-1) ?? prices.at(-1);
  const open = pricesOpen === s.id;
  return `
    <div class="supplier-item">
      <div class="supplier-main">
        <strong>${esc(s.name)}</strong>
        <div class="hint">${details}</div>
        ${contractHtml(s, { current })}
        ${latest ? `<div class="price-now">${esc(priceSummary(s.commodity, latest))}</div>` : ""}
        <button type="button" class="link-btn" data-toggle-prices="${esc(s.id)}" aria-expanded="${open}">${esc(t("priceList"))} (${prices.length}) ${open ? "▴" : "▾"}</button>
        ${open ? pricesHtml(s) : ""}
      </div>
      <button type="button" class="mp-link" data-edit-supplier="${esc(s.id)}" data-commodity-of="${s.commodity}">${esc(t("edit"))}</button>
    </div>`;
}

function formHtml(commodity, s) {
  const today = new Date();
  const start = s?.start ?? `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  // A name typed for another commodity is offered here too: often the same company supplies more.
  const names = [...new Set(SUPPLIED.flatMap((c) => suppliersOf(getState(), c)).map((x) => x.name))];
  // Water has no product, fixed price or supply point code to keep.
  const energy = commodity !== "water";
  return `
    <form class="supplier-form" id="supplier-form" novalidate>
      <h3 class="bulk-sub">${esc(s ? t("supplierEdit") : t("supplierAdd"))}</h3>
      <label class="field" for="sup-name">${esc(t("supplierName"))}</label>
      <input type="text" id="sup-name" name="name" list="sup-names" autocomplete="off" value="${esc(s?.name ?? "")}" />
      <datalist id="sup-names">${names.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
      <label class="field">${esc(t("contractStart"))}</label>
      ${dateSelects("start", start, { years: range(thisYear() - 25, thisYear() + 1).reverse() })}
      ${
        energy
          ? `
      <label class="field" for="sup-product">${esc(t("supplierProduct"))}</label>
      <input type="text" id="sup-product" name="product" value="${esc(s?.product ?? "")}" />
      <label class="field">${esc(t("contractEndOptional"))}</label>
      ${dateSelects("end", s?.contractEnd, { optional: true, years: range(thisYear() - 10, thisYear() + 6) })}
      <p class="hint">${esc(t("contractEndHint"))}</p>
      <label class="field" for="sup-remind">${esc(t("remindBefore"))}</label>
      <select id="sup-remind" name="remindMonths">${REMIND_MONTHS.map((n) => `<option value="${n}" ${n === (s?.remindMonths ?? DEFAULT_REMIND_MONTHS) ? "selected" : ""}>${esc(t(n === 1 ? "remindMonth" : n < 5 ? "remindMonthsFew" : "remindMonthsMany", { n }))}</option>`).join("")}</select>
      <label class="field" for="sup-point">${esc(pointLabel(commodity))}</label>
      <input type="text" id="sup-point" name="point" autocomplete="off" ${commodity === "gas" ? 'autocapitalize="characters"' : 'inputmode="numeric"'} value="${esc(s?.point ?? "")}" />`
          : ""
      }
      <label class="field" for="sup-customer">${esc(t("customerNo"))}</label>
      <input type="text" id="sup-customer" name="customerNo" autocomplete="off" value="${esc(s?.customerNo ?? "")}" />
      <label class="field" for="sup-note">${esc(t("note"))}</label>
      <textarea id="sup-note" name="note" rows="3">${esc(s?.note ?? "")}</textarea>
      <p class="warn" id="sup-error" hidden></p>
      <div class="form-actions">
        ${s ? deleteButton("sup-delete") : ""}
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

const errorShower = (form, id) => {
  const error = form.querySelector(id);
  error.hidden = true;
  return (key) => {
    error.textContent = t(key);
    error.hidden = false;
  };
};

function bindPriceForm(root, rerender) {
  const form = root.querySelector("#price-form");
  if (!form) return;
  const supplier = getState().suppliers[editingPrice.supplierId];
  // The low-tariff price only with a two-tariff rate; a reminder when the LT meter is off.
  const tariffSelect = form.querySelector("#pr-tariff");
  const syncTariff = () => {
    if (!tariffSelect) return;
    const two = isTwoTariff(tariffSelect.value);
    form.querySelector("[data-nt]").hidden = !two;
    form.querySelector("#pr-nt-warn").hidden = !(two && !getState().config.active["el-nt"]);
  };
  syncTariff();
  tariffSelect?.addEventListener("change", syncTariff);
  form.querySelector("#pr-cancel").addEventListener("click", () => {
    editingPrice = null;
    rerender();
  });
  form.querySelector("#pr-delete")?.addEventListener("click", () => {
    if (!confirm(t("priceDeleteConfirm"))) return;
    const id = editingPrice.id;
    editingPrice = null;
    update((state) => deletePrice(state, id));
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const show = errorShower(form, "#pr-error");
    const num = (name) => (data.has(name) ? parseNumber(data.get(name)) : null);
    const values = { unit: num("unit"), unitNt: num("unitNt"), unitSewer: num("unitSewer"), monthly: num("monthly"), advance: num("advance") };
    if (Object.values(values).some((v) => Number.isNaN(v) || v < 0)) return show("priceInvalid");
    const fields = {
      id: editingPrice.id ?? undefined,
      supplierId: supplier.id,
      from: `${data.get("fromYear")}-${data.get("fromMonth")}`,
      tariff: data.get("tariff") ?? "",
      breaker: data.get("breaker") ?? "",
      advancePeriod: data.get("advancePeriod") ?? "month",
      ...values,
    };
    editingPrice = null;
    update((state) => setPrice(state, fields));
    toast(t("saved"));
  });
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
  section.querySelectorAll("[data-toggle-prices]").forEach((b) =>
    b.addEventListener("click", () => {
      pricesOpen = pricesOpen === b.dataset.togglePrices ? null : b.dataset.togglePrices;
      editingPrice = null;
      rerender();
    }),
  );
  section.querySelectorAll("[data-add-price]").forEach((b) =>
    b.addEventListener("click", () => {
      editingPrice = { supplierId: b.dataset.addPrice, id: null };
      rerender();
    }),
  );
  section.querySelectorAll("[data-edit-price]").forEach((b) =>
    b.addEventListener("click", () => {
      editingPrice = { supplierId: pricesOpen, id: b.dataset.editPrice };
      rerender();
    }),
  );
  bindPriceForm(root, rerender);

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
    const show = errorShower(form, "#sup-error");
    if (!String(data.get("name")).trim()) return show("supplierInvalid");
    // The start is required; the end (a fixed price) is all three parts or none, a real date, not before the start.
    const start = readDate(data, "start");
    if (!start) return show("contractStartInvalid");
    const contractEnd = readDate(data, "end") ?? null;
    if (contractEnd === null) return show("contractInvalid");
    if (contractEnd && contractEnd < start) return show("contractBeforeStart");
    const fields = {
      id: editing.id ?? undefined,
      commodity: editing.commodity,
      name: data.get("name"),
      start,
      remindMonths: Number(data.get("remindMonths") ?? DEFAULT_REMIND_MONTHS),
      product: data.get("product") ?? "",
      contractEnd,
      point: data.get("point") ?? "",
      customerNo: data.get("customerNo"),
      note: data.get("note"),
    };
    editing = null;
    update((state) => setSupplier(state, fields));
    toast(t("saved"));
  });
}
