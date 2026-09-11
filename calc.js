// Zakat calculator - the arithmetic. Pure: no DOM, no storage, unit tested.
//
// Model: a zakat year (hawl) is a lunar year, 354.367 days, counted from the
// start date the user chose. Wealth on any day = opening amount + monthly gains
// accrued so far + dated amounts on or before that day - zakat paid on or before
// that day. At each year's end: if wealth >= nisab, zakat due = rate x wealth.
// Payments are attributed to a year: one made within the grace window after a
// year's end belongs to that year; otherwise to the year in progress (advance).
// Overpayment can carry forward. Verdict per year: met / above / below.

export const LUNAR_YEAR_DAYS = 354.36707;
export const SOLAR_YEAR_DAYS = 365.2425;
export const GOLD_NISAB_GRAMS = 85;
export const SILVER_NISAB_GRAMS = 595;
export const DAY_MS = 86_400_000;

/* ---------- dates: ISO strings (YYYY-MM-DD), UTC noon inside so DST never shifts a day ---------- */
export const toDate = (iso) => new Date(`${iso}T12:00:00Z`);
export const toISO = (d) => d.toISOString().slice(0, 10);
export const addDays = (iso, n) => toISO(new Date(toDate(iso).getTime() + Math.round(n) * DAY_MS));
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY_MS);
/** Same day of month n months on; the 31st becomes the last day of a shorter month. */
export function addMonths(iso, n) {
  const d = toDate(iso), day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, 12));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return toISO(t);
}
/** Hijri date for display, from the browser's / Node's own calendar data. */
export function hijri(iso, style = "long") {
  try { return new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: style, year: "numeric" }).format(toDate(iso)).replace(/ AH$/, ""); }
  catch { return ""; }
}

/* ---------- settings ---------- */
export const DEFAULTS = {
  start: "", opening: 0, currency: "", calendar: "lunar", rate: 2.5,
  nisabMode: "gold", goldPrice: 0, silverPrice: 0, nisabDirect: 0,
  graceDays: 60, carryForward: true,
};
export function yearLength(calendar) { return calendar === "solar" ? SOLAR_YEAR_DAYS : LUNAR_YEAR_DAYS; }
/** The nisab in the user's currency from the chosen standard. */
export function nisabValue(s) {
  if (s.nisabMode === "silver") return (Number(s.silverPrice) || 0) * SILVER_NISAB_GRAMS;
  if (s.nisabMode === "direct") return Number(s.nisabDirect) || 0;
  return (Number(s.goldPrice) || 0) * GOLD_NISAB_GRAMS;
}

/* ---------- the timeline ---------- */
/** Year n runs (start + (n-1) years, start + n years]; ends on the day the wealth is assessed. */
export function yearWindow(start, n, calendar) {
  const len = yearLength(calendar);
  return { n, start: n === 1 ? start : addDays(start, len * (n - 1)), end: addDays(start, len * n) };
}
/** All the monthly gain instalments of one rule up to and including `until`. */
export function monthlyInstalments(g, until) {
  const out = [];
  if (!g.from || !(Number(g.amount) > 0)) return out;
  for (let i = 0; i < 1200; i++) {
    const d = addMonths(g.from, i);
    if (d > until) break;
    if (g.to && d > g.to) break;
    out.push({ date: d, amount: Number(g.amount) });
  }
  return out;
}
/** Wealth on a day: opening + gains accrued + dated amounts - zakat paid, all on or before that day. */
export function balanceAt(iso, data) {
  const s = data.settings;
  if (!s.start || iso < s.start) return 0;
  let b = Number(s.opening) || 0;
  for (const g of data.gains || []) for (const m of monthlyInstalments(g, iso)) if (m.date >= s.start) b += m.amount;
  for (const a of data.amounts || []) if (a.date && a.date >= s.start && a.date <= iso) b += Number(a.amount) || 0;
  for (const p of data.payments || []) if (p.date && p.date <= iso) b -= Number(p.amount) || 0;
  return Math.round(b * 100) / 100;
}

/* ---------- payments -> years ---------- */
/**
 * Which year a payment is for: a manual "forYear" wins; otherwise a payment within
 * graceDays after a year's end is for that year, and anything else is for the year
 * in progress on that date (an advance payment).
 */
