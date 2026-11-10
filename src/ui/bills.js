import { advanceBalance, billingPeriodOf } from "../costs.js";
import { billsOf, deleteBill, monthAdd, setBill } from "../data.js";
import { fmt, t, cur } from "../i18n.js";
import { getState, update } from "../store.js";
import { esc, infoTip, parseNumber, toast } from "./dom.js";
import { currentMonth } from "./month-picker.js";

// Bills as the supplier issued them, each beside what the app works out for the same months, so it shows whether
// the app's costs and estimates match reality. editing: null, or { commodity, id } (id null for a new bill).
let editing = null;

const kc = (v) => `${fmt(v, 0)} ${cur()}`;
const signed = (v) => `${v >= 0 ? "+" : "−"}${kc(Math.abs(v))}`;
const pad = (n) => String(n).padStart(2, "0");
const label = ({ from, to }) => `${Number(from.slice(5))}/${from.slice(0, 4)} – ${Number(to.slice(5))}/${to.slice(0, 4)}`;

// The last billing period that has ended: what a new bill most likely covers.
function lastPeriod(state, commodity) {
  const now = currentMonth();
  let p = billingPeriodOf(state, commodity, monthAdd(now, -1));
  if (p.to >= now) p = billingPeriodOf(state, commodity, monthAdd(p.from, -1));
  return p;
}

const monthSelects = (prefix, month) => {
  const year = Number(currentMonth().slice(0, 4));
  const opts = (values, selected, name = (v) => v) => values.map((v) => `<option value="${v}" ${String(v) === String(selected) ? "selected" : ""}>${esc(name(v))}</option>`).join("");
  return `<div class="two-cols">
    <select name="${prefix}Month" aria-label="${esc(t("month"))}">${opts(Array.from({ length: 12 }, (_, i) => pad(i + 1)), month.slice(5), (v) => t("monthsLong")[Number(v) - 1])}</select>
    <select name="${prefix}Year" aria-label="${esc(t("year"))}">${opts(Array.from({ length: 15 }, (_, i) => year + 1 - i), month.slice(0, 4))}</select>
  </div>`;
};

function formHtml(state, commodity, b) {
  const period = b ?? lastPeriod(state, commodity);
  const value = (v) => (v == null ? "" : esc(String(Math.abs(v)).replace(".", ",")));
  return `
    <form class="price-form" id="bill-form" novalidate>
      <h4 class="price-title">${esc(t(b ? "billEdit" : "billAdd"))}</h4>
      <label class="field">${esc(t("billFrom"))}</label>
      ${monthSelects("from", period.from)}
      <label class="field">${esc(t("billTo"))}</label>
      ${monthSelects("to", period.to)}
      <div class="price-field">
        <label class="field" for="bill-cost">${esc(t("billCost"))}</label>
        <div class="meter-input"><input type="text" inputmode="decimal" id="bill-cost" name="cost" value="${value(b?.cost)}" /><span class="unit">${cur()}</span></div>
      </div>
      <label class="field" for="bill-balance">${esc(t("billResult"))}</label>
      <div class="two-cols">
        <select name="sign" aria-label="${esc(t("billResult"))}">
          <option value="1" ${b?.balance == null || b.balance >= 0 ? "selected" : ""}>${esc(t("billOver"))}</option>
          <option value="-1" ${b?.balance < 0 ? "selected" : ""}>${esc(t("billUnder"))}</option>
        </select>
        <div class="meter-input"><input type="text" inputmode="decimal" id="bill-balance" name="balance" value="${value(b?.balance)}" /><span class="unit">${cur()}</span></div>
      </div>
      <label class="field" for="bill-note">${esc(t("note"))}</label>
      <input type="text" id="bill-note" name="note" autocomplete="off" value="${esc(b?.note ?? "")}" />
      <p class="warn" id="bill-error" hidden></p>
      <div class="form-actions">
        ${b ? `<button type="button" class="btn danger" id="bill-delete">${esc(t("delete"))}</button>` : ""}
        <button type="button" class="btn" id="bill-cancel">${esc(t("cancel"))}</button>
        <button type="submit" class="btn primary">${esc(t("save"))}</button>
      </div>
    </form>`;
}

