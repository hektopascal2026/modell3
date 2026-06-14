import { yearByMonth } from "./personnel.js";

const YEAR_KEYS = ["costY1", "costY2", "costY3", "costY4"];

export const isPerHeadItem = (item) =>
  item.type === "perHead" || item.ratePerHead != null;

export const getCostForYear = (item, year) => {
  const key = YEAR_KEYS[year - 1] ?? "costY4";
  if (year === 4) return item.costY4 ?? item.costY3 ?? 0;
  return item[key] ?? 0;
};

const isEinmalig = (item) => {
  if (isPerHeadItem(item)) return false;
  const y2 = item.costY2 ?? 0;
  const y3 = item.costY3 ?? 0;
  return item.id === "sach-4" || item.id === "sach-6" || (item.costY1 > 0 && y2 === 0 && y3 === 0 && !item.unitMonth);
};

/** Monthly sachkosten; perHead-Positionen: ratePerHead × aktiver Headcount. */
export const calcMonthlySachkosten = (items, month, { headSum = 0, excludeIds = [] } = {}) => {
  const year = yearByMonth(month);
  const monthInYear = ((month - 1) % 12) + 1;
  let total = 0;
  const breakdown = {};

  for (const item of items) {
    if (excludeIds.includes(item.id) || item.id === "sach-23") continue;

    let monthly = 0;

    if (isPerHeadItem(item)) {
      monthly = (item.ratePerHead ?? 0) * headSum;
    } else if (isEinmalig(item)) {
      const annual = getCostForYear(item, year);
      monthly = monthInYear === 1 ? annual : 0;
    } else {
      monthly = getCostForYear(item, year) / 12;
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

  const monthlyBase = Object.entries(breakdown)
    .filter(([id]) => id !== "sach-1")
    .reduce((sum, [, value]) => sum + value, 0);

  const rate = reserveItem.unitMonth ?? 0.1;
  return monthlyBase * rate;
};

export const calcYearlySachkosten = (items, year, headSumByMonth) => {
  const startM = (year - 1) * 12 + 1;
  const endM = year * 12;
  let total = 0;
  const reserveItem = items.find((i) => i.id === "sach-23");

  for (let m = startM; m <= endM; m += 1) {
    const headSum = headSumByMonth ? headSumByMonth(m) : 0;
    const { total: base, breakdown } = calcMonthlySachkosten(items, m, { headSum });
    const reserve = calcReserveMonthly(items, m, reserveItem, breakdown);
    total += base + reserve;
  }
  return total;
};

export const calcYearlyPerHeadCost = (items, itemId, year, headSumByMonth) => {
  const startM = (year - 1) * 12 + 1;
  const endM = year * 12;
  let total = 0;
  for (let m = startM; m <= endM; m += 1) {
    const { breakdown } = calcMonthlySachkosten(items, m, {
      headSum: headSumByMonth ? headSumByMonth(m) : 0,
    });
    total += breakdown[itemId] ?? 0;
  }
  return total;
};
