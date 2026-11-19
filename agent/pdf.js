// The client PDF, made in the browser from the trip as it is now (PLAN.md A10). The same layout and rules as
// scripts/agent_trip_to_pdf.py (Dana's publish step makes the final file there); here the agent sees it any time and can
// print or "save as PDF". Rules: every agent text escaped, prices only when showPrices is on, no booking numbers (never in the trip file).
import * as M from './model.js?v=20261119q';

const WD = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const MODE_HE = { flight: 'טיסה', train: 'רכבת', shinkansen: 'שינקנסן', driver: 'נהג פרטי', taxi: 'מונית', car: 'רכב שכור', transit: 'תחבורה ציבורית', walk: 'הליכה', other: '' };
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const he = (x) => (x && typeof x === 'object' ? x.he || '' : x || '');
const D = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const short = (dt) => dt.getUTCDate() + '.' + (dt.getUTCMonth() + 1);
const wd = (dt) => WD[dt.getUTCDay()];
const addD = (dt, n) => new Date(dt.getTime() + n * 86400000);
const money = (v, cur) => { const n = Number(String(v).replace(/,/g, '')); return (isNaN(n) ? String(v) : n.toLocaleString('en-US', { maximumFractionDigits: 2 })) + (cur ? ' ' + cur : ''); };

export async function loadPack(country) {
  try {
    const idx = await fetch('packs/index.json').then((r) => r.json());
    const key = Object.keys(idx).find((k) => idx[k].includes((country || '').trim()));
    return key ? await fetch('packs/' + key + '.json').then((r) => r.json()) : null;
  } catch (e) { return null; }
}

