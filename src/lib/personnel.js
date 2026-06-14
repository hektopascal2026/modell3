export const yearByMonth = (month) => Math.min(4, Math.ceil(month / 12));

export const getMonthsForYear = (role, year) => {
  if (year === 1) return role.monthsY1 ?? 0;
  if (year === 2) return role.monthsY2 ?? 0;
  if (year === 3) return role.monthsY3 ?? 0;
  return role.monthsY4 ?? role.monthsY3 ?? 0;
};

/** Role active in absolute month m based on startMonth + per-year duration segments. */
export const isRoleActive = (role, month) => {
  const start = role.startMonth ?? 1;
  if (month < start) return false;

  let segmentStart = start;
  for (let y = yearByMonth(start); y <= 4; y += 1) {
    const monthsActive = getMonthsForYear(role, y);
    if (monthsActive <= 0) {
      segmentStart = y * 12 + 1;
      continue;
    }
    const segmentEnd = segmentStart + monthsActive - 1;
    if (month >= segmentStart && month <= segmentEnd) return true;
    segmentStart = y * 12 + 1;
  }
  return false;
};

export const calcMonthlyPersonnel = (roles, month, sozialPct = 16) => {
  let bruttolohn = 0;
  let fteSum = 0;

  for (const role of roles) {
    if (!isRoleActive(role, month)) continue;
    bruttolohn += (role.salaryMonth ?? 0) * (role.fte ?? 0);
    fteSum += role.fte ?? 0;
  }

  const sozialabgaben = bruttolohn * (sozialPct / 100);
  return {
    bruttolohn,
    sozialabgaben,
    personalkosten: bruttolohn + sozialabgaben,
    fteSum,
  };
};

export const calcYearlyPersonnel = (roles, year, sozialPct = 16) => {
  const startM = (year - 1) * 12 + 1;
  const endM = year * 12;
  let total = 0;
  for (let m = startM; m <= endM; m += 1) {
    total += calcMonthlyPersonnel(roles, m, sozialPct).personalkosten;
  }
  return total;
};
