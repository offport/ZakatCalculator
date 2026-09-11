// Zakat calculator - the arithmetic. Pure: no DOM, no storage, unit tested.
//
// Model. A zakat year (hawl) is a lunar year, 354.367 days. It begins on the first
// day the zakatable wealth reaches the nisab (from the date the user chose - if the
// wealth was already at nisab that day, that day). Zakatable wealth on any day =
// opening amount + monthly gains accrued + dated amounts - zakat paid - debts due
// that day. At each year's end: if the wealth is at or above that year's nisab
// (gold / silver price of that year), zakat due = rate x wealth. Payments belong to
// a year (within the grace window after a year's end -> that year; otherwise the
// year in progress; or the year the user picks) and are applied oldest debt first:
// arrears of earlier years, then the year's own due; what is left carries forward.
// Optionally the hawl restarts when the wealth falls below nisab during a year
// (Shafi'i / Maliki / Hanbali); by default only the year's end counts (Hanafi).

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
  yearPrices: {},                // { [n]: price (or direct nisab) at year n's end } - overrides the current price for that year
  graceDays: 60, carryForward: true,
  autoStart: true,               // the hawl begins the first day the wealth reaches nisab
  restartOnDip: false,           // Shafi'i / Maliki / Hanbali: a dip below nisab restarts the hawl
};
export function yearLength(calendar) { return calendar === "solar" ? SOLAR_YEAR_DAYS : LUNAR_YEAR_DAYS; }
/** The current price (or direct amount) the nisab is built from. */
export function currentPrice(s) { return Number(s.nisabMode === "silver" ? s.silverPrice : s.nisabMode === "direct" ? s.nisabDirect : s.goldPrice) || 0; }
export function nisabFromPrice(s, price) { return s.nisabMode === "direct" ? (Number(price) || 0) : (Number(price) || 0) * (s.nisabMode === "silver" ? SILVER_NISAB_GRAMS : GOLD_NISAB_GRAMS); }
/** The nisab in the user's currency from the chosen standard, at today's price. */
export function nisabValue(s) { return nisabFromPrice(s, currentPrice(s)); }
/** Price used for year n: the year's own price if set, else the current one. */
export function priceForYear(s, n) { const p = s.yearPrices?.[n]; return p != null && p !== "" && Number(p) > 0 ? Number(p) : currentPrice(s); }
export const nisabForYear = (s, n) => nisabFromPrice(s, priceForYear(s, n));

/* ---------- the timeline ---------- */
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
/** Gross wealth on a day: opening + gains accrued + dated amounts - zakat paid, all on or before that day. */
export function balanceAt(iso, data) {
  const s = data.settings;
  if (!s.start || iso < s.start) return 0;
  let b = Number(s.opening) || 0;
  for (const g of data.gains || []) for (const m of monthlyInstalments(g, iso)) if (m.date >= s.start) b += m.amount;
  for (const a of data.amounts || []) if (a.date && a.date >= s.start && a.date <= iso) b += Number(a.amount) || 0;
  for (const p of data.payments || []) if (p.date && p.date <= iso) b -= Number(p.amount) || 0;
  return Math.round(b * 100) / 100;
}
/** Debts outstanding on a day: each liability counts from its date until it is settled (its `until`, if any). */
export function liabilitiesAt(iso, data) {
  let d = 0;
  for (const l of data.liabilities || []) if (l.date && l.date <= iso && (!l.until || iso < l.until)) d += Number(l.amount) || 0;
  return Math.round(d * 100) / 100;
}
/** What zakat is assessed on: gross wealth minus debts due. */
export const zakatableAt = (iso, data) => Math.round((balanceAt(iso, data) - liabilitiesAt(iso, data)) * 100) / 100;
/** Every day on which the wealth can change, on or after `from` and up to `until`, sorted. */
export function eventDates(data, from, until) {
  const s = data.settings, set = new Set();
  const add = (d) => { if (d && d >= from && d <= until) set.add(d); };
  add(s.start);
  for (const g of data.gains || []) for (const m of monthlyInstalments(g, until)) add(m.date);
  for (const a of data.amounts || []) add(a.date);
  for (const p of data.payments || []) add(p.date);
  for (const l of data.liabilities || []) { add(l.date); if (l.until) add(l.until); }
  return [...set].sort();
}
/** The first day on or after `from` when the zakatable wealth is at least `nisab`; null if never (up to `until`). */
export function firstNisabDate(data, from, nisab, until) {
  if (zakatableAt(from, data) >= nisab) return from;
  for (const d of eventDates(data, from, until)) if (d > from && zakatableAt(d, data) >= nisab) return d;
  return null;
}

