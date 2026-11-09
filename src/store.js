import { emptyState, normalizeState } from "./data.js";

// The data kept in this browser; every change is announced so the screens redraw and Dropbox syncs.
const key = "home-meters-state";

let state = (() => {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(key)));
  } catch {
    return emptyState();
  }
})();

export const getState = () => state;

export function replaceState(next, { silent = false } = {}) {
  state = next;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {}
  window.dispatchEvent(new CustomEvent("data-change", { detail: { local: !silent } }));
}

export const update = (fn) => replaceState(fn(state));
