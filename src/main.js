import "./styles.css";
import { cloudStatus, onCloudStatus, setupCloud } from "./cloud.js";
import { lang, setLang, t } from "./i18n.js";
import { renderEntry } from "./ui/entry.js";
import { leaveOverview, renderOverview } from "./ui/overview.js";
import { renderSettings } from "./ui/settings.js";

const icons = {
  entry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 20V11M12 20V4M19 20v-7"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};
const tabs = { entry: "tabEntry", overview: "tabOverview", settings: "tabSettings" };
const view = document.getElementById("view");
const currentTab = () => (location.hash.slice(1) in tabs ? location.hash.slice(1) : "entry");

function render() {
  const tab = currentTab();
  renderControls();
  document.title = t("appName");
  document.getElementById("title").textContent = t("appName");
  document.getElementById("tabbar").innerHTML = Object.entries(tabs)
    .map(([id, key]) => `<a href="#${id}" ${id === tab ? 'aria-current="page"' : ""}>${icons[id]}<span>${t(key)}</span></a>`)
    .join("");
  if (tab !== "overview") leaveOverview();
  if (tab === "entry") renderEntry(view);
  else if (tab === "overview") renderOverview(view);
  else renderSettings(view, render);
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

function showSync(s) {
  const dot = document.getElementById("sync-dot");
  dot.hidden = !s.connected;
  dot.className = `sync-dot ${s.state === "syncing" ? "busy" : s.error ? "error" : "ok"}`;
  dot.title = s.error ?? "";
  if (currentTab() === "settings") render();
}

setLang(lang);
window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
});
// Data that came from Dropbox redraws the screen, except while something is being typed.
window.addEventListener("data-change", () => {
  if (!["INPUT", "SELECT"].includes(document.activeElement?.tagName)) render();
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
