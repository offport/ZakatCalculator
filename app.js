// Zakat Calculator - the page. State lives in localStorage (optionally encrypted
// with a passphrase via Web Crypto); the arithmetic is in calc.js. No network.
import { DEFAULTS, compute, series, nisabValue, nisabForYear, currentPrice, hijri, money, toDate } from "./calc.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const KEY = "zakat:v1", ENC = "zakat:enc";                    // unchanged since v1: older data loads as it is, new fields get defaults
const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtDate = (iso) => iso ? toDate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
const fmtMon = (iso) => toDate(iso).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

/* ---------- state ---------- */
let S = blank();
let R = null;                                                  // the latest compute() result
let editing = null;                                            // { list, id } while a row is being edited
let cryptoKey = null;                                          // AES-GCM key while unlocked
function blank() { return { v: 2, settings: { ...DEFAULTS, yearPrices: {} }, gains: [], amounts: [], payments: [], liabilities: [] }; }
/** Any saved shape (v1 or v2) -> the current one, keeping every entry. */
function normalise(o) {
  const b = blank(), s = { ...b.settings, ...(o.settings || {}) };
  s.yearPrices = { ...(o.settings?.yearPrices || {}) };
  return { ...b, ...o, v: 2, settings: s, gains: o.gains || [], amounts: o.amounts || [], payments: o.payments || [], liabilities: o.liabilities || [] };
}

/* ---------- at-rest encryption (Web Crypto, all in the browser) ---------- */
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250_000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptJSON(obj, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
async function decryptJSON(blob, key) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
let saltBytes = null;

async function save() {
  try {
    if (cryptoKey) { const blob = await encryptJSON(S, cryptoKey, saltBytes); localStorage.setItem(ENC, JSON.stringify(blob)); localStorage.removeItem(KEY); }
    else localStorage.setItem(KEY, JSON.stringify(S));
  } catch (e) { toast("could not save: " + e.message); }
}
async function load() {
  const enc = localStorage.getItem(ENC);
  if (enc) {
    const blob = JSON.parse(enc);
    for (;;) {
      const pass = await askPassphrase({ title: "Unlock", text: "Your data on this device is encrypted. Enter the passphrase to open it.", allowCancel: false });
      try { saltBytes = unb64(blob.salt); cryptoKey = await deriveKey(pass, saltBytes); S = normalise(await decryptJSON(blob, cryptoKey)); return; }
      catch { toast("wrong passphrase"); }
    }
  }
  try { const raw = localStorage.getItem(KEY); if (raw) S = normalise(JSON.parse(raw)); } catch { S = blank(); }
}

/* ---------- passphrase dialog ---------- */
function askPassphrase({ title, text, confirm = false, allowCancel = true, allowRemove = false }) {
  return new Promise((resolve) => {
    const dlg = $("#dlg");
    $("#dlg-title").textContent = title; $("#dlg-text").textContent = text;
    $("#dlg-l2").hidden = !confirm; $("#dlg-cancel").hidden = !allowCancel; $("#dlg-remove").hidden = !allowRemove;
    $("#dlg-pass").value = ""; $("#dlg-pass2").value = ""; $("#dlg-err").textContent = "";
    const done = (v) => { dlg.close(); dlg.removeEventListener("cancel", onCancel); resolve(v); };
    const onCancel = (e) => { e.preventDefault(); if (allowCancel) done(null); };
    dlg.addEventListener("cancel", onCancel);
    $("#dlg-form").onsubmit = (e) => { e.preventDefault(); const p = $("#dlg-pass").value;
      if (p.length < 6) { $("#dlg-err").textContent = "at least 6 characters"; return; }
      if (confirm && p !== $("#dlg-pass2").value) { $("#dlg-err").textContent = "the two do not match"; return; }
      done(p); };
    $("#dlg-cancel").onclick = () => done(null);
    $("#dlg-remove").onclick = () => done("__remove__");
    dlg.showModal(); $("#dlg-pass").focus();
  });
}
async function setPassphrase() {
  const p = await askPassphrase({ title: cryptoKey ? "Change or remove the passphrase" : "Set a passphrase", text: "Everything saved on this device will be encrypted with it (AES-256-GCM, key derived with PBKDF2). There is no recovery: if you forget it, restore from a backup.", confirm: true, allowRemove: !!cryptoKey });
  if (p === null) return;
  if (p === "__remove__") { cryptoKey = null; saltBytes = null; localStorage.removeItem(ENC); await save(); renderLock(); toast("passphrase removed - data is stored in plain form"); return; }
  saltBytes = crypto.getRandomValues(new Uint8Array(16)); cryptoKey = await deriveKey(p, saltBytes);
  await save(); renderLock(); toast("encrypted with your passphrase");
}
function renderLock() { $("#lock").textContent = cryptoKey ? "🔒 Encrypted" : "Passphrase"; }

/* ---------- toast ---------- */
let toastT;
function toast(msg, ms = 3000) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms); }

