import { DEFAULT_ELECTRICITY_CO2 } from "../insights.js";
import { COMMODITIES, CURRENCIES, METERS, mergeStates, normalizeState, setConfig, stateText } from "../data.js";
import { cloudAvailable, cloudStatus, connectCloud, disconnectCloud, syncNow } from "../cloud.js";
import { cur, fmtMonth, fmtTime, lang, t } from "../i18n.js";
import { getState, update } from "../store.js";
import { bulkEnabled, setBulkEnabled } from "./bulk.js";
import { reminderCalendar } from "../reminder.js";
import { searchPlaces } from "../weather.js";
import { csvExport } from "../household.js";
import { esc, parseNumber, toast } from "./dom.js";
import { bindSuppliers, suppliersHtml } from "./suppliers.js";
import { bindUpgrades, upgradesSettingsHtml } from "./upgrades.js";
import { cardFull, cardHidden, cardOrder, moveCard, resetLayout, setCardFull, setCardHidden } from "./layout.js";

function cloudHtml() {
  if (!cloudAvailable()) return `<p class="warn">${esc(t("cloudMissingKey"))}</p>`;
  const s = cloudStatus();
  if (!s.connected) return `<p class="hint">${esc(t("notConnected"))}</p><div class="btn-row"><button class="btn" id="connect">${esc(t("connect"))}</button></div>`;
  const line = s.state === "syncing" ? t("syncing") : s.error ? t(s.error) : s.at ? t("syncedAt", { time: fmtTime(s.at) }) : "";
  // A mark before the state, as in Garmin tool: turning while syncing, green when synced, red on a failure.
  const kind = s.state === "syncing" ? "syncing" : s.error ? "error" : "ok";
  const mark = { syncing: "↻", error: "!", ok: "✓" }[kind];
  return `<p class="cloud-state is-${kind}"><span class="cloud-icon" aria-hidden="true">${mark}</span>${esc(line)}</p>
    ${summaryHtml(s.summary)}
    <div class="btn-row"><button class="btn" id="sync">${esc(t("syncNow"))}</button><button class="btn danger" id="disconnect">${esc(t("disconnect"))}</button></div>`;
}

// What the last sync left the same everywhere: a tick for what is there, a dash for what is not, and what moved.
function summaryHtml(summary) {
  if (!summary) return "";
  const items = METERS.map((m) => {
    const info = summary.meters?.[m.id] ?? { count: 0 };
    const detail = info.count ? t("syncCount", { count: info.count, month: fmtMonth(info.last) }) : t("syncNone");
    return [t(`meter.${m.id}`), info.count > 0, detail];
  });
  if (summary.suppliers != null) items.push([t("syncSuppliers"), summary.suppliers > 0, summary.suppliers ? String(summary.suppliers) : ""]);
  items.push([t("syncConfig"), summary.config, ""]);
  const list = items
    .map(([label, set, detail]) => `<li class="${set ? "is-set" : ""}" title="${esc(t(set ? "itemSynced" : "itemNotSet"))}"><span class="cloud-tick" aria-hidden="true">${set ? "✓" : "–"}</span><span>${esc(label)}${detail ? ` <small>· ${esc(detail)}</small>` : ""}</span></li>`)
    .join("");
  const moved = (side) => (side?.readings ?? 0) + (side?.config ? 1 : 0);
  const r = moved(summary.received);
  const sent = moved(summary.sent);
  const movedLine = r || sent ? t("syncMoved", { received: r, sent }) : t("syncNothing");
  return `<ul class="cloud-items">${list}</ul><p class="hint">${esc(movedLine)}</p>`;
}

// The day of the month for the calendar reminder, kept per device.
const dayKey = "home-meters-reminder-day";
const reminderDay = () => {
  try {
    return Number(localStorage.getItem(dayKey)) || 1;
  } catch {
    return 1;
  }
};

// Set by Vite from vite.config.js; a dev server started without it still shows the page.
const appVersion = typeof __APP_VERSION__ === "undefined" ? "dev" : __APP_VERSION__;

