import "./styles.css";
import { cloudStatus, onCloudStatus, setupCloud } from "./cloud.js";
import { lang, setLang, t } from "./i18n.js";
import { renderEntry, setEntryMonth } from "./ui/entry.js";
import { dismissNotice } from "./ui/notices.js";
import { leaveOverview, renderOverview } from "./ui/overview.js";
import { renderSettings, setSettingsSection } from "./ui/settings.js";

const icons = {
  entry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 20V11M12 20V4M19 20v-7"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};
const tabs = { entry: "tabEntry", overview: "tabOverview", settings: "tabSettings" };
const view = document.getElementById("view");
const currentTab = () => (location.hash.slice(1) in tabs ? location.hash.slice(1) : "entry");

const draftKey = (el) => `${el.form?.id ?? ""}|${el.name || el.id}|${el.type === "checkbox" ? el.value : ""}`;
const draftFields = () => [...view.querySelectorAll("form input, form select, form textarea")].filter((el) => el.type !== "file" && (el.name || el.id));
function readDrafts() {
  return new Map(draftFields().map((el) => [draftKey(el), el.type === "checkbox" || el.type === "radio" ? el.checked : el.value]));
}
function writeDrafts(drafts) {
  for (const el of draftFields()) {
    const key = draftKey(el);
    if (!drafts.has(key)) continue;
    const value = drafts.get(key);
    if (el.type === "checkbox" || el.type === "radio") el.checked = value;
    else el.value = value;
    // Let the form react (two-tariff fields, water fields…) as if typed.
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

// Set by Vite from vite.config.js; a dev server started without it still shows the page.
const appVersion = typeof __APP_VERSION__ === "undefined" ? "dev" : __APP_VERSION__;
const lockIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

function render() {
  const tab = currentTab();
  renderControls();
  document.title = t("appName");
  document.getElementById("title").textContent = t("appName");
  // The same links twice: at the bottom on a phone, in the top bar on a wide screen.
  const links = Object.entries(tabs)
    .map(([id, key]) => `<a href="#${id}" ${id === tab ? 'aria-current="page"' : ""}>${icons[id]}<span>${t(key)}</span></a>`)
    .join("");
  document.getElementById("tabbar").innerHTML = links;
  document.getElementById("topnav").innerHTML = links;
  // What the app does, where the data stays and the version: on a wide screen only, a phone has the bottom bar there.
  document.getElementById("footer").innerHTML = `<span>${t("footerAbout")}</span><span class="privacy">${lockIcon}<span>${t("footerPrivacy")}</span></span><span class="app-version">${t("version")} ${appVersion}</span>`;
  // What is typed in an open form survives a redraw (after a sync on coming back to the app, say): the values
  // are read before and put back into the same fields after, as long as the form is still open.
  const drafts = tab !== "entry" && view.dataset.tab === tab ? readDrafts() : null;
  view.dataset.tab = tab;
  if (tab !== "overview") leaveOverview();
  // A screen that fails to draw says so instead of staying blank.
  try {
    if (tab === "entry") renderEntry(view);
    else if (tab === "overview") renderOverview(view);
    else renderSettings(view, render);
    if (drafts) writeDrafts(drafts);
  } catch (error) {
    console.error(error);
    view.innerHTML = `<section class="card"><h2>${t("renderError")}</h2><pre class="error-detail"></pre></section>`;
    view.querySelector(".error-detail").textContent = `${error?.message}

${error?.stack ?? ""}`;
  }
}

// Light or dark: picked here and kept, or the system's until picked (also set before paint in index.html).
const themeKey = "home-meters-theme";
const systemDark = matchMedia("(prefers-color-scheme: dark)");
const savedTheme = () => {
  try {
    return localStorage.getItem(themeKey);
  } catch {
    return null;
  }
};
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#121417" : "#f6f7f9";
}

function renderControls() {
  const theme = document.documentElement.dataset.theme;
  document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
  document.querySelectorAll("[data-theme-choice]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.themeChoice === theme));
    const label = t(b.dataset.themeChoice === "dark" ? "darkMode" : "lightMode");
    b.title = label;
    b.setAttribute("aria-label", label);
  });
  document.getElementById("lang-switch").setAttribute("aria-label", t("language"));
}

document.getElementById("lang-switch").addEventListener("click", (event) => {
  const button = event.target.closest("[data-lang]");
  if (!button || button.dataset.lang === lang) return;
  setLang(button.dataset.lang);
  render();
});
document.getElementById("theme-switch").addEventListener("click", (event) => {
  const button = event.target.closest("[data-theme-choice]");
  if (!button) return;
  try {
    localStorage.setItem(themeKey, button.dataset.themeChoice);
  } catch {}
  applyTheme(button.dataset.themeChoice);
  render();
});

// The sync state shows in Settings; redraw it there when it changes.
function showSync() {
  if (currentTab() === "settings") render();
}

setLang(lang);
// "Enter" on the missing-reading reminder: the entry screen at that month.
document.addEventListener("click", (event) => {
  // An ⓘ opens its text; a tap anywhere else closes any open one.
  const tip = event.target.closest(".info-tip");
  document.querySelectorAll(".info-tip[aria-expanded=true]").forEach((b) => {
    if (b === tip) return;
    b.setAttribute("aria-expanded", "false");
    b.nextElementSibling.hidden = true;
  });
  if (tip) {
    const open = tip.getAttribute("aria-expanded") !== "true";
    tip.setAttribute("aria-expanded", String(open));
    tip.nextElementSibling.hidden = !open;
    return;
  }
  const link = event.target.closest("[data-settings-section]");
  if (link) setSettingsSection(link.dataset.settingsSection);
  const close = event.target.closest("[data-dismiss]");
  if (close) {
    dismissNotice(close.dataset.dismiss);
    close.closest(".notice").remove();
    return;
  }
  const button = event.target.closest("[data-goto-month]");
  if (!button) return;
  setEntryMonth(button.dataset.gotoMonth);
  if (location.hash === "#entry" || !location.hash) render();
  else location.hash = "#entry";
  window.scrollTo(0, 0);
});

window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
});
// Data that came from Dropbox redraws the screen, except while something is being typed.
window.addEventListener("data-change", () => {
  if (!["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) render();
});
systemDark.addEventListener("change", () => {
  if (savedTheme()) return;
  applyTheme(systemDark.matches ? "dark" : "light");
  render();
});
applyTheme(savedTheme() ?? (systemDark.matches ? "dark" : "light"));
onCloudStatus(showSync);
render();
showSync(cloudStatus());
setupCloud();

// Offline support (see public/sw.js); only in the built app, so the dev server always serves fresh files.
if (import.meta.env.PROD && "serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
