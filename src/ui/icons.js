// Icons for the commodities, drawn in currentColor so the caller sets the color.
const paths = {
  electricity: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z"/>',
  gas: '<path d="M12 22c4 0 7-2.8 7-6.8 0-3.4-2.2-5.6-3.6-7.6-.4 1.8-1.4 3-2.6 3.6.3-3.4-1-6.8-3.8-9.2-.3 3.3-2 5.4-3.6 7.5C4.2 11.2 5 13.7 5 15.2 5 19.2 8 22 12 22Z"/><path d="M12 22c-1.7 0-3-1.3-3-3.1 0-1.9 1.6-3 3-4.9 1.4 1.9 3 3 3 4.9 0 1.8-1.3 3.1-3 3.1Z"/>',
  water: '<path d="M12 2.5s-6.5 7.2-6.5 12A6.5 6.5 0 0 0 12 21a6.5 6.5 0 0 0 6.5-6.5c0-4.8-6.5-12-6.5-12Z"/><path d="M9 14.5a3 3 0 0 0 3 3"/>',
};

export const commodityIcon = (commodity, className = "c-icon") =>
  `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${paths[commodity] ?? ""}</svg>`;
