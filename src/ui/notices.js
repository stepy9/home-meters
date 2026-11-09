import { daysUntil, reminderDue, supplierAt } from "../data.js";
import { fmtDate, t } from "../i18n.js";
import { getState } from "../store.js";
import { esc } from "./dom.js";
import { commodityIcon } from "./icons.js";
import { currentMonth } from "./month-picker.js";

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
      return `<div class="notice ${days < 0 ? "is-past" : ""}"><span class="notice-icon" style="color:var(--${c})">${commodityIcon(c)}</span><span>${esc(text)} <a href="#settings">${esc(t("noticeAction"))}</a></span></div>`;
    })
    .filter(Boolean);
  return items.length ? `<div class="notices">${items.join("")}</div>` : "";
}
