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
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
onCloudStatus(showSync);
render();
showSync(cloudStatus());
setupCloud();