// Settings in sections, one shown at a time; the open one is kept per device.
const SECTIONS = ["general", "suppliers", "house"];
const sectionKey = "home-meters-settings-section";
let section = (() => {
  try {
    const saved = localStorage.getItem(sectionKey);
    return SECTIONS.includes(saved) ? saved : "general";
  } catch {
    return "general";
  }
})();
export function setSettingsSection(next) {
  if (!SECTIONS.includes(next)) return;
  section = next;
  try {
    localStorage.setItem(sectionKey, next);
  } catch {}
}
// The overview's cards, each with a box to show or hide it, a switch for the full width and arrows to move it.
function layoutRowsHtml() {
  const order = cardOrder();
  return order
    .map((c, i) => `<li class="layout-row">
      <label class="check"><input type="checkbox" data-card-show="${c}" ${cardHidden(c) ? "" : "checked"} />${esc(t(`card.${c}`))}</label>
      <button type="button" class="layout-full" data-card-full="${c}" aria-pressed="${cardFull(c)}" title="${esc(t("layoutFullHint"))}">${esc(t(cardFull(c) ? "layoutFull" : "layoutHalf"))}</button>
      <button type="button" class="card-max" data-card-move="${c}" data-step="-1" aria-label="${esc(t("moveUp"))}" title="${esc(t("moveUp"))}" ${i === 0 ? "disabled" : ""}>↑</button>
      <button type="button" class="card-max" data-card-move="${c}" data-step="1" aria-label="${esc(t("moveDown"))}" title="${esc(t("moveDown"))}" ${i === order.length - 1 ? "disabled" : ""}>↓</button>
    </li>`)
    .join("");
}

function bindLayout(view) {
  const list = view.querySelector("#layout-list");
  const redraw = (card, step) => {
    list.innerHTML = layoutRowsHtml();
    // Keep the focus on the arrow just used (or the other one at the top or bottom), so a card can be moved several places with the keyboard.
    if (card) (list.querySelector(`[data-card-move="${card}"][data-step="${step}"]:not([disabled])`) ?? list.querySelector(`[data-card-move="${card}"]:not([disabled])`))?.focus();
  };
  list.addEventListener("click", (e) => {
    const full = e.target.closest("[data-card-full]");
    if (full) {
      setCardFull(full.dataset.cardFull, !cardFull(full.dataset.cardFull));
      return redraw();
    }
    const b = e.target.closest("[data-card-move]");
    if (!b) return;
    moveCard(b.dataset.cardMove, Number(b.dataset.step));
    redraw(b.dataset.cardMove, b.dataset.step);
  });
  list.addEventListener("change", (e) => {
    const box = e.target.closest("[data-card-show]");
    if (box) setCardHidden(box.dataset.cardShow, !box.checked);
  });
  view.querySelector("#layout-reset").addEventListener("click", () => {
    resetLayout();
    redraw();
  });
}

const group = (name, html) => `<div class="settings-group" data-group="${name}" ${name === section ? "" : "hidden"}>${html}</div>`;

