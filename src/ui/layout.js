// The order of the overview's cards and which are hidden, set in Settings and kept per device.
// A card only shows where it applies (some in the usage view, some in the costs view); the order covers them all.
export const CARDS = ["supplier", "forecast", "year", "compare", "table", "upgrades", "bills", "price", "offers"];

const key = "home-meters-layout";

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(key)) ?? {};
    const order = (saved.order ?? []).filter((c) => CARDS.includes(c));
    // A card added in a later version goes where it sits by default.
    for (const c of CARDS) if (!order.includes(c)) order.splice(Math.min(CARDS.indexOf(c), order.length), 0, c);
    return { order, hidden: new Set((saved.hidden ?? []).filter((c) => CARDS.includes(c))) };
  } catch {
    return { order: [...CARDS], hidden: new Set() };
  }
}

let layout = load();

function save() {
  try {
    localStorage.setItem(key, JSON.stringify({ order: layout.order, hidden: [...layout.hidden] }));
  } catch {}
}

export const cardOrder = () => layout.order;
export const cardHidden = (card) => layout.hidden.has(card);

export function moveCard(card, step) {
  const from = layout.order.indexOf(card);
  const to = from + step;
  if (from < 0 || to < 0 || to >= layout.order.length) return;
  layout.order.splice(to, 0, ...layout.order.splice(from, 1));
  save();
}

export function setCardHidden(card, hidden) {
  if (hidden) layout.hidden.add(card);
  else layout.hidden.delete(card);
  save();
}

export function resetLayout() {
  layout = { order: [...CARDS], hidden: new Set() };
  save();
}
