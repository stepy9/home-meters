import { METERS, deleteReading, monthAdd, readingAt, readingBefore, readingsOf, setReading, usedBetween } from "../data.js";
import { checkReading } from "../anomalies.js";
import { fmt, fmtMonth, fmtMonthLong, t, unitLabel } from "../i18n.js";
import { getState, update } from "../store.js";
import { bindBulk, bulkEnabled, bulkHtml } from "./bulk.js";
import { bindMonthPicker, monthPickerHtml } from "./month-picker.js";
import { cssVar, esc, parseNumber, toast } from "./dom.js";
import { commodityIcon } from "./icons.js";
import { noticesHtml } from "./notices.js";

const colorVar = { "el-vt": "--electricity", "el-nt": "--electricity-2", gas: "--gas", water: "--water" };

// Read early in a month, the reading is the state at the end of the month before.
const defaultMonth = () => {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return now.getDate() <= 10 ? monthAdd(month, -1) : month;
};

let month = defaultMonth();
// Opening the entry for a given month (from the missing-reading reminder).
export const setEntryMonth = (next) => (month = next);

const activeMeters = (state) => METERS.filter((m) => state.config.active[m.id]);

function meterCard(state, meter) {
  const current = readingAt(state, meter.id, month);
  const prev = readingBefore(state, meter.id, month);
  const unit = unitLabel(meter.unit);
  const swapped = current?.oldFinal != null;
  return `
    <section class="card" data-meter="${meter.id}">
      <div class="meter-head"><span class="meter-icon" style="color:${cssVar(colorVar[meter.id])}">${commodityIcon(meter.commodity)}</span>${esc(t(`meter.${meter.id}`))}</div>
      <label class="field" for="v-${meter.id}">${esc(prev ? t("previous", { value: `${fmt(prev.value, 3)} ${unit}`, month: fmtMonth(prev.month) }) : t("noPrevious"))}</label>
      <div class="meter-input">
        <input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" id="v-${meter.id}" name="value" value="${current ? esc(current.value) : ""}" />
        <span class="unit">${unit}</span>
      </div>
      <p class="hint used"></p>
      <p class="warn" hidden>${esc(t("lowerWarning"))}</p>
      <p class="warn unusual" hidden></p>
      <label class="check"><input type="checkbox" name="swap" ${swapped ? "checked" : ""} />${esc(t("swap"))}</label>
      <p class="hint swap-hint" ${swapped ? "" : "hidden"}>${esc(t("swapHint"))}</p>
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
  const swap = card.querySelector('[name="swap"]').checked;
  card.querySelector(".swap-fields").hidden = !swap;
  card.querySelector(".swap-hint").hidden = !swap;
  // With a swap the top field is the new meter's state: the label says so.
  card.querySelector(".field[for]").textContent = swap ? t("swapValue") : prev ? t("previous", { value: `${fmt(prev.value, 3)} ${unitLabel(meter.unit)}`, month: fmtMonth(prev.month) }) : t("noPrevious");
  // A swap needs the old meter's final state before the use can be worked out.
  const used = prev && Number.isFinite(reading.value) && (!swap || Number.isFinite(reading.oldFinal)) ? usedBetween(prev, reading) : null;
  card.querySelector(".used").textContent = used == null ? "" : t("usedSince", { value: `${fmt(used, 3)} ${unitLabel(meter.unit)}` });
  card.querySelector(".warn").hidden = !(used != null && used < 0);
  card.dataset.invalid = (used != null && used < 0) || Number.isNaN(reading.value) || (swap && reading.value != null && !Number.isFinite(reading.oldFinal)) ? "1" : "";
  // Well above or far below the usual use: a leak, or a digit too many or missing.
  const check = used != null ? checkReading(state, reading) : null;
  const unusual = card.querySelector(".unusual");
  unusual.hidden = !check;
  if (check) unusual.textContent = t(check.kind === "high" ? "entryHigh" : "entryLow", { value: `${fmt(check.perMonth, 1)} ${unitLabel(meter.unit)}`, usual: `${fmt(check.usual, 1)} ${unitLabel(meter.unit)}` });
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
    ${noticesHtml()}
    <form id="entry-form" novalidate>
      <section class="card">
        <span class="field">${esc(t("month"))}</span>
        ${monthPickerHtml(month, marked)}
        <p class="hint">${esc(t("entryHint"))}</p>
      </section>
      ${meters.map((m) => meterCard(state, m)).join("")}
      <div class="form-actions">
        ${hasAny ? `<button class="btn danger icon-btn" type="button" id="delete-month" title="${esc(t("delete"))} ${esc(fmtMonth(month))}" aria-label="${esc(t("delete"))} ${esc(fmtMonth(month))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button>` : ""}
        <button class="btn primary" type="submit">${esc(t("save"))} ${esc(fmtMonthLong(month))}</button>
      </div>
    </form>
    ${bulkEnabled() ? bulkHtml() : ""}
    ${historyHtml(state)}`;

  if (bulkEnabled()) bindBulk(view);
  const form = view.querySelector("#entry-form");
  // Saving waits until no card holds a reading below the last one (without a swap) or a value that is not a number.
  const submit = form.querySelector('[type="submit"]');
  const refreshSubmit = () => (submit.disabled = [...form.querySelectorAll("[data-meter]")].some((c) => c.dataset.invalid));
  form.querySelectorAll("[data-meter]").forEach(refreshCard);
  refreshSubmit();
  form.addEventListener("input", (event) => {
    const card = event.target.closest("[data-meter]");
    if (card) refreshCard(card);
    refreshSubmit();
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
    if (submit.disabled || readings.some((r) => Number.isNaN(r.value) || Number.isNaN(r.oldFinal) || Number.isNaN(r.newStart))) return;
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
