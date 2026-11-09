export const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// A number typed with a comma or a dot, or null when empty or not a number.
export const parseNumber = (text) => {
  const clean = String(text ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : NaN;
};

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let toastTimer = null;
export function toast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2000);
}
