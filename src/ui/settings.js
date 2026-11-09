import { METERS, mergeStates, normalizeState, setConfig, stateText } from "../data.js";
import { cloudAvailable, cloudStatus, connectCloud, disconnectCloud, syncNow } from "../cloud.js";
import { fmtTime, lang, setLang, t } from "../i18n.js";
import { getState, update } from "../store.js";
import { esc, parseNumber, toast } from "./dom.js";

function cloudHtml() {
  if (!cloudAvailable()) return `<p class="warn">${esc(t("cloudMissingKey"))}</p>`;
  const s = cloudStatus();
  if (!s.connected) return `<p class="hint">${esc(t("notConnected"))}</p><div class="btn-row"><button class="btn" id="connect">${esc(t("connect"))}</button></div>`;
  const line = s.state === "syncing" ? t("syncing") : s.error ? t(s.error) : s.at ? t("syncedAt", { time: fmtTime(s.at) }) : "";
  return `<p class="${s.error ? "warn" : "hint"}">${esc(line)}</p>
    <div class="btn-row"><button class="btn" id="sync">${esc(t("syncNow"))}</button><button class="btn danger" id="disconnect">${esc(t("disconnect"))}</button></div>`;
}

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
    <section class="card">
      <h2>${esc(t("language"))}</h2>
      <div class="segmented">${["cs", "en"].map((l) => `<button type="button" data-lang="${l}" aria-pressed="${l === lang}">${l === "cs" ? "Čeština" : "English"}</button>`).join("")}</div>
    </section>
    <section class="card">
      <h2>${esc(t("backup"))}</h2>
      <div class="btn-row">
        <button class="btn" id="export">${esc(t("exportJson"))}</button>
        <label class="btn" for="import">${esc(t("importJson"))}</label>
        <input type="file" id="import" accept="application/json,.json" hidden />
      </div>
    </section>
    <p class="version">${esc(t("version"))} ${esc(__APP_VERSION__)}</p>`;

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
  view.querySelectorAll("[data-lang]").forEach((b) =>
    b.addEventListener("click", () => {
      setLang(b.dataset.lang);
      rerender();
    }),
  );
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
