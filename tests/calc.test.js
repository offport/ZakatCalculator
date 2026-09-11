import test from "node:test";
import assert from "node:assert/strict";
import { addMonths, addDays, daysBetween, yearWindow, monthlyInstalments, balanceAt, yearOfPayment, compute, nisabValue, hijri, LUNAR_YEAR_DAYS, money } from "../calc.js";

const base = () => ({
  settings: { start: "2024-01-15", opening: 10000, currency: "SAR", calendar: "lunar", rate: 2.5, nisabMode: "gold", goldPrice: 300, graceDays: 60, carryForward: true },
  gains: [], amounts: [], payments: [],
});

test("dates: months clamp to the shorter month, days add exactly, lunar year is 354 days", () => {
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonths("2024-01-31", 2), "2024-03-31");
  assert.equal(addMonths("2024-03-15", 12), "2025-03-15");
  assert.equal(addDays("2024-01-15", LUNAR_YEAR_DAYS), "2025-01-03");
  assert.equal(daysBetween("2024-01-15", "2025-01-03"), 354);
  const w = yearWindow("2024-01-15", 2, "lunar");
  assert.deepEqual(w, { n: 2, start: "2025-01-03", end: "2025-12-24" }, "cumulative: round(2 x 354.367) = 709 days");
  assert.equal(yearWindow("2024-01-15", 1, "solar").end, "2025-01-14");
});

test("hijri display comes from the platform calendar", () => {
  assert.match(hijri("2026-09-11"), /Rabi|1448/);
});

test("nisab from gold, silver or a direct amount", () => {
  assert.equal(nisabValue({ nisabMode: "gold", goldPrice: 300 }), 25500);
  assert.equal(nisabValue({ nisabMode: "silver", silverPrice: 4 }), 2380);
  assert.equal(nisabValue({ nisabMode: "direct", nisabDirect: 20000 }), 20000);
});

test("monthly gains accrue on the same day each month, from a start, optionally to an end", () => {
  const g = { amount: 500, from: "2024-02-10", to: "2024-05-31" };
  assert.deepEqual(monthlyInstalments(g, "2024-12-31").map((m) => m.date), ["2024-02-10", "2024-03-10", "2024-04-10", "2024-05-10"]);
  assert.equal(monthlyInstalments({ amount: 500, from: "2024-02-10" }, "2024-04-01").length, 2);
  assert.equal(monthlyInstalments({ amount: 0, from: "2024-02-10" }, "2024-12-31").length, 0);
});

test("balance on a day: opening + gains + dated amounts - payments, nothing before the start", () => {
  const d = base();
  d.gains.push({ amount: 1000, from: "2024-02-01" });
  d.amounts.push({ date: "2024-03-01", amount: 2500 }, { date: "2024-06-01", amount: -700 }, { date: "2030-01-01", amount: 99999 });
  d.payments.push({ date: "2024-04-01", amount: 300 });
  assert.equal(balanceAt("2024-01-14", d), 0, "before the start");
  assert.equal(balanceAt("2024-01-15", d), 10000);
  assert.equal(balanceAt("2024-03-01", d), 10000 + 2000 + 2500);
  assert.equal(balanceAt("2024-06-30", d), 10000 + 5000 + 2500 - 700 - 300);
});

test("payments: within the grace window after a year end they belong to that year, otherwise to the year in progress; a manual year wins", () => {
  const s = base().settings;
  assert.equal(yearOfPayment({ date: "2024-06-01", amount: 1 }, s), 1, "during year 1: advance for year 1");
  assert.equal(yearOfPayment({ date: "2025-01-20", amount: 1 }, s), 1, "17 days after year 1 ended: for year 1");
  assert.equal(yearOfPayment({ date: "2025-03-20", amount: 1 }, s), 2, "past the 60-day grace: for year 2");
  assert.equal(yearOfPayment({ date: "2025-03-20", amount: 1, forYear: 1 }, s), 1, "override");
});

test("compute: a settled year met, one overpaid with carry-forward, one underpaid, and the current year projected", () => {
  const d = base();
  d.gains.push({ amount: 1000, from: "2024-02-15" });
  // year 1 ends 2025-01-03: wealth = 10000 + 11 x 1000 (Feb..Dec) = 21000 -> below the 25500 nisab -> nothing due
  // year 2 ends 2025-12-24: wealth = 21000 + 12 x 1000 = 33000; pay 825 (2.5%) right after
  d.payments.push({ date: "2025-12-28", amount: 825 });
  // year 3 ends 2026-12-13 (before the Dec 15 instalment): 33000 - 825 + 11 x 1000 = 43175 -> due 1079.38; pay 1300 -> above by 220.62 (carried)
  d.payments.push({ date: "2027-01-05", amount: 1300 });
  let r = compute(d, "2027-02-01");
  assert.equal(r.nisab, 25500);
  assert.deepEqual(r.years.map((y) => [y.n, y.end, y.settled, y.wealth, y.status]), [
    [1, "2025-01-03", true, 21000, "below-nisab"],
    [2, "2025-12-24", true, 33000, "met"],
    [3, "2026-12-13", true, 43175, "above"],
    [4, "2027-12-02", false, 43175 - 1300 + 12000, "current"],
  ]);
  assert.equal(r.years[1].due, 825); assert.equal(r.years[1].paid, 825); assert.equal(r.years[1].diff, 0);
  assert.equal(r.years[2].due, 1079.38); assert.equal(r.years[2].diff, 220.62);
  assert.equal(r.years[3].carriedIn, 220.62, "the surplus carries into the current year");
  assert.equal(r.current.n, 4); assert.equal(r.current.daysLeft, daysBetween("2027-02-01", "2027-12-02"));
  assert.equal(r.current.wealthToday, balanceAt("2027-02-01", d));
  assert.deepEqual([r.totals.met, r.totals.above, r.totals.below, r.totals.belowNisab], [1, 1, 0, 1]);
  assert.equal(r.totals.surplus, 220.62);
  // now underpay year 4 and look from 2028: below by the shortfall, carry consumed
  d.payments.push({ date: "2027-12-10", amount: 500 });
  r = compute(d, "2028-03-01");
  const y4 = r.years[3];
  assert.equal(y4.status, "below"); assert.equal(y4.credit, 720.62); assert.equal(y4.diff, Math.round((720.62 - y4.due) * 100) / 100);
  assert.equal(r.totals.shortfall, -y4.diff);
});

test("compute: no start -> nothing; no nisab price -> years flagged; carry-forward can be off", () => {
  assert.deepEqual(compute({ settings: {} }, "2026-01-01").years, []);
  const d = base(); d.settings.goldPrice = 0;
  d.payments.push({ date: "2025-01-05", amount: 100 });
  assert.equal(compute(d, "2026-01-01").years[0].status, "no-nisab");
  const e = base(); e.settings.carryForward = false; e.settings.goldPrice = 100;   // nisab 8500
  e.payments.push({ date: "2025-01-05", amount: 1000 });                             // year 1 due 250 -> above by 750
  const r = compute(e, "2026-06-01");
  assert.equal(r.years[0].status, "above"); assert.equal(r.years[1].carriedIn, 0);
});

test("money formatting", () => {
  assert.equal(money(1234.5, "SAR"), "1,234.50 SAR"); assert.equal(money(0), "0.00");
});
