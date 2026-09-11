import test from "node:test";
import assert from "node:assert/strict";
import { addMonths, addDays, daysBetween, monthlyInstalments, balanceAt, liabilitiesAt, zakatableAt, eventDates, firstNisabDate, compute, series, nisabValue, nisabForYear, hijri, LUNAR_YEAR_DAYS, money } from "../calc.js";

const base = () => ({
  settings: { start: "2024-01-15", opening: 30000, currency: "SAR", calendar: "lunar", rate: 2.5, nisabMode: "gold", goldPrice: 300, graceDays: 60, carryForward: true, autoStart: true, restartOnDip: false },
  gains: [], amounts: [], payments: [], liabilities: [],
});
const yrs = (r) => r.years.map((y) => [y.n, y.end, y.status]);

test("dates: months clamp to the shorter month, days add exactly, a lunar year is 354 days", () => {
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonths("2024-01-31", 2), "2024-03-31");
  assert.equal(addDays("2024-01-15", LUNAR_YEAR_DAYS), "2025-01-03");
  assert.equal(daysBetween("2024-01-15", "2025-01-03"), 354);
  assert.match(hijri("2026-09-11"), /Rabi|1448/);
});

test("nisab: gold, silver, direct - and a price per year overrides the current one", () => {
  assert.equal(nisabValue({ nisabMode: "gold", goldPrice: 300 }), 25500);
  assert.equal(nisabValue({ nisabMode: "silver", silverPrice: 4 }), 2380);
  assert.equal(nisabValue({ nisabMode: "direct", nisabDirect: 20000 }), 20000);
  const s = { nisabMode: "gold", goldPrice: 300, yearPrices: { 1: 250, 2: "" } };
  assert.equal(nisabForYear(s, 1), 21250); assert.equal(nisabForYear(s, 2), 25500, "blank -> current price");
});

test("wealth on a day: gains, dated amounts, payments and debts; events; the first nisab day", () => {
  const d = base();
  d.gains.push({ amount: 1000, from: "2024-02-01" });
  d.amounts.push({ date: "2024-03-01", amount: 2500 }, { date: "2024-06-01", amount: -700 });
  d.payments.push({ date: "2024-04-01", amount: 300 });
  d.liabilities.push({ date: "2024-05-01", amount: 4000, until: "2024-07-01", note: "car loan" });
  assert.equal(balanceAt("2024-01-14", d), 0);
  assert.equal(balanceAt("2024-06-30", d), 30000 + 5000 + 2500 - 700 - 300);
  assert.equal(liabilitiesAt("2024-05-15", d), 4000); assert.equal(liabilitiesAt("2024-07-01", d), 0, "settled on its until date");
  assert.equal(zakatableAt("2024-05-15", d), balanceAt("2024-05-15", d) - 4000);
  assert.deepEqual(eventDates(d, "2024-01-01", "2024-03-15"), ["2024-01-15", "2024-02-01", "2024-03-01"]);
  assert.equal(monthlyInstalments({ amount: 500, from: "2024-02-10", to: "2024-05-31" }, "2024-12-31").length, 4);
  const low = base(); low.settings.opening = 20000; low.gains.push({ amount: 1000, from: "2024-02-15" });
  assert.equal(firstNisabDate(low, "2024-01-15", 25500, "2026-01-01"), "2024-07-15", "the sixth instalment takes it to 26,000");
});

test("the hawl begins the first day the wealth reaches nisab, not on the chosen date", () => {
  const d = base(); d.settings.opening = 20000; d.gains.push({ amount: 1000, from: "2024-02-15" });
  const r = compute(d, "2026-01-01");
  assert.equal(r.start, "2024-07-15"); assert.match(r.startNote, /began on 2024-07-15/);
  assert.equal(r.years[0].start, "2024-07-15"); assert.equal(r.years[0].end, addDays("2024-07-15", LUNAR_YEAR_DAYS));
  const never = base(); never.settings.opening = 1000;
  const rn = compute(never, "2026-01-01");
  assert.equal(rn.notStarted, true); assert.deepEqual(rn.years, []); assert.match(rn.reason, /has not reached it/);
  const off = base(); off.settings.opening = 20000; off.settings.autoStart = false;
  assert.equal(compute(off, "2026-01-01").years[0].start, "2024-01-15", "with the option off the chosen date is used");
});

