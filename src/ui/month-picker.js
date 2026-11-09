import { monthAdd } from "../data.js";
import { t } from "../i18n.js";
import { esc } from "./dom.js";

// A month picker in place of the browser's: arrows step a month, the label opens a year with its twelve
// months. Months that already have readings carry a dot; months after the current one cannot be picked.

const chevron = (dir) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${dir === "prev" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"}"/></svg>`;

export const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

const longLabel = (month) => `${t("monthsLong")[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

let open = false;
let shownYear = null;

function gridHtml(month, marked) {
  const max = currentMonth();
  const year = shownYear ?? Number(month.slice(0, 4));
  const cells = t("months")
    .map((name, i) => {
      const value = `${year}-${String(i + 1).padStart(2, "0")}`;
      const cls = [value === month && "is-selected", value === max && "is-current", marked.has(value) && "has-data"].filter(Boolean).join(" ");
      return `<button type="button" class="mp-month ${cls}" data-pick="${value}" ${value > max ? "disabled" : ""}>${esc(name)}</button>`;
    })
    .join("");
  return `
    <div class="mp-panel">
      <div class="mp-year">
        <button type="button" class="mp-arrow" data-year-step="-1" aria-label="${esc(String(year - 1))}">${chevron("prev")}</button>
        <strong>${year}</strong>
        <button type="button" class="mp-arrow" data-year-step="1" aria-label="${esc(String(year + 1))}" ${year >= Number(max.slice(0, 4)) ? "disabled" : ""}>${chevron("next")}</button>
      </div>
      <div class="mp-grid">${cells}</div>
      <div class="mp-foot"><button type="button" class="mp-link" data-pick="${max}">${esc(t("thisMonth"))}</button></div>
    </div>`;
}

export function monthPickerHtml(month, marked) {
  const atMax = month >= currentMonth();
  return `
    <div class="month-picker" id="month-picker">
      <div class="mp-bar">
        <button type="button" class="mp-arrow" data-step="-1" aria-label="${esc(t("prevMonth"))}">${chevron("prev")}</button>
        <button type="button" class="mp-label" aria-expanded="${open}">${esc(longLabel(month))}${marked.has(month) ? '<span class="mp-dot" aria-hidden="true"></span>' : ""}</button>
        <button type="button" class="mp-arrow" data-step="1" aria-label="${esc(t("nextMonth"))}" ${atMax ? "disabled" : ""}>${chevron("next")}</button>
      </div>
      ${open ? gridHtml(month, marked) : ""}
    </div>`;
}

// onChange(month) is called with a new month; the caller redraws. Opening and year browsing redraw just the picker.
export function bindMonthPicker(root, month, marked, onChange) {
  const picker = root.querySelector("#month-picker");
  const redraw = () => {
    picker.outerHTML = monthPickerHtml(month, marked);
    bindMonthPicker(root, month, marked, onChange);
  };
  picker.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.step) {
      const next = monthAdd(month, Number(button.dataset.step));
      if (next <= currentMonth()) onChange(next);
    } else if (button.classList.contains("mp-label")) {
      open = !open;
      shownYear = null;
      redraw();
    } else if (button.dataset.yearStep) {
      shownYear = (shownYear ?? Number(month.slice(0, 4))) + Number(button.dataset.yearStep);
      redraw();
    } else if (button.dataset.pick) {
      open = false;
      shownYear = null;
      onChange(button.dataset.pick);
    }
  });
}