/* ---------- settings ---------- */
const FIELDS = ["start", "opening", "currency", "calendar", "rate", "nisabMode", "goldPrice", "silverPrice", "nisabDirect", "graceDays"];
const CHECKS = ["carryForward", "autoStart", "restartOnDip"];
function renderSettings() {
  const s = S.settings;
  for (const f of FIELDS) { const el = $("#f-" + f); if (el) el.value = s[f] ?? ""; }
  for (const f of CHECKS) $("#f-" + f).checked = !!s[f];
  $("#l-gold").hidden = s.nisabMode !== "gold"; $("#l-silver").hidden = s.nisabMode !== "silver"; $("#l-direct").hidden = s.nisabMode !== "direct";
  $("#h-start").textContent = s.start ? `${hijri(s.start)} · the zakat year begins here, or on the first later day the wealth reaches the nisab` : "count from this day; the zakat year begins the first day the wealth is at the nisab";
  $("#h-calendar").textContent = s.calendar === "solar" ? "a solar year is 11 days longer than the lunar hawl; many use a 2.577 % rate to compensate" : "the hawl: 354 days, the year of the Hijri calendar";
  const n = nisabValue(s);
  $("#v-nisab").textContent = n > 0 ? money(n, s.currency) + (s.nisabMode === "gold" ? "  (85 g of gold)" : s.nisabMode === "silver" ? "  (595 g of silver)" : "") : "enter a price or an amount";
}
function afterSettings() { save(); renderSettings(); renderResults(); renderList("payments"); renderForYear(); renderYearPrices(); }
function bindSettings() {
  for (const f of FIELDS) { const el = $("#f-" + f); if (!el) continue;
    el.addEventListener("input", () => { S.settings[f] = el.type === "number" ? (el.value === "" ? 0 : Number(el.value)) : el.value; afterSettings(); });
    el.addEventListener("change", afterSettings); }
  for (const f of CHECKS) $("#f-" + f).addEventListener("change", (e) => { S.settings[f] = e.target.checked; afterSettings(); });
  $("#yp-rows").addEventListener("input", (e) => { const inp = e.target.closest("[data-yp]"); if (!inp) return;
    const n = inp.dataset.yp, v = inp.value.trim();
    if (v === "" || !(Number(v) > 0)) delete S.settings.yearPrices[n]; else S.settings.yearPrices[n] = Number(v);
    save(); renderResults(); renderList("payments");
    const b = $(`[data-ypn="${n}"]`); if (b) b.textContent = nisabText(S.settings, Number(n)); });
  $("#yp-rows").addEventListener("change", () => { renderYearPrices(); renderForYear(); });
}
const nisabText = (s, n) => nisabForYear(s, n) > 0 ? money(nisabForYear(s, n), s.currency) : "—";
/** One price per zakat year, prefilled with the current price: the nisab of that year is judged at its own price. */
function renderYearPrices() {
  const s = S.settings, real = (R?.years || []).filter((y) => y.status !== "broken");
  $("#yp").hidden = !real.length;
  $("#yp-unit").textContent = s.nisabMode === "direct" ? "nisab amount" : `${s.nisabMode} price per gram`;
  $("#yp-rows").innerHTML = real.map((y) => `<label class="yp-row"><span>Year ${y.n}<small>${y.settled ? "ended" : "ends"} ${fmtDate(y.end)}</small></span><input type="number" step="0.01" min="0" inputmode="decimal" data-yp="${y.n}" value="${esc(s.yearPrices?.[y.n] ?? "")}" placeholder="${currentPrice(s) || "current"}"><b data-ypn="${y.n}">${nisabText(s, y.n)}</b></label>`).join("");
}

