import { compareOffers } from "../costs.js";
import { TARIFFS, deleteOffer, isTwoTariff, setOffer } from "../data.js";
import { fmt, t, cur } from "../i18n.js";
import { getState, update } from "../store.js";
import { esc, infoTip, parseNumber, toast } from "./dom.js";
import { currentMonth } from "./month-picker.js";

// Offers from other suppliers, priced on the last twelve months of consumption beside the current price list.
// editing: null, or { commodity, id } (id null for a new offer).
let editing = null;

const kc = (v) => `${fmt(v, 0)} ${cur()}`;

const field = (name, label, value, unit) => `
  <div class="price-field">
    <label class="field" for="of-${name}">${esc(label)}</label>
    <div class="meter-input"><input type="text" inputmode="decimal" id="of-${name}" name="${name}" value="${value == null ? "" : esc(String(value).replace(".", ","))}" /><span class="unit">${esc(unit)}</span></div>
  </div>`;

function formHtml(commodity, o) {
  const tariff = o?.tariff ?? "";
  return `
    <form class="price-form" id="offer-form" novalidate>
      <h4 class="price-title">${esc(o ? t("offerEdit") : t("offerAdd"))}</h4>
      <label class="field" for="of-name">${esc(t("offerName"))}</label>
      <input type="text" id="of-name" name="name" autocomplete="off" value="${esc(o?.name ?? "")}" />
      ${
        commodity === "electricity"
          ? `<label class="field" for="of-tariff">${esc(t("tariff"))}</label>
      <select id="of-tariff" name="tariff"><option value="">–</option>${TARIFFS.map((x) => `<option value="${x.id}" ${x.id === tariff ? "selected" : ""}>${x.id} – ${esc(t(`tariff.${x.id}`))}</option>`).join("")}</select>
      ${field("unit", t("priceVt"), o?.unit, `${cur()}/kWh`)}
      <div data-offer-nt>${field("unitNt", t("priceNt"), o?.unitNt, `${cur()}/kWh`)}</div>`
          : field("unit", t("priceGas"), o?.unit, `${cur()}/kWh`)
      }
      ${field("monthly", t("priceMonthly"), o?.monthly, t("kcPerMonth"))}
      <label class="field" for="of-note">${esc(t("note"))}</label>
      <input type="text" id="of-note" name="note" autocomplete="off" value="${esc(o?.note ?? "")}" />
      <p class="warn" id="of-error" hidden></p>
      <div class="form-actions">
        ${o ? `<button type="button" class="btn danger" id="of-delete">${esc(t("delete"))}</button>` : ""}
        <button type="button" class="btn" id="of-cancel">${esc(t("cancel"))}</button>
        <button type="submit" class="btn primary">${esc(t("save"))}</button>
      </div>
    </form>`;
}

export function offersHtml(commodity) {
  if (!["electricity", "gas"].includes(commodity)) return "";
  const state = getState();
  const r = compareOffers(state, commodity, currentMonth());
  const open = editing?.commodity === commodity;
  const unit = "kWh";
  const rows = r.offers
    .map(({ offer, cost, diff }) => {
      const diffHtml = diff == null ? "" : `<span class="${diff < 0 ? "down" : "up"}">${diff < 0 ? "−" : "+"}${kc(Math.abs(diff))}</span>`;
      return `
      <div class="offer-row">
        <div class="offer-main"><strong>${esc(offer.name)}</strong><div class="hint">${esc([offer.tariff, offer.note].filter(Boolean).join(" · "))}</div></div>
        <div class="offer-cost"><div>${cost == null ? "–" : kc(cost)}</div><small>${diffHtml}</small></div>
        <button type="button" class="mp-link" data-edit-offer="${esc(offer.id)}">${esc(t("edit"))}</button>
      </div>`;
    })
    .join("");
  const current = r.current
    ? `<div class="offer-row is-current"><div class="offer-main"><strong>${esc(t("offerCurrent"))}</strong><div class="hint">${esc(r.current.price.tariff || "")}</div></div><div class="offer-cost"><div>${kc(r.current.cost)}</div></div><span></span></div>`
    : `<p class="hint">${esc(t("offerNoCurrent"))}</p>`;
  return `
    <section class="card" id="offers">
      <h2 class="with-tip">${esc(t("offersTitle"))}${r.months ? infoTip(t("offersHint", { months: r.months, usage: fmt(r.usage, 0), unit })) : ""}</h2>
      ${r.months ? "" : `<p class="hint">${esc(t("offersNoData"))}</p>`}
      ${r.months ? current + rows : ""}
      ${open ? formHtml(commodity, editing.id ? state.offers[editing.id] : null) : `<button type="button" class="btn small" data-add-offer="${commodity}">+ ${esc(t("offerAdd"))}</button>`}
    </section>`;
}

export function bindOffers(root, rerender) {
  const section = root.querySelector("#offers");
  if (!section) return;
  section.querySelector("[data-add-offer]")?.addEventListener("click", (e) => {
    editing = { commodity: e.currentTarget.dataset.addOffer, id: null };
    rerender();
    root.querySelector("#of-name")?.focus();
  });
  section.querySelectorAll("[data-edit-offer]").forEach((b) =>
    b.addEventListener("click", () => {
      const o = getState().offers[b.dataset.editOffer];
      editing = { commodity: o.commodity, id: o.id };
      rerender();
      root.querySelector("#offer-form")?.scrollIntoView({ block: "center", behavior: "smooth" });
    }),
  );
  const form = section.querySelector("#offer-form");
  if (!form) return;
  const tariff = form.querySelector("#of-tariff");
  const syncNt = () => {
    if (tariff) form.querySelector("[data-offer-nt]").hidden = !isTwoTariff(tariff.value);
  };
  syncNt();
  tariff?.addEventListener("change", syncNt);
  form.querySelector("#of-cancel").addEventListener("click", () => {
    editing = null;
    rerender();
  });
  form.querySelector("#of-delete")?.addEventListener("click", () => {
    if (!confirm(t("offerDeleteConfirm"))) return;
    const id = editing.id;
    editing = null;
    update((s) => deleteOffer(s, id));
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const error = form.querySelector("#of-error");
    const show = (key) => {
      error.textContent = t(key);
      error.hidden = false;
    };
    if (!String(data.get("name")).trim()) return show("offerInvalid");
    const num = (n) => (data.has(n) ? parseNumber(data.get(n)) : null);
    const values = { unit: num("unit"), unitNt: num("unitNt"), monthly: num("monthly") };
    if (Object.values(values).some((v) => Number.isNaN(v) || v < 0)) return show("priceInvalid");
    if (values.unit == null) return show("offerNeedsPrice");
    const fields = { id: editing.id ?? undefined, commodity: editing.commodity, name: data.get("name"), tariff: data.get("tariff") ?? "", note: data.get("note"), ...values };
    editing = null;
    update((s) => setOffer(s, fields));
    toast(t("saved"));
  });
}
