# Zakat Calculator

A small, local-first web page that keeps track of your zakat years. You pick the day your zakat
year starts and what you held that day; add what you gain each month and any amounts on
particular dates; record the zakat you pay. For every completed zakat year it shows the wealth
held at the year's end, whether it was above the nisab, the zakat that was due, what you paid
for that year, and a verdict: **met**, **above** or **below** — with the difference. The year in
progress is projected, with the days left until it is assessed.

Static files only — no server, no build, no external scripts, no network at all. Everything
you enter stays in your browser (optionally encrypted with a passphrase). Made for phones first.

## How it calculates

- **Zakat year (hawl)** — a lunar year, 354.367 days, counted from your start date; year *n*
  ends on `start + n × 354.367 days`. Dates are shown in both the Gregorian and the Hijri
  calendar (the browser's own `islamic-umalqura` calendar data — nothing downloaded).
  A solar-year option (365.24 days) exists; many use a 2.577 % rate with it.
- **Wealth on a day** = amount held on the start date + monthly gains accrued so far (on the same
  day of each month from the date you give, optionally until an end date) + amounts on dates on
  or before that day (negative for money that left) − zakat paid on or before that day.
- **Nisab** = 85 g of gold × the gold price per gram you enter, or 595 g of silver × the silver
  price, or an amount you type. Enter the price in your own currency.
- **Zakat due** for a year = 2.5 % of the wealth at the year's end, if that wealth is at or above
  the nisab; otherwise nothing is due (the year is marked *below nisab*).
- **Which year a payment counts for** — a payment made within the grace period (60 days by
  default) after a year's end counts for that year; any other payment counts for the year in
  progress on that date (an advance). You can pick the year yourself on each payment.
- **Verdict** per settled year, comparing *paid + carried over* with *due*: **met** (within 0.50),
  **above** (the surplus carries into the next year, unless you turn that off), **below** (the
  shortfall is still owed). Totals across all settled years at the bottom.
- The **year in progress** shows wealth today, the projected wealth and zakat at the year's end
  (monthly gains keep accruing; dated amounts in the future count), what you have paid so far,
  and what is still to pay.

This is arithmetic on the numbers you enter, not a ruling. Schools differ on details (what
counts as zakatable wealth, debts, the nisab standard, hawl for money that arrives mid-year); ask
a scholar for your circumstances.

## Using it

1. **Start & settings** — the start date, the amount held that day, your currency, the calendar,
   the rate, the nisab source and price, the grace period, carry-forward.
2. **Monthly gains** — amount, from which date, optionally until when.
3. **Amounts on a date** — bonuses, inheritances, sales; negative for money that left.
4. **Zakat paid** — date and amount; the year is matched automatically and shown on the row;
   choose a year yourself if it should count elsewhere.
5. **Your zakat years** — the year in progress on top, then every settled year, newest first,
   then totals.

Tap any row to edit it (the form switches to *Update*), ✕ to remove it. Everything saves as you
type. **Backup** downloads a JSON file; **Restore** loads one; **Print** gives a clean sheet.

**Passphrase** encrypts what is stored on this device: AES-256-GCM with a key derived from your
passphrase (PBKDF2, 250,000 rounds) using the browser's Web Crypto. There is no recovery — keep
a backup. Without a passphrase the data is stored in plain form in the browser's local storage.

## Privacy and security

- The page has a strict Content-Security-Policy: scripts only from itself, no connections at all
  (`connect-src 'none'`), no frames, no external anything. It cannot phone home even by accident.
- No cookies, no analytics, no fonts or images fetched. It works offline once loaded.
- Local storage is per browser and per device; clearing site data deletes it — hence *Backup*.

## Run it

It is plain files. Open `index.html` from disk, or serve the folder with anything static:

```bash
npm run serve        # http://127.0.0.1:8795  (a 12-line static server, no dependencies)
npm test             # the arithmetic, node --test
```

To publish on GitHub Pages: push the repository and enable Pages on the branch root — there is a
`.nojekyll`, no build step, and every path is relative.

## Files

```
index.html   the page (strict CSP in a meta tag)
style.css    the golden theme, phone first, print styles
app.js       state, storage, encryption, forms, rendering
calc.js      the arithmetic - pure, shared with the tests
tests/       node --test
```

## Not in this version

- Zakat on gold jewellery, business stock, debts owed to or by you, shares, property — the
  calculator works on one pool of money you describe. Add or subtract such things as dated amounts.
- A live gold price. Enter it by hand; the meta-tag CSP forbids network calls on purpose. If a
  fetch were ever wanted, it would need `connect-src` opened for one price API and, where that
  API has no CORS headers, a tiny localhost relay — documented here rather than built.
- Multiple currencies or several separate pools.
