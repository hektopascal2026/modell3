import { yearByMonth } from "./personnel.js";

const YEAR_KEYS = ["costY1", "costY2", "costY3", "costY4"];

export const getCostForYear = (item, year) => {
  const key = YEAR_KEYS[year - 1] ?? "costY4";
  if (year === 4) return item.costY4 ?? item.costY3 ?? 0;
  return item[key] ?? 0;
};

const isEinmalig = (item) => {
  const y2 = item.costY2 ?? 0;
  const y3 = item.costY3 ?? 0;
  return item.id === "sach-4" || item.id === "sach-6" || (item.costY1 > 0 && y2 === 0 && y3 === 0 && !item.unitMonth);
};

/** Monthly sachkosten from per-year totals (GJ1–GJ3 editable; GJ4 = GJ3). */
export const calcMonthlySachkosten = (items, month, { fteSum = 0, excludeIds = [] } = {}) => {
  const year = yearByMonth(month);
  const monthInYear = ((month - 1) % 12) + 1;
  let total = 0;
  const breakdown = {};

  for (const item of items) {
    if (excludeIds.includes(item.id) || item.id === "sach-23") continue;

    const annual = getCostForYear(item, year);
    let monthly = 0;

    if (isEinmalig(item)) {
      monthly = monthInYear === 1 ? annual : 0;
    } else {
      monthly = annual / 12;
    }

    breakdown[item.id] = monthly;
    total += monthly;
  }

  return { total, breakdown };
};

export const calcReserveMonthly = (items, month, reserveItem, breakdown) => {
  if (!reserveItem) return 0;
  const year = yearByMonth(month);
  const override = getCostForYear(reserveItem, year);
  if (override > 0) return override / 12;

  const annualExclFreelance = items
    .filter((i) => i.id !== "sach-23" && i.id !== "sach-1")
    .reduce((sum, i) => sum + getCostForYear(i, year), 0);

  const rate = reserveItem.unitMonth ?? 0.1;
  return (annualExclFreelance * rate) / 12;
};

export const calcYearlySachkosten = (items, year, fteByMonthFn) => {
  const startM = (year - 1) * 12 + 1;
  const endM = year * 12;
  let total = 0;
  const reserveItem = items.find((i) => i.id === "sach-23");

  for (let m = startM; m <= endM; m += 1) {
    const { total: base, breakdown } = calcMonthlySachkosten(items, m, {
      fteSum: fteByMonthFn ? fteByMonthFn(m) : 0,
    });
    const reserve = calcReserveMonthly(items, m, reserveItem, breakdown);
    total += base + reserve;
  }
  return total;
};
