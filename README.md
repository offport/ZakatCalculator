# Zakat Calculator

A small, local-first web page that keeps track of your zakat years. You pick the day you want to
count from and what you held that day; the zakat year begins the first day that wealth is at the
nisab. Add what you gain each month, any amounts on particular dates, and debts that are due;
record the zakat you pay. For every completed zakat year it shows the wealth at the year's end
(after debts), whether it was above the nisab at that year's gold or silver price, the zakat that
was due, what was paid for that year, and a verdict: **met**, **above** or **below** — with the
amount. Payments settle the oldest unpaid year first, and an *Outstanding* total shows what is
still owed. The year in progress is projected, with the days left until it is assessed, and a
graph shows the wealth over time against the nisab, with every payment and year end, and the
zakat due against the zakat paid for each year.

Static files only — no server, no build, no external scripts, no network at all. Everything
you enter stays in your browser (optionally encrypted with a passphrase). Made for phones first.
Gold on a light ivory ground, deep emerald for the header and summary tiles, charcoal text.

## How it calculates

- **Zakat year (hawl)** — a lunar year, 354.367 days. It begins on the first day the zakatable
  wealth is at or above the nisab, counting from the date you chose (that date itself if the
  wealth was already there; a note says so when it began later). Year *n* ends
  `n × 354.367 days` after that. Dates are shown in both the Gregorian and the Hijri calendar
  (the browser's own `islamic-umalqura` calendar data — nothing downloaded). A solar-year option
  (365.24 days) exists; many use a 2.577 % rate with it. Switch off *start the year when the
  wealth reaches the nisab* to count from the chosen date regardless.
- **Wealth on a day** = amount held on the start date + monthly gains accrued so far (on the same
  day of each month from the date you give, optionally until an end date) + amounts on dates on
  or before that day (negative for money that left) − zakat paid on or before that day
  − **debts due** that day (each debt counts from its due date until the date you say it was
  settled; an open debt keeps being deducted).
- **Nisab** = 85 g of gold × the gold price per gram, or 595 g of silver × the silver price, or
  an amount you type, in your own currency. The price you enter is *today's*; the settings card
  lists every zakat year with its own price box, so each year is judged against the nisab at the
  price of its time (blank = today's price). The day the first year begins is judged at today's
  price.
- **Zakat due** for a year = 2.5 % of the wealth at the year's end, if that wealth is at or above
  that year's nisab; otherwise nothing is due (*below nisab*).
- **A dip below the nisab** during a year is flagged on the year. By default (the Hanafi rule)
  only the year's end counts and the year stands. With *restart the year if the wealth falls
  below the nisab* on (the Shafi'i, Maliki and Hanbali view), the year is shown as *not
  completed* and a new year begins the day the wealth is back at the nisab.
- **Which year a payment counts for** — a payment made within the grace period (60 days by
  default) after a year's end is that year's zakat, paid late; any other payment is an advance
  for the year in progress on that date. You can pick the year yourself on each payment.
- **Arrears first** — what is available for a year (its payments plus anything carried over) goes
  first to the oldest year still owed, then to the year's own due; whatever is left carries into
  the next year (if carry-forward is on — that assumes the extra was paid with the intention of
  zakat, otherwise it is ordinary charity). The year cards show what went to earlier years and
  what came from later payments.
- **Verdict** per settled year: **met** (fully covered, within 0.50), **above** (a surplus, which
  carries forward), **below** (an amount still owed). Totals across all settled years at the
  bottom, including *Outstanding* (the sum still owed) and *Surplus*.
- The **year in progress** shows wealth today, the projected wealth and zakat at the year's end
  (monthly gains keep accruing; dated amounts and debts in the future count), what you have paid
  so far, what went to arrears, and what is still to pay.
- The **graph** (inline SVG, no library) shows the zakatable wealth as a step line from the hawl
  start to the end of the current year — solid up to today, dashed projection after — with the
  nisab as a dashed red line, a dot on every zakat payment, a dot on every year end (red-ringed if
  below the nisab), and a bar pair per year for zakat due against zakat paid (red when short).

This is arithmetic on the numbers you enter, not a ruling. Schools differ on details (what
counts as zakatable wealth, which debts are deducted, the nisab standard, hawl for money that
arrives mid-year); ask a scholar for your circumstances.

## Using it

1. **Start & settings** — the date to count from, the amount held that day, your currency, the
   calendar, the rate, the nisab source and today's price, a price per zakat year, the grace
   period, and the three rules: auto-start at the nisab, restart on a dip, carry-forward.
2. **Monthly gains** — amount, from which date, optionally until when.
3. **Amounts on a date** — bonuses, inheritances, sales; negative for money that left.
4. **Debts due** — amount, due from which date, optionally the date it was settled.
5. **Zakat paid** — date and amount; the year is matched automatically and shown on the row;
   choose a year yourself if it should count elsewhere.
6. **Your zakat years** — the summary strip (with *Outstanding* when something is owed), the
   graph, the year in progress, every settled year newest first, then totals.

Tap any row to edit it (the form switches to *Update*), ✕ to remove it. Everything saves as you
type. **Backup** downloads a JSON file; **Restore** loads one; **Print** gives a clean sheet.

Data entered in an earlier version loads unchanged: new fields (debts, the price per year, the
two rules) take their defaults and the existing entries are kept as they are.

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
style.css    gold / ivory / emerald theme, phone first, print styles
app.js       state, storage, encryption, forms, rendering, the graph
calc.js      the arithmetic - pure, shared with the tests
tests/       node --test
```

## Not in this version

- Zakat on gold jewellery, business stock, shares, property, or money owed *to* you — the
  calculator works on one pool of money you describe. Add or subtract such things as dated
  amounts.
- A live gold price. Enter it by hand; the meta-tag CSP forbids network calls on purpose. If a
  fetch were ever wanted, it would need `connect-src` opened for one price API and, where that
  API has no CORS headers, a tiny localhost relay — documented here rather than built.
- Multiple currencies or several separate pools.
