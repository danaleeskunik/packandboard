// The client PDF, made in the browser from the trip as it is now (PLAN.md A10). The same layout and rules as
// scripts/agent_trip_to_pdf.py (Dana's publish step makes the final file there); here the agent sees it any time and can
// print or "save as PDF". Rules: every agent text escaped, prices only when showPrices is on, no booking numbers (never in the trip file).
import * as M from './model.js?v=20261115h';

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
