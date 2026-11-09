import { COMMODITIES, UPGRADE_KINDS, deleteUpgrade, setUpgrade, upgradesOf } from "../data.js";
import { fmt, fmtMonth, fmtPct, t } from "../i18n.js";
import { getState, update } from "../store.js";
import { upgradeImpact, upgradePayback } from "../upgrades.js";
import { esc, parseNumber, toast } from "./dom.js";
import { commodityIcon } from "./icons.js";
import { currentMonth } from "./month-picker.js";

// House upgrades: a list with a form in Settings, and in the overview what each did to consumption.
// editing: null, or the id of the upgrade being edited ("" for a new one).
let editing = null;

const kc = (v) => `${fmt(v, 0)} Kč`;
const pad = (n) => String(n).padStart(2, "0");
const options = (values, selected, label = (v) => v) =>
  values.map((v) => `<option value="${v}" ${String(v) === String(selected) ? "selected" : ""}>${esc(label(v))}</option>`).join("");

const numField = (name, label, value, unit) => `
  <div class="price-field">
    <label class="field" for="up-${name}">${esc(label)}</label>
    <div class="meter-input"><input type="text" inputmode="decimal" id="up-${name}" name="${name}" value="${value == null ? "" : esc(String(value).replace(".", ","))}" /><span class="unit">${esc(unit)}</span></div>
  </div>`;

function formHtml(u) {
  const month = u?.month ?? currentMonth();
  const year = Number(currentMonth().slice(0, 4));
  const years = Array.from({ length: 41 }, (_, i) => year + 1 - i);
  const kind = u?.kind ?? "insulation";
  const affects = u?.affects ?? UPGRADE_KINDS[kind];
  return `
    <form class="price-form" id="upgrade-form" novalidate>
      <h4 class="price-title">${esc(t(u ? "upgradeEdit" : "upgradeAdd"))}</h4>
      <label class="field" for="up-kind">${esc(t("upgradeKind"))}</label>
      <select id="up-kind" name="kind">${options(Object.keys(UPGRADE_KINDS), kind, (k) => t(`upgrade.${k}`))}</select>
      <label class="field">${esc(t("upgradeWhen"))}</label>
      <div class="two-cols">
        <select name="month" aria-label="${esc(t("month"))}">${options(Array.from({ length: 12 }, (_, i) => pad(i + 1)), month.slice(5), (v) => t("monthsLong")[Number(v) - 1])}</select>
        <select name="year" aria-label="${esc(t("year"))}">${options(years, month.slice(0, 4))}</select>
      </div>
      <label class="field" for="up-name">${esc(t("upgradeName"))}</label>
      <input type="text" id="up-name" name="name" autocomplete="off" placeholder="${esc(t("upgradeNameHint"))}" value="${esc(u?.name ?? "")}" />
      ${numField("cost", t("upgradeCost"), u?.cost, "Kč")}
      ${numField("subsidy", t("upgradeSubsidy"), u?.subsidy, "Kč")}
      <label class="field" for="up-company">${esc(t("upgradeCompany"))}</label>
      <input type="text" id="up-company" name="company" autocomplete="off" value="${esc(u?.company ?? "")}" />
      <label class="field">${esc(t("upgradeAffects"))}</label>
      <div class="affects">${COMMODITIES.map((c) => `<label class="check"><input type="checkbox" name="affects" value="${c}" ${affects.includes(c) ? "checked" : ""} />${esc(t(c))}</label>`).join("")}</div>
      <label class="field" for="up-note">${esc(t("note"))}</label>
      <input type="text" id="up-note" name="note" autocomplete="off" placeholder="${esc(t("upgradeNoteHint"))}" value="${esc(u?.note ?? "")}" />
      <p class="warn" id="up-error" hidden></p>
      <div class="form-actions">
        ${u ? `<button type="button" class="btn danger" id="up-delete">${esc(t("delete"))}</button>` : ""}
        <button type="button" class="btn" id="up-cancel">${esc(t("cancel"))}</button>
        <button type="submit" class="btn primary">${esc(t("save"))}</button>
      </div>
    </form>`;
}

const title = (u) => u.name || t(`upgrade.${u.kind}`);
const moneyText = (u) =>
  [u.cost != null && `${t("upgradeCost")} ${kc(u.cost)}`, u.subsidy && `${t("upgradeSubsidy").toLowerCase()} ${kc(u.subsidy)}`].filter(Boolean).join(", ");

