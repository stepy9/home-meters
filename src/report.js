// A year on paper: per commodity the use and costs by month, the year's totals against the year before and the
// goal, and the emissions.
import { commodityCosts } from "./costs.js";
import { COMMODITIES, byYear, commodityConsumption } from "./data.js";
import { emissions } from "./insights.js";

const sum = (months) => {
  const known = (months ?? []).filter(Boolean);
  return known.length ? known.reduce((s, m) => s + m.total, 0) : null;
};

// A year against the one before over the months both know, so a year begun in November is not compared whole:
// { nowUsage, prevUsage } (or Cost), null where no month is shared.
function sameMonths(months, prev, kind) {
  const both = (months ?? []).map((m, i) => (m && prev?.[i] ? [m.total, prev[i].total] : null)).filter(Boolean);
  const key = kind === "usage" ? "Usage" : "Cost";
  if (!both.length) return { [`now${key}`]: null, [`prev${key}`]: null };
  return { [`now${key}`]: both.reduce((s, [a]) => s + a, 0), [`prev${key}`]: both.reduce((s, [, b]) => s + b, 0) };
}

// Years with any use, newest first.
export const reportYears = (state) =>
  [...new Set(COMMODITIES.flatMap((c) => [...commodityConsumption(state, c).keys()].map((m) => Number(m.slice(0, 4)))))].sort((a, b) => b - a);

// { year, commodities: [{ commodity, usage: [12 × { value, estimated } | null], cost: [12], totals, goal }],
// costs: [12 household totals], total, prevTotal, emissions }. A commodity without use that year is left out.
export function yearReport(state, year) {
  const commodities = [];
  for (const commodity of COMMODITIES) {
    const use = byYear(commodityConsumption(state, commodity)).table;
    const cost = byYear(new Map([...commodityCosts(state, commodity)].filter(([, r]) => r))).table;
    const usage = use.get(year);
    if (!usage?.some(Boolean)) continue;
    const costs = cost.get(year) ?? Array(12).fill(null);
    commodities.push({
      commodity,
      usage: usage.map((m) => (m ? { value: m.total, estimated: m.estimated } : null)),
      cost: costs.map((m) => m?.total ?? null),
      totals: { usage: sum(usage), cost: sum(costs), ...sameMonths(usage, use.get(year - 1), "usage"), ...sameMonths(costs, cost.get(year - 1), "cost"), months: usage.filter(Boolean).length },
      goal: state.config.goals?.[commodity] ?? null,
    });
  }
  const costs = Array.from({ length: 12 }, (_, i) => {
    const parts = commodities.map((c) => c.cost[i]).filter((v) => v != null);
    return parts.length ? parts.reduce((s, v) => s + v, 0) : null;
  });
  const total = commodities.reduce((s, c) => s + (c.totals.cost ?? 0), 0);
  const nowShared = commodities.reduce((s, c) => s + (c.totals.nowCost ?? 0), 0);
  const prevTotal = commodities.reduce((s, c) => s + (c.totals.prevCost ?? 0), 0);
  return { year, commodities, costs, total, nowShared, prevTotal, emissions: emissions(state, year) };
}