/* ---------- the four lists ---------- */
/** The zakat year a payment was matched to, from the latest result. */
const yearOfPayment = (id) => R?.years.find((y) => y.payments?.some((p) => p.id === id))?.n;
const LISTS = {
  gains: { form: "#a-gains", ul: "#l-gains", fields: ["amount", "from", "to", "note"], empty: "No monthly gains yet.",
    row: (g) => ({ when: `from ${fmtDate(g.from)}${g.to ? " until " + fmtDate(g.to) : ""}`, what: `${esc(g.note || "monthly")} · every month`, amt: money(g.amount, S.settings.currency), neg: false }) },
  amounts: { form: "#a-amounts", ul: "#l-amounts", fields: ["date", "amount", "note"], empty: "No dated amounts yet.",
    row: (a) => ({ when: fmtDate(a.date), what: esc(a.note || (Number(a.amount) < 0 ? "taken out" : "added")), amt: money(a.amount, S.settings.currency), neg: Number(a.amount) < 0 }) },
  liabilities: { form: "#a-liabilities", ul: "#l-liabilities", fields: ["date", "amount", "until", "note"], empty: "No debts recorded - nothing is deducted.",
    row: (l) => ({ when: `due from ${fmtDate(l.date)}${l.until ? " · settled " + fmtDate(l.until) : " · still open"}`, what: esc(l.note || "debt"), amt: "− " + money(l.amount, S.settings.currency), neg: true }) },
  payments: { form: "#a-payments", ul: "#l-payments", fields: ["date", "amount", "forYear", "note"], empty: "No zakat payments recorded yet.",
    row: (p) => { const n = yearOfPayment(p.id); return { when: `${fmtDate(p.date)}${n ? ` · year ${n}${p.forYear ? " (chosen)" : ""}` : ""}`, what: esc(p.note || "zakat paid"), amt: money(p.amount, S.settings.currency), neg: false }; } },
};
function renderList(name) {
  const L = LISTS[name], items = [...S[name]].sort((a, b) => String(a.date || a.from).localeCompare(String(b.date || b.from)));
  $(L.ul).innerHTML = items.length ? items.map((it) => { const r = L.row(it);
    return `<li data-id="${it.id}" class="${editing?.list === name && editing.id === it.id ? "edit" : ""}"><span class="what"><span class="when">${r.when}</span><br>${r.what}</span><span class="amt ${r.neg ? "neg" : ""}">${r.amt}</span><button class="del" data-del="${it.id}" title="Remove" aria-label="Remove">&#x2715;</button></li>`; }).join("")
    : `<li class="empty">${L.empty}</li>`;
  fitList($(L.ul), items.length);
}
/** More than five entries: keep the list five rows tall and let it scroll; say how many there are. */
const ROWS = 5;
function fitList(ul, count) {
  const more = ul.nextElementSibling?.classList.contains("list-more") ? ul.nextElementSibling : null;
  const lis = ul.querySelectorAll("li[data-id]");
  if (lis.length > ROWS) {
    ul.classList.add("scroll"); ul.style.maxHeight = `${lis[ROWS].offsetTop - lis[0].offsetTop - 6 + 14}px`;   // five rows, plus the faded edge
    (more || ul.insertAdjacentElement("afterend", Object.assign(document.createElement("div"), { className: "list-more" }))).textContent = `${count} entries · scroll for more`;
  } else { ul.classList.remove("scroll"); ul.style.maxHeight = ""; more?.remove(); }
}
function afterList(name) { save(); renderResults(); renderList(name); if (name !== "payments") renderList("payments"); renderForYear(); renderYearPrices(); }
function bindList(name) {
  const L = LISTS[name], form = $(L.form);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form), it = { id: editing?.list === name ? editing.id : uid() };
    for (const f of L.fields) { const v = String(fd.get(f) ?? "").trim(); it[f] = f === "amount" ? Number(v) : f === "forYear" ? (v ? Number(v) : "") : v; }
    if (!(it.amount !== 0) || Number.isNaN(it.amount)) { toast("enter an amount"); return; }
    if (name === "gains" && it.to && it.to < it.from) { toast("the end date is before the start"); return; }
    if (name === "liabilities" && it.until && it.until < it.date) { toast("settled before it was due?"); return; }
    if (editing?.list === name) { const i = S[name].findIndex((x) => x.id === editing.id); if (i >= 0) S[name][i] = it; editing = null; form.querySelector("button[type=submit]").textContent = "Add"; }
    else S[name].push(it);
    form.reset(); afterList(name);
    const n = name === "payments" ? yearOfPayment(it.id) : null;
    toast(n ? `recorded · counts for year ${n}` : "added");
  });
  $(L.ul).addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) { S[name] = S[name].filter((x) => x.id !== del.dataset.del); if (editing?.id === del.dataset.del) { editing = null; form.reset(); form.querySelector("button[type=submit]").textContent = "Add"; } afterList(name); return; }
    const li = e.target.closest("li[data-id]"); if (!li) return;
    const it = S[name].find((x) => x.id === li.dataset.id); if (!it) return;
    editing = { list: name, id: it.id };
    for (const f of L.fields) { const el = form.elements[f]; if (el) el.value = it[f] ?? ""; }
    form.querySelector("button[type=submit]").textContent = "Update"; renderList(name); $(L.ul).querySelector("li.edit")?.scrollIntoView({ block: "nearest" }); form.elements[L.fields[0]].focus();
  });
}
function renderForYear() {
  const sel = $("#f-forYear"), cur = sel.value;
  sel.innerHTML = `<option value="">automatic</option>` + (R?.years || []).filter((y) => y.status !== "broken").map((y) => `<option value="${y.n}">year ${y.n} · ends ${fmtDate(y.end)}</option>`).join("");
  sel.value = cur;
}