const CSS = `
@page { size: A4; margin: 16mm 14mm 18mm; @bottom-center { content: counter(page) " / " counter(pages); font: 9pt 'Heebo', sans-serif; color: #5F6B63; } }
@page cover { margin: 0; @bottom-center { content: none; } }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 10.5pt/1.55 'Heebo', sans-serif; color: #1F2A24; direction: rtl; background: #8A938D; }
h1, h2, h3 { font-family: 'Miriam Libre', 'Heebo', serif; color: #17352A; margin: 0; }
.ltr { direction: ltr; unicode-bidi: isolate; }
.bar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; padding: 10px 16px; background: #17352A; color: #fff; font-size: 14px; }
.bar button { font: 700 15px 'Heebo', sans-serif; min-height: 44px; padding: 0 20px; border-radius: 999px; border: 0; background: #fff; color: #17352A; cursor: pointer; }
.sheet { background: #fff; width: 210mm; max-width: 100%; margin: 16px auto; padding: 16mm 14mm; box-shadow: 0 4px 18px rgba(0,0,0,.25); }
.cover { page: cover; min-height: 297mm; display: flex; flex-direction: column; background: #F7F2E8; break-after: page; position: relative; padding: 0; }
.cover .band { height: 12mm; display: flex; }
.cover .band span { flex: 1; }
.cover .in { flex: 1; padding: 34mm 22mm 0; display: flex; flex-direction: column; }
.cover .agency { font: 700 14pt 'Heebo', sans-serif; color: #17352A; margin-bottom: 18mm; }
.cover .logo img { max-height: 26mm; max-width: 70mm; object-fit: contain; margin-bottom: 18mm; }
.cover .eyebrow { font-weight: 700; color: #1F5E48; font-size: 12pt; }
.cover h1 { font-size: 48pt; line-height: 1.1; margin: 4mm 0 6mm; }
.cover .dates { font-size: 15pt; font-weight: 600; }
.cover .cities { font-size: 12.5pt; color: #4B5A51; margin-top: 3mm; }
.cover .family { margin-top: 22mm; font-size: 13pt; }
.cover .family b { display: block; font: 700 20pt 'Miriam Libre', serif; color: #17352A; margin-top: 1mm; }
.cover .foot { padding: 0 22mm 16mm; display: flex; justify-content: space-between; align-items: flex-end; font-size: 9.5pt; color: #5F6B63; }
.cover .pab { font: 700 11pt 'Miriam Libre', serif; color: #17352A; }
section { margin-bottom: 9mm; }
section > h2 { font-size: 18pt; padding-bottom: 2mm; border-bottom: 2px solid #1F5E48; margin-bottom: 4mm; }
table { width: 100%; border-collapse: collapse; font-size: 10pt; }
th { text-align: right; font-weight: 700; color: #4B5A51; font-size: 9pt; padding: 2mm 2.5mm; background: #EFE8D8; }
td { padding: 2.2mm 2.5mm; border-bottom: 1px solid #E2D9C4; vertical-align: top; }
tr { break-inside: avoid; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-inline-end: 5px; vertical-align: middle; }
.muted { color: #5F6B63; }
.day { margin-bottom: 6mm; border-inline-start: 4px solid var(--c); padding-inline-start: 4mm; }
.day-h { display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; break-after: avoid; margin-bottom: 1.5mm; }
.day-h h3 { font-size: 13.5pt; }
.day-h .when { font-weight: 700; color: #1F5E48; white-space: nowrap; font-size: 10pt; }
.day .where { font-size: 9.5pt; color: #5F6B63; margin-bottom: 1.5mm; }
.row { display: flex; gap: 4mm; padding: 1.6mm 0; border-top: 1px solid #EFE8D8; break-inside: avoid; }
.row .lb { flex: 0 0 22mm; font-weight: 700; color: #4B5A51; font-size: 9.5pt; }
.row .tx { flex: 1; }
.row .tx b { color: #17352A; }
.meta { color: #5F6B63; font-size: 9.5pt; }
.tip { margin: 2mm 0; padding: 2.5mm 3.5mm; background: #E7EEF8; border-inline-start: 3px solid #4A63A8; border-radius: 2mm; break-inside: avoid; color: #1F3366; }
.free { color: #5F6B63; padding: 1.6mm 0; border-top: 1px solid #EFE8D8; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 8mm; }
.card { border: 1px solid #E2D9C4; border-radius: 2.5mm; padding: 3mm 4mm; break-inside: avoid; }
.card .t { font-weight: 700; color: #B42318; font-size: 9pt; }
.card .n { font: 700 13pt 'Heebo', sans-serif; margin-top: 1mm; }
.note { font-size: 9.5pt; color: #4B5A51; }
.draft { position: fixed; bottom: 6mm; left: 6mm; font: 700 9pt 'Heebo', sans-serif; color: #A3281E; }
@media print { body { background: #fff; } .bar { display: none; } .sheet { width: auto; margin: 0; padding: 0; box-shadow: none; } .cover { min-height: 297mm; } }
@media screen and (max-width: 820px) { .sheet { padding: 8mm 6mm; } .cover .in { padding: 20mm 10mm 0; } .cover h1 { font-size: 34pt; } }
`;