/* ---------- the verdicts ---------- */
const r2 = (v) => Math.round(v * 100) / 100;
/**
 * Everything the results view shows. `today` is ISO. Years whose end is on or before
 * today are settled; the one containing today is "current" (projected).
 */
export function compute(data, today) {
  const s = { ...DEFAULTS, ...(data.settings || {}) };
  const empty = { years: [], current: null, totals: null, nisab: nisabValue(s), start: null, startNote: "", notStarted: false, today, rate: Number(s.rate) || 2.5, calendar: s.calendar };
  if (!s.start) return empty;
  const len = yearLength(s.calendar), rate = (Number(s.rate) || 2.5) / 100, grace = Number(s.graceDays) || 0;
  const horizon = addDays(today, len * 2);

  // 1. when does the hawl begin? (judged at today's price - the per-year prices are for each year's end)
  let start = s.start, startNote = "";
  const nisab0 = nisabValue(s);
  if (s.autoStart && nisab0 > 0 && zakatableAt(s.start, data) < nisab0) {
    const d = firstNisabDate(data, s.start, nisab0, horizon);
    if (!d || d > today) return { ...empty, notStarted: true, reason: `on ${s.start} the wealth (${zakatableAt(s.start, data)}) was below the nisab (${nisab0}), and it has not reached it since - no zakat year has begun` };
    start = d; startNote = `The zakat year began on ${d}, the first day the wealth reached the nisab - on ${s.start} it was below it.`;
  }

  // 2. the years: each ends a year after it starts; a dip below nisab is noted, and restarts the hawl if that rule is on
  const years = [];
  let n = 1, ys = start, base = start, k = 1;                     // base/k: the chain start and the year's index in it (cumulative rounding)
  for (let guard = 0; guard < 400; guard++) {
    const ye = addDays(base, len * k), settled = ye <= today, nisab = nisabForYear(s, n);
    const upto = settled ? ye : today;
    let dipDate = null, minW = Infinity;
    for (const d of eventDates(data, ys, upto)) { if (d <= ys) continue; const w = zakatableAt(d, data); if (w < minW) minW = w; if (w < nisab && nisab > 0) { dipDate = d; break; } }
    if (dipDate && s.restartOnDip) {
      years.push({ n, start: ys, end: ye, status: "broken", brokenOn: dipDate, nisab, settled: true, due: 0, paid: 0, payments: [], hijriStart: hijri(ys, "short"), hijriEnd: hijri(dipDate, "short") });
      const again = firstNisabDate(data, dipDate, nisab, horizon);
      if (!again || again > today) break;                          // the hawl has not resumed yet
      ys = again; base = again; k = 1; continue;
    }
    const gross = balanceAt(ye, data), debts = liabilitiesAt(ye, data), wealth = zakatableAt(ye, data);
    const aboveNisab = nisab > 0 && wealth >= nisab;
    years.push({ n, start: ys, end: ye, settled, nisab, price: priceForYear(s, n), gross, debts, wealth, aboveNisab, due: aboveNisab ? r2(wealth * rate) : 0,
      dipped: !!dipDate, dipDate, minWealth: minW === Infinity ? wealth : minW, payments: [], paid: 0, carriedIn: 0, toArrears: 0, fromLater: 0, applied: 0, owed: 0, surplus: 0,
      daysLeft: settled ? 0 : daysBetween(today, ye), hijriStart: hijri(ys, "short"), hijriEnd: hijri(ye, "short") });
    if (!settled) break;
    n++; k++; ys = ye;
  }
  const real = years.filter((y) => y.status !== "broken");

  // 3. which year each payment is for
  const yearOf = (p) => {
    if (p.forYear && real.some((y) => y.n === Number(p.forYear))) return Number(p.forYear);
    if (!p.date) return real[0]?.n ?? 1;
    const ended = real.filter((y) => y.end <= p.date && daysBetween(y.end, p.date) <= grace).at(-1);
    if (ended) return ended.n;
    const inside = real.find((y) => p.date > y.start && p.date <= y.end) || real.find((y) => p.date <= y.start) || real.at(-1);
    return inside?.n ?? 1;
  };
  for (const p of (data.payments || []).filter((p) => p.date && Number(p.amount) > 0)) { const y = real.find((x) => x.n === yearOf(p)); if (y) y.payments.push({ ...p, amount: Number(p.amount) }); }
  for (const y of real) { y.payments.sort((a, b) => a.date.localeCompare(b.date)); y.paid = r2(y.payments.reduce((a, p) => a + p.amount, 0)); }

  // 4. settle: oldest debt first, then the year's own due, then carry the rest forward
  let carry = 0;
  for (const y of real) {
    let pool = r2(y.paid + carry); y.carriedIn = carry;
    for (const prev of real) { if (prev === y) break; if (!prev.settled || prev.owed < 0.005 || pool <= 0) continue; const pay = r2(Math.min(pool, prev.owed)); prev.owed = r2(prev.owed - pay); prev.fromLater = r2(prev.fromLater + pay); y.toArrears = r2(y.toArrears + pay); pool = r2(pool - pay); }
    y.applied = r2(Math.min(pool, y.due)); y.owed = r2(y.due - y.applied); pool = r2(pool - y.applied);
    y.surplus = pool;
    carry = y.settled && s.carryForward ? pool : 0;
  }
  for (const y of real) {
    if (!y.settled) y.status = "current";
    else if (y.nisab <= 0) y.status = "no-nisab";
    else if (!y.aboveNisab) y.status = "below-nisab";
    else if (y.owed >= 0.5) y.status = "below";
    else if (y.surplus >= 0.5) y.status = "above";
    else y.status = "met";
  }

  // 5. totals
  const settled = real.filter((y) => y.settled);
  const lastSettled = settled.at(-1);
  const totals = { due: r2(settled.reduce((a, y) => a + y.due, 0)), paid: r2(real.reduce((a, y) => a + y.paid, 0)),
    outstanding: r2(settled.reduce((a, y) => a + y.owed, 0)),
    surplus: r2(lastSettled && s.carryForward ? lastSettled.surplus : settled.reduce((a, y) => a + (y.status === "above" ? y.surplus : 0), 0)),
    met: settled.filter((y) => y.status === "met").length, above: settled.filter((y) => y.status === "above").length, below: settled.filter((y) => y.status === "below").length,
    belowNisab: settled.filter((y) => y.status === "below-nisab").length, broken: years.filter((y) => y.status === "broken").length, dipped: real.filter((y) => y.dipped).length };
  const current = real.find((y) => !y.settled) || null;
  if (current) { current.wealthToday = zakatableAt(today, data); current.grossToday = balanceAt(today, data); current.debtsToday = liabilitiesAt(today, data); }
  return { years, current, totals, nisab: nisabValue(s), start, startNote, notStarted: false, today, rate: rate * 100, calendar: s.calendar };
}

/* ---------- the chart: zakatable wealth over time ---------- */
/**
 * Points for a line chart from the hawl start to the current year's end: every day the wealth
 * changes, every year end, and today. Each point carries that year's nisab; points after
 * today are projections.
 */
export function series(data, today, result) {
  const real = (result?.years || []).filter((y) => y.status !== "broken");
  if (!real.length) return [];
  const from = real[0].start, until = real.at(-1).end;
  const dates = new Set([from, today, until, ...eventDates(data, from, until), ...real.map((y) => y.end)]);
  const nisabAt = (d) => (real.find((y) => d > y.start && d <= y.end) || real.find((y) => d <= y.start) || real.at(-1)).nisab;
  return [...dates].filter((d) => d >= from && d <= until).sort().map((d) => ({ date: d, wealth: zakatableAt(d, data), gross: balanceAt(d, data), nisab: nisabAt(d), projected: d > today }));
}

/* ---------- money formatting ---------- */
export function money(v, currency = "") {
  const n = Number(v) || 0;
  const s = n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${s} ${currency}` : s;
}