export function upgradesSettingsHtml() {
  const state = getState();
  const rows = upgradesOf(state)
    .map(
      (u) => `
      <div class="offer-row">
        <div class="offer-main"><strong>${esc(title(u))}</strong><div class="hint">${esc([fmtMonth(u.month), u.name && u.name !== t(`upgrade.${u.kind}`) && t(`upgrade.${u.kind}`), moneyText(u), u.company, u.note].filter(Boolean).join(" · "))}</div></div>
        <div class="upgrade-icons">${u.affects.map((c) => `<span style="color:var(--${c})">${commodityIcon(c)}</span>`).join("")}</div>
        <button type="button" class="mp-link" data-edit-upgrade="${esc(u.id)}">${esc(t("edit"))}</button>
      </div>`,
    )
    .join("");
  return `
    <section class="card" id="upgrades">
      <h2>${esc(t("upgradesTitle"))}</h2>
      <p class="hint">${esc(t("upgradesHint"))}</p>
      ${rows}
      ${editing != null ? formHtml(editing ? state.upgrades[editing] : null) : `<button type="button" class="btn small" data-add-upgrade>+ ${esc(t("upgradeAdd"))}</button>`}
    </section>`;
}

export function bindUpgrades(root, rerender) {
  const section = root.querySelector("#upgrades");
  if (!section) return;
  const open = (id) => {
    editing = id;
    rerender();
    root.querySelector("#upgrade-form")?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  section.querySelector("[data-add-upgrade]")?.addEventListener("click", () => open(""));
  section.querySelectorAll("[data-edit-upgrade]").forEach((b) => b.addEventListener("click", () => open(b.dataset.editUpgrade)));
  const form = section.querySelector("#upgrade-form");
  if (!form) return;
  // A new upgrade's commodities follow its kind until they are changed by hand.
  let touched = Boolean(editing);
  const boxes = form.querySelectorAll('[name="affects"]');
  boxes.forEach((box) => box.addEventListener("change", () => (touched = true)));
  form.querySelector("#up-kind").addEventListener("change", (e) => {
    if (!touched) boxes.forEach((box) => (box.checked = UPGRADE_KINDS[e.target.value].includes(box.value)));
  });
  form.querySelector("#up-cancel").addEventListener("click", () => {
    editing = null;
    rerender();
  });
  form.querySelector("#up-delete")?.addEventListener("click", () => {
    if (!confirm(t("upgradeDeleteConfirm"))) return;
    const id = editing;
    editing = null;
    update((s) => deleteUpgrade(s, id));
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const values = { cost: parseNumber(data.get("cost")), subsidy: parseNumber(data.get("subsidy")) };
    if (Object.values(values).some((v) => Number.isNaN(v) || v < 0)) {
      const error = form.querySelector("#up-error");
      error.textContent = t("priceInvalid");
      error.hidden = false;
      return;
    }
    const fields = {
      id: editing || undefined,
      kind: data.get("kind"),
      month: `${data.get("year")}-${data.get("month")}`,
      name: data.get("name"),
      company: data.get("company"),
      note: data.get("note"),
      affects: data.getAll("affects"),
      ...values,
    };
    editing = null;
    update((s) => setUpgrade(s, fields));
    toast(t("saved"));
  });
}

// The overview card: upgrades that affect this commodity, each with the change in use, the yearly saving and the
// payback. dd: degree days for gas, when the weather is loaded.
export function upgradesOverviewHtml(state, commodity, dd) {
  const list = upgradesOf(state, commodity);
  if (!list.length) return "";
  const month = currentMonth();
  const unit = commodity === "electricity" ? "kWh" : "m³";
  const rows = list
    .map((u) => {
      const impacts = u.affects.map((c) => upgradeImpact(state, u, c, { month, dd: c === "gas" ? dd : null }));
      const i = impacts[u.affects.indexOf(commodity)];
      let body;
      if (i.pending) body = `<div class="hint">${esc(t("upgradePending", { pairs: i.pairs }))}</div>`;
      else {
        const saved = i.saved == null ? null : commodity === "gas" ? i.saved / state.config.gasKwhFactor : i.saved;
        const parts = [
          `<span class="${i.change < 0 ? "down" : "up"}">${fmtPct(i.change)}</span> ${esc(t(i.byWeather ? "upgradeChangeWeather" : "upgradeChange"))}`,
          saved != null && saved > 0 && esc(t("upgradeSaved", { amount: fmt(saved, 0), unit })),
        ].filter(Boolean);
        const pay = upgradePayback(u, impacts);
        if (pay && pay.savedMoney > 0) {
          parts.push(esc(t(u.affects.length > 1 ? "upgradeMoneyAll" : "upgradeMoney", { amount: fmt(pay.savedMoney, 0) })));
          if (pay.years != null) parts.push(`<strong>${esc(t("upgradePayback", { years: fmt(pay.years, 1) }))}</strong>`);
        }
        body = `<div class="upgrade-impact">${parts.join(" · ")}</div><div class="hint">${esc(t("upgradeBasis", { pairs: i.pairs }))}</div>`;
      }
      return `<div class="upgrade-row"><strong>${esc(title(u))}</strong> <span class="hint">${esc(fmtMonth(u.month))}</span>${body}</div>`;
    })
    .join("");
  return `<section class="card"><h2>${esc(t("upgradesTitle"))}</h2>${rows}</section>`;
}