export function buildPdfHtml(t, pack, { draft = true, bar = true } = {}) {
  if (!t.stays.length || !t.startDate) return null;
  const name = (s) => he(s.label) || s.dest;
  const color = (s) => s.color || (pack && pack.themeColor) || '#1F5E48';
  const stayByDest = (dest) => t.stays.find((s) => s.dest === dest);
  const country = (t.country || (pack && pack.nameHe) || '').trim();
  const first = D(t.startDate), N = M.totalNights(t), last = addD(first, N);
  const family = he(t.client && t.client.name).trim();
  const agency = ((t.branding && t.branding.agencyName) || '').trim();
  const cities = [...new Set(t.stays.map(name))].join(' · ');
  const fm = first.getUTCMonth(), lm = last.getUTCMonth(), fy = first.getUTCFullYear(), ly = last.getUTCFullYear();
  const dates = fm === lm && fy === ly ? `${first.getUTCDate()}–${last.getUTCDate()} ב${MONTHS[fm]} ${fy}`
    : fy === ly ? `${first.getUTCDate()} ב${MONTHS[fm]} – ${last.getUTCDate()} ב${MONTHS[lm]} ${ly}`
    : `${first.getUTCDate()} ב${MONTHS[fm]} ${fy} – ${last.getUTCDate()} ב${MONTHS[lm]} ${ly}`;
  const showPrices = !!t.showPrices;

  const logo = t.branding && M.safeUrl(t.branding.logoUrl) ? `<div class="logo"><img src="${esc(M.safeUrl(t.branding.logoUrl))}" alt=""></div>` : agency ? `<div class="agency">${esc(agency)}</div>` : '';
  const cover = `<div class="sheet cover"><div class="band">${t.stays.map((s) => `<span style="background:${esc(color(s))}"></span>`).join('')}</div>
    <div class="in">${logo}<div class="eyebrow">מסלול מותאם אישית</div><h1>${esc(t.title || country)}</h1>
    <div class="dates">${esc(dates)} · ${N + 1} ימים</div><div class="cities">${esc(cities)}</div>
    ${family ? `<div class="family">הטיול של<b>${esc(family)}</b></div>` : ''}</div>
    <div class="foot"><span>${esc(agency ? 'תכנון: ' + agency : '')}</span><span class="pab">Pack &amp; Board</span></div></div>`;

  const fl = t.flights || {};
  const fline = (f, def, label) => {
    if (!f) return `<tr><td>${label}</td><td>${wd(def)} ${short(def)}</td><td class="muted" colspan="3">הפרטים יישלחו בנפרד</td></tr>`;
    const fd = f.date ? D(f.date) : def;
    return `<tr><td>${label}</td><td>${wd(fd)} ${short(fd)}</td><td class="ltr">${esc(f.number || '')}</td><td class="ltr">${esc([f.from, f.to].filter(Boolean).join(' → '))}</td><td>${esc(f.depart || '')}</td></tr>`;
  };
  const flights = `<section><h2>טיסות</h2><table><tr><th>כיוון</th><th>תאריך</th><th>טיסה</th><th>מסלול</th><th>המראה</th></tr>${fline(fl.out, first, 'הלוך')}${fline(fl.back, last, 'חזור')}</table></section>`;

  let rows = '', start = first;
  t.stays.forEach((s) => {
    const a = start, z = addD(start, s.nights); start = z;
    const h = M.shownHotel(s);
    const hn = h && h.name ? esc(h.name) : '<span class="muted">יפורט בהמשך</span>';
    let extra = '';
    if (h && h.area) extra += `<div class="muted">${esc(h.area)}</div>`;
    if (h && h.why) extra += `<div class="note">${esc(h.why)}</div>`;
    const price = showPrices && h && h.pricePerNight != null && h.pricePerNight !== '' ? esc(money(h.pricePerNight, h.currency)) : '';
    rows += `<tr><td><span class="dot" style="background:${esc(color(s))}"></span>${esc(name(s))}</td><td class="ltr">${short(a)}–${short(z)}</td><td>${s.nights}</td><td><bdi>${hn}</bdi>${extra}</td>${showPrices ? `<td class="ltr">${price}</td>` : ''}</tr>`;
  });
  const hotels = `<section><h2>מלונות</h2><table><tr><th>יעד</th><th>תאריכים</th><th>לילות</th><th>מלון</th>${showPrices ? '<th>ללילה</th>' : ''}</tr>${rows}</table></section>`;

  let daysHtml = '';
  const transfers = [];
  t.days.forEach((day, n) => {
    const info = M.dayInfo(t, n), dt = D(info.date);
    const st = stayByDest(info.dest), st2 = info.dest2 ? stayByDest(info.dest2) : null;
    const groups = M.itemsByPart(day);
    let body = '';
    M.PARTS.forEach((p) => groups[p].forEach((it) => {
      const tr = it.transfer || {};
      if (it.pending && !tr.to) return;
      const ti = he(it.title).trim(), tx = he(it.text).trim();
      let h = ti ? `<b><bdi>${esc(ti)}</bdi></b>${tx ? ': ' + esc(tx) : ''}` : esc(tx);
      const meta = [];
      if (it.kind === 'transfer') {
        const facts = [MODE_HE[tr.mode] || '', tr.duration || '', tr.distanceKm ? tr.distanceKm + ' ק״מ' : '', tr.provider || ''].filter(Boolean);
        const route = [tr.from, tr.to].filter(Boolean).join(' ← ');
        if (route) meta.push(route);
        meta.push(...facts);
        transfers.push({ dt, label: M.itemLabel(it), title: ti, route, facts, price: showPrices && it.price != null && it.price !== '' ? money(it.price, it.currency) : '' });
      }
      if (it.place && !/^[a-z]+:/i.test(it.place)) meta.push(it.place);
      if (showPrices && it.price != null && it.price !== '' && it.kind !== 'tip') meta.push(money(it.price, it.currency));
      if (meta.length) h += `<div class="meta"><bdi>${esc(meta.join(' · '))}</bdi></div>`;
      if (!h) return;
      body += it.kind === 'tip' ? `<div class="tip">${h}</div>` : `<div class="row"><div class="lb">${esc(M.itemLabel(it))}</div><div class="tx">${h}</div></div>`;
    }));
    if (!body) body = '<div class="free">יום חופשי</div>';
    const where = st2 ? name(st) + ' ← ' + name(st2) : name(st);
    const title = he(day.title).trim() || where;
    daysHtml += `<div class="day" style="--c:${esc(color(st2 || st))}"><div class="day-h"><h3>יום ${n + 1} · ${esc(title)}</h3><span class="when">${wd(dt)} ${short(dt)}</span></div><div class="where">${esc(where)}</div>${body}</div>`;
  });
  const days = `<section><h2>יום אחר יום</h2>${daysHtml}</section>`;

  const transfersSec = transfers.length ? `<section><h2>כל ההעברות</h2><table><tr><th>יום</th><th>שעה</th><th>מה</th><th>איך</th>${showPrices ? '<th>מחיר</th>' : ''}</tr>${transfers.map((x) =>
    `<tr><td>${wd(x.dt)} ${short(x.dt)}</td><td class="ltr">${esc(x.label)}</td><td><b>${esc(x.title)}</b>${x.route ? `<div class="muted"><bdi>${esc(x.route)}</bdi></div>` : ''}</td><td>${esc(x.facts.join(' · '))}</td>${showPrices ? `<td class="ltr">${esc(x.price)}</td>` : ''}</tr>`).join('')}</table></section>` : '';

  let cards = agency ? `<div class="card"><div class="t">${esc('תכנון הטיול: ' + agency)}</div><div class="n ltr">${esc((t.branding && t.branding.phone) || '')}</div></div>` : '';
  if (pack) cards += pack.emergency.map(([tel, ti, n]) => `<div class="card"><div class="t">${esc(ti)}</div><div class="n ltr">${esc(n)}</div></div>`).join('');
  const notes = pack ? pack.emergencyNotes.map(([ti, p]) => `<p class="note"><b>${esc(ti)}:</b> ${esc(p)}</p>`).join('') : '';
  const contacts = cards || notes ? `<section style="break-inside:avoid"><h2>אנשי קשר וחירום</h2><div class="grid2">${cards}</div>${notes}</section>` : '';

  const fileName = `${country || 'טיול'}-${family || 'טיול'}-${short(first)}-${short(last)}.${ly}`.replace(/[\\/:*?"<>|]+/g, ' ');
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(fileName)}</title>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&family=Miriam+Libre:wght@400;700&display=swap" rel="stylesheet"><style>${CSS}</style></head><body>
${bar ? `<div class="bar"><span>תצוגת PDF${draft ? ' · טיוטה, לפי מה שמולא עד עכשיו' : ''}</span><button type="button" onclick="window.print()">הדפסה או שמירה כ-PDF</button></div>` : ''}
${cover}<div class="sheet">${flights}${hotels}${days}${transfersSec}${contacts}</div></body></html>`;
}

// ---------- the price quote for the client, in the destination's look (Dana 2026-11-19) ----------
// The look comes from the country pack (pack.quote: paper, ink, accent, motif, stamp, small labels); without it, a plain
// version in the trip colour. Every agent text is escaped. No booking number is ever part of the quote.
const SYM = { ILS: '₪', USD: '$', EUR: '€', JPY: '¥', GBP: '£', THB: '฿' };
const SEIGAIHA = (c) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='48' height='24' viewBox='0 0 48 24'><g fill='none' stroke='${c}' stroke-width='1.3' opacity='.55'><path d='M0 24a24 24 0 0 1 48 0'/><path d='M6 24a18 18 0 0 1 36 0'/><path d='M12 24a12 12 0 0 1 24 0'/><path d='M18 24a6 6 0 0 1 12 0'/><path d='M-24 12a24 24 0 0 1 48 0M24 12a24 24 0 0 1 48 0'/><path d='M-18 12a18 18 0 0 1 36 0M30 12a18 18 0 0 1 36 0'/><path d='M-12 12a12 12 0 0 1 24 0M36 12a12 12 0 0 1 24 0'/></g></svg>`)}")`;