test("verdicts with arrears first: a later payment settles the older debt before its own year", () => {
  const d = base(); d.gains.push({ amount: 1000, from: "2024-02-15" });
  // y1 ends 2025-01-03: 30000 + 11000 = 41000 -> due 1025; nothing paid -> below, owed 1025
  // y2 ends 2025-12-24: 53000 -> due 1325; pay 2350 on 2025-12-28 -> 1025 clears y1, 1325 clears y2 -> both met
  d.payments.push({ date: "2025-12-28", amount: 2350 });
  let r = compute(d, "2026-06-01");
  const [y1, y2, y3] = r.years;
  assert.deepEqual(yrs(r).slice(0, 2), [[1, "2025-01-03", "met"], [2, "2025-12-24", "met"]]);
  assert.equal(y1.paid, 0); assert.equal(y1.fromLater, 1025); assert.equal(y1.owed, 0);
  assert.equal(y2.paid, 2350); assert.equal(y2.toArrears, 1025); assert.equal(y2.applied, 1325); assert.equal(y2.owed, 0); assert.equal(y2.surplus, 0);
  assert.equal(y3.status, "current"); assert.equal(r.totals.outstanding, 0);
  // pay only 2000 instead: y1 cleared (1025), y2 gets 975 of 1325 -> y2 below by 350, outstanding 350
  d.payments[0].amount = 2000;
  r = compute(d, "2026-06-01");
  assert.deepEqual(yrs(r).slice(0, 2), [[1, "2025-01-03", "met"], [2, "2025-12-24", "below"]]);
  assert.equal(r.years[1].owed, 350); assert.equal(r.totals.outstanding, 350);
  // pay 3000: both met and 650 carries into year 3
  d.payments[0].amount = 3000;
  r = compute(d, "2026-06-01");
  assert.equal(r.years[1].status, "above"); assert.equal(r.years[1].surplus, 650); assert.equal(r.years[2].carriedIn, 650); assert.equal(r.totals.surplus, 650);
});

test("payment attribution: grace window after a year end, else the year in progress, else the chosen year", () => {
  const d = base(); d.gains.push({ amount: 1000, from: "2024-02-15" });
  d.payments.push({ date: "2024-06-01", amount: 100 }, { date: "2025-01-20", amount: 200 }, { date: "2025-03-20", amount: 300 }, { date: "2025-04-20", amount: 400, forYear: 1 });
  const r = compute(d, "2026-06-01");
  assert.deepEqual(r.years[0].payments.map((p) => p.amount), [100, 200, 400], "advance during y1, within grace after y1, chosen");
  assert.deepEqual(r.years[1].payments.map((p) => p.amount), [300], "past the grace window: the year in progress");
});

test("nisab per year: a lower gold price for year 1 turns a below-nisab year into a due one", () => {
  const d = base(); d.settings.opening = 24000;                    // 24,000 < 25,500 at 300/g
  d.settings.autoStart = false;
  let r = compute(d, "2026-01-01");
  assert.equal(r.years[0].status, "below-nisab");
  d.settings.yearPrices = { 1: 280 };                                // 23,800 -> due
  r = compute(d, "2026-01-01");
  assert.equal(r.years[0].nisab, 23800); assert.equal(r.years[0].status, "below"); assert.equal(r.years[0].due, 600);
});

test("debts due are deducted at assessment; a dip below nisab is flagged, and restarts the hawl when that rule is on", () => {
  const d = base();                                                  // 30,000 flat, nisab 25,500
  d.liabilities.push({ date: "2024-06-01", amount: 6000, until: "2024-11-01", note: "loan" });
  let r = compute(d, "2026-01-01");
  assert.equal(r.years[0].wealth, 30000, "the loan was settled before the year end, so nothing is deducted then");
  assert.equal(r.years[0].dipped, true); assert.equal(r.years[0].dipDate, "2024-06-01"); assert.equal(r.years[0].minWealth, 24000);
  assert.equal(r.years[0].status, "below", "Hanafi default: only the year end counts, and nothing was paid");
  d.settings.restartOnDip = true;
  r = compute(d, "2026-01-01");
  assert.equal(r.years[0].status, "broken"); assert.equal(r.years[0].brokenOn, "2024-06-01");
  assert.equal(r.years[1].n, 1); assert.equal(r.years[1].start, "2024-11-01", "the hawl restarts the day the wealth is back at nisab");
  assert.equal(r.totals.broken, 1);
  const open = base(); open.liabilities.push({ date: "2024-06-01", amount: 6000 });      // never settled
  assert.equal(compute(open, "2026-01-01").years[0].wealth, 24000, "an open debt is deducted at the year end");
});

test("the current year is projected; no start means nothing; series covers start to the current year end", () => {
  const d = base(); d.gains.push({ amount: 1000, from: "2024-02-15" });
  const r = compute(d, "2025-06-01");
  assert.equal(r.years.length, 2); assert.equal(r.current.n, 2); assert.equal(r.current.daysLeft, daysBetween("2025-06-01", r.current.end));
  assert.equal(r.current.wealthToday, zakatableAt("2025-06-01", d));
  assert.deepEqual(compute({ settings: {} }, "2026-01-01").years, []);
  const pts = series(d, "2025-06-01", r);
  assert.equal(pts[0].date, "2024-01-15"); assert.equal(pts.at(-1).date, r.current.end);
  assert.ok(pts.some((p) => p.date === "2025-06-01" && !p.projected) && pts.at(-1).projected);
  assert.ok(pts.every((p) => p.nisab === 25500));
});

test("money formatting", () => {
  assert.equal(money(1234.5, "SAR"), "1,234.50 SAR"); assert.equal(money(0), "0.00");
});