export function billsHtml(state, commodity) {
  const list = billsOf(state, commodity);
  const open = editing?.commodity === commodity;
  const rows = list
    .map((b) => {
      const app = advanceBalance(state, commodity, { from: b.from, to: b.to });
      const actual = [b.cost != null && `${t("billCostShort")} ${kc(b.cost)}`, b.balance != null && `<span class="${b.balance >= 0 ? "down" : "up"}">${esc(t(b.balance >= 0 ? "billOver" : "billUnder"))} ${signed(b.balance)}</span>`].filter(Boolean);
      // The app's own numbers for the same months, when it has costs for them.
      let check = "";
      if (app.months) {
        const parts = [`${t("billCostShort")} ${kc(app.cost)}`];
        if (app.paid) parts.push(`${t(app.balance >= 0 ? "billOver" : "billUnder")} ${signed(app.balance)}`);
        const diff = b.cost ? app.cost / b.cost - 1 : null;
        const months = (b.to.slice(0, 4) - b.from.slice(0, 4)) * 12 + (b.to.slice(5) - b.from.slice(5)) + 1;
        const partial = app.months < months ? ` (${t("billMonthsOf", { months: app.months, of: months })})` : "";
        check = `<div class="hint">${esc(t("billApp"))}: ${esc(parts.join(" · "))}${esc(partial)}${diff != null && app.months === months ? ` · <strong class="${Math.abs(diff) <= 0.05 ? "down" : "up"}">${esc(t(Math.abs(diff) <= 0.05 ? "billMatches" : "billOff", { pct: fmt(Math.abs(diff) * 100, 0) }))}</strong>` : ""}</div>`;
      }
      return `
      <div class="offer-row">
        <div class="offer-main"><strong>${esc(label(b))}</strong><div>${actual.join(" · ")}</div>${check}${b.note ? `<div class="hint">${esc(b.note)}</div>` : ""}</div>
        <span></span>
        <button type="button" class="mp-link" data-edit-bill="${esc(b.id)}">${esc(t("edit"))}</button>
      </div>`;
    })
    .join("");
  return `
    <section class="card" id="bills">
      <h2 class="with-tip">${esc(t("billsTitle"))}${infoTip(t("billsHint"))}</h2>
      ${rows}
      ${open ? formHtml(state, commodity, editing.id ? state.bills[editing.id] : null) : `<button type="button" class="btn small" data-add-bill="${commodity}">+ ${esc(t("billAdd"))}</button>`}
    </section>`;
}

export function bindBills(root, rerender) {
  const section = root.querySelector("#bills");
  if (!section) return;
  const open = (value) => {
    editing = value;
    rerender();
    root.querySelector("#bill-form")?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  section.querySelector("[data-add-bill]")?.addEventListener("click", (e) => open({ commodity: e.currentTarget.dataset.addBill, id: null }));
  section.querySelectorAll("[data-edit-bill]").forEach((b) =>
    b.addEventListener("click", () => {
      const bill = getState().bills[b.dataset.editBill];
      open({ commodity: bill.commodity, id: bill.id });
    }),
  );
  const form = section.querySelector("#bill-form");
  if (!form) return;
  form.querySelector("#bill-cancel").addEventListener("click", () => {
    editing = null;
    rerender();
  });
  form.querySelector("#bill-delete")?.addEventListener("click", () => {
    if (!confirm(t("billDeleteConfirm"))) return;
    const id = editing.id;
    editing = null;
    update((s) => deleteBill(s, id));
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const error = form.querySelector("#bill-error");
    const show = (key) => {
      error.textContent = t(key);
      error.hidden = false;
    };
    const from = `${data.get("fromYear")}-${data.get("fromMonth")}`;
    const to = `${data.get("toYear")}-${data.get("toMonth")}`;
    if (from > to) return show("billBadPeriod");
    const cost = parseNumber(data.get("cost"));
    const amount = parseNumber(data.get("balance"));
    if ([cost, amount].some((v) => Number.isNaN(v) || v < 0)) return show("priceInvalid");
    if (cost == null && amount == null) return show("billNeedsAmount");
    const fields = { id: editing.id ?? undefined, commodity: editing.commodity, from, to, cost, balance: amount == null ? null : amount * Number(data.get("sign")), note: data.get("note") };
    editing = null;
    update((s) => setBill(s, fields));
    toast(t("saved"));
  });
}
