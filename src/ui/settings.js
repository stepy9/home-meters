import { METERS, mergeStates, normalizeState, setConfig, stateText } from "../data.js";
import { cloudAvailable, cloudStatus, connectCloud, disconnectCloud, syncNow } from "../cloud.js";
import { fmtMonth, fmtTime, lang, t } from "../i18n.js";
import { getState, update } from "../store.js";
import { bulkEnabled, setBulkEnabled } from "./bulk.js";
import { reminderCalendar } from "../reminder.js";
import { searchPlaces } from "../weather.js";
import { esc, parseNumber, toast } from "./dom.js";
import { bindSuppliers, suppliersHtml } from "./suppliers.js";

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

export function renderSettings(view, rerender) {
  const state = getState();
  view.innerHTML = `
    <section class="card">
      <h2>${esc(t("cloud"))}</h2>
      <p class="hint">${esc(t("cloudHint"))}</p>
      ${cloudHtml()}
    </section>
    <section class="card">
      <h2>${esc(t("settingsMeters"))}</h2>
      ${METERS.map((m) => `<label class="check"><input type="checkbox" data-active="${m.id}" ${state.config.active[m.id] ? "checked" : ""} />${esc(t(`meter.${m.id}`))}</label>`).join("")}
      <p class="hint">${esc(t("activeHint"))}</p>
      <label class="field" for="gas-factor">${esc(t("gasFactor"))}</label>
      <input type="text" inputmode="decimal" id="gas-factor" value="${esc(state.config.gasKwhFactor)}" />
      <p class="hint">${esc(t("gasFactorHint"))}</p>
    </section>
    ${suppliersHtml()}
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
      <h2>${esc(t("backup"))}</h2>
      <div class="btn-row">
        <button class="btn" id="export">${esc(t("exportJson"))}</button>
        <label class="btn" for="import">${esc(t("importJson"))}</label>
        <input type="file" id="import" accept="application/json,.json" hidden />
      </div>
    </section>
    <p class="version">${esc(t("version"))} ${esc(appVersion)}</p>`;

  bindSuppliers(view, rerender);
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