/* ---------- results ---------- */
const STATUS = { met: ["met", "Met"], above: ["above", "Above"], below: ["below", "Below"], current: ["current", "In progress"], "below-nisab": ["flat", "Below nisab"], "no-nisab": ["flat", "No nisab set"], broken: ["flat", "Hawl restarted"] };
function renderResults() {
  R = compute(S, today()); const r = R, c = S.settings.currency;
  const ready = !!S.settings.start;
  $("#r-empty").hidden = ready; $("#r-body").hidden = !ready;
  if (!ready) return;
  const t = r.totals;
  $("#r-strip").innerHTML = [
    ["Today", `${fmtDate(r.today)}<br><small>${esc(hijri(r.today, "short"))}</small>`],
    ["Wealth today", money(r.current?.wealthToday ?? (r.notStarted ? 0 : 0), c)],
    ["Nisab", r.nisab > 0 ? money(r.nisab, c) : "<small>not set</small>"],
    ["Rate", `${r.rate} %<br><small>${r.calendar === "solar" ? "solar" : "lunar"} year</small>`],
    ...(t?.outstanding > 0 ? [["Outstanding", `<span class="red">${money(t.outstanding, c)}</span><br><small>from earlier years</small>`]] : []),
  ].map(([k, v]) => `<div class="b"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  const note = $("#r-note");
  if (r.notStarted) {
    note.hidden = false; note.innerHTML = `<b>No zakat year has begun yet.</b> On ${fmtDate(S.settings.start)} the wealth was below the nisab and it has not reached it since. Zakat becomes due a lunar year after the day it first does. <span class="muted">(Switch off "start the year when the wealth reaches the nisab" to count from the date anyway.)</span>`;
    $("#r-chart").hidden = true; $("#r-current").innerHTML = ""; $("#r-years").innerHTML = ""; $("#r-totals").innerHTML = ""; return;
  }
  note.hidden = !r.startNote;
  if (r.startNote) note.innerHTML = `<b>Started ${fmtDate(r.start)}</b> (${esc(hijri(r.start))}) - the first day the wealth reached the nisab; on ${fmtDate(S.settings.start)} it was below it.`;
  renderChart(r);
  const y = r.current;
  $("#r-current").innerHTML = y ? `<div class="year now"><div class="head"><h3>Year ${y.n} &middot; in progress</h3><span class="chip current">${y.daysLeft} day${y.daysLeft === 1 ? "" : "s"} left</span>${y.dipped ? `<span class="chip flat" title="fell below the nisab on ${fmtDate(y.dipDate)}">dipped</span>` : ""}</div>
    <div class="period"><b>${fmtDate(y.start)}</b> &rarr; <b>${fmtDate(y.end)}</b> &middot; ${esc(y.hijriStart)} &rarr; ${esc(y.hijriEnd)}</div>
    <div class="kv">
      <div><span>Wealth today${y.debtsToday ? " (after debts)" : ""}</span><b class="gold">${money(y.wealthToday, c)}</b></div>
      <div><span>Projected at year end</span><b>${money(y.wealth, c)}${y.debts ? ` <small>after ${money(y.debts, c)} of debts</small>` : ""}</b></div>
      <div><span>Nisab this year</span><b>${y.nisab > 0 ? money(y.nisab, c) : "not set"}</b></div>
      <div><span>Projected zakat due</span><b class="gold">${y.nisab > 0 ? (y.aboveNisab ? money(y.due, c) : "none - below nisab") : "set the nisab"}</b></div>
      <div><span>Paid so far for this year</span><b>${money(y.paid, c)}</b></div>
      ${y.carriedIn ? `<div><span>Carried from last year</span><b class="blue">${money(y.carriedIn, c)}</b></div>` : ""}
      ${y.toArrears ? `<div><span>Went to earlier years first</span><b class="red">−${money(y.toArrears, c)}</b></div>` : ""}
    </div>
    <div class="verdict current">${projection(y, c)}</div>
    ${dipNote(y)}${paysList(y, c)}</div>` : "";
  $("#r-years").innerHTML = r.years.filter((x) => x.settled).reverse().map((x) => { const [cls, label] = STATUS[x.status] || ["flat", x.status];
    if (x.status === "broken") return `<div class="year broken"><div class="head"><h3>Year ${x.n} &middot; not completed</h3><span class="chip ${cls}">${label}</span></div>
      <div class="period"><b>${fmtDate(x.start)}</b> &rarr; <b>${fmtDate(x.brokenOn)}</b> &middot; ${esc(x.hijriStart)} &rarr; ${esc(x.hijriEnd)}</div>
      <div class="verdict flat">The wealth fell below the nisab of ${money(x.nisab, c)} on ${fmtDate(x.brokenOn)}, so this year did not complete; a new year ${r.years.some((z) => z.n === x.n && z.status !== "broken") ? "began when the wealth reached the nisab again" : "has not begun yet"}.</div></div>`;
    return `<div class="year"><div class="head"><h3>Year ${x.n}</h3><span class="chip ${cls}">${label}</span>${x.dipped ? `<span class="chip flat" title="fell below the nisab on ${fmtDate(x.dipDate)}">dipped</span>` : ""}</div>
    <div class="period"><b>${fmtDate(x.start)}</b> &rarr; <b>${fmtDate(x.end)}</b> &middot; ${esc(x.hijriStart)} &rarr; ${esc(x.hijriEnd)}</div>
    <div class="kv">
      <div><span>Wealth at year end${x.debts ? " (after debts)" : ""}</span><b class="gold">${money(x.wealth, c)}${x.debts ? ` <small>${money(x.gross, c)} − ${money(x.debts, c)}</small>` : ""}</b></div>
      <div><span>Nisab${S.settings.nisabMode !== "direct" && x.price ? ` <small>at ${money(x.price, c)}/g</small>` : ""}</span><b>${x.nisab > 0 ? money(x.nisab, c) + (x.aboveNisab ? " ✓" : " ✗") : "not set"}</b></div>
      <div><span>Zakat due (${r.rate} %)</span><b class="gold">${money(x.due, c)}</b></div>
      <div><span>Paid for this year</span><b>${money(x.paid, c)}</b></div>
      ${x.carriedIn ? `<div><span>Carried from year ${x.n - 1}</span><b class="blue">${money(x.carriedIn, c)}</b></div>` : ""}
      ${x.toArrears ? `<div><span>Went to earlier years first</span><b class="red">−${money(x.toArrears, c)}</b></div>` : ""}
      ${x.fromLater ? `<div><span>Settled by later payments</span><b class="blue">+${money(x.fromLater, c)}</b></div>` : ""}
      <div><span>Balance</span><b class="${x.owed >= 0.5 ? "red" : x.surplus >= 0.5 ? "blue" : "green"}">${x.owed >= 0.5 ? "−" + money(x.owed, c) : x.surplus >= 0.5 ? "+" + money(x.surplus, c) : money(0, c)}</b></div>
    </div>
    <div class="verdict ${cls}">${verdict(x, c)}</div>
    ${dipNote(x)}${paysList(x, c)}</div>`; }).join("");
  const settled = r.years.filter((x) => x.settled && x.status !== "broken").length;
  $("#r-totals").innerHTML = settled ? [
    ["Years settled", settled], ["Met", t.met], ["Above", t.above], ["Below", t.below],
    ["Total due", money(t.due, c)], ["Total paid", money(t.paid, c)],
    ["Outstanding", t.outstanding ? money(t.outstanding, c) : "none"], ["Surplus", t.surplus ? money(t.surplus, c) : "none"],
  ].map(([k, v]) => `<div class="b"><div class="k">${k}</div><div class="v ${k === "Outstanding" && t.outstanding ? "red" : k === "Surplus" && t.surplus ? "blue" : k === "Met" && t.met ? "green" : ""}">${v}</div></div>`).join("") : `<div class="axnote">The first zakat year has not ended yet - the card above projects it.</div>`;
}
function verdict(x, c) {
  if (x.status === "no-nisab") return "Set a gold or silver price (or a nisab amount) in the settings to judge this year.";
  if (x.status === "below-nisab") return `Wealth was below the nisab of ${money(x.nisab, c)} at the year's end - no zakat was due this year.${x.paid ? ` The ${money(x.paid, c)} paid ${x.toArrears ? "went to earlier years" : "counts as charity, or choose another year for it"}.` : ""}`;
  const how = [x.applied ? `${money(x.applied, c)} from ${x.carriedIn ? "this year's payments and the carry-over" : "this year's payments"}` : "", x.fromLater ? `${money(x.fromLater, c)} from later payments` : ""].filter(Boolean).join(" and ");
  if (x.status === "met") return `<b>Met.</b> ${money(x.due, c)} was due and it is fully covered${how ? `: ${how}` : ""}.`;
  if (x.status === "above") return `<b>Above by ${money(x.surplus, c)}.</b> ${money(x.due, c)} was due; the extra ${S.settings.carryForward ? "carries into the next year" : "counts as charity"}.`;
  return `<b>Below by ${money(x.owed, c)}.</b> ${money(x.due, c)} was due${how ? `; ${how}` : ", nothing was applied to it"}. The rest is still owed - your next payment settles it first.`;
}
function projection(y, c) {
  if (S.settings.start > today()) return "The start date is in the future.";
  if (!(y.nisab > 0)) return "Set the nisab to see whether zakat will be due.";
  if (!y.aboveNisab) return `On current numbers the wealth at year end (${money(y.wealth, c)}) stays below the nisab - no zakat would be due.`;
  if (y.owed < 0.5 && y.surplus < 0.5) return `<b>On track.</b> What is available for this year already covers the projected ${money(y.due, c)}.`;
  if (y.surplus >= 0.5) return `<b>Ahead by ${money(y.surplus, c)}.</b> ${money(y.applied + y.surplus, c)} available against a projected ${money(y.due, c)}.`;
  return `<b>${money(y.owed, c)} still to pay</b> against a projected ${money(y.due, c)}, due on ${fmtDate(y.end)} (${esc(y.hijriEnd)}).${y.toArrears ? ` ${money(y.toArrears, c)} of what you paid this year went to earlier years' arrears first.` : ""}`;
}
function dipNote(y) { return y.dipped ? `<p class="dip">Fell below the nisab on ${fmtDate(y.dipDate)} (lowest ${money(y.minWealth, S.settings.currency)}). ${S.settings.restartOnDip ? "" : "With the Hanafi rule only the year's end counts, so the year stands; the other schools would restart it (see the settings)."}</p>` : ""; }
function paysList(y, c) { return y.payments.length ? `<ul class="pays">${y.payments.map((p) => `<li><span>${fmtDate(p.date)} ${esc(p.note || "")}</span><span>${money(p.amount, c)}</span></li>`).join("")}</ul>` : ""; }

/* ---------- the graph: wealth over time, nisab, payments, year ends; then due vs paid per year ---------- */
function niceStep(range) { const raw = range / 4 || 1, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
const short = (v) => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(Math.abs(v) >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k" : String(Math.round(v));
const f1 = (n) => n.toFixed(1);
function renderChart(r) {
  const host = $("#r-chart"), c = S.settings.currency;
  const pts = r && !r.notStarted ? series(S, today(), r) : [];
  const real = (r?.years || []).filter((y) => y.status !== "broken");
  if (pts.length < 2 || !real.length) { host.innerHTML = ""; host.hidden = true; return; }
  host.hidden = false;
  const W = Math.max(280, Math.floor(host.clientWidth || 640)), H = 250, L = 48, Rp = 10, T = 24, B = 30;
  const t0 = toDate(pts[0].date).getTime(), t1 = toDate(pts.at(-1).date).getTime();
  const vals = pts.flatMap((p) => [p.wealth, p.nisab]);
  const hi = Math.max(1, ...vals), lo = Math.min(0, ...vals), step = niceStep(hi - lo);
  const top = Math.ceil(hi / step) * step, bot = Math.floor(lo / step) * step;
  const X = (d) => L + ((toDate(d).getTime() - t0) / (t1 - t0 || 1)) * (W - L - Rp);
  const Y = (v) => T + (1 - (v - bot) / (top - bot || 1)) * (H - T - B);
  const stepPath = (list, key) => list.map((p, i) => (i ? `H${f1(X(p.date))}V${f1(Y(p[key]))}` : `M${f1(X(p.date))},${f1(Y(p[key]))}`)).join("");
  const past = pts.filter((p) => !p.projected), future = pts.filter((p) => p.projected);
  const todayPt = past.at(-1), proj = todayPt ? [todayPt, ...future] : future;
  let g = "";
  for (let v = bot; v <= top + 1e-9; v += step) g += `<line class="grid" x1="${L}" x2="${W - Rp}" y1="${f1(Y(v))}" y2="${f1(Y(v))}"/><text class="lbl" x="${L - 6}" y="${f1(Y(v) + 4)}" text-anchor="end">${short(v)}</text>`;
  real.forEach((y, i) => { const xs = X(y.start), xe = X(y.end);
    g += `<line class="yr" x1="${f1(xe)}" x2="${f1(xe)}" y1="${T}" y2="${H - B}"/><text class="lbl yr" x="${f1((xs + xe) / 2)}" y="${T - 9}" text-anchor="middle">Year ${y.n}</text>`;
    if (i === 0 || xe - xs > 70) g += `<text class="lbl" x="${f1(xs)}" y="${H - B + 16}" text-anchor="${i === 0 ? "start" : "middle"}">${fmtMon(y.start)}</text>`; });
  g += `<text class="lbl" x="${f1(X(real.at(-1).end))}" y="${H - B + 16}" text-anchor="end">${fmtMon(real.at(-1).end)}</text>`;
  g += `<path class="nisab" d="${stepPath(pts, "nisab")}"/>`;
  if (past.length > 1) g += `<path class="wealth" d="${stepPath(past, "wealth")}"/>`;
  if (proj.length > 1) g += `<path class="wealth proj" d="${stepPath(proj, "wealth")}"/>`;
  if (todayPt) g += `<line class="today" x1="${f1(X(todayPt.date))}" x2="${f1(X(todayPt.date))}" y1="${T}" y2="${H - B}"/><text class="lbl today" x="${f1(X(todayPt.date) + 4)}" y="${T + 11}">today</text>`;
  for (const y of real) for (const p of y.payments) { const w = pts.find((q) => q.date === p.date)?.wealth ?? 0; g += `<circle class="pay" cx="${f1(X(p.date))}" cy="${f1(Y(w))}" r="4"><title>${fmtDate(p.date)} · zakat paid ${money(p.amount, c)}</title></circle>`; }
  for (const y of real) g += `<circle class="ye${y.aboveNisab ? "" : " under"}" cx="${f1(X(y.end))}" cy="${f1(Y(y.wealth))}" r="4.5"><title>Year ${y.n} ${y.settled ? "end" : "end (projected)"} · ${money(y.wealth, c)} · nisab ${money(y.nisab, c)}</title></circle>`;
  // due vs paid bars
  const BH = 120, bT = 14, bB = 22, slot = (W - L - Rp) / real.length, bw = Math.min(30, Math.max(8, slot * 0.28));
  const maxBar = Math.max(1, ...real.flatMap((y) => [y.due, y.paid]));
  const BY = (v) => bT + (1 - v / maxBar) * (BH - bT - bB);
  let b = `<line class="grid" x1="${L}" x2="${W - Rp}" y1="${f1(BY(0))}" y2="${f1(BY(0))}"/>`;
  real.forEach((y, i) => { const cx = L + (i + 0.5) * slot;
    b += `<rect class="due" x="${f1(cx - bw - 1.5)}" y="${f1(BY(y.due))}" width="${f1(bw)}" height="${f1(BY(0) - BY(y.due))}"><title>Year ${y.n} · due ${money(y.due, c)}${y.settled ? "" : " (projected)"}</title></rect>`;
    b += `<rect class="paid${y.settled && y.owed >= 0.5 ? " short" : ""}" x="${f1(cx + 1.5)}" y="${f1(BY(y.paid))}" width="${f1(bw)}" height="${f1(BY(0) - BY(y.paid))}"><title>Year ${y.n} · paid ${money(y.paid, c)}</title></rect>`;
    if (slot > 90) { if (y.due > 0) b += `<text class="lbl v" x="${f1(cx - bw / 2 - 1.5)}" y="${f1(BY(y.due) - 3)}" text-anchor="middle">${short(y.due)}</text>`; if (y.paid > 0) b += `<text class="lbl v" x="${f1(cx + bw / 2 + 1.5)}" y="${f1(BY(y.paid) - 3)}" text-anchor="middle">${short(y.paid)}</text>`; }
    b += `<text class="lbl" x="${f1(cx)}" y="${BH - 6}" text-anchor="middle">Y${y.n}${y.settled ? "" : "*"}</text>`; });
  host.innerHTML = `<div class="chart-title">Zakatable wealth over time</div><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Zakatable wealth over time">${g}</svg>
  <div class="legend"><span><i class="sw"></i>wealth</span><span><i class="sw proj"></i>projected</span><span><i class="sw nisab"></i>nisab</span><span><i class="sw pay"></i>zakat paid</span><span><i class="sw ye"></i>year end</span></div>
  <div class="chart-title">Zakat due vs paid, per year</div><svg viewBox="0 0 ${W} ${BH}" width="${W}" height="${BH}" role="img" aria-label="Zakat due versus paid per year">${b}</svg>
  <div class="legend"><span><i class="sw due"></i>due</span><span><i class="sw paidsw"></i>paid for the year</span><span><i class="sw shortsw"></i>paid, still short</span><span>* in progress</span></div>`;
}
let resizeT; window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (R && !$("#r-body").hidden) renderChart(R); }, 150); });

/* ---------- backup / restore / print ---------- */
$("#backup").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify({ ...S, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" })); a.download = `zakat-${today()}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast("backup downloaded"); };
$("#restore").onchange = async (e) => { const f = e.target.files?.[0]; if (!f) return;
  try { const o = JSON.parse(await f.text()); if (!o || typeof o !== "object" || !("settings" in o)) throw new Error("not a Zakat Calculator backup"); if (!confirm("Replace everything on this device with the backup?")) return; S = normalise(o); await save(); renderAll(); toast("restored"); }
  catch (err) { toast("could not restore: " + err.message); } e.target.value = ""; };
$("#print").onclick = () => window.print();
$("#lock").onclick = setPassphrase;

/* ---------- boot ---------- */
function renderAll() { renderSettings(); renderResults(); for (const n of Object.keys(LISTS)) renderList(n); renderForYear(); renderYearPrices(); renderLock(); }
bindSettings(); for (const n of Object.keys(LISTS)) bindList(n);
await load();
renderAll();
