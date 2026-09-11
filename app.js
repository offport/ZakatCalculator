// Zakat Calculator - the page. State lives in localStorage (optionally encrypted
// with a passphrase via Web Crypto); the arithmetic is in calc.js. No network.
import { DEFAULTS, compute, nisabValue, hijri, money, yearOfPayment, toISO } from "./calc.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const KEY = "zakat:v1", ENC = "zakat:enc";
const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtDate = (iso) => iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";

/* ---------- state ---------- */
let S = blank();
let editing = null;                                            // { list, id } while a row is being edited
let cryptoKey = null;                                          // AES-GCM key while unlocked
function blank() { return { v: 1, settings: { ...DEFAULTS, graceDays: 60, rate: 2.5, carryForward: true }, gains: [], amounts: [], payments: [] }; }

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
function normalise(o) { const b = blank(); return { ...b, ...o, settings: { ...b.settings, ...(o.settings || {}) }, gains: o.gains || [], amounts: o.amounts || [], payments: o.payments || [] }; }

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
function renderSettings() {
  const s = S.settings;
  for (const f of FIELDS) { const el = $("#f-" + f); if (el) el.value = s[f] ?? ""; }
  $("#f-carryForward").checked = !!s.carryForward;
  $("#l-gold").hidden = s.nisabMode !== "gold"; $("#l-silver").hidden = s.nisabMode !== "silver"; $("#l-direct").hidden = s.nisabMode !== "direct";
  $("#h-start").textContent = s.start ? `${hijri(s.start)} · every zakat year is assessed on the same day of the ${s.calendar === "solar" ? "solar" : "lunar"} calendar` : "the anniversary of this day is when each year's zakat is assessed";
  $("#h-calendar").textContent = s.calendar === "solar" ? "a solar year is 11 days longer than the lunar hawl; many use a 2.577 % rate to compensate" : "the hawl: 354 days, the year of the Hijri calendar";
  const n = nisabValue(s);
  $("#v-nisab").textContent = n > 0 ? money(n, s.currency) + (s.nisabMode === "gold" ? "  (85 g of gold)" : s.nisabMode === "silver" ? "  (595 g of silver)" : "") : "enter a price or an amount";
}
function bindSettings() {
  for (const f of FIELDS) { const el = $("#f-" + f); if (!el) continue;
    el.addEventListener("input", () => { S.settings[f] = el.type === "number" ? (el.value === "" ? 0 : Number(el.value)) : el.value; save(); renderSettings(); renderResults(); renderForYear(); });
    el.addEventListener("change", () => { save(); renderSettings(); renderResults(); }); }
  $("#f-carryForward").addEventListener("change", (e) => { S.settings.carryForward = e.target.checked; save(); renderResults(); });
}

/* ---------- the three lists ---------- */
const LISTS = {
  gains: { form: "#a-gains", ul: "#l-gains", fields: ["amount", "from", "to", "note"], empty: "No monthly gains yet.",
    row: (g) => ({ when: `from ${fmtDate(g.from)}${g.to ? " until " + fmtDate(g.to) : ""}`, what: `${esc(g.note || "monthly")} · every month`, amt: money(g.amount, S.settings.currency), neg: false }) },
  amounts: { form: "#a-amounts", ul: "#l-amounts", fields: ["date", "amount", "note"], empty: "No dated amounts yet.",
    row: (a) => ({ when: fmtDate(a.date), what: esc(a.note || (Number(a.amount) < 0 ? "taken out" : "added")), amt: money(a.amount, S.settings.currency), neg: Number(a.amount) < 0 }) },
  payments: { form: "#a-payments", ul: "#l-payments", fields: ["date", "amount", "forYear", "note"], empty: "No zakat payments recorded yet.",
    row: (p) => ({ when: `${fmtDate(p.date)} · year ${yearOfPayment(p, S.settings)}${p.forYear ? " (chosen)" : ""}`, what: esc(p.note || "zakat paid"), amt: money(p.amount, S.settings.currency), neg: false }) },
};
function renderList(name) {
  const L = LISTS[name], items = [...S[name]].sort((a, b) => String(a.date || a.from).localeCompare(String(b.date || b.from)));
  $(L.ul).innerHTML = items.length ? items.map((it) => { const r = L.row(it);
    return `<li data-id="${it.id}" class="${editing?.list === name && editing.id === it.id ? "edit" : ""}"><span class="what"><span class="when">${r.when}</span><br>${r.what}</span><span class="amt ${r.neg ? "neg" : ""}">${r.amt}</span><button class="del" data-del="${it.id}" title="Remove" aria-label="Remove">&#x2715;</button></li>`; }).join("")
    : `<li class="empty">${L.empty}</li>`;
}
function bindList(name) {
  const L = LISTS[name], form = $(L.form);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form), it = { id: editing?.list === name ? editing.id : uid() };
    for (const f of L.fields) { const v = String(fd.get(f) ?? "").trim(); it[f] = f === "amount" ? Number(v) : f === "forYear" ? (v ? Number(v) : "") : v; }
    if (!(it.amount !== 0) || Number.isNaN(it.amount)) { toast("enter an amount"); return; }
    if (name === "gains" && it.to && it.to < it.from) { toast("the end date is before the start"); return; }
    if (editing?.list === name) { const i = S[name].findIndex((x) => x.id === editing.id); if (i >= 0) S[name][i] = it; editing = null; form.querySelector("button[type=submit]").textContent = "Add"; }
    else S[name].push(it);
    form.reset(); save(); renderList(name); renderResults(); renderForYear();
    toast(name === "payments" ? `recorded · counts for year ${yearOfPayment(it, S.settings)}` : "added");
  });
  $(L.ul).addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) { S[name] = S[name].filter((x) => x.id !== del.dataset.del); if (editing?.id === del.dataset.del) { editing = null; form.reset(); form.querySelector("button[type=submit]").textContent = "Add"; } save(); renderList(name); renderResults(); return; }
    const li = e.target.closest("li[data-id]"); if (!li) return;
    const it = S[name].find((x) => x.id === li.dataset.id); if (!it) return;
    editing = { list: name, id: it.id };
    for (const f of L.fields) { const el = form.elements[f]; if (el) el.value = it[f] ?? ""; }
    form.querySelector("button[type=submit]").textContent = "Update"; renderList(name); form.elements[L.fields[0]].focus();
  });
}
function renderForYear() {
  const sel = $("#f-forYear"), cur = sel.value;
  const r = compute(S, today());
  sel.innerHTML = `<option value="">automatic</option>` + r.years.map((y) => `<option value="${y.n}">year ${y.n} · ends ${fmtDate(y.end)}</option>`).join("");
  sel.value = cur;
}

