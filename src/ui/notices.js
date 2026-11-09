import { daysUntil, reminderDue, supplierAt } from "../data.js";
import { fmtDate, t } from "../i18n.js";
import { getState } from "../store.js";
import { esc } from "./dom.js";
import { missingReadings } from "../reminder.js";
import { findAnomalies } from "../anomalies.js";
import { fmt, fmtMonth } from "../i18n.js";
import { commodityIcon } from "./icons.js";
import { currentMonth } from "./month-picker.js";

const pencil = '<svg class="c-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m14 6 4 4"/></svg>';

// Unusual-consumption notices hidden with ×, per commodity, month and kind, kept on this device.
const dismissedKey = "home-meters-dismissed";
const dismissed = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(dismissedKey)) ?? []);
  } catch {
    return new Set();
  }
};
export function dismissNotice(key) {
  const set = dismissed();
  set.add(key);
  try {
    localStorage.setItem(dismissedKey, JSON.stringify([...set].slice(-50)));
  } catch {}
}
const unitOf = (c) => (c === "electricity" ? "kWh" : "m³");

// After a fixed price has ended the reminder stays a while, as the price has most likely gone up since.
const AFTER_END_DAYS = 90;

// A banner for each current electricity or gas contract whose fixed price ends soon or has just ended.
export function noticesHtml() {
  const state = getState();
  const items = ["electricity", "gas"]
    .map((c) => {
      const s = supplierAt(state, c, currentMonth());
      if (!s?.contractEnd) return null;
      const days = daysUntil(s.contractEnd);
      if (!reminderDue(s) || days < -AFTER_END_DAYS) return null;
      const key = days < 0 ? "noticeEnded" : days === 0 ? "noticeToday" : "noticeSoon";
      const text = t(key, { commodity: t(c).toLowerCase(), name: s.name, date: fmtDate(s.contractEnd), days });
      return `<div class="notice ${days < 0 ? "is-past" : ""}"><span class="notice-icon" style="color:var(--${c})">${commodityIcon(c)}</span><span>${esc(text)} <a href="#settings" data-settings-section="suppliers">${esc(t("noticeAction"))}</a></span></div>`;
    })
    .filter(Boolean);
  // Consumption well above the usual, or below zero (a reading typed wrong).
  const hidden = dismissed();
  for (const a of findAnomalies(state, currentMonth())) {
    const key = `${a.commodity}|${a.month}|${a.kind}`;
    if (hidden.has(key)) continue;
    const vars = { commodity: t(a.commodity).toLowerCase(), month: fmtMonth(a.month), value: fmt(a.value, 1), usual: a.usual == null ? "" : fmt(a.usual, 1), unit: unitOf(a.commodity), pct: a.usual ? Math.round((a.value / a.usual - 1) * 100) : 0 };
    items.push(
      `<div class="notice is-past"><span class="notice-icon" style="color:var(--${a.commodity})">${commodityIcon(a.commodity)}</span><span>${esc(t(a.kind === "negative" ? "anomalyNegative" : "anomalyHigh", vars))} <button type="button" class="link-inline" data-goto-month="${a.month}">${esc(t("anomalyCheck"))}</button></span><button type="button" class="notice-close" data-dismiss="${esc(key)}" aria-label="${esc(t("hide"))}">×</button></div>`,
    );
  }
  // Last month's reading still missing for some meters: a button opens the entry for that month.
  const missing = missingReadings(state, currentMonth());
  if (missing.meters.length) {
    const names = missing.meters.map((id) => t(`meter.${id}`)).join(", ");
    items.unshift(
      `<div class="notice is-info"><span class="notice-icon">${pencil}</span><span>${esc(t("noticeReading", { month: fmtMonth(missing.month), meters: names }))} <button type="button" class="link-inline" data-goto-month="${missing.month}">${esc(t("noticeReadingAction"))}</button></span></div>`,
    );
  }
  return items.length ? `<div class="notices">${items.join("")}</div>` : "";
}