export function buildQuoteHtml(t, pack) {
  if (!t.stays.length || !t.startDate) return null;
  const q = M.quoteOf(t), tot = M.quoteTotals(t), qs = (pack && pack.quote) || {};
  const accent = qs.accent || (pack && pack.themeColor) || '#1F5E48', paper = qs.paper || '#FBF8F2', ink = qs.ink || '#1F2A24';
  const line = qs.line || '#E3DDD2', tint = qs.tint || '#EEF3EF', L = qs.labels || {};
  const name = (s) => he(s.label) || s.dest;
  const color = (s) => s.color || accent;
  const country = (t.country || (pack && pack.nameHe) || '').trim();
  const first = D(t.startDate), N = M.totalNights(t), last = addD(first, N);
  const family = he(t.client && t.client.name).trim();
  const agency = ((t.branding && t.branding.agencyName) || '').trim();
  const phone = ((t.branding && t.branding.phone) || '').trim();
  const sym = SYM[q.currency] || q.currency;
  const fmt = (n) => (n == null ? '' : Math.round(n).toLocaleString('he-IL'));
  const amount = (n) => `<span class="amt" dir="ltr">${q.currency === 'ILS' ? esc(fmt(n)) + ' ' + esc(sym) : esc(sym) + esc(fmt(n))}</span>`;
  const today = new Date(), issued = q.issued || today.toISOString().slice(0, 10);
  const longDate = (iso) => { const x = D(iso); return `${x.getUTCDate()} ב${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`; };
  const number = q.number || ('Q-' + String(t.id || '').replace(/[^a-z0-9]/gi, '').slice(-5).toUpperCase() + '-' + issued.slice(2, 4) + issued.slice(5, 7));
  const pax = tot.pax, adults = ((t.client && t.client.travelers) || []).filter((x) => x.type !== 'child').length, kids = pax - adults;
  const paxText = pax ? `${adults} מבוגרים` + (kids ? ` ו-${kids} ${kids === 1 ? 'ילד' : 'ילדים'}` : '') : '';
  const cities = [...new Set(t.stays.map(name))].join(' · ');
  const tag = (k) => (L[k] ? `<span class="jp" aria-hidden="true">${esc(L[k])}</span>` : '');

  const logo = t.branding && M.safeUrl(t.branding.logoUrl) ? `<img class="logo" src="${esc(M.safeUrl(t.branding.logoUrl))}" alt="${esc(agency)}">` : agency ? `<div class="agency">${esc(agency)}</div>` : '';
  const stamp = qs.stamp ? `<div class="stamp" aria-hidden="true">${esc(qs.stamp)}</div>` : '';
  const head = `<header class="hd"><div class="motif"></div><div class="in">${logo}<div class="meta"><span>הצעת מחיר <bdi>${esc(number)}</bdi></span><span>${esc(longDate(issued))}</span></div>
    ${stamp}<p class="eye">הצעת מחיר לטיול</p><h1>${esc(t.title || country || 'הטיול')}</h1>
    <p class="sub"><bdi>${short(first)}–${short(last)}.${last.getUTCFullYear()}</bdi> · ${N + 1} ימים · ${esc(cities)}</p>
    ${family ? `<p class="for">עבור <b>${esc(family)}</b>${paxText ? ' · ' + esc(paxText) : ''}</p>` : ''}</div></header>`;

  const big = tot.priced ? `<section class="total"><div><span class="lb">סך הכל לטיול</span>${amount(tot.total)}</div>${q.perPerson && pax > 1 ? `<div><span class="lb">לאדם</span>${amount(tot.perPerson)}</div>` : ''}${q.validUntil ? `<div><span class="lb">בתוקף עד</span><span class="v">${esc(longDate(q.validUntil))}</span></div>` : ''}</section>` : '';

  const fl = t.flights || {};
  const fcard = (f, def, label) => {
    const fd = f && f.date ? D(f.date) : def;
    return `<div class="fl"><span class="dir">${label}</span><b>${wd(fd)} ${short(fd)}</b>${f ? `<span class="ltr route">${esc([f.from, f.to].filter(Boolean).join(' → '))}</span><span class="muted ltr">${esc([f.number, f.depart].filter(Boolean).join(' · '))}</span>` : '<span class="muted">הפרטים יישלחו בהמשך</span>'}</div>`;
  };
  const flights = `<section><h2>${tag('flights')}טיסות</h2><div class="fls">${fcard(fl.out, first, 'הלוך')}${fcard(fl.back, last, 'חזור')}</div></section>`;

  let start = first, hrows = '';
  t.stays.forEach((s) => {
    const a = start, z = addD(start, s.nights); start = z;
    const h = M.shownHotel(s) || s.hotels[0];
    hrows += `<div class="ht" style="--c:${esc(color(s))}"><div class="hc"><b>${esc(name(s))}</b><span class="muted"><bdi>${short(a)}–${short(z)}</bdi> · ${s.nights} לילות</span></div>
      <div class="hn">${h && h.name ? `<bdi>${esc(h.name)}</bdi>` : '<span class="muted">יפורט בהמשך</span>'}${h && h.area ? `<span class="muted"> · ${esc(h.area)}</span>` : ''}${h && h.why ? `<div class="why">${esc(h.why)}</div>` : ''}</div></div>`;
  });
  const hotels = `<section><h2>${tag('hotels')}מלונות</h2><div class="hts">${hrows}</div></section>`;

  let drows = '';
  t.days.forEach((day, n) => {
    const info = M.dayInfo(t, n), dt = D(info.date);
    const st = t.stays.find((s) => s.dest === info.dest), st2 = info.dest2 ? t.stays.find((s) => s.dest === info.dest2) : null;
    const where = st2 ? name(st) + ' ← ' + name(st2) : name(st);
    const title = he(day.title).trim();
    drows += `<li style="--c:${esc(color(st2 || st))}"><span class="dn">${n + 1}</span><span class="dd">${wd(dt)} ${short(dt)}</span><span class="dw">${esc(where)}</span><span class="dt">${esc(title)}</span></li>`;
  });
  const days = `<section><h2>${tag('days')}המסלול, יום אחר יום</h2><ol class="days">${drows}</ol></section>`;

  const lrows = q.lines.filter((l) => (l.label || '').trim() || M.quoteNum(l.price) != null).map((l) => {
    const p = M.quoteNum(l.price), n = M.quoteNum(l.qty);
    return `<tr><td><b>${esc(l.label)}</b>${l.note ? `<div class="muted">${esc(l.note)}</div>` : ''}</td><td class="c">${n == null ? '' : esc(String(n))}</td><td class="e">${p == null ? '<span class="muted">יעודכן</span>' : amount(p)}</td><td class="e">${p == null ? '' : amount(p * (n == null ? 1 : n))}</td></tr>`;
  }).join('');
  const price = lrows ? `<section class="price"><h2>${tag('price')}פירוט המחיר</h2><table><thead><tr><th>מה כלול</th><th class="c">כמות</th><th class="e">מחיר</th><th class="e">סה״כ</th></tr></thead><tbody>${lrows}</tbody>
    <tfoot><tr><td colspan="3">סך הכל</td><td class="e">${amount(tot.total)}</td></tr>${q.perPerson && pax > 1 ? `<tr class="pp"><td colspan="3">לאדם (${pax} נוסעים)</td><td class="e">${amount(tot.perPerson)}</td></tr>` : ''}</tfoot></table></section>` : '';

  const list = (arr) => arr.filter((x) => String(x).trim()).map((x) => `<li>${esc(x)}</li>`).join('');
  const inc = list(q.includes), exc = list(q.excludes);
  const incl = inc || exc ? `<section class="two">${inc ? `<div class="box yes"><h3>המחיר כולל</h3><ul>${inc}</ul></div>` : ''}${exc ? `<div class="box no"><h3>המחיר לא כולל</h3><ul>${exc}</ul></div>` : ''}</section>` : '';
  const terms = q.notes || q.validUntil ? `<section><h2>${tag('terms')}תנאים והערות</h2>${q.validUntil ? `<p>ההצעה בתוקף עד ${esc(longDate(q.validUntil))}, ובכפוף לזמינות בעת ההזמנה.</p>` : ''}${q.notes ? `<p class="pre">${esc(q.notes)}</p>` : ''}</section>` : '';
  const foot = `<footer class="ft"><div>${qs.greeting ? `<b>${esc(qs.greeting)}</b>` : ''}${agency ? `<span>${esc(agency)}${phone ? ' · <bdi class="ltr">' + esc(phone) + '</bdi>' : ''}</span>` : ''}</div><span class="pab">Pack &amp; Board</span></footer>`;

  const css = `
@page{size:A4;margin:12mm}*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:${paper};color:${ink};font:15px/1.6 'Heebo',system-ui,sans-serif;direction:rtl}
.page{max-width:820px;margin:0 auto;padding:0 18px 40px}
h1,h2,h3{font-family:'Miriam Libre','Heebo',serif;margin:0}
.muted{color:color-mix(in srgb,${ink} 58%,${paper})}.ltr{direction:ltr;unicode-bidi:isolate}bdi{unicode-bidi:isolate}
.hd{position:relative;margin:0 -18px 18px;padding:0 18px;border-bottom:3px solid ${accent};background:${paper}}
.hd .motif{height:58px;margin:0 -18px;background:${qs.motif === 'seigaiha' ? SEIGAIHA(accent) : accent};background-size:48px 24px;${qs.motif === 'seigaiha' ? '' : 'opacity:.9;'}}
.hd .in{position:relative;padding:22px 0 22px}
.logo{max-height:52px;max-width:180px;display:block;margin-bottom:12px}.agency{font-weight:700;margin-bottom:10px}
.hd .meta{position:absolute;top:22px;inset-inline-end:0;text-align:end;display:flex;flex-direction:column;font-size:13px;color:color-mix(in srgb,${ink} 62%,${paper})}
.stamp{position:absolute;inset-inline-end:6px;top:78px;width:74px;height:74px;border-radius:50%;border:3px solid ${accent};color:${accent};display:flex;align-items:center;justify-content:center;font:700 38px/1 serif;transform:rotate(-12deg);opacity:.9}
.eye{margin:0 0 4px;font-weight:700;font-size:13px;letter-spacing:.12em;color:${accent}}
h1{font-size:clamp(30px,6vw,44px);line-height:1.1;color:${ink}}
.sub{margin:8px 0 0;font-size:16px}.for{margin:10px 0 0;font-size:16px}
.total{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 22px}
.total>div{flex:1 1 180px;background:${accent};color:#fff;border-radius:14px;padding:14px 18px;display:flex;flex-direction:column}
.total>div:not(:first-child){background:#fff;color:${ink};border:1px solid ${line}}
.total .lb{font-size:13px;font-weight:600;opacity:.85}.total .amt{align-self:flex-start}.total .amt{font:700 28px/1.2 'Miriam Libre',serif}.total .v{font:700 18px/1.4 'Heebo',sans-serif;margin-top:6px}
section{margin:0 0 24px;break-inside:avoid}
h2{font-size:22px;display:flex;align-items:center;gap:10px;padding-bottom:8px;margin-bottom:12px;border-bottom:1px solid ${line}}
h2::before{content:"";width:5px;height:22px;border-radius:3px;background:${accent}}
.jp{order:2;margin-inline-start:auto;font:500 14px/1 serif;color:${accent};letter-spacing:.2em}
.fls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.fl{background:#fff;border:1px solid ${line};border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:2px}
.fl .dir{font-size:12px;font-weight:700;color:${accent}}.fl .route{font-weight:600}
.hts{display:flex;flex-direction:column;gap:10px}
.ht{display:grid;grid-template-columns:170px minmax(0,1fr);gap:12px;background:#fff;border:1px solid ${line};border-inline-start:5px solid var(--c);border-radius:12px;padding:12px 14px}
.hc{display:flex;flex-direction:column}.why{font-size:14px;margin-top:4px;color:color-mix(in srgb,${ink} 70%,${paper})}
.days{list-style:none;margin:0;padding:0;background:#fff;border:1px solid ${line};border-radius:12px;overflow:hidden}
.days li{display:grid;grid-template-columns:34px 74px 130px minmax(0,1fr);gap:10px;align-items:baseline;padding:9px 14px;border-top:1px solid ${line}}
.days li:first-child{border-top:0}.dn{font:700 15px/1 'Miriam Libre',serif;color:var(--c)}.dd{font-size:14px;color:color-mix(in srgb,${ink} 62%,${paper})}.dw{font-weight:600}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid ${line};border-radius:12px;overflow:hidden}
th,td{padding:10px 14px;text-align:start;border-top:1px solid ${line};vertical-align:top}th{background:${tint};font-size:13px;border-top:0}
td.c,th.c{text-align:center;width:70px}td.e,th.e{text-align:end;white-space:nowrap;width:120px}
tfoot td{font-weight:700;background:${tint}}tfoot .pp td{font-weight:600;background:#fff}tfoot .amt{font-size:17px}
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.box{background:#fff;border:1px solid ${line};border-radius:12px;padding:14px 16px}.box h3{font-size:17px;margin-bottom:6px}
.box ul{margin:0;padding-inline-start:18px}.box li{margin:3px 0}.box.yes h3{color:${accent}}
.pre{white-space:pre-wrap}
.ft{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;border-top:3px solid ${accent};padding-top:14px;margin-top:10px}
.ft div{display:flex;flex-direction:column}.ft b{font-family:'Miriam Libre',serif;font-size:18px;color:${accent}}.pab{font-size:12px;color:color-mix(in srgb,${ink} 55%,${paper})}
@media (max-width:620px){.fls,.two{grid-template-columns:minmax(0,1fr)}.ht{grid-template-columns:minmax(0,1fr)}
  .days li{grid-template-columns:28px 64px minmax(0,1fr)}.days .dt{grid-column:3}.stamp{width:58px;height:58px;font-size:30px;top:70px}
  th.c,td.c{width:48px;padding-inline:6px}td.e,th.e{width:auto}}
@media print{body{background:${paper}}.page{max-width:none;padding:0}.hd{margin:0 0 16px}.hd .motif{margin:0}}`;
  const fileName = `הצעת מחיר-${country || 'טיול'}-${family || ''}-${short(first)}.${first.getUTCFullYear()}`.replace(/[\\/:*?"<>|]+/g, ' ');
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(fileName)}</title>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&family=Miriam+Libre:wght@400;700&display=swap" rel="stylesheet"><style>${css}</style></head><body>
<div class="page">${head}${big}${flights}${days}${hotels}${price}${incl}${terms}${foot}</div></body></html>`;
}
