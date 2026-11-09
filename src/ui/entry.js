import { METERS, deleteReading, monthAdd, readingAt, readingBefore, readingsOf, setReading, usedBetween } from "../data.js";
import { fmt, fmtMonth, t, unitLabel } from "../i18n.js";
import { getState, update } from "../store.js";
import { bindBulk, bulkEnabled, bulkHtml } from "./bulk.js";
import { bindMonthPicker, monthPickerHtml } from "./month-picker.js";
import { cssVar, esc, parseNumber, toast } from "./dom.js";

const colorVar = { "el-vt": "--electricity", "el-nt": "--electricity-2", gas: "--gas", water: "--water" };

// Read early in a month, the reading is the state at the end of the month before.
const defaultMonth = () => {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return now.getDate() <= 10 ? monthAdd(month, -1) : month;
};

let month = defaultMonth();

const activeMeters = (state) => METERS.filter((m) => state.config.active[m.id]);

function meterCard(state, meter) {
  const current = readingAt(state, meter.id, month);
  const prev = readingBefore(state, meter.id, month);
  const unit = unitLabel(meter.unit);
  const swapped = current?.oldFinal != null;
  return `
    <section class="card" data-meter="${meter.id}">
      <div class="meter-head"><span class="dot" style="background:${cssVar(colorVar[meter.id])}"></span>${esc(t(`meter.${meter.id}`))}</div>
      <label class="field" for="v-${meter.id}">${esc(prev ? t("previous", { value: `${fmt(prev.value, 3)} ${unit}`, month: fmtMonth(prev.month) }) : t("noPrevious"))}</label>
      <div class="meter-input">
        <input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" id="v-${meter.id}" name="value" value="${current ? esc(current.value) : ""}" />
        <span class="unit">${unit}</span>
      </div>
      <p class="hint used"></p>
      <p class="warn" hidden>${esc(t("lowerWarning"))}</p>
      <label class="check"><input type="checkbox" name="swap" ${swapped ? "checked" : ""} />${esc(t("swap"))}</label>
      <div class="swap-fields" ${swapped ? "" : "hidden"}>
        <div><label class="field">${esc(t("oldFinal"))}</label><input type="text" inputmode="decimal" name="oldFinal" value="${swapped ? esc(current.oldFinal) : ""}" /></div>
        <div><label class="field">${esc(t("newStart"))}</label><input type="text" inputmode="decimal" name="newStart" value="${swapped ? esc(current.newStart) : "0"}" /></div>
      </div>
    </section>`;
}

// What a card holds, as a reading (value null when empty).
function cardReading(card) {
  const get = (name) => parseNumber(card.querySelector(`[name="${name}"]`).value);
  const swap = card.querySelector('[name="swap"]').checked;
  return { meter: card.dataset.meter, month, value: get("value"), ...(swap ? { oldFinal: get("oldFinal"), newStart: get("newStart") ?? 0 } : {}) };
}

function refreshCard(card) {
  const state = getState();
  const meter = METERS.find((m) => m.id === card.dataset.meter);
  const reading = cardReading(card);
  const prev = readingBefore(state, meter.id, month);
  card.querySelector(".swap-fields").hidden = !card.querySelector('[name="swap"]').checked;
  const used = prev && Number.isFinite(reading.value) && (reading.oldFinal == null || Number.isFinite(reading.oldFinal)) ? usedBetween(prev, reading) : null;
  card.querySelector(".used").textContent = used == null ? "" : t("usedSince", { value: `${fmt(used, 3)} ${unitLabel(meter.unit)}` });
  card.querySelector(".warn").hidden = !(used != null && used < 0);
}

function historyHtml(state) {
  const meters = activeMeters(state);
  const months = [...new Set(meters.flatMap((m) => readingsOf(state, m.id).map((r) => r.month)))].sort().reverse().slice(0, 3);
  if (!months.length) return "";
  const rows = months
    .map((m) => {
      const values = meters
        .map((meter) => readingAt(state, meter.id, m))
        .map((r, i) => (r ? `${esc(t(`meter.${meters[i].id}`))}: ${fmt(r.value, 3)}` : null))
        .filter(Boolean)
        .join(" · ");
      return `<div class="history-row"><div><strong>${esc(fmtMonth(m))}</strong><div class="history-values">${values}</div></div><button type="button" data-month="${m}">${m === month ? "✓" : "›"}</button></div>`;
    })
    .join("");
  return `<section class="card"><h2>${esc(t("history"))}</h2>${rows}</section>`;
}

export function renderEntry(view) {
  const state = getState();
  const meters = activeMeters(state);
  const hasAny = meters.some((m) => readingAt(state, m.id, month));
  // Months with any reading of an active meter, marked in the picker.
  const marked = new Set(meters.flatMap((m) => readingsOf(state, m.id).map((r) => r.month)));
  view.innerHTML = `
    <form id="entry-form" novalidate>
      <section class="card">
        <span class="field">${esc(t("month"))}</span>
        ${monthPickerHtml(month, marked)}
        <p class="hint">${esc(t("entryHint"))}</p>
      </section>
      ${meters.map((m) => meterCard(state, m)).join("")}
      <div class="form-actions">
        ${hasAny ? `<button class="btn danger icon-btn" type="button" id="delete-month" title="${esc(t("delete"))} ${esc(fmtMonth(month))}" aria-label="${esc(t("delete"))} ${esc(fmtMonth(month))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button>` : ""}
        <button class="btn primary" type="submit">${esc(t("save"))} ${esc(fmtMonth(month))}</button>
      </div>
    </form>
    ${bulkEnabled() ? bulkHtml() : ""}
    ${historyHtml(state)}`;

  if (bulkEnabled()) bindBulk(view);
  const form = view.querySelector("#entry-form");
  form.querySelectorAll("[data-meter]").forEach(refreshCard);
  form.addEventListener("input", (event) => {
    const card = event.target.closest("[data-meter]");
    if (card) refreshCard(card);
  });
  bindMonthPicker(form, month, marked, (next) => {
    month = next;
    renderEntry(view);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    document.activeElement?.blur();
    const readings = [...form.querySelectorAll("[data-meter]")].map(cardReading).filter((r) => r.value != null);
    if (!readings.length) return toast(t("nothingToSave"));
    if (readings.some((r) => Number.isNaN(r.value) || Number.isNaN(r.oldFinal) || Number.isNaN(r.newStart))) return;
    update((s) => readings.reduce((acc, r) => setReading(acc, r), s));
    toast(t("saved"));
  });
  form.querySelector("#delete-month")?.addEventListener("click", () => {
    const label = meters.filter((m) => readingAt(getState(), m.id, month)).map((m) => t(`meter.${m.id}`)).join(", ");
    if (!confirm(t("deleteConfirm", { meter: label, month: fmtMonth(month) }))) return;
    update((s) => meters.reduce((acc, m) => (readingAt(acc, m.id, month) ? deleteReading(acc, m.id, month) : acc), s));
  });
  view.querySelectorAll("[data-month]").forEach((button) =>
    button.addEventListener("click", () => {
      month = button.dataset.month;
      renderEntry(view);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }),
  );
}