export function yearOfPayment(p, s) {
  if (p.forYear) return Number(p.forYear);
  if (!s.start || !p.date || p.date < s.start) return 1;
  const len = yearLength(s.calendar), elapsed = daysBetween(s.start, p.date);
  const inProgress = Math.floor(elapsed / len) + 1;              // the year running on that day
  const ended = inProgress - 1;                                   // the year that ended most recently
  if (ended >= 1) { const endDay = addDays(s.start, len * ended); if (daysBetween(endDay, p.date) <= (Number(s.graceDays) || 0)) return ended; }
  return inProgress;
}

/* ---------- the verdicts ---------- */
const r2 = (v) => Math.round(v * 100) / 100;
/**
 * Everything the results view shows. `today` is ISO; years whose end is on or before today
 * are settled, the one containing today is "current" (projected), later ones are not shown.
 */
export function compute(data, today) {
  const s = { ...DEFAULTS, ...(data.settings || {}) };
  if (!s.start) return { years: [], current: null, totals: null, nisab: nisabValue(s) };
  const len = yearLength(s.calendar), rate = (Number(s.rate) || 2.5) / 100, nisab = nisabValue(s);
  const elapsed = Math.max(0, daysBetween(s.start, today));
  const currentN = Math.floor(elapsed / len) + 1;
  const paidByYear = {};
  for (const p of data.payments || []) { const n = yearOfPayment(p, s); (paidByYear[n] ??= []).push(p); }
  const years = [];
  let carry = 0, carryOut = 0;                                   // carryOut: what the last settled year passes on
  for (let n = 1; n <= currentN; n++) {
    const w = yearWindow(s.start, n, s.calendar);
    const settled = w.end <= today;
    const wealth = balanceAt(w.end, data);
    const aboveNisab = wealth >= nisab && nisab > 0;
    const due = aboveNisab ? r2(wealth * rate) : 0;
    const pays = (paidByYear[n] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const paid = r2(pays.reduce((a, p) => a + (Number(p.amount) || 0), 0));
    const credit = r2(paid + carry);
    const diff = r2(credit - due);
    let status;
    if (!settled) status = "current";
    else if (nisab <= 0) status = "no-nisab";
    else if (!aboveNisab) status = "below-nisab";
    else if (Math.abs(diff) < 0.5) status = "met";
    else if (diff > 0) status = "above";
    else status = "below";
    const year = { n, start: w.start, end: w.end, settled, wealth, nisab, aboveNisab, due, paid, carriedIn: carry, credit, diff, status,
      payments: pays, daysLeft: settled ? 0 : daysBetween(today, w.end), hijriStart: hijri(w.start, "short"), hijriEnd: hijri(w.end, "short") };
    years.push(year);
    carry = settled && s.carryForward && diff > 0 ? diff : 0;
    if (settled) carryOut = carry;
  }
  const settledYears = years.filter((y) => y.settled);
  // with carry-forward, a surplus that a later year already used up is not a surplus any more:
  // what is left is the carry going into the year in progress
  const totals = { due: r2(settledYears.reduce((a, y) => a + y.due, 0)), paid: r2(years.reduce((a, y) => a + y.paid, 0)),
    shortfall: r2(settledYears.filter((y) => y.status === "below").reduce((a, y) => a - y.diff, 0)),
    surplus: s.carryForward ? r2(carryOut) : r2(settledYears.filter((y) => y.status === "above").reduce((a, y) => a + y.diff, 0)),
    met: settledYears.filter((y) => y.status === "met").length, above: settledYears.filter((y) => y.status === "above").length, below: settledYears.filter((y) => y.status === "below").length,
    belowNisab: settledYears.filter((y) => y.status === "below-nisab").length };
  const current = years.find((y) => !y.settled) || null;
  if (current) current.wealthToday = balanceAt(today, data);
  return { years, current, totals, nisab, rate: rate * 100, calendar: s.calendar, today };
}

/* ---------- money formatting ---------- */
export function money(v, currency = "") {
  const n = Number(v) || 0;
  const s = n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${s} ${currency}` : s;
}