/* ---------- results ---------- */
const STATUS = { met: ["met", "Met"], above: ["above", "Above"], below: ["below", "Below"], current: ["current", "In progress"], "below-nisab": ["flat", "Below nisab"], "no-nisab": ["flat", "No nisab set"] };
function renderResults() {
  const r = compute(S, today()), c = S.settings.currency;
  const ready = !!S.settings.start;
  $("#r-empty").hidden = ready; $("#r-body").hidden = !ready;
  if (!ready) return;
  $("#r-strip").innerHTML = [
    ["Today", `${fmtDate(r.today)}<br><small>${esc(hijri(r.today, "short"))}</small>`],
    ["Wealth today", money(r.current?.wealthToday ?? 0, c)],
    ["Nisab", r.nisab > 0 ? money(r.nisab, c) : "<small>not set</small>"],
    ["Rate", `${r.rate} %<br><small>${r.calendar === "solar" ? "solar" : "lunar"} year</small>`],
  ].map(([k, v]) => `<div class="b"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  const y = r.current;
  $("#r-current").innerHTML = y ? `<div class="year now"><div class="head"><h3>Year ${y.n} &middot; in progress</h3><span class="chip current">${y.daysLeft} day${y.daysLeft === 1 ? "" : "s"} left</span></div>
    <div class="period"><b>${fmtDate(y.start)}</b> &rarr; <b>${fmtDate(y.end)}</b> &middot; ${esc(y.hijriStart)} &rarr; ${esc(y.hijriEnd)}</div>
    <div class="kv">
      <div><span>Wealth today</span><b class="gold">${money(y.wealthToday, c)}</b></div>
      <div><span>Projected at year end</span><b>${money(y.wealth, c)}</b></div>
      <div><span>Nisab</span><b>${r.nisab > 0 ? money(r.nisab, c) : "not set"}</b></div>
      <div><span>Projected zakat due</span><b class="gold">${r.nisab > 0 ? (y.aboveNisab ? money(y.due, c) : "none - below nisab") : "set the nisab"}</b></div>
      <div><span>Paid so far for this year</span><b>${money(y.paid, c)}</b></div>
      ${y.carriedIn ? `<div><span>Carried from last year</span><b class="blue">${money(y.carriedIn, c)}</b></div>` : ""}
    </div>
    <div class="verdict current">${projection(y, c)}</div>
    ${paysList(y, c)}</div>` : "";
  $("#r-years").innerHTML = r.years.filter((x) => x.settled).reverse().map((x) => { const [cls, label] = STATUS[x.status] || ["flat", x.status];
    return `<div class="year"><div class="head"><h3>Year ${x.n}</h3><span class="chip ${cls}">${label}</span></div>
    <div class="period"><b>${fmtDate(x.start)}</b> &rarr; <b>${fmtDate(x.end)}</b> &middot; ${esc(x.hijriStart)} &rarr; ${esc(x.hijriEnd)}</div>
    <div class="kv">
      <div><span>Wealth at year end</span><b class="gold">${money(x.wealth, c)}</b></div>
      <div><span>Nisab</span><b>${r.nisab > 0 ? money(r.nisab, c) + (x.aboveNisab ? " ✓" : " ✗") : "not set"}</b></div>
      <div><span>Zakat due (${r.rate} %)</span><b class="gold">${money(x.due, c)}</b></div>
      <div><span>Paid for this year</span><b>${money(x.paid, c)}</b></div>
      ${x.carriedIn ? `<div><span>Carried from year ${x.n - 1}</span><b class="blue">${money(x.carriedIn, c)}</b></div>` : ""}
      <div><span>Difference</span><b class="${x.diff > 0.49 ? "blue" : x.diff < -0.49 ? "red" : "green"}">${x.diff >= 0 ? "+" : "−"}${money(Math.abs(x.diff), c)}</b></div>
    </div>
    <div class="verdict ${cls}">${verdict(x, c)}</div>
    ${paysList(x, c)}</div>`; }).join("");
  const t = r.totals, settled = r.years.filter((x) => x.settled).length;
  $("#r-totals").innerHTML = settled ? [
    ["Years settled", settled], ["Met", t.met], ["Above", t.above], ["Below", t.below],
    ["Total due", money(t.due, c)], ["Total paid", money(t.paid, c)],
    ["Shortfall", t.shortfall ? money(t.shortfall, c) : "none"], ["Surplus", t.surplus ? money(t.surplus, c) : "none"],
  ].map(([k, v], i) => `<div class="b"><div class="k">${k}</div><div class="v ${k === "Shortfall" && t.shortfall ? "red" : k === "Surplus" && t.surplus ? "blue" : k === "Met" && t.met ? "green" : ""}">${v}</div></div>`).join("") : `<div class="axnote">The first zakat year has not ended yet - the card above projects it.</div>`;
}
function verdict(x, c) {
  if (x.status === "no-nisab") return "Set a gold or silver price (or a nisab amount) in the settings to judge this year.";
  if (x.status === "below-nisab") return `Wealth stayed below the nisab of ${money(x.nisab, c)} - no zakat was due this year.${x.paid ? ` The ${money(x.paid, c)} paid counts as charity, or choose another year for it.` : ""}`;
  if (x.status === "met") return `<b>Met.</b> You paid ${money(x.credit, c)}${x.carriedIn ? ` (including ${money(x.carriedIn, c)} carried over)` : ""} against ${money(x.due, c)} due.`;
  if (x.status === "above") return `<b>Above by ${money(x.diff, c)}.</b> ${money(x.credit, c)} paid against ${money(x.due, c)} due${S.settings.carryForward ? " - the surplus carries into the next year" : ""}.`;
  return `<b>Below by ${money(-x.diff, c)}.</b> ${money(x.credit, c)} paid against ${money(x.due, c)} due - this amount is still owed.`;
}
function projection(y, c) {
  if (S.settings.start > today()) return "The start date is in the future.";
  if (!(y.nisab > 0)) return "Set the nisab to see whether zakat will be due.";
  if (!y.aboveNisab) return `On current numbers the wealth at year end (${money(y.wealth, c)}) stays below the nisab - no zakat would be due.`;
  const left = y.due - y.credit;
  if (Math.abs(left) < 0.5) return `<b>On track.</b> What you have paid (${money(y.credit, c)}) already covers the projected ${money(y.due, c)}.`;
  if (left < 0) return `<b>Ahead by ${money(-left, c)}.</b> ${money(y.credit, c)} paid against a projected ${money(y.due, c)}.`;
  return `<b>${money(left, c)} still to pay</b> against a projected ${money(y.due, c)}, due on ${fmtDate(y.end)} (${esc(y.hijriEnd)}).`;
}
function paysList(y, c) { return y.payments.length ? `<ul class="pays">${y.payments.map((p) => `<li><span>${fmtDate(p.date)} ${esc(p.note || "")}</span><span>${money(p.amount, c)}</span></li>`).join("")}</ul>` : ""; }

/* ---------- backup / restore / print ---------- */
$("#backup").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify({ ...S, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" })); a.download = `zakat-${today()}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast("backup downloaded"); };
$("#restore").onchange = async (e) => { const f = e.target.files?.[0]; if (!f) return;
  try { const o = JSON.parse(await f.text()); if (!o || typeof o !== "object" || !("settings" in o)) throw new Error("not a Zakat Calculator backup"); if (!confirm("Replace everything on this device with the backup?")) return; S = normalise(o); await save(); renderAll(); toast("restored"); }
  catch (err) { toast("could not restore: " + err.message); } e.target.value = ""; };
$("#print").onclick = () => window.print();
$("#lock").onclick = setPassphrase;

/* ---------- boot ---------- */
function renderAll() { renderSettings(); for (const n of Object.keys(LISTS)) renderList(n); renderForYear(); renderResults(); renderLock(); }
bindSettings(); for (const n of Object.keys(LISTS)) bindList(n);
await load();
renderAll();