export function renderSettings(view, rerender) {
  const state = getState();
  const tabs = `<div class="segmented settings-tabs">${SECTIONS.map((x) => `<button type="button" data-section="${x}" aria-pressed="${x === section}">${esc(t(`section.${x}`))}</button>`).join("")}</div>`;
  view.innerHTML = `
    <div class="settings-layout">
    ${tabs}
    <div class="settings-content">
    <div class="settings-group" data-group="general" ${section === "general" ? "" : "hidden"}>
    <section class="card">
      <h2>${esc(t("cloud"))}</h2>
      <p class="hint">${esc(t("cloudHint"))}</p>
      ${cloudHtml()}
    </section>
    <section class="card">
      <h2>${esc(t("settingsMeters"))}</h2>
      <div class="checks">${METERS.map((m) => `<label class="check"><input type="checkbox" data-active="${m.id}" ${state.config.active[m.id] ? "checked" : ""} />${esc(t(`meter.${m.id}`))}</label>`).join("")}</div>
      <p class="hint">${esc(t("activeHint"))}</p>
      <label class="field" for="gas-factor">${esc(t("gasFactor"))}</label>
      <input type="text" inputmode="decimal" id="gas-factor" value="${esc(state.config.gasKwhFactor)}" />
      <p class="hint">${esc(t("gasFactorHint"))}</p>
      <label class="field" for="currency">${esc(t("currency"))}</label>
      <select id="currency" class="short-input">${Object.entries(CURRENCIES).map(([code, sign]) => `<option value="${code}" ${code === state.config.currency ? "selected" : ""}>${code} (${esc(sign)})</option>`).join("")}</select>
      <p class="hint">${esc(t("currencyHint"))}</p>
    </section>
    <section class="card">
      <h2>${esc(t("goalsTitle"))}</h2>
      <p class="hint">${esc(t("goalsHint"))}</p>
      ${COMMODITIES.map((k) => `
        <span class="field">${esc(t(k))}</span>
        <div class="two-cols">
          <div class="meter-input"><input type="text" inputmode="decimal" data-goal="${k}" data-kind="usage" value="${state.config.goals?.[k]?.usage ?? ""}" aria-label="${esc(t(k))} ${esc(t("goalUsage"))}" placeholder="${esc(t("goalUsage"))}" /><span class="unit">${k === "electricity" ? "kWh" : "m³"}</span></div>
          <div class="meter-input"><input type="text" inputmode="decimal" data-goal="${k}" data-kind="cost" value="${state.config.goals?.[k]?.cost ?? ""}" aria-label="${esc(t(k))} ${esc(t("goalCost"))}" placeholder="${esc(t("goalCost"))}" /><span class="unit">${esc(cur())}</span></div>
        </div>`).join("")}
      <label class="field" for="co2-el">${esc(t("co2Factor"))}</label>
      <div class="meter-input short-input"><input type="text" inputmode="decimal" id="co2-el" value="${state.config.co2Electricity ?? ""}" placeholder="${DEFAULT_ELECTRICITY_CO2}" /><span class="unit">kg/kWh</span></div>
      <p class="hint">${esc(t("co2FactorHint", { value: DEFAULT_ELECTRICITY_CO2 }))}</p>
    </section>
    </div>
    ${group("suppliers", suppliersHtml())}
    <div class="settings-group" data-group="house" ${section === "house" ? "" : "hidden"}>
    <section class="card">
      <h2>${esc(t("houseTitle"))}</h2>
      <p class="hint">${esc(t("houseHint"))}</p>
      <div class="two-cols">
        <div><label class="field" for="house-area">${esc(t("houseArea"))}</label><div class="meter-input"><input type="text" inputmode="decimal" id="house-area" value="${state.config.house?.area ?? ""}" /><span class="unit">m²</span></div></div>
        <div><label class="field" for="house-people">${esc(t("housePeople"))}</label><input type="text" inputmode="numeric" id="house-people" value="${state.config.house?.people ?? ""}" /></div>
      </div>
      <label class="field" for="house-children">${esc(t("houseChildren"))}</label>
      <input type="text" inputmode="numeric" id="house-children" class="short-input" value="${state.config.house?.children ?? ""}" />
      <p class="hint">${esc(t("houseChildrenHint"))}</p>
    </section>
    ${upgradesSettingsHtml()}
    <section class="card" id="weather">
      <h2>${esc(t("weatherTitle"))}</h2>
      <p class="hint">${esc(t("weatherSettingsHint"))}</p>
      ${state.config.location ? `<p class="weather-place"><strong>${esc(state.config.location.name)}</strong> <button type="button" class="mp-link" id="weather-clear">${esc(t("delete"))}</button></p>` : ""}
      <form class="weather-search" id="weather-search" novalidate>
        <input type="search" id="weather-query" placeholder="${esc(t("weatherSearch"))}" autocomplete="off" enterkeyhint="search" />
        <button type="submit" class="btn">${esc(t("weatherFind"))}</button>
      </form>
      <div id="weather-results"></div>
    </section>
    </div>
    <div class="settings-group" data-group="general" ${section === "general" ? "" : "hidden"}>
    <section class="card">
      <h2>${esc(t("entrySettings"))}</h2>
      <label class="check"><input type="checkbox" id="bulk-enabled" ${bulkEnabled() ? "checked" : ""} />${esc(t("bulkEnabled"))}</label>
      <p class="hint">${esc(t("bulkEnabledHint"))}</p>
      <h3 class="bulk-sub">${esc(t("calendarTitle"))}</h3>
      <div class="two-cols">
        <select id="reminder-day" aria-label="${esc(t("day"))}">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${i + 1 === reminderDay() ? "selected" : ""}>${esc(t("calendarDay", { day: i + 1 }))}</option>`).join("")}</select>
        <button type="button" class="btn" id="reminder-ics">${esc(t("calendarDownload"))}</button>
      </div>
      <p class="hint">${esc(t("calendarHint"))}</p>
    </section>
    <section class="card">
      <h2>${esc(t("layoutTitle"))}</h2>
      <p class="hint">${esc(t("layoutHint"))}</p>
      <ul class="layout-list" id="layout-list">${layoutRowsHtml()}</ul>
      <button type="button" class="mp-link" id="layout-reset">${esc(t("layoutReset"))}</button>
    </section>
    <section class="card">
      <h2>${esc(t("backup"))}</h2>
      <div class="btn-row">
        <button class="btn" id="export">${esc(t("exportJson"))}</button>
        <button class="btn" id="export-csv">${esc(t("exportCsv"))}</button>
        <label class="btn" for="import">${esc(t("importJson"))}</label>
        <input type="file" id="import" accept="application/json,.json" hidden />
      </div>
    </section>
    </div>
    <p class="version">${esc(t("version"))} ${esc(appVersion)}</p>
    </div>
    </div>`;

  view.querySelectorAll("[data-section]").forEach((b) =>
    b.addEventListener("click", () => {
      setSettingsSection(b.dataset.section);
      view.querySelectorAll("[data-section]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      view.querySelectorAll("[data-group]").forEach((g) => (g.hidden = g.dataset.group !== section));
      window.scrollTo(0, 0);
    }),
  );
  bindSuppliers(view, rerender);
  bindLayout(view);
  for (const [id, key] of [["#house-area", "area"], ["#house-people", "people"], ["#house-children", "children"]])
    view.querySelector(id).addEventListener("change", (e) => {
      const v = parseNumber(e.target.value);
      if (Number.isNaN(v) || (v != null && v < 0)) return toast(t("priceInvalid"));
      update((s) => setConfig(s, { house: { [key]: v } }));
    });
  bindUpgrades(view, rerender);
  view.querySelector("#weather-clear")?.addEventListener("click", () => update((s) => setConfig(s, { location: null })));
  view.querySelector("#weather-search").addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = view.querySelector("#weather-query").value.trim();
    const results = view.querySelector("#weather-results");
    if (!query) return;
    results.innerHTML = `<p class="hint">${esc(t("weatherLoading"))}</p>`;
    try {
      const places = await searchPlaces(query, lang);
      results.innerHTML = places.length
        ? places.map((pl, i) => `<button type="button" class="place" data-place="${i}">${esc(pl.name)}</button>`).join("")
        : `<p class="hint">${esc(t("weatherNone"))}</p>`;
      results.querySelectorAll("[data-place]").forEach((b) => b.addEventListener("click", () => update((s) => setConfig(s, { location: places[Number(b.dataset.place)] }))));
    } catch (error) {
      results.innerHTML = `<p class="warn">${esc(t("weatherError", { error: error.message }))}</p>`;
    }
  });
  view.querySelector("#connect")?.addEventListener("click", connectCloud);
  view.querySelector("#sync")?.addEventListener("click", syncNow);
  view.querySelector("#disconnect")?.addEventListener("click", () => {
    disconnectCloud();
    rerender();
  });
  view.querySelectorAll("[data-active]").forEach((box) =>
    box.addEventListener("change", () => update((s) => setConfig(s, { active: { [box.dataset.active]: box.checked } }))),
  );
  view.querySelector("#gas-factor").addEventListener("change", (event) => {
    const value = parseNumber(event.target.value);
    if (value > 0) update((s) => setConfig(s, { gasKwhFactor: value }));
    else event.target.value = getState().config.gasKwhFactor;
  });
  // An empty goal or factor clears it.
  view.querySelectorAll("[data-goal]").forEach((input) =>
    input.addEventListener("change", () => {
      const value = parseNumber(input.value);
      if (value != null && !(value > 0)) return (input.value = getState().config.goals?.[input.dataset.goal]?.[input.dataset.kind] ?? "");
      update((s) => setConfig(s, { goals: { [input.dataset.goal]: { [input.dataset.kind]: value } } }));
    }),
  );
  view.querySelector("#co2-el").addEventListener("change", (e) => {
    const value = parseNumber(e.target.value);
    if (value != null && !(value > 0)) return (e.target.value = getState().config.co2Electricity ?? "");
    update((s) => setConfig(s, { co2Electricity: value }));
  });
  view.querySelector("#currency").addEventListener("change", (e) => update((s) => setConfig(s, { currency: e.target.value })));
  view.querySelector("#bulk-enabled").addEventListener("change", (event) => setBulkEnabled(event.target.checked));
  view.querySelector("#reminder-day").addEventListener("change", (event) => {
    try {
      localStorage.setItem(dayKey, event.target.value);
    } catch {}
  });
  view.querySelector("#reminder-ics").addEventListener("click", () => {
    const ics = reminderCalendar({ day: reminderDay(), title: t("calendarEvent"), description: t("calendarEventText"), url: location.origin + location.pathname });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([ics], { type: "text/calendar" })), download: "home-meters-odecet.ics" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  view.querySelector("#export").addEventListener("click", () => {
    const blob = new Blob([stateText(getState())], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `home-meters-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  view.querySelector("#export-csv").addEventListener("click", () => {
    const names = { month: t("month"), reading: t("csvReading"), use: t("csvUse"), cost: t("costs"), total: t("total").toLowerCase(), electricity: t("electricity").toLowerCase(), gas: t("gas").toLowerCase(), water: t("water").toLowerCase(), meters: Object.fromEntries(METERS.map((m) => [m.id, t(`meter.${m.id}`)])) };
    const blob = new Blob([csvExport(getState(), names)], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `home-meters-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  view.querySelector("#import").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const incoming = normalizeState(JSON.parse(await file.text()));
      update((s) => mergeStates(s, incoming));
      toast(t("importDone"));
    } catch {
      toast(t("importFailed"));
    }
    event.target.value = "";
  });
}
