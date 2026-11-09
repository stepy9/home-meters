const translations = {
  cs: {
    appName: "Měřáky",
    tabEntry: "Zadat",
    tabOverview: "Přehled",
    tabSettings: "Nastavení",
    electricity: "Elektřina",
    gas: "Plyn",
    water: "Voda",
    "meter.el-vt": "Elektřina VT",
    "meter.el-nt": "Elektřina NT",
    "meter.gas": "Plyn",
    "meter.water": "Voda",
    "short.el-vt": "VT",
    "short.el-nt": "NT",
    month: "Měsíc",
    entryHint: "Stav měřáku ke konci měsíce.",
    previous: "Minule {value} ({month})",
    noPrevious: "První odečet",
    usedSince: "Spotřeba: {value}",
    lowerWarning: "Hodnota je nižší než minule. Pokud byl měřák vyměněn, zaškrtni výměnu.",
    swap: "Výměna měřáku v tomto měsíci",
    oldFinal: "Konečný stav starého",
    newStart: "Počáteční stav nového",
    save: "Uložit",
    saved: "Uloženo",
    delete: "Smazat",
    deleteConfirm: "Smazat odečet {meter} za {month}?",
    nothingToSave: "Nezadal(a) jsi žádnou hodnotu.",
    history: "Poslední odečty",
    noData: "Zatím tu nejsou data. Spotřeba se zobrazí po zadání aspoň dvou odečtů.",
    year: "Rok",
    yearChart: "Spotřeba po měsících",
    compareChart: "Porovnání roků",
    compareTable: "Měsíce × roky",
    total: "Celkem",
    perMonth: "{months} měs.",
    estimated: "* dopočteno rovnoměrně z delšího období",
    vsLastYear: "proti {year}",
    unit: "Jednotka",
    settingsMeters: "Měřáky",
    activeHint: "Vypnutý měřák se nenabízí k zadání; jeho data zůstanou.",
    gasFactor: "Přepočet plynu (kWh/m³)",
    gasFactorHint: "Najdeš na faktuře (spalné teplo × objemový přepočet), obvykle kolem 10,5.",
    cloud: "Dropbox",
    cloudHint: "Data se ukládají do souboru readings.json ve složce aplikace ve tvém Dropboxu, takže je uvidíš na telefonu i počítači.",
    cloudMissingKey: "Chybí Dropbox App key, viz README.",
    connect: "Připojit Dropbox",
    disconnect: "Odpojit",
    syncNow: "Synchronizovat",
    syncing: "Synchronizuji…",
    syncedAt: "Naposledy {time}",
    notConnected: "Nepřipojeno, data jsou jen v tomto prohlížeči.",
    "newer-version": "Data v Dropboxu jsou z novější verze aplikace. Načti stránku znovu.",
    language: "Jazyk",
    lightMode: "Světlý režim",
    darkMode: "Tmavý režim",
    backup: "Záloha",
    exportJson: "Stáhnout JSON",
    importJson: "Nahrát JSON",
    importDone: "Nahráno a sloučeno.",
    importFailed: "Soubor se nepodařilo načíst.",
    version: "Verze",
    months: ["led", "úno", "bře", "dub", "kvě", "čvn", "čvc", "srp", "zář", "říj", "lis", "pro"],
  },
  en: {
    appName: "Home Meters",
    tabEntry: "Enter",
    tabOverview: "Overview",
    tabSettings: "Settings",
    electricity: "Electricity",
    gas: "Gas",
    water: "Water",
    "meter.el-vt": "Electricity HT",
    "meter.el-nt": "Electricity LT",
    "meter.gas": "Gas",
    "meter.water": "Water",
    "short.el-vt": "HT",
    "short.el-nt": "LT",
    month: "Month",
    entryHint: "Meter state at the end of the month.",
    previous: "Last {value} ({month})",
    noPrevious: "First reading",
    usedSince: "Used: {value}",
    lowerWarning: "The value is lower than last time. If the meter was replaced, tick the swap.",
    swap: "Meter replaced this month",
    oldFinal: "Old meter final state",
    newStart: "New meter start state",
    save: "Save",
    saved: "Saved",
    delete: "Delete",
    deleteConfirm: "Delete the {meter} reading for {month}?",
    nothingToSave: "No value entered.",
    history: "Recent readings",
    noData: "No data yet. Consumption shows once there are at least two readings.",
    year: "Year",
    yearChart: "Consumption by month",
    compareChart: "Years compared",
    compareTable: "Months × years",
    total: "Total",
    perMonth: "{months} mo.",
    estimated: "* spread evenly from a longer period",
    vsLastYear: "vs {year}",
    unit: "Unit",
    settingsMeters: "Meters",
    activeHint: "A meter switched off is not offered for entry; its data stays.",
    gasFactor: "Gas conversion (kWh/m³)",
    gasFactorHint: "From your bill (calorific value × volume correction), usually about 10.5.",
    cloud: "Dropbox",
    cloudHint: "Data is kept in readings.json in the app's folder in your Dropbox, so the phone and computer show the same.",
    cloudMissingKey: "Dropbox App key missing, see README.",
    connect: "Connect Dropbox",
    disconnect: "Disconnect",
    syncNow: "Sync now",
    syncing: "Syncing…",
    syncedAt: "Last {time}",
    notConnected: "Not connected, data is only in this browser.",
    "newer-version": "Data in Dropbox comes from a newer app version. Reload the page.",
    language: "Language",
    lightMode: "Light mode",
    darkMode: "Dark mode",
    backup: "Backup",
    exportJson: "Download JSON",
    importJson: "Upload JSON",
    importDone: "Uploaded and merged.",
    importFailed: "Could not read the file.",
    version: "Version",
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  },
};

const langKey = "home-meters-lang";
export let lang = (() => {
  try {
    const saved = localStorage.getItem(langKey);
    if (saved in translations) return saved;
  } catch {}
  return navigator.language?.startsWith("cs") || navigator.language?.startsWith("sk") ? "cs" : "en";
})();

export function setLang(next) {
  lang = next;
  try {
    localStorage.setItem(langKey, next);
  } catch {}
  document.documentElement.lang = next;
}

export const t = (key, vars = {}) => {
  const text = translations[lang][key] ?? translations.en[key] ?? key;
  return typeof text === "string" ? text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "") : text;
};

const locale = () => (lang === "cs" ? "cs-CZ" : "en-GB");
export const fmt = (value, digits = 1) => new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(value);
export const fmtPct = (value) => new Intl.NumberFormat(locale(), { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" }).format(value);
export const fmtMonth = (month) => `${t("months")[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
export const fmtTime = (ms) => new Intl.DateTimeFormat(locale(), { dateStyle: "short", timeStyle: "short" }).format(ms);
export const unitLabel = (unit) => (unit === "m3" ? "m³" : unit);
