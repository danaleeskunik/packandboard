// Agent itinerary builder: the screens (PLAN.md tasks A3-A8). Plain JS, no build step.
// State lives in S; every change to the trip goes through commit() (undo + autosave) or edit() (typing: autosave only).
import * as M from './model.js?v=20261126d';
import { createStore, takeSecret, forgetSecret, Conflict, NoAccess } from './store.js?v=20261126d';
import { buildPdfHtml, buildQuoteHtml, loadPack } from './pdf.js?v=20261126d';

const S = {
  store: null, me: null, trips: [], filter: 'all', q: '', menuFor: null,
  row: null, t: null, priv: {}, version: 0, history: [],
  snippets: [], libQuery: '', libDest: '',
  day: 0, editItem: null, side: (() => { try { return localStorage.getItem('packandboard.agent.side') || 'preview'; } catch (e) { return 'preview'; } })(),
  save: 'saved', saveTimer: null, saving: false, dirty: false, privTimer: null,
  dlg: null, conflict: false,
  hopen: {}, mtab: 'edit', itemMenu: null, libMenu: null, addOpen: null, pickQ: '', askLibFor: null, askLib: null, allDays: false, scrolledDay: null,
};
// day and item duplication are hidden for now (Dana, 2026-11-15: confusing). Whole-trip cloning in the trips list stays.
const SHOW_DUPLICATE = false;
const PALETTE = ['#C02436', '#2F6B4F', '#6B3FA0', '#1F5F8B', '#1F7A73', '#8E3B6B', '#4A5C36', '#3B5BA0'];
const WEEKDAY = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const STATUS = { draft: ['טיוטה', 'draft'], submitted: ['אצל דנה', 'dana'], published: ['פורסם', 'pub'], archived: ['בארכיון', 'draft'] };
const KIND_HE = { activity: 'פעילות', meal: 'ארוחה', tip: 'טיפ', transfer: 'הגעה' };
const MODE_HE = { flight: 'טיסה', train: 'רכבת', shinkansen: 'שינקנסן', driver: 'נהג פרטי', taxi: 'מונית', car: 'רכב שכור', transit: 'תחבורה ציבורית', walk: 'הליכה', other: 'אחר' };
const PART_RANGE = { 'בוקר': 'עד <span class="ltr">11:30</span>', 'צהריים': '<span class="ltr">11:30–16:00</span>', 'ערב': '<span class="ltr">16:00–21:00</span>', 'לילה': 'מ-<span class="ltr">21:00</span>' };
const CURRENCIES = ['ILS', 'USD', 'EUR', 'JPY', 'GBP', 'THB'];

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const he = (x) => (x && typeof x === 'object' ? x.he || '' : x || '');
const icon = (d, size) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"${size ? ` style="width:${size}px;height:${size}px"` : ''}><path d="${d}"/></svg>`;
const I = {
  plus: 'M12 5v14M5 12h14', copy: 'M9 9h11v11H9zM5 15V5a2 2 0 0 1 2-2h8', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20', back: 'M9 6l6 6-6 6', check: 'M20 6L9 17l-5-5',
  close: 'M6 6l12 12M18 6L6 18', more: 'M12 5h.01M12 12h.01M12 19h.01', down: 'M6 9l6 6 6-6', up: 'M6 15l6-6 6 6',
  pin: 'M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11zM12 10h.01', nav: 'M3 11l18-8-8 18-2-8z', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  lock: 'M5 11h14v9H5zM8 11V8a4 4 0 0 1 8 0v3', edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
};
// the design's line icons (agent-builder/app/icons, 24x24, stroke 2), drawn with a mask so they take the text colour
const ic = (name, size) => `<span class="ic i-${name}${size ? ' s' + size : ''}" aria-hidden="true" style="-webkit-mask-image:url(icons/${name}.svg);mask-image:url(icons/${name}.svg)"></span>`;
const CUR_SIGN = { ILS: '₪', USD: '$', EUR: '€', JPY: '¥', GBP: '£', THB: '฿' };
const WEEKDAY_FULL = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const longDay = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return WEEKDAY_FULL[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + ' ' + d + '.' + m; };
// the builder's own destination colours: by the destination's place in the route (not by city), 7 colours, a hatch from the 8th.
// A destination that comes back (Tokyo at the start and the end) keeps its first colour. The client app, the PDF and the quote keep the country pack's colours.
const DEST_COLORS = ['#33658A', '#5B7D6B', '#C2544B', '#0F6E7A', '#B04E6A', '#2F5DA8', '#4D6378'];
function posColor(dest, t = S.t) {
  const order = []; ((t && t.stays) || []).forEach((s) => { if (!order.includes(s.dest)) order.push(s.dest); });
  const i = order.indexOf(dest);
  return i < 0 ? { c: '#8E94A0', rep: false } : { c: DEST_COLORS[i % 7], rep: i >= 7 };
}
const HATCH = 'repeating-linear-gradient(135deg,rgba(255,255,255,.28) 0 3px,transparent 3px 7px)';
const paint = (dest, t = S.t) => { const p = posColor(dest, t); return `background-color:${p.c}${p.rep ? ';background-image:' + HATCH : ''}`; };
const paint2 = (a, b, t = S.t) => `background:linear-gradient(270deg,${posColor(a, t).c} 50%,${posColor(b, t).c} 50%)`;   // a transition day: right = the destination you leave
const dayLabel = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + ' ' + d + '.' + m; };
const stayOf = (dest) => (S.t ? S.t.stays.find((s) => s.dest === dest) : null);
const destName = (dest) => { const s = stayOf(dest); return s ? he(s.label) || dest : dest; };
const destColor = (dest) => { const s = stayOf(dest); return (s && s.color) || '#8A938D'; };
function tripTitle(d) {
  const where = d.country || (d.stays && d.stays.length ? d.stays.map((s) => he(s.label)).join(' · ') : 'טיול חדש');
  return where + ' · ' + he(d.client && d.client.name);
}
function tripDates(d) {
  if (!d.startDate) return '';
  const n = d.stays && d.stays.length ? M.totalNights(d) : 0;
  const end = M.addDays(d.startDate, n);
  return `<span class="ltr">${M.shortDate(d.startDate)} – ${M.shortDate(end)}.${end.slice(0, 4)}</span>` + (n ? ` · ${n} לילות · ${n + 1} ימים` : '');
}

// ---------- toast with undo ----------
let toastTimer, toastUndo;
function hideToast() { $('#toast').hidden = true; toastUndo = null; clearTimeout(toastTimer); }
function toast(msg, undo) {
  const el = $('#toast');
  $('#toast-t').textContent = msg;
  $('#toast-undo').hidden = !undo;
  toastUndo = undo || null;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; toastUndo = null; }, 7000);
}
$('#toast-undo').addEventListener('click', () => { const u = toastUndo; $('#toast').hidden = true; toastUndo = null; if (u) u(); });

// ---------- changing the trip ----------
function commit(next, undoMsg) {
  const prev = S.t, prevDay = S.day, tripId = S.row && S.row.id;
  S.history.push(prev);
  if (S.history.length > 50) S.history.shift();
  S.t = next;
  if (S.day >= S.t.days.length) S.day = Math.max(0, S.t.days.length - 1);
  scheduleSave();
  render();
  if (undoMsg) toast(undoMsg, () => {
    if (!S.row || S.row.id !== tripId) return;               // never put one trip's content into another trip
    S.t = prev; S.day = Math.min(prevDay, S.t.days.length - 1); S.editItem = null; scheduleSave(); render();
  });
}
function edit(next) { S.t = next; scheduleSave(); paintSaved(); paintPreview(); }
function tryCommit(fn, undoMsg) {
  try { commit(fn(S.t), undoMsg); } catch (e) { toast(e.message.replace(/^\w+: /, '')); }
}

function scheduleSave() {
  S.dirty = true; S.save = 'busy'; paintSaved();
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(saveNow, 800);
}
async function saveNow() {
  if (S.saving) { S.saveTimer = setTimeout(saveNow, 400); return; }
  if (!S.dirty || !S.row || S.conflict) return;
  S.saving = true; S.dirty = false;
  const data = S.t;
  try {
    const row = await S.store.saveTrip(S.row.id, S.version, data);
    S.version = row.version; S.row = row;
    S.save = S.dirty ? 'busy' : 'saved';
  } catch (e) {
    if (e instanceof Conflict) { S.conflict = true; S.save = 'err'; render(); }
    else { S.dirty = true; S.save = 'err'; S.saveTimer = setTimeout(saveNow, 5000); }
  }
  S.saving = false;
  paintSaved();
}
function paintSaved() {
  document.querySelectorAll('.js-saved').forEach((el) => {
    el.className = 'saved js-saved' + (S.save === 'err' ? ' err' : S.save === 'busy' ? ' busy' : '');
    el.innerHTML = S.save === 'saved' ? ic('check', 16) + 'נשמר' : S.save === 'busy' ? 'שומר…' : ic('cloud-off', 16) + 'לא נשמר';
  });
  const b = $('#save-banner'); if (b) b.hidden = !(S.save === 'err' && !S.conflict);
}
window.addEventListener('beforeunload', (e) => { if (S.dirty || S.saving || S.privPending) { e.preventDefault(); e.returnValue = ''; } });

function editPrivate(mut) {
  mut(S.priv);
  S.privPending = { tripId: S.row.id, agentId: S.me.id, data: JSON.parse(JSON.stringify(S.priv)) };   // bound to THIS trip
  clearTimeout(S.privTimer);
  S.save = 'busy'; paintSaved();
  S.privTimer = setTimeout(savePrivNow, 800);
}
async function savePrivNow() {
  const job = S.privPending; if (!job || S.privSaving) return;
  S.privSaving = true;
  try {
    await S.store.savePrivate(job.tripId, job.agentId, job.data);
    if (S.privPending === job) S.privPending = null;
    if (!S.dirty && !S.saving && !S.conflict) S.save = 'saved';
  } catch (e) { S.save = 'err'; clearTimeout(S.privTimer); S.privTimer = setTimeout(savePrivNow, 5000); }
  S.privSaving = false;
  paintSaved();
}

// ---------- routing ----------
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const m = h.match(/^t\/([0-9a-f-]{36})(?:\/(\w+))?(?:\/(\d+))?/);
  if (m) return { view: 'trip', id: m[1], step: m[2] || 'structure', day: m[3] !== undefined ? Number(m[3]) : null };
  return { view: 'list' };
}
const go = (h) => { location.hash = h; };
window.addEventListener('hashchange', () => { if (/(?:^#|&)a=/.test(location.hash)) { takeSecret(); location.reload(); return; } load(); });

async function load() {
  if (!S.store || !S.me) return;                             // the link was not accepted (yet): the gate page stays
  const r = route();
  if (S.row && (r.view === 'list' || r.id !== S.row.id)) {
    hideToast();                                             // an undo belongs to the trip it was made in
    if (!(await flush()) && !S.conflict) {                   // offline: stay, do not drop the edits
      history.replaceState(null, '', S.lastHash || '#/t/' + S.row.id + '/structure');
      render(); toast('השינויים האחרונים עוד לא נשמרו, כי אין חיבור. כדאי לחכות רגע ולנסות שוב.');
      return;
    }
  }
  S.dlg = null; S.menuFor = null; S.editItem = null;
  try {
    if (r.view === 'list') {
      S.row = null; S.t = null; S.history = [];
      S.trips = await S.store.listTrips();
    } else {
      if (!S.row || S.row.id !== r.id) {
        $('#app').innerHTML = loadingPage('trip');
        const row = await S.store.getTrip(r.id);
        S.row = row; S.t = M.relabel(row.data); S.version = row.version; S.history = []; S.conflict = false; S.save = 'saved'; S.dirty = false; S.privPending = null;
        S.priv = await S.store.getPrivate(r.id).catch(() => ({}));
        S.day = 0;
      }
      if (r.day !== null && r.day < S.t.days.length) S.day = r.day;
    }
  } catch (e) {
    $('#app').innerHTML = gatePage(e instanceof NoAccess ? 'alert' : 'wifi-off', 'לא הצלחנו לפתוח', e instanceof NoAccess ? 'הטיול לא נמצא, או שאין גישה אליו מהקישור הזה.' : 'אין חיבור כרגע. השינויים שכבר נשמרו לא הלכו לשום מקום.',
      `<div class="row" style="justify-content:center;margin-top:20px"><button class="btn" type="button" data-act="reload-page">${ic('refresh', 16)}לנסות שוב</button><a class="btn ghost" href="#/">לכל הטיולים</a></div>`);
    return;
  }
  render();
}
// save what is waiting before leaving a trip; true = everything is saved
async function flush() {
  clearTimeout(S.saveTimer); clearTimeout(S.privTimer);
  for (let i = 0; i < 6 && (S.dirty || S.saving || S.privPending || S.privSaving); i++) {
    if (S.dirty && !S.saving && !S.conflict) await saveNow();
    if (S.privPending && !S.privSaving) await savePrivNow();
    if (S.dirty || S.saving || S.privPending || S.privSaving) await new Promise((r) => setTimeout(r, 300));
  }
  return !(S.dirty || S.saving || S.privPending || S.privSaving);
}

// ---------- render ----------
function render() {
  const focusId = document.activeElement && document.activeElement.id;
  if (S.dlg && !S.dlgReturn) S.dlgReturn = opener(document.activeElement && document.activeElement.closest('[data-act]'));
  const r = route();
  $('#app').innerHTML = r.view === 'list' ? viewList() : viewTrip(r.step);
  if (r.view === 'trip' && r.step === 'days' && r.day !== S.day) history.replaceState(null, '', '#/t/' + S.row.id + '/days/' + S.day);
  if (r.view === 'trip') S.lastHash = location.hash;
  $('#dlg-root').innerHTML = S.dlg ? viewDialog() : '';
  $('#app').inert = !!S.dlg;
  paintSaved();
  if (r.view === 'trip' && r.step === 'days' && S.scrolledDay !== S.day && window.innerWidth < 1100) {   // keep the chosen day tile in sight on a phone
    S.scrolledDay = S.day;
    const cur = $('.dtile[aria-current="true"]'); if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  if (S.dlg) { const f = $('#dlg-root [data-autofocus]') || $('#dlg-root input, #dlg-root select, #dlg-root button'); if (f) f.focus(); }
  else if (focusId) { const el = document.getElementById(focusId); if (el) el.focus(); }
}

const wordmark = (href) => `<${href ? `a href="${href}"` : 'span'} class="wordmark" aria-label="Pack and Board">Pack <span class="amp">&amp;</span> Board</${href ? 'a' : 'span'}>`;
function agencyBadge() {
  const b = (S.me && S.me.branding) || {};
  return `<div class="agency"><span>${esc(b.agencyName || S.me.name)}</span><span class="lg" aria-hidden="true">${b.logoUrl ? `<img src="${esc(b.logoUrl)}" alt="">` : esc((S.me.name || '?').slice(0, 1))}</span></div>`;
}
const flapDigits = (v) => String(v).split('').map((c) => `<span>${esc(c)}</span>`).join('');
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const todayIso = () => { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
function updatedText(r) {
  if (!r.updated_at) return '';
  const d = r.updated_at.slice(0, 10), n = daysBetween(d, todayIso());
  return n <= 0 ? 'עודכן היום' : n === 1 ? 'עודכן אתמול' : 'עודכן ' + M.shortDate(d);
}

function viewList() {
  const q = S.q.trim();
  const today = todayIso();
  const startOf = (r) => (r.data && r.data.startDate) || '9999-12-31';
  const endOf = (r) => { const d = r.data || {}; return d.startDate ? M.addDays(d.startDate, d.stays && d.stays.length ? M.totalNights(d) : 0) : '9999-12-31'; };
  // nearest departure first; trips that already ended go to the end, the most recent first
  const ordered = S.trips.slice().sort((a, b) => {
    const pa = endOf(a) < today, pb = endOf(b) < today;
    if (pa !== pb) return pa ? 1 : -1;
    return pa ? startOf(b).localeCompare(startOf(a)) : startOf(a).localeCompare(startOf(b));
  });
  const trips = ordered.filter((r) => (S.filter === 'all' || r.status === S.filter) && (!q || he(r.data.client && r.data.client.name).includes(q)));
  const count = (st) => S.trips.filter((r) => st === 'all' || r.status === st).length;
  const segBtn = (v, l) => `<button type="button" data-act="filter" data-v="${v}" aria-pressed="${S.filter === v}">${l} <span class="cnt num">${count(v)}</span></button>`;
  const next = S.trips.map((r) => r.data && r.data.startDate).filter((d) => d && d >= today).sort()[0];
  const kpi = (v, k) => `<div class="kpi"><div class="v" aria-hidden="true">${flapDigits(v)}</div><div class="k"><span class="sr">${esc(v)} </span>${k}</div></div>`;
  const cards = trips.map((r) => {
    const d = r.data, st = STATUS[r.status] || STATUS.draft, name = he(d.client && d.client.name);
    const stays = d.stays || [], N = stays.length ? M.totalNights(d) : 0;
    const uniq = []; stays.forEach((s) => { if (!uniq.some((u) => u.dest === s.dest)) uniq.push(s); });
    const route2 = uniq.map((s) => `<span class="row" style="gap:6px"><span class="dot" style="width:8px;height:8px;${paint(s.dest, d)}"></span>${esc(he(s.label))}</span>`).join('<span class="sep" aria-hidden="true"></span>');
    const cbar = stays.map((s) => `<i style="flex:${Number(s.nights) || 1};${paint(s.dest, d)}"></i>`).join('');
    const [y, m, dd] = (d.startDate || '').split('-').map(Number);
    return `<article class="bp" aria-label="${esc(name)}">
      <div class="main">
        <div class="row between" style="flex-wrap:nowrap"><span class="lbl2">${esc(d.country || (stays[0] ? he(stays[0].label) : 'טיול חדש'))}</span>
          <button class="ibtn" type="button" data-act="menu" data-id="${r.id}" aria-label="פעולות לטיול של ${esc(name)}" aria-expanded="${S.menuFor === r.id}" style="margin:-10px 0 -10px -12px">${ic('more', 20)}</button></div>
        <h2 class="who">${esc(name)}</h2>
        ${route2 ? `<div class="route2">${route2}</div><div class="cbar" aria-hidden="true">${cbar}</div>` : '<p class="small muted">עוד אין יעדים</p>'}
        <div class="row between" style="margin-top:6px;gap:8px"><div class="row" style="gap:6px"><span class="badge ${st[1]}">${st[0]}</span>${r.changed_since_publish ? '<span class="badge warn"><span class="bd"></span>יש שינויים</span>' : ''}</div><span class="xs muted">${updatedText(r)}</span></div>
      </div>
      <div class="stubx"><span class="lbl2">יציאה</span>
        ${d.startDate ? `<span><span class="big num">${dd}.${m}</span><span class="xs muted" style="display:block;margin-top:4px">${MONTHS[m - 1]} ${y}</span></span><span class="xs muted num">${N ? N + 1 + ' ימים' : ''}</span>` : '<span class="xs muted">בלי תאריך</span>'}
        <a class="btn sm" href="#/t/${r.id}/structure" aria-label="פתיחת הטיול של ${esc(name)}">פתיחה</a></div>
      ${S.menuFor === r.id ? `<div class="menu" role="menu" aria-label="פעולות">
        <button role="menuitem" type="button" data-act="clone-open" data-id="${r.id}">${ic('copy')}שכפול טיול</button>
        <button role="menuitem" type="button" data-act="archive" data-id="${r.id}">${ic('archive')}העברה לארכיון</button></div>` : ''}
    </article>`;
  }).join('');
  return `<header class="hero"><div class="wrap">
      <div class="row between">${wordmark('#/')}${agencyBadge()}</div>
      <div class="row between" style="align-items:flex-end;gap:24px;margin-top:32px">
        <div><p class="eyebrow">בונה המסלולים</p><h1 class="display">הטיולים שלי</h1></div>
        <div class="kpis">${kpi(count('all') - 0, 'טיולים פעילים')}${kpi(count('submitted'), 'אצל דנה לאישור')}${kpi(next ? daysBetween(today, next) : '–', 'ימים ליציאה הקרובה')}</div>
      </div></div></header>
    <main class="wrap" style="padding-top:24px;padding-bottom:72px">
      <div class="toolbar">
        <button class="btn" type="button" data-act="new-open">${ic('plus')}טיול חדש</button>
        <label class="inp-ic"><span class="sr">חיפוש לפי שם המשפחה</span>${ic('search')}<input id="q" class="inp" type="search" placeholder="חיפוש לפי שם המשפחה" value="${esc(S.q)}" data-f="q"></label>
        <span class="grow"></span>
        <div class="seg" role="group" aria-label="סינון לפי מצב">${segBtn('all', 'הכול')}${segBtn('draft', 'טיוטה')}${segBtn('submitted', 'אצל דנה')}${segBtn('published', 'פורסם')}</div>
      </div>
      ${cards ? `<div class="passes">${cards}<button class="addtile" type="button" data-act="new-open"><span class="pl">${ic('plus', 24)}</span>טיול חדש</button></div>`
        : `<div class="empty-state">${S.trips.length ? 'אין טיולים שמתאימים לחיפוש.' : '<b style="color:var(--ink);font-size:18px">עוד אין כאן טיולים</b><br>מתחילים בטיול הראשון: שם המשפחה ותאריך, והשאר בהמשך.'}<br>${S.trips.length ? '' : `<button class="btn" type="button" data-act="new-open">${ic('plus')}טיול ראשון</button>`}</div>`}
    </main>`;
}

// the seven steps: one list for the side rail (computer) and the flaps (phone)
function stepsData() {
  const d = S.t, st = M.stepStates(d), c = st.counts, qt = M.quoteTotals(d);
  const label = { empty: 'עוד לא', work: 'בעבודה', done: 'מוכן' };
  const qst = !qt.lines ? 'empty' : qt.priced >= qt.lines ? 'done' : 'work';
  return [
    { k: 'structure', n: '01', name: 'מבנה ולילות', short: 'מבנה', state: st.structure, sub: d.stays.length ? `${d.stays.length} יעדים · ${M.totalNights(d)} לילות` : label.empty },
    { k: 'hotels', n: '02', name: 'מלונות', short: 'מלונות', state: st.hotels, sub: c.stays ? c.staysWithHotel + ' מתוך ' + c.stays : label[st.hotels] },
    { k: 'days', n: '03', name: 'ימים', short: 'ימים', state: st.days, sub: c.days ? c.filledDays + ' מתוך ' + c.days : label[st.days] },
    { k: 'transfers', n: '04', name: 'הגעה ותחבורה', short: 'הגעה', state: st.transfers, attn: c.pendingTransfers, sub: c.pendingTransfers ? c.pendingTransfers + ' הצעות לאשר' : label[st.transfers] },
    { k: 'quote', n: '05', name: 'הצעת מחיר', short: 'מחיר', state: qst, sub: qt.priced ? money(qt.total, M.quoteOf(d).currency) : label[qst] },
    { k: 'approve', n: '06', name: 'אישור לקוח', short: 'אישור', later: true, sub: 'בקרוב' },
    { k: 'publish', n: '07', name: 'פרסום', short: 'פרסום', state: S.row.status === 'published' ? 'done' : S.row.status === 'submitted' ? 'work' : 'empty', sub: (STATUS[S.row.status] || STATUS.draft)[0] },
  ];
}
function tripStub(d) {
  if (!d.startDate) return '';
  const n = d.stays.length ? M.totalNights(d) : 0, end = M.addDays(d.startDate, n);
  return `${M.shortDate(d.startDate)} – ${M.shortDate(end)}.${end.slice(0, 4)}`;
}
function rail(steps) {
  const d = S.t, cur = route().step;
  const uniq = []; d.stays.forEach((s) => { if (!uniq.some((u) => u.dest === s.dest)) uniq.push(s); });
  const pax = M.travellersCount(d);
  const marker = (s) => s.later ? '<span></span>' : s.attn ? `<span class="attn num" aria-hidden="true">${s.attn}</span>` : s.state === 'done' ? `<span class="ok" aria-hidden="true">${ic('check', 16)}</span>` : s.state === 'work' ? '<span class="half" aria-hidden="true"></span>' : '<span class="todo" aria-hidden="true"></span>';
  return `<aside class="rail" aria-label="ניווט בטיול">
    <div>${wordmark()}</div>
    <a class="back" href="#/">${ic('chev-r', 16)}הטיולים שלי</a>
    <div class="tpass">
      <div class="band" aria-hidden="true">${d.stays.map((s) => `<i style="flex:${Number(s.nights) || 1};${paint(s.dest)}"></i>`).join('') || '<i style="flex:1;background:var(--hair)"></i>'}</div>
      <div class="bd-b"><p class="xs muted" style="font-weight:700;letter-spacing:.06em">${esc(d.country || 'טיול')}</p><p class="who">${esc(he(d.client && d.client.name))}</p>${uniq.length ? `<p class="small muted">${uniq.map((s) => esc(he(s.label))).join(' · ')}</p>` : ''}</div>
      <div class="stub num"><span class="ltr">${tripStub(d)}</span><span>${pax ? pax + ' מטיילים' : ''}</span></div>
    </div>
    <h2 class="rl">שלבים</h2>
    <ol class="rsteps">${steps.map((s) => `<li><button class="rst${s.later ? ' later' : ''}" type="button"${s.later ? ' aria-disabled="true"' : ` data-act="step" data-v="${s.k}"`}${cur === s.k ? ' aria-current="step"' : ''}><span class="flap">${s.n}</span><span><span class="nm">${s.name}</span><span class="st num">${esc(s.sub)}</span></span>${marker(s)}</button></li>`).join('')}</ol>
    <div class="foot"><span class="saved js-saved" role="status"></span><button class="btn onboard sm block" type="button" data-act="pdf">${ic('file')}תצוגת PDF</button></div>
  </aside>`;
}
function mtop(steps) {
  const d = S.t, cur = route().step;
  const n = d.stays.length ? M.totalNights(d) : 0;
  const flap = (s) => {
    const lab = `שלב ${s.n} ${s.name}, ${s.sub}`;
    if (s.later) return `<button class="mflap later" type="button" aria-disabled="true" aria-label="${esc(lab)}"><span class="num">${Number(s.n)}</span><span class="s no"></span></button>`;
    if (cur === s.k) return `<button class="mflap" type="button" data-act="step" data-v="${s.k}" aria-current="step" aria-label="${esc(lab)}"><span class="num">${s.n}</span>${s.short}</button>`;
    const cls = s.attn ? 'att' : s.state === 'done' ? '' : s.state === 'work' ? 'half' : 'no';
    return `<button class="mflap" type="button" data-act="step" data-v="${s.k}" aria-label="${esc(lab)}"><span class="num">${Number(s.n)}</span><span class="s ${cls}"></span></button>`;
  };
  return `<header class="mtop">
    <div class="row"><a class="ibtn" href="#/" aria-label="הטיולים שלי">${ic('chev-r', 20)}</a>
      <div class="tripid grow"><b>${esc(tripTitle(d))}</b><span class="num"><span class="ltr">${tripStub(d)}</span>${n ? ' · ' + (n + 1) + ' ימים' : ''}</span></div>
      <span class="saved js-saved" role="status"></span>
      <button class="ibtn" type="button" data-act="pdf" aria-label="תצוגת PDF">${ic('file')}</button></div>
    <nav class="mflaps" aria-label="שלבי הטיול">${steps.map(flap).join('')}</nav>
  </header>`;
}
// the head of every step: a small flap, "step 0X of 07", the title and one line
const phead = (n, title, sub) => `<div class="phead"><p class="kicker"><span class="flap" aria-hidden="true">${n}</span>שלב ${n} מתוך 07</p><h1 class="display">${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>`;
const needStays = (n, title, why) => phead(n, title) + `<div class="empty-state">${why}<br><a class="btn" href="#/t/${S.row.id}/structure">${ic('chev-r', 16)}למבנה</a></div>`;

function viewTrip(step) {
  const steps = stepsData();
  const body = step === 'quote' ? viewQuote() : step === 'hotels' ? viewHotels() : step === 'days' ? viewDays() : step === 'transfers' ? viewTransfers() : step === 'publish' ? viewPublish() : viewStructure();
  return `<div class="app">${rail(steps)}<div style="min-width:0">${mtop(steps)}<main class="stage">
    ${S.conflict ? `<div class="banner warn" role="alert" style="margin-bottom:16px">${ic('alert')}<span class="grow">הטיול נשמר בחלון או במחשב אחר, ולכן השינויים האחרונים כאן לא נשמרו.</span><button class="btn sm" type="button" data-act="reload">${ic('refresh', 16)}לטעון את הגרסה השמורה</button></div>` : ''}
    <div id="save-banner" class="banner err" role="alert" style="margin-bottom:16px" hidden>${ic('cloud-off')}<span class="grow">השינויים האחרונים עוד לא נשמרו. מנסים שוב לבד כל כמה שניות.</span><button class="btn sm ghost" type="button" data-act="retry-save">לנסות עכשיו</button></div>
    ${body}</main></div></div>`;
}

// ---------- structure ----------
function viewStructure() {
  const t = S.t, N = t.stays.length ? M.totalNights(t) : 0;
  const rows = t.stays.map((s, i) => {
    const start = M.stayStart(t, i);
    const range = t.startDate ? `<span class="ltr">${M.shortDate(M.addDays(t.startDate, start))} – ${M.shortDate(M.addDays(t.startDate, start + s.nights))}</span> · ${(Number(s.nights) || 0) + 1} ימים` : '';
    const name = he(s.label);
    return `<li class="stay" draggable="true" data-drag-stay="${s.id}">
      <div class="reorder">
        <button class="mini" type="button" data-act="stay-up" data-id="${s.id}" aria-label="הזזת ${esc(name)} למעלה"${i === 0 ? ' disabled' : ''}>${ic('chev-u')}</button>
        <button class="mini" type="button" data-act="stay-down" data-id="${s.id}" aria-label="הזזת ${esc(name)} למטה"${i === t.stays.length - 1 ? ' disabled' : ''}>${ic('chev-d')}</button>
      </div>
      <span class="vb" style="${paint(s.dest)}"></span>
      <div style="min-width:0"><label class="sr" for="stay-name-${s.id}">שם היעד</label><input id="stay-name-${s.id}" class="inp nm-inp" value="${esc(name)}" data-f="stay-name" data-id="${s.id}"><p class="dt num">${range}</p></div>
      <div class="stepper" role="group" aria-label="לילות ב${esc(name)}"><button type="button" data-act="night-minus" data-id="${s.id}" aria-label="פחות לילה ב${esc(name)}"${s.nights <= 1 ? ' disabled' : ''}>${ic('minus')}</button><output><b class="num">${Number(s.nights) || 0}</b>${s.nights === 1 ? 'לילה' : 'לילות'}</output><button type="button" data-act="night-plus" data-id="${s.id}" aria-label="עוד לילה ב${esc(name)}">${ic('plus')}</button></div>
      <button class="mini del" type="button" data-act="stay-del" data-id="${s.id}" aria-label="הסרת ${esc(name)} וכל הימים שלו">${ic('trash')}</button>
    </li>`;
  }).join('');
  const strip = t.days.map((d, i) => {
    const info = M.dayInfo(t, i);
    return info.transition
      ? `<span class="num" style="${paint2(info.dest, info.dest2)}" title="${esc(destName(info.dest) + ' ← ' + destName(info.dest2))}, יום מעבר">${i + 1}</span>`
      : `<span class="num" style="${paint(info.dest)}" title="${esc(destName(info.dest))}">${i + 1}</span>`;
  }).join('');
  const trans = t.days.filter((d, i) => M.dayInfo(t, i).transition).length;
  const last = t.days.length ? M.dayInfo(t, t.days.length - 1).date : '';
  return phead('01', 'מבנה ולילות', 'באיזה סדר עוברים בין היעדים, וכמה לילות בכל אחד. התאריכים מתעדכנים לבד.') + `
    <section class="card" style="padding:22px 24px;margin-bottom:20px" aria-label="סיכום">
      <div class="row between" style="align-items:flex-end;gap:20px">
        <div class="row" style="gap:36px"><div class="stat"><div class="v num">${N}</div><div class="k">לילות</div></div><div class="stat"><div class="v num">${t.days.length}</div><div class="k">ימים</div></div><div class="stat"><div class="v num">${trans}</div><div class="k">ימי מעבר</div></div></div>
        <div class="row" style="gap:12px;align-items:flex-end">
          <div class="field" style="width:200px"><label for="start">תאריך התחלה</label><input id="start" class="inp ltr" type="date" value="${esc(t.startDate)}" data-f="start"></div>
          <div class="field" style="width:160px"><label for="country">שם הטיול (מדינה)</label><input id="country" class="inp" value="${esc(t.country)}" placeholder="למשל יפן" data-f="country"></div>
        </div>
      </div>
      ${strip ? `<div class="strip" style="margin-top:18px" role="img" aria-label="${t.days.length} הימים לפי יעד">${strip}</div>
        <div class="row between xs muted num" style="margin-top:6px;gap:8px"><span>${longDay(t.startDate)}</span><span>יום בשני צבעים הוא יום מעבר, ותופיע בו הצעה להגעה</span><span>${longDay(last)}</span></div>` : ''}
    </section>
    <section class="card" aria-labelledby="h-st">
      <div class="card-h"><h2 id="h-st">יעדים</h2>${t.stays.length > 1 ? '<span class="small muted">גוררים או משתמשים בחיצים כדי לשנות סדר</span>' : ''}</div>
      ${rows ? `<ol class="stays">${rows}</ol>` : '<p class="muted" style="padding:16px 20px">עוד אין יעדים. מתחילים מהיעד הראשון.</p>'}
      <form class="add-row" data-form="add-stay">
        <label class="inp-ic"><span class="sr">יעד חדש</span><input id="newdest" class="inp" placeholder="הוספת יעד, למשל טוקיו" required>${ic('pin')}</label>
        <div class="stepper" role="group" aria-label="לילות ביעד החדש"><button type="button" data-act="nn-minus" aria-label="פחות לילה">${ic('minus')}</button><label class="sr" for="newnights">לילות</label><input id="newnights" class="num" type="number" min="1" max="60" value="2"><span class="small muted" style="padding-inline-end:4px">לילות</span><button type="button" data-act="nn-plus" aria-label="עוד לילה">${ic('plus')}</button></div>
        <button class="btn ghost sm" type="submit">${ic('plus')}הוספה</button>
      </form>
    </section>
    ${t.stays.length ? nextStep('hotels', 'למלונות') : ''}`;
}

// ---------- hotels: up to 3 options for every stay, one of them shown to the travellers ----------
function viewHotels() {
  const t = S.t;
  if (!t.stays.length) return needStays('02', 'מלונות', 'קודם מוסיפים יעדים בשלב המבנה.');
  const STATE_HE = { proposed: 'הצעה', chosen: 'נבחר', booked: 'הוזמן' };
  const cards = t.stays.map((s, i) => {
    const start = M.stayStart(t, i);
    const shown = M.shownHotel(s);
    const openId = (S.hopen[s.id] && s.hotels.some((h) => h.id === S.hopen[s.id])) ? S.hopen[s.id] : (shown || s.hotels[0] || {}).id || '';
    const ref = ((S.priv.bookings || {})[s.id] || {}).ref || '';
    const open = (h, j) => {
      const hid = h.id || '';
      const f = (k, label, o = {}) => `<div class="field${o.full ? ' full' : ''}"><label for="h-${k}-${s.id}">${label}</label>${o.icon ? '<span class="inp-ic">' : ''}<input id="h-${k}-${s.id}" class="inp${o.ltr ? ' ltr' : ''}" value="${esc(h[k] || '')}" placeholder="${o.ph || ''}" data-f="hotel" data-k="${k}" data-id="${s.id}" data-hid="${hid}">${o.icon ? ic(o.icon) + '</span>' : ''}</div>`;
      const st = h.state || 'proposed', isShown = st === 'chosen' || st === 'booked';
      return `<div class="hopt">
        <div class="hopt-h"><span class="badge ${isShown ? 'pub' : 'draft'}">${isShown ? ic('eye', 16) : ''}אפשרות ${j + 1}${isShown ? ' · מופיעה אצל המטיילים' : ' · הצעה'}</span>
          <div class="seg" role="group" aria-label="מצב המלון">${['proposed', 'chosen', 'booked'].map((v) => `<button type="button" data-act="hotel-state" data-id="${s.id}" data-hid="${hid}" data-v="${v}" aria-pressed="${st === v}">${v === 'booked' ? ic('lock', 16) : ''}${STATE_HE[v]}</button>`).join('')}</div></div>
        <div class="g2">
          ${f('name', 'שם המלון', { ltr: 1 })}${f('area', 'אזור')}${f('url', 'קישור', { ltr: 1, ph: 'https://' })}${f('maps', 'מיקום במפה', { ph: 'כתובת או קישור למפות', icon: 'pin' })}
          <div class="field"><label for="h-pricePerNight-${s.id}">מחיר ללילה (רשות)</label><div class="row" style="flex-wrap:nowrap;gap:8px"><input id="h-pricePerNight-${s.id}" class="inp ltr num" value="${esc(h.pricePerNight || '')}" data-f="hotel" data-k="pricePerNight" data-id="${s.id}" data-hid="${hid}"><label class="sr" for="h-cur-${s.id}">מטבע</label><select id="h-cur-${s.id}" class="inp" style="flex:0 0 112px" data-f="hotel" data-k="currency" data-id="${s.id}" data-hid="${hid}">${CURRENCIES.map((c) => `<option value="${c}"${(h.currency || 'ILS') === c ? ' selected' : ''}>${c} ${CUR_SIGN[c]}</option>`).join('')}</select></div></div>
          <div class="field full"><label for="h-why-${s.id}">למה אני ממליצה</label><textarea id="h-why-${s.id}" class="inp" style="min-height:64px" data-f="hotel" data-k="why" data-id="${s.id}" data-hid="${hid}">${esc(h.why || '')}</textarea></div>
          ${st === 'booked' ? `<div class="full lock">${ic('lock')}<div class="grow"><div class="field"><label for="h-ref-${s.id}">מספר הזמנה</label><input id="h-ref-${s.id}" class="inp ltr" value="${esc(ref)}" data-f="hotel-ref" data-id="${s.id}"></div><p style="margin-top:6px;color:var(--ink-2)">נשמר בנפרד מהטיול, לא עובר בשכפול, ובאפליקציה של המטיילים מוצג רק עם הקישור הסודי.</p></div></div>` : ''}
        </div></div>`;
    };
    const opts = s.hotels.length ? s.hotels.map((h, j) => h.id === openId ? open(h, j) : `<div class="hrow">
        <span class="num muted small" style="width:20px;text-align:center">${j + 1}</span>
        <div class="grow"><p style="font-weight:600"><bdi>${esc(h.name || 'בלי שם')}</bdi></p>${h.area ? `<p class="xs muted">${esc(h.area)}</p>` : ''}</div>
        <span class="badge ${h.state === 'proposed' || !h.state ? 'draft' : 'pub'}">${STATE_HE[h.state || 'proposed']}</span>
        <button class="mini" type="button" data-act="hotel-open" data-id="${s.id}" data-hid="${h.id}" aria-label="עריכת ${esc(h.name || 'האפשרות')}">${ic('pencil')}</button>
        <button class="mini" type="button" data-act="hotel-del" data-id="${s.id}" data-hid="${h.id}" aria-label="מחיקת ${esc(h.name || 'האפשרות')}">${ic('trash')}</button>
      </div>`).join('') : open({}, 0);
    return `<section class="card hcard" aria-labelledby="h-${s.id}">
      <div class="topband" style="${paint(s.dest)}"></div>
      <div class="card-h" style="min-height:58px"><div class="row" style="gap:10px"><span class="dot" style="${paint(s.dest)}"></span><h2 id="h-${s.id}">${esc(he(s.label))}</h2><span class="small muted num"><span class="ltr">${M.shortDate(M.addDays(t.startDate, start))} – ${M.shortDate(M.addDays(t.startDate, start + s.nights))}</span> · ${Number(s.nights) || 0} לילות</span></div>
        ${s.hotels.length > 1 && openId ? `<button class="mini" type="button" data-act="hotel-del" data-id="${s.id}" data-hid="${openId}" aria-label="מחיקת האפשרות הפתוחה">${ic('trash')}</button>` : ''}</div>
      <div class="card-b col" style="gap:10px">${opts}
        ${s.hotels.length && s.hotels.length < 3 ? `<button class="addline" type="button" data-act="hotel-add" data-id="${s.id}">${ic('plus', 16)}אפשרות נוספת <span class="muted">(עד 3)</span></button>` : ''}</div>
    </section>`;
  }).join('');
  return phead('02', 'מלונות', 'עד 3 אפשרויות לכל יעד. רק מלון שנבחר או הוזמן מופיע אצל המטיילים.') + `
    <div class="side2">
      <div class="col" style="gap:16px">${cards}</div>
      <aside class="card" style="padding:20px" aria-labelledby="sees-h">
        <h2 id="sees-h" class="h3">מה המטיילים רואים</h2>
        <p class="small muted" style="margin-top:6px">באפליקציה וב-PDF מופיע מלון אחד לכל יעד: זה שנבחר או הוזמן. הצעות נשארות אצלך.</p>
        <hr class="hr" style="margin:14px 0">
        <div class="toggle"><button class="sw" type="button" role="switch" aria-checked="${!!t.showPrices}" aria-labelledby="sp-l" data-act="prices"></button><span id="sp-l"><b>להציג מחירים למטיילים</b><br><span class="small muted">${t.showPrices ? 'דלוק: המחירים יופיעו באפליקציה וב-PDF.' : 'כבוי: המחירים נשמרים אצלך, ולא נכנסים לאפליקציה ול-PDF.'}</span></span></div>
      </aside>
    </div>${nextStep('days', 'לבניית הימים')}`;
}

// ---------- step 5: the price quote for the client ----------
function money(n, cur) { return Math.round(n).toLocaleString('he-IL') + ' ' + ({ ILS: '₪', USD: '$', EUR: '€', JPY: '¥', GBP: '£', THB: '฿' }[cur] || cur); }
function viewQuote() {
  const t = S.t, q = M.quoteOf(t), tot = M.quoteTotals(t);
  if (!t.stays.length) return needStays('05', 'הצעת מחיר', 'קודם מוסיפים יעדים בשלב המבנה. ההצעה נבנית מהם.');
  const row = (l, i) => `<div class="qline" role="group" aria-label="שורה ${i + 1}">
      <div class="field qlab"><label for="ql-${l.id}">מה</label><input id="ql-${l.id}" class="inp" value="${esc(l.label || '')}" placeholder="למשל טיסות הלוך וחזור" data-f="quote-line" data-k="label" data-id="${l.id}"></div>
      <div class="field qnote"><label for="qn-${l.id}">פירוט (רשות)</label><input id="qn-${l.id}" class="inp" value="${esc(l.note || '')}" placeholder="למשל 3 לילות, ארוחת בוקר" data-f="quote-line" data-k="note" data-id="${l.id}"></div>
      <div class="field qqty"><label for="qq-${l.id}">כמות</label><input id="qq-${l.id}" class="inp ltr num" inputmode="decimal" value="${esc(l.qty == null ? '' : l.qty)}" data-f="quote-line" data-k="qty" data-id="${l.id}"></div>
      <div class="field qpr"><label for="qp-${l.id}">מחיר ליחידה</label><input id="qp-${l.id}" class="inp ltr num" inputmode="decimal" value="${esc(l.price == null ? '' : l.price)}" placeholder="0" data-f="quote-line" data-k="price" data-id="${l.id}"></div>
      <div class="qsum num" id="qs-${l.id}" aria-live="polite">${lineSum(l, q.currency)}</div>
      <button class="mini qdel" type="button" data-act="q-del" data-id="${l.id}" aria-label="מחיקת השורה ${esc(l.label || String(i + 1))}">${ic('trash')}</button>
    </div>`;
  return phead('05', 'הצעת מחיר', 'הצעת המחיר שהמטיילים מקבלים, בעיצוב של היעד: הטיסות, הימים, המלונות והמחיר. מתחילים במילוי מהטיול, ומשלימים מחירים.') + `
    <div class="card qset">
      <div class="field"><label for="q-cur">מטבע</label><select id="q-cur" class="inp" data-f="quote" data-k="currency">${CURRENCIES.map((c) => `<option value="${c}"${q.currency === c ? ' selected' : ''}>${c} ${CUR_SIGN[c]}</option>`).join('')}</select></div>
      <div class="field"><label for="q-valid">בתוקף עד</label><input id="q-valid" class="inp ltr" type="date" value="${esc(q.validUntil)}" data-f="quote" data-k="validUntil"></div>
      <div class="toggle"><button class="sw" type="button" role="switch" aria-checked="${q.perPerson}" aria-labelledby="qpp-l" data-act="q-pp"></button><span id="qpp-l"><b>להציג מחיר לאדם</b><br><span class="small muted">${tot.pax ? tot.pax + ' מטיילים בטיול' : 'אין מטיילים בטיול'}</span></span></div>
    </div>
    <section class="card" aria-labelledby="qh-h">
      <div class="card-h"><h2 id="qh-h">פירוט המחיר</h2><button class="btn ghost sm" type="button" data-act="q-fill">${ic('refresh', 16)}מילוי מהטיול</button></div>
      ${q.lines.length ? `<div class="qhead" aria-hidden="true"><span>מה</span><span>פירוט</span><span>כמות</span><span>מחיר ליחידה</span><span class="tot">סה״כ</span><span></span></div>${q.lines.map(row).join('')}` : '<p class="muted" style="padding:16px 20px">עוד אין שורות. "מילוי מהטיול" מוסיף את הטיסות, המלונות והפעילויות שיש להן מחיר.</p>'}
      <div class="qfoot"><button class="btn ghost sm" type="button" data-act="q-add">${ic('plus')}שורה חדשה</button><div class="grow"></div>
        <div class="qtot" id="q-tot" aria-live="polite">${totText(t)}</div></div>
    </section>
    <div class="g2" style="margin-top:16px">
      <div class="field"><label for="q-inc">המחיר כולל (שורה לכל דבר)</label><textarea id="q-inc" class="inp" data-f="quote" data-k="includes" placeholder="טיסות ומיסים&#10;מלונות עם ארוחת בוקר&#10;JR Pass ל-7 ימים">${esc(q.includes.join('\n'))}</textarea></div>
      <div class="field"><label for="q-exc">המחיר לא כולל (שורה לכל דבר)</label><textarea id="q-exc" class="inp" data-f="quote" data-k="excludes" placeholder="ביטוח נסיעות&#10;ארוחות צהריים וערב">${esc(q.excludes.join('\n'))}</textarea></div>
    </div>
    <div class="field" style="margin-top:14px"><label for="q-notes">תנאים והערות (רשות)</label><textarea id="q-notes" class="inp" data-f="quote" data-k="notes" placeholder="למשל מקדמה של 30% באישור, ויתרה עד 30 יום לפני היציאה">${esc(q.notes)}</textarea></div>
    <div class="next-step row"><button class="btn" type="button" data-act="q-preview">${ic('eye')}תצוגת הצעת המחיר</button><a class="btn ghost" href="#/t/${S.row.id}/publish">לפרסום${ic('chev-l', 16)}</a></div>`;
}
function lineSum(l, cur) { const p = M.quoteNum(l.price), n = M.quoteNum(l.qty); return p == null ? '' : money(p * (n == null ? 1 : n), cur); }
function totText(t) {
  const q = M.quoteOf(t), tot = M.quoteTotals(t);
  if (!tot.priced) return '<span class="muted">סך הכל יופיע כשיהיו מחירים</span>';
  return `<span>סך הכל <b>${esc(money(tot.total, q.currency))}</b></span>${q.perPerson && tot.pax > 1 ? `<span class="muted">${esc(money(tot.perPerson, q.currency))} לאדם</span>` : ''}`;
}
function paintQuote() {
  if (route().step !== 'quote') return;
  const q = M.quoteOf(S.t); q.lines.forEach((l) => { const el = document.getElementById('qs-' + l.id); if (el) el.textContent = lineSum(l, q.currency); });
  const tt = document.getElementById('q-tot'); if (tt) tt.innerHTML = totText(S.t);
}
function showDoc(html, title, back) {
  const box = document.createElement('div');
  box.className = 'pdf-view'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', title);
  box.innerHTML = `<div class="pdf-bar"><b>${esc(title)}</b><span class="muted-on-dark">לפי מה שמולא עד עכשיו</span><div class="grow"></div>
    <button class="btn sm" type="button" data-pdf="print">הדפסה או שמירה כ-PDF</button><button class="btn sm ghost-dark" type="button" data-pdf="close">סגירה</button></div><iframe title="${esc(title)}"></iframe>`;
  document.body.appendChild(box);
  $('#app').inert = true;
  const fr = box.querySelector('iframe'); fr.srcdoc = html;
  const close = () => { box.remove(); $('#app').inert = false; const b = $(back); if (b) b.focus(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-pdf]'); if (!b) return; if (b.dataset.pdf === 'close') close(); else fr.contentWindow.print(); });
  box.querySelector('[data-pdf="print"]').focus();
}

function nextStep(step, text, inline) {
  return `<div class="${inline ? '' : 'next-step'}"><a class="btn" href="#/t/${S.row.id}/${step}">${esc(text)}${ic('chev-l', 16)}</a></div>`;
}
// the entry gate, the "could not open" page and the loading skeleton
function gatePage(icn, title, text, extra = '') {
  return `<div class="gate-page">${wordmark()}<p class="small muted" style="margin-bottom:28px">בונה המסלולים</p>
    <div class="card"><span class="mark" aria-hidden="true">${ic(icn, 24)}</span><h1 class="h2">${title}</h1><p class="muted" style="margin-top:6px">${text}</p>${extra}</div></div>`;
}
function loadingPage(kind) {
  const sk = (w, h, r = 6) => `<div class="sk" style="width:${w};height:${h}px;border-radius:${r}px"></div>`;
  const card = `<div class="card" style="overflow:hidden">${sk('100%', 6, 0)}<div class="col" style="padding:16px;gap:10px">${sk('40%', 26)}${sk('60%', 16)}${sk('75%', 14)}</div></div>`;
  return `<div role="status" aria-label="טוען">${kind === 'trip' ? '' : `<header class="hero"><div class="wrap" style="min-height:68px;display:flex;align-items:center">${wordmark()}</div></header>`}
    <div class="wrap" style="padding-top:28px"><div class="passes">${card}${card}</div></div></div>`;
}

// ---------- step 4: all transfers of the trip in one place ----------
const modeIcon = (mode) => (mode === 'flight' ? 'plane' : mode === 'walk' ? 'pin' : 'train');
function viewTransfers() {
  const t = S.t;
  if (!t.stays.length) return needStays('04', 'הגעה ותחבורה', 'קודם מוסיפים יעדים ולילות בשלב המבנה.');
  const sugg = M.suggestedTransfers(t);
  const dayName = (d) => { const info = M.dayInfo(t, d); return he(t.days[d].title).trim() || (info.transition ? destName(info.dest) + ' ← ' + destName(info.dest2) : destName(info.dest)); };
  const dayHead = (d) => `יום ${d + 1} · <span class="ltr">${dayLabel(M.dayInfo(t, d).date)}</span> · ${esc(dayName(d))}`;
  const dayDots = (d) => { const info = M.dayInfo(t, d); return `<span class="dot" style="${paint(info.dest)}"></span>${info.transition ? `<span class="dot" style="${paint(info.dest2)};margin-inline-start:-4px;box-shadow:0 0 0 2px #fff"></span>` : ''}`; };
  const list = [];
  t.days.forEach((day, d) => day.items.forEach((it) => { if (it.kind === 'transfer') list.push({ it, d }); }));
  list.sort((a, b) => a.d - b.d || M.PARTS.indexOf(M.itemPart(a.it)) - M.PARTS.indexOf(M.itemPart(b.it)));
  const f = (it, k, label, val, o = {}) => `<div class="field"><label for="x${k.replace('.', '')}-${it.id}">${label}</label><input id="x${k.replace('.', '')}-${it.id}" class="inp${o.ltr ? ' ltr' : ''}" value="${esc(val == null ? '' : val)}" placeholder="${o.ph || ''}" data-f="item" data-k="${k}" data-id="${it.id}"></div>`;
  const cards = list.map(({ it, d }) => {
    const tr = it.transfer || {}, nav = M.navUrl(tr);
    return `<section class="card" style="overflow:hidden" aria-label="${esc(he(it.title) || 'קטע הגעה')}">
      <div class="card-h trc-h"><div class="row" style="gap:10px;flex-wrap:nowrap;min-width:0"><span class="mark ${it.pending ? 'warn' : 'ok'}" aria-hidden="true">${ic(modeIcon(tr.mode), 16)}</span><div style="min-width:0"><p class="h3">${esc(he(it.title)) || 'קטע הגעה'}${it.pending ? '<span class="flag todo">לאשר</span>' : ''}</p><p class="small muted num">${dayHead(d)}</p></div></div>
        <div class="row" style="gap:4px"><a class="btn quiet sm" href="#/t/${S.row.id}/days/${d}">${ic('calendar', 16)}ביום</a><button class="mini" type="button" data-act="item-del" data-id="${it.id}" aria-label="מחיקת קטע ההגעה">${ic('trash')}</button></div></div>
      <div class="card-b g3">
        ${f(it, 'title', 'מה', he(it.title), { ph: 'למשל מהשדה למלון' })}
        <div class="field"><label for="xm-${it.id}">אמצעי</label><select id="xm-${it.id}" class="inp" data-f="item" data-k="tr.mode" data-id="${it.id}">${M.MODES.map((m) => `<option value="${m}"${(tr.mode || 'other') === m ? ' selected' : ''}>${MODE_HE[m]}</option>`).join('')}</select></div>
        ${f(it, 'from', 'שעת יציאה', it.when && it.when.from, { ltr: 1, ph: '09:30' })}
        ${f(it, 'tr.from', 'מאיפה', tr.from, { ltr: 1, ph: 'Narita Airport' })}${f(it, 'tr.to', 'לאן', tr.to, { ltr: 1, ph: 'Hotel, Tokyo' })}
        ${f(it, 'tr.duration', 'משך', tr.duration, { ph: 'שעה' })}
        ${f(it, 'tr.provider', 'ספק', tr.provider, { ph: 'למשל Narita Express' })}
        <div class="field"><label for="xp-${it.id}">מחיר (רשות)</label><div class="row" style="flex-wrap:nowrap;gap:8px"><input id="xp-${it.id}" class="inp ltr num" value="${esc(it.price == null ? '' : it.price)}" data-f="item" data-k="price" data-id="${it.id}"><label class="sr" for="xc-${it.id}">מטבע</label><select id="xc-${it.id}" class="inp" style="flex:0 0 104px" data-f="item" data-k="currency" data-id="${it.id}">${CURRENCIES.map((c) => `<option value="${c}"${(it.currency || 'ILS') === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div></div>
        ${f(it, 'tr.distanceKm', 'מרחק בק״מ', tr.distanceKm, { ltr: 1 })}
        <div class="field"><span class="lbl">ניווט</span>${nav ? `<a class="btn ghost sm" style="align-self:flex-start" href="${esc(nav)}" target="_blank" rel="noopener">${ic('nav', 16)}ניווט במפות</a>` : '<span class="small muted">מופיע כשממלאים מאיפה ולאן</span>'}</div>
        <div class="field full"><label for="xn-${it.id}">הערות</label><textarea id="xn-${it.id}" class="inp" style="min-height:64px" data-f="item" data-k="text" data-id="${it.id}" placeholder="למשל לשבת בצד ימין כדי לראות את פוג׳י">${esc(he(it.text))}</textarea></div>
      </div></section>`;
  }).join('');
  const side = sugg.length ? `<section class="card sugg" aria-labelledby="sg-h">
      <div class="card-h"><div><h2 id="sg-h" class="h3">הצעות לאישור</h2><p class="small muted">מצאנו ${sugg.length === 1 ? 'מעבר אחד' : sugg.length + ' מעברים'} בלי קטע הגעה</p></div><span class="badge warn num">${sugg.length}</span></div>
      <ul>${sugg.map((x) => `<li><span class="mark warn" aria-hidden="true">${ic(x.suggest === 'move' ? 'train' : 'plane', 16)}</span>
        <div class="grow"><p style="font-weight:700">${esc(x.title)}</p><p class="small muted num row" style="gap:6px">${dayDots(x.d)}<span>${dayHead(x.d)}</span></p></div>
        <button class="btn sm" type="button" data-act="sugg" data-v="${esc(x.suggest)}" data-d="${x.d}" aria-label="הוספת ${esc(x.title)}">${ic('plus', 16)}הוספה</button></li>`).join('')}</ul>
      ${sugg.length > 1 ? `<div style="padding:14px 20px"><button class="btn ghost sm block" type="button" data-act="sugg-all">${ic('check', 16)}הוספת כל ה-${sugg.length}</button></div>` : ''}
    </section>` : `<section class="card" style="padding:20px"><div class="row" style="gap:10px;flex-wrap:nowrap"><span class="mark ok" aria-hidden="true">${ic('check', 16)}</span><p class="small">אין מעברים בלי קטע הגעה.</p></div></section>`;
  return phead('04', 'הגעה ותחבורה', 'כל ההעברות בטיול במקום אחד: מהשדה למלון, בין הערים ובחזרה לשדה. כל שינוי כאן מופיע גם ביום עצמו.') + `
    <div class="side380">
      <div class="col" style="gap:16px">
        ${cards || '<div class="empty-state">עוד אין קטעי הגעה בטיול. אפשר להוסיף מההצעות, או קטע חדש כאן למטה.</div>'}
        <form class="card row" data-form="add-transfer" style="padding:12px 16px;gap:10px;flex-wrap:wrap">
          <label class="lbl" for="at-day" style="white-space:nowrap">קטע הגעה חדש ביום</label>
          <select id="at-day" class="inp grow" style="flex:1 1 220px;width:auto">${t.days.map((x, d) => `<option value="${d}">יום ${d + 1} · ${M.shortDate(M.dayInfo(t, d).date)} · ${esc(dayName(d))}</option>`).join('')}</select>
          <button class="btn ghost sm" type="submit">${ic('plus')}הוספה</button>
        </form>
      </div>
      ${side}
    </div>
    ${nextStep('quote', 'להצעת המחיר')}`;
}

// ---------- days ----------
const KIND_IC = { activity: ['flag', 'act'], meal: ['meal', 'meal'], tip: ['bulb', 'tip'], transfer: ['train', 'go'] };
const PART_IC = { 'בוקר': 'sun', 'צהריים': 'meal', 'ערב': 'clock', 'לילה': 'moon' };
function itemCard(it, d) {
  if (S.editItem === it.id) return itemEditor(it, d);
  const ask = S.askLib === it.id ? `<div class="banner ok" role="status">${ic('book')}<span class="grow">לשמור את "${esc(he(it.title))}" גם בספרייה של ${esc(destName(M.dayInfo(S.t, d).dest))}?</span><button class="btn sm" type="button" data-act="item-lib" data-id="${it.id}">שמירה לספרייה</button><button class="btn quiet sm" type="button" data-act="ask-lib-no">לא עכשיו</button></div>` : '';
  return itemCardBody(it, d) + ask;
}
function itemCardBody(it, d) {
  const tr = it.transfer || {};
  const nav = it.kind === 'transfer' ? M.navUrl(tr) : null;
  const meta = [];
  if (it.kind === 'transfer') { if (tr.mode && tr.mode !== 'other') meta.push(MODE_HE[tr.mode]); if (tr.duration) meta.push(tr.duration); if (tr.distanceKm) meta.push(tr.distanceKm + ' ק״מ'); }
  if (it.src === 'library') meta.push('מהספרייה');
  const from = it.when && it.when.from, to = it.when && it.when.to;
  const [kic, kcls] = KIND_IC[it.kind] || KIND_IC.activity;
  const title = he(it.title);
  const cls = (it.kind === 'tip' ? ' tipc' : '') + (it.kind === 'transfer' ? ' trc' : '') + (it.pending ? ' attn' : '');
  return `<article class="ti${cls}" draggable="true" data-drag-item="${it.id}" aria-label="${esc(title || KIND_HE[it.kind])}">
    <span class="hdl" aria-hidden="true">${ic('grip', 16)}</span>
    ${from ? `<span class="t">${esc(from)}${to ? `<small>עד <span class="ltr">${esc(to)}</span></small>` : ''}</span>` : '<span class="t none">בלי שעה</span>'}
    <div style="min-width:0">
      <div class="row" style="gap:8px">
        <span class="k ${kcls}">${ic(it.kind === 'transfer' ? modeIcon(tr.mode) : kic, 16)}${KIND_HE[it.kind]}${meta.length ? `<span class="mt">· ${esc(meta.join(' · '))}</span>` : ''}</span>
        <span class="tm">${from ? `<b class="ltr">${esc(from)}</b>${to ? `<span class="xs muted">עד <span class="ltr">${esc(to)}</span></span>` : ''}` : '<span class="xs muted">בלי שעה</span>'}</span>
        ${it.pending ? '<span class="flag todo">לאשר</span>' : ''}${it.checkDate ? '<span class="flag">לבדוק תאריך</span>' : ''}
      </div>
      <p class="tt">${esc(title) || '<span class="muted">בלי כותרת</span>'}</p>
      ${he(it.text) ? `<p>${esc(he(it.text))}</p>` : ''}
      ${it.place || nav || M.safeUrl(it.url) ? `<div class="links">
        ${it.place ? `<a class="pill" target="_blank" rel="noopener" href="${esc(M.placeHref(it.place))}">${ic('pin', 16)}<bdi>${esc(M.placeLabel(it.place))}</bdi></a>` : ''}
        ${nav ? `<a class="pill" target="_blank" rel="noopener" href="${esc(nav)}">${ic('nav', 16)}ניווט במפות</a>` : ''}
        ${M.safeUrl(it.url) ? `<a class="pill" target="_blank" rel="noopener" href="${esc(M.safeUrl(it.url))}">${ic('link', 16)}קישור</a>` : ''}
      </div>` : ''}
    </div>
    <div class="tools">
      <button class="mini" type="button" data-act="item-edit" data-id="${it.id}" aria-label="עריכת ${esc(title || 'הקטע')}">${ic('pencil')}</button>
      ${SHOW_DUPLICATE ? `<button class="mini" type="button" data-act="item-dup" data-id="${it.id}" aria-label="שכפול הקטע">${ic('copy')}</button>` : ''}
      <button class="mini" type="button" data-act="item-move" data-id="${it.id}" aria-label="העברת ${esc(title || 'הקטע')} ליום או לחלק אחר">${ic('arrow-l')}</button>
      <button class="mini" type="button" data-act="item-del" data-id="${it.id}" aria-label="מחיקת ${esc(title || 'הקטע')}">${ic('trash')}</button>
    </div>
    <button class="mini imenu" type="button" data-act="item-menu" data-id="${it.id}" aria-label="פעולות ל${esc(title || 'קטע')}" aria-expanded="${S.itemMenu === it.id}">${ic('more')}</button>
    ${S.itemMenu === it.id ? `<div class="menu" role="menu" aria-label="פעולות לקטע">
      <button role="menuitem" type="button" data-act="item-edit" data-id="${it.id}">${ic('pencil')}עריכה</button>
      <button role="menuitem" type="button" data-act="item-move" data-id="${it.id}">${ic('clock')}העברה לחלק אחר ביום</button>
      <button role="menuitem" type="button" data-act="item-move" data-id="${it.id}">${ic('calendar')}העברה ליום אחר</button>
      <button role="menuitem" class="del" type="button" data-act="item-del" data-id="${it.id}">${ic('trash')}מחיקה</button></div>` : ''}
  </article>`;
}

function itemEditor(it) {
  const timed = !!(it.when && it.when.from !== undefined);
  const tr = it.transfer || {};
  const inp = (id, label, val, k, opt = {}) => `<div class="field${opt.grow ? ' grow' : ''}"><label for="${id}">${label}</label><input id="${id}" class="inp${opt.ltr ? ' ltr' : ''}" value="${esc(val || '')}" placeholder="${opt.ph || ''}" data-f="item" data-k="${k}" data-id="${it.id}"${opt.type ? ` type="${opt.type}"` : ''}></div>`;
  return `<div class="edit" role="group" aria-label="עריכת קטע">
    <fieldset class="field"><legend>סוג</legend><div class="seg">${M.KINDS.map((k) => `<button type="button" data-act="item-kind" data-id="${it.id}" data-v="${k}" aria-pressed="${it.kind === k}">${ic(KIND_IC[k][0], 16)}${KIND_HE[k]}</button>`).join('')}</div></fieldset>
    <div class="g2" style="margin-top:14px">
      <fieldset class="field"><legend>מתי</legend><div class="seg"><button type="button" data-act="item-whenmode" data-id="${it.id}" data-v="part" aria-pressed="${!timed}">חלק ביום</button><button type="button" data-act="item-whenmode" data-id="${it.id}" data-v="time" aria-pressed="${timed}">שעה</button></div></fieldset>
      ${timed
        ? `<div class="row" style="flex-wrap:nowrap;align-items:flex-end">${inp('t-from-' + it.id, 'משעה', it.when.from, 'from', { ltr: 1, grow: 1, ph: '09:00' })}${inp('t-to-' + it.id, 'עד (רשות)', it.when.to, 'to', { ltr: 1, grow: 1, ph: '11:30' })}</div>`
        : `<div class="field"><label for="t-part-${it.id}">חלק ביום</label><select id="t-part-${it.id}" class="inp" data-f="item" data-k="part" data-id="${it.id}">${M.PARTS.map((p) => `<option${M.itemPart(it) === p ? ' selected' : ''}>${p}</option>`).join('')}</select></div>`}
    </div>
    <div style="margin-top:14px">${inp('it-' + it.id, 'כותרת', he(it.title), 'title')}</div>
    <div class="field" style="margin-top:14px"><label for="ix-${it.id}">טקסט</label><textarea id="ix-${it.id}" class="inp" data-f="item" data-k="text" data-id="${it.id}">${esc(he(it.text))}</textarea></div>
    ${it.kind === 'transfer' ? `<div class="g2" style="margin-top:14px">
        ${inp('tf-' + it.id, 'מאיפה', tr.from, 'tr.from', { ltr: 1, ph: 'Narita Airport' })}${inp('tt-' + it.id, 'לאן', tr.to, 'tr.to', { ltr: 1, ph: 'Hotel, Tokyo' })}
        <div class="field"><label for="tm-${it.id}">אמצעי</label><select id="tm-${it.id}" class="inp" data-f="item" data-k="tr.mode" data-id="${it.id}">${M.MODES.map((m) => `<option value="${m}"${(tr.mode || 'other') === m ? ' selected' : ''}>${MODE_HE[m]}</option>`).join('')}</select></div>
        ${inp('tdu-' + it.id, 'משך', tr.duration, 'tr.duration', { ph: 'שעה' })}
        ${inp('tkm-' + it.id, 'מרחק בק״מ', tr.distanceKm, 'tr.distanceKm', { ltr: 1 })}
        ${inp('tpr-' + it.id, 'ספק', tr.provider, 'tr.provider', { ph: 'למשל Narita Express' })}
      </div>` : ''}
    <div class="g2" style="margin-top:14px">
      ${inp('ip-' + it.id, 'מיקום במפות (שם המקום או קישור מגוגל מפות)', it.place, 'place', { ltr: 1 })}
      ${inp('iu-' + it.id, 'קישור (רשות)', it.url, 'url', { ltr: 1, ph: 'https://' })}
      <div class="field"><label for="ipr-${it.id}">מחיר (רשות)</label><div class="row" style="flex-wrap:nowrap;gap:8px"><input id="ipr-${it.id}" class="inp ltr num" value="${esc(it.price == null ? '' : it.price)}" data-f="item" data-k="price" data-id="${it.id}"><label class="sr" for="icu-${it.id}">מטבע</label><select id="icu-${it.id}" class="inp" style="flex:0 0 104px" data-f="item" data-k="currency" data-id="${it.id}">${CURRENCIES.map((c) => `<option${(it.currency || 'ILS') === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div></div>
    </div>
    <div class="row" style="margin-top:16px"><button class="btn sm" type="button" data-act="item-done">${ic('check', 16)}סיום</button><button class="btn ghost sm" type="button" data-act="item-lib" data-id="${it.id}">${ic('book', 16)}שמירה לספרייה</button>${timed && M.isTime(it.when.from) ? `<span class="small muted"><span class="ltr">${esc(it.when.from)}</span> נכנס ל${M.partOf(it.when.from)}</span>` : ''}</div>
  </div>`;
}

// the library belongs to a country: a trip to Paris does not show the Tokyo items.
// An item keeps its country in data.country ('' = every country). Older items have none: their country comes from a trip that has their destination.
const normC = (c) => String(c || '').trim().toLowerCase();
function snipCountry(x) {
  if (x.data && typeof x.data.country === 'string') return x.data.country.trim();
  if (x.dest === 'all') return '';
  const tr = [S.t, ...S.trips.map((r) => r.data)].find((d) => d && d.stays && d.stays.some((st) => st.dest === x.dest));
  return tr ? String(tr.country || '').trim() : null;           // null: no trip knows it
}
function countrySnips() {
  const mine = normC(S.t && S.t.country);
  return S.snippets.filter((x) => { const c = snipCountry(x); return c === '' || !mine || (c !== null && normC(c) === mine); });
}
function knownCountries() {
  const set = new Map();
  [S.t, ...S.trips.map((r) => r.data)].forEach((d) => { const c = d && String(d.country || '').trim(); if (c && !set.has(normC(c))) set.set(normC(c), c); });
  S.snippets.forEach((x) => { const c = x.data && typeof x.data.country === 'string' ? x.data.country.trim() : ''; if (c && !set.has(normC(c))) set.set(normC(c), c); });
  return [...set.values()];
}
// "+ add to <part>": a new item, or one from the library (the open day's destinations and general items first)
function addPicker(p, d) {
  const t = S.t, info = M.dayInfo(t, d);
  const dests = [info.dest, info.dest2].filter(Boolean);
  const lib0 = countrySnips();
  const all = M.librarySubset(lib0, t, d, { query: S.pickQ, allDests: true });
  const mine = all.filter((x) => x.dest === 'all' || dests.includes(x.dest)), other = all.filter((x) => !mine.includes(x));
  const row = (x) => `<button class="pickrow" type="button" data-act="lib-add" data-id="${x.id}" data-v="${p}"><span class="dot" style="${x.dest === 'all' ? 'background:var(--line)' : paint(x.dest)}"></span><span class="grow"><b>${esc(he(x.data.title))}</b><span class="xs muted" style="display:block">${esc(x.dest === 'all' ? 'כללי' : destName(x.dest))} · ${esc(KIND_HE[x.data.kind] || '')}</span></span>${ic('plus', 16)}</button>`;
  return `<div class="addpick" role="group" aria-label="הוספה ל${p}">
    <div class="row between" style="gap:8px"><button class="btn sm" type="button" data-act="item-add" data-v="${p}">${ic('pencil', 16)}קטע חדש</button><button class="mini" type="button" data-act="add-close" aria-label="סגירה">${ic('x')}</button></div>
    <p class="lbl" style="margin-top:12px">או מהספרייה שלי</p>
    ${lib0.length ? `<label class="inp-ic" style="margin-top:6px"><span class="sr">חיפוש בספרייה</span><input id="pickq" class="inp" type="search" placeholder="חיפוש בספרייה" value="${esc(S.pickQ)}" data-f="pickq">${ic('search')}</label>
      <div class="picklist">${mine.map(row).join('')}${other.length ? `<p class="xs muted" style="margin:8px 10px 2px">יעדים אחרים</p>${other.map(row).join('')}` : ''}${all.length ? '' : '<p class="small muted" style="padding:8px 10px">אין קטעים שמתאימים לחיפוש.</p>'}</div>`
      : '<p class="small muted" style="margin-top:4px">הספרייה עוד ריקה. כל קטע חדש אפשר לשמור בה בסיום.</p>'}
  </div>`;
}
function viewDays() {
  const t = S.t;
  if (!t.stays.length) return needStays('03', 'ימים', 'קודם מוסיפים יעדים ולילות בשלב המבנה. הימים נוצרים מהם.');
  const d = S.day, day = t.days[d], info = M.dayInfo(t, d);
  const suggAll = M.suggestedTransfers(t);
  const dayName = (i) => { const inf = M.dayInfo(t, i); return he(t.days[i].title).trim() || (inf.transition ? destName(inf.dest) + ' ← ' + destName(inf.dest2) : destName(inf.dest)); };
  const uniq = []; t.stays.forEach((s) => { if (!uniq.some((u) => u.dest === s.dest)) uniq.push(s); });
  const tiles = t.days.map((x, i) => {
    const inf = M.dayInfo(t, i);
    const pend = x.items.some((it) => it.pending) || suggAll.some((s) => s.d === i);
    const [y, m, dd] = inf.date.split('-').map(Number);
    return `<button class="dtile" type="button" data-act="day" data-v="${i}" data-drop-day="${i}"${i === d ? ' aria-current="true"' : ''} aria-label="יום ${i + 1}, ${esc(dayName(i))}${pend ? ', הגעה לאשר' : ''}"><span class="wd" aria-hidden="true">${WEEKDAY[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]}</span><span class="dn num" aria-hidden="true">${i + 1}</span><span class="dd" aria-hidden="true">${dd}.${m}</span><span class="cb" style="${inf.transition ? paint2(inf.dest, inf.dest2) : paint(inf.dest)}"></span>${pend ? '<span class="wdot" aria-hidden="true"></span>' : ''}</button>`;
  }).join('');
  const groups = M.itemsByPart(day);
  const sugg = suggAll.filter((s) => s.d === d);
  const bands = M.PARTS.map((p) => `<section class="tlb" aria-label="${p}">
      <div class="lane"><h3>${ic(PART_IC[p], 16)}${p}</h3><span class="rng">${PART_RANGE[p]}</span></div>
      <div class="body" data-drop-part="${p}">
        ${groups[p].map((it) => itemCard(it, d)).join('')}
        ${S.addOpen === p ? addPicker(p, d) : `<button class="addq" type="button" data-act="add-open" data-v="${p}" aria-expanded="false">${ic('plus', 16)}הוספה ל${p}</button>`}
      </div></section>`).join('');
  // which destinations the library shows: the open day's by default, or the one the agent picked (general items always come along)
  const dayDests = [info.dest, info.dest2].filter(Boolean);
  const pick = S.libDest === 'all' ? null : S.libDest ? [S.libDest] : dayDests;
  const libC = countrySnips();
  const lib = M.librarySubset(libC, t, d, { query: S.libQuery, allDests: true }).filter((x) => !pick || x.dest === 'all' || pick.includes(x.dest));
  const libChip = (v, label, on, dot) => `<button class="chip" type="button" data-act="lib-dest" data-v="${esc(v)}" aria-pressed="${on}">${dot ? `<span class="dot" style="${dot}"></span>` : ''}${esc(label)} <span class="num" style="opacity:.7">${libC.filter((x) => v === 'all' || x.dest === v).length}</span></button>`;
  const mPressed = (v) => (v === 'edit' ? S.mtab === 'edit' : S.mtab === 'side' && (v === 'lib') === (S.side === 'lib'));
  const sideBody = S.side === 'lib' ? `
      <button class="btn ghost sm block" type="button" data-act="lib-new">${ic('plus')}קטע חדש לספרייה</button>
      <label class="inp-ic" style="margin-top:10px"><span class="sr">חיפוש בספרייה</span><input id="lq" class="inp" type="search" placeholder="חיפוש בספרייה" value="${esc(S.libQuery)}" data-f="libq">${ic('search')}</label>
      <div class="libfilter" role="group" aria-label="סינון הספרייה">
        ${uniq.map((x) => libChip(x.dest, he(x.label), !!pick && pick.includes(x.dest), paint(x.dest))).join('')}
        ${libChip('all', 'כל היעדים', !pick)}
      </div>
      ${lib.length ? `<p class="xs muted" style="margin:0 0 8px">גוררים קטע לחלק ביום, או לוחצים + ובוחרים מתי.</p><ul class="lib">${lib.map((s) => `<li draggable="true" data-drag-snip="${s.id}"><div><div class="mt">${esc(s.dest === 'all' ? 'כללי' : destName(s.dest))} · ${esc(KIND_HE[s.data.kind] || '')}</div><div class="tt">${esc(he(s.data.title))}</div>${he(s.data.text) ? `<p dir="auto">${esc(he(s.data.text))}</p>` : ''}</div>
        <button class="plus" type="button" data-act="lib-pick" data-id="${s.id}" aria-label="הוספת ${esc(he(s.data.title))} ליום ${S.day + 1}" aria-expanded="${S.libMenu === s.id}">${ic('plus')}</button>${S.libMenu === s.id ? `<div class="menu" role="menu" aria-label="מתי ביום ${S.day + 1}">${M.PARTS.map((p) => `<button role="menuitem" type="button" data-act="lib-add" data-id="${s.id}" data-v="${p}">${ic(PART_IC[p])}ל${p}</button>`).join('')}</div>` : ''}<div class="libacts"><button class="mini" type="button" data-act="lib-edit" data-id="${s.id}" aria-label="עריכת ${esc(he(s.data.title))} בספרייה">${ic('pencil')}</button><button class="mini" type="button" data-act="lib-del" data-id="${s.id}" aria-label="מחיקת ${esc(he(s.data.title))} מהספרייה">${ic('trash')}</button></div></li>`).join('')}</ul>`
        : `<p class="small muted">${libC.length ? 'אין כאן קטעים שמתאימים.' : 'הספרייה ריקה. מוסיפים כאן קטע חדש, או "שמירה לספרייה" מתוך קטע ביום.'}</p>`}`
    : `<div id="preview">${previewDay(d)}</div><p class="xs muted" style="margin-top:8px;text-align:center">כך המטיילים יראו את היום באפליקציה. מתעדכן תוך כדי כתיבה.</p>`;
  const prev = d > 0 ? `<button class="btn ghost sm" type="button" data-act="day" data-v="${d - 1}">${ic('chev-r', 16)}<span class="t">יום ${d} · ${esc(dayName(d - 1))}</span></button>` : '<span></span>';
  const next = d < t.days.length - 1 ? `<button class="btn sm" type="button" data-act="day" data-v="${d + 1}"><span class="t">יום ${d + 2} · ${esc(dayName(d + 1))}</span>${ic('chev-l', 16)}</button>` : `<a class="btn sm" href="#/t/${S.row.id}/transfers">להגעה ותחבורה${ic('chev-l', 16)}</a>`;
  return `<nav aria-label="ימים">
      <div class="dnav-h"><div class="row" style="gap:16px"><span class="h3">${t.days.length} ימים</span>
        <span class="legend">${uniq.map((s) => `<span><span class="dot" style="width:8px;height:8px;${paint(s.dest)}"></span>${esc(he(s.label))}</span>`).join('')}<span><span class="dot" style="width:8px;height:8px;background:var(--warn)"></span>הגעה לאשר</span></span></div>
        <div class="row" style="gap:4px"><button class="btn quiet sm ph-only" type="button" data-act="all-days" aria-pressed="${!!S.allDays}">${ic('calendar', 16)}כל הימים</button><button class="btn quiet sm" type="button" data-act="day-add">${ic('plus', 16)}יום חדש</button></div></div>
      <div class="dboard${S.allDays ? ' all' : ''}">${tiles}</div>
    </nav>
    <div class="seg full mseg" role="group" aria-label="תצוגה">
      <button type="button" data-act="mtab" data-v="edit" aria-pressed="${mPressed('edit')}">${ic('pencil', 16)}עריכה</button>
      <button type="button" data-act="mtab" data-v="preview" aria-pressed="${mPressed('preview')}">${ic('phone', 16)}באפליקציה</button>
      <button type="button" data-act="mtab" data-v="lib" aria-pressed="${mPressed('lib')}">${ic('book', 16)}ספרייה</button>
    </div>
    <div class="dgrid" data-mtab="${S.mtab}">
      <div class="deditor" style="min-width:0">
        <div class="dayhero"><div class="grow" style="min-width:min(300px,100%)"><p class="kicker"><span class="dot" style="${info.transition ? paint2(info.dest, info.dest2) : paint(info.dest)}"></span><span class="num">יום ${d + 1} · ${longDay(info.date)} · ${esc(info.transition ? destName(info.dest) + ' ← ' + destName(info.dest2) : destName(info.dest))}</span></p>
          <label class="sr" for="day-title">שם היום</label><input id="day-title" class="ttl" value="${esc(he(day.title))}" placeholder="שם היום, למשל אסאקוסה ואואנו" data-f="day-title"></div>
          <div class="row" style="gap:6px">
            ${SHOW_DUPLICATE ? `<button class="btn ghost sm" type="button" data-act="day-dup" data-v="${d}">${ic('copy', 16)}שכפול יום</button><button class="icon-btn" type="button" data-act="day-dup-opts" aria-label="אפשרויות שכפול">${ic('chev-d')}</button>` : ''}
            <button class="icon-btn" type="button" data-act="day-del" aria-label="מחיקת יום ${d + 1}"${M.totalNights(t) <= 1 ? ' disabled' : ''}>${ic('trash')}</button>
          </div></div>
        ${sugg.map((s) => `<div class="banner warn" style="margin:8px 0 4px">${ic('alert')}<span class="grow">הצעה: קטע הגעה <b>${esc(s.title)}</b></span><button class="btn ghost sm" type="button" data-act="sugg" data-v="${esc(s.suggest)}">${ic('plus', 16)}הוספה ל${esc(s.part)}</button></div>`).join('')}
        ${bands}
        <div class="daynav sticky">${prev}${next}</div>
      </div>
      <aside class="dside" aria-label="${S.side === 'lib' ? 'הספרייה שלי' : 'היום באפליקציה'}">
        <div class="ptabs" role="tablist" aria-label="מה להציג בצד">
          <button type="button" role="tab" data-act="side" data-v="preview" aria-selected="${S.side !== 'lib'}">${ic('phone', 16)}באפליקציה</button>
          <button type="button" role="tab" data-act="side" data-v="lib" aria-selected="${S.side === 'lib'}">${ic('book', 16)}הספרייה שלי <span class="num">${countrySnips().length}</span></button>
        </div>
        ${sideBody}
      </aside>
    </div>`;
}

// ---------- the day as the client app shows it (same order and rules as scripts/agent_trip_to_app.py) ----------
const WD_SHORT = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];
// the small map the app puts in every day card: the day's city (the app uses the same Google Maps embed)
function dayCity(d) { const info = M.dayInfo(S.t, d); return destName(info.dest2 || info.dest) + (S.t.country ? ', ' + S.t.country : ''); }
function previewDay(d) {
  const city = dayCity(d);
  return `<div class="pv-phone"><div class="pv-card" style="--c:${esc(destColor(M.dayInfo(S.t, d).dest2 || M.dayInfo(S.t, d).dest))}">
    <div id="pv-body">${previewBody(d)}</div>
    <div class="pv-map"><iframe title="מפה של ${esc(city)}" src="https://maps.google.com/maps?q=${encodeURIComponent(city)}&z=12&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" tabindex="-1"></iframe>
      <div class="pv-map-cap"><span>${esc(city)}</span><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(city)}" target="_blank" rel="noopener">פתיחה במפות</a></div></div>
  </div></div>`;
}
function previewBody(d) {
  const t = S.t, day = t.days[d], info = M.dayInfo(t, d);
  const [y, m, dd] = info.date.split('-').map(Number);
  const wd = WD_SHORT[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
  const where = info.transition ? destName(info.dest) + ' ← ' + destName(info.dest2) : destName(info.dest);
  const title = he(day.title).trim() || where;
  const groups = M.itemsByPart(day);
  const price = (it) => (t.showPrices && it.price != null && it.price !== '' ? ' · ' + esc(Number(it.price).toLocaleString('en-US') + (it.currency ? ' ' + it.currency : '')) : '');
  let rows = '', chips = '';
  M.PARTS.forEach((p) => groups[p].forEach((it) => {
    const tr = it.transfer || {};
    if (it.pending && !tr.to) return;                       // an empty suggestion is not shown to the client
    const ti = he(it.title).trim(), tx = he(it.text).trim();
    let body = ti ? `<b>${esc(ti)}</b>${tx ? ': ' + esc(tx) : ''}` : esc(tx);
    if (it.kind === 'transfer') {
      const facts = [MODE_HE[tr.mode] && tr.mode !== 'other' ? MODE_HE[tr.mode] : '', tr.duration || '', tr.distanceKm ? tr.distanceKm + ' ק״מ' : '', tr.provider || ''].filter(Boolean);
      if (facts.length) body += ` <span class="pv-dim">(${esc(facts.join(' · '))})</span>`;
      const nav = M.navUrl(tr);
      if (nav) chips += `<a class="pv-route" href="${esc(nav)}" target="_blank" rel="noopener">ניווט: ${esc(ti || (tr.from + ' ← ' + tr.to))}</a>`;
    }
    if (it.kind !== 'tip') body += price(it);
    if (M.safeUrl(it.url)) body += ` <a class="pv-link" href="${esc(M.safeUrl(it.url))}" target="_blank" rel="noopener">קישור</a>`;
    if (!body) return;
    rows += it.kind === 'tip'
      ? `<div class="pv-tip"><span>טיפ</span><div>${body}</div></div>`
      : `<div class="pv-row"><span>${esc(M.itemLabel(it))}</span><div>${body}</div></div>`;
    if (it.place) chips += `<a class="pv-chip" href="${esc(M.placeHref(it.place))}" target="_blank" rel="noopener">${esc(M.placeLabel(it.place))}</a>`;
  }));
  if (!rows) rows = '<div class="pv-row"><span></span><div class="pv-dim">יום חופשי</div></div>';
  return `<span class="pv-wm" aria-hidden="true">${String(d + 1).padStart(2, '0')}</span>
    <div class="pv-head"><h3>יום ${d + 1} · ${esc(title)}</h3><span class="pv-date">${wd} ${M.shortDate(info.date)}</span></div>
    ${rows}${chips ? `<div class="pv-chips">${chips}</div>` : ''}`;
}
// while typing only the text part is redrawn, so the map does not reload on every key
function paintPreview() { const el = document.getElementById('pv-body'); if (el && S.t && S.t.days[S.day]) el.innerHTML = previewBody(S.day); }

// ---------- publish ----------
function viewPublish() {
  const t = S.t, st = M.stepStates(t), c = st.counts, r = S.row;
  const empty = t.days.map((x, i) => (M.dayIsEmpty(x) ? M.shortDate(M.dayInfo(t, i).date) : null)).filter(Boolean);
  const noHotel = t.stays.filter((s) => !M.shownHotel(s)).map((s) => he(s.label));
  const checks = [
    [!!t.stays.length, 'מבנה', t.stays.length ? `${t.stays.length} יעדים, ${M.totalNights(t)} לילות` : 'אין יעדים', 'structure', 'למבנה'],
    [!empty.length, empty.length ? `${empty.length} ימים ריקים` : 'כל הימים מלאים', empty.length ? `<span class="ltr">${empty.slice(0, 6).join(', ')}</span>${empty.length > 6 ? '…' : ''}. אפשר לשלוח גם כך.` : `${t.days.length} מתוך ${t.days.length}`, 'days', 'לימים'],
    [!c.pendingTransfers, c.pendingTransfers ? `${c.pendingTransfers} קטעי הגעה לאשר` : 'קטעי ההגעה', c.pendingTransfers ? 'הצעות שעוד לא מולאו' : '', 'transfers', 'לאישור'],
    [!noHotel.length, noHotel.length ? 'אין מלון ב' + noHotel.map(esc).join(', ') : 'יש מלון בכל יעד', '', 'hotels', 'למלונות'],
    [true, 'מחירים', t.showPrices ? 'מוצגים למטיילים' : 'לא מוצגים למטיילים'],
  ];
  const left = checks.filter((x) => !x[0]).length;
  const li = ([good, title, sub, link, linkText]) => `<li class="chk"><span class="mark ${good ? 'ok' : 'warn'}" aria-hidden="true">${ic(good ? 'check' : 'alert', 16)}</span><div><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>${!good && link ? `<a class="btn ghost sm" href="#/t/${r.id}/${link}">${linkText}${ic('chev-l', 16)}</a>` : '<span></span>'}</li>`;
  const pub = r.published || {};
  const stage = r.status === 'published' ? 2 : r.status === 'submitted' ? 1 : 0;
  const tl = (i, icn, title, sub) => `<div class="it${stage > i ? ' done' : ''}"><span class="mark ${stage >= i ? 'ok' : 'todo'}" aria-hidden="true">${ic(icn, 16)}</span><div><p style="font-weight:700">${title}${stage === i ? '<span class="sr"> (המצב עכשיו)</span>' : ''}</p><p class="small muted">${sub}</p></div></div>`;
  return phead('07', 'פרסום', 'כשהכול מוכן שולחים לדנה. אחרי שהיא מאשרת, מקבלים כאן את הקישור לאפליקציה ואת ה-PDF.') + `
    <div class="side2 w340">
      <div class="col" style="gap:16px">
        <section class="card" aria-labelledby="h-send">
          <div class="card-h"><h2 id="h-send">מוכן לשליחה?</h2>${left ? `<span class="badge warn"><span class="bd"></span>${left === 1 ? 'נשאר דבר אחד' : 'נשארו ' + left + ' דברים'}</span>` : '<span class="badge pub">הכול מוכן</span>'}</div>
          <div class="card-b" style="padding-top:4px"><ul class="checklist">${checks.map(li).join('')}</ul>
            ${r.status === 'submitted' ? '<div class="banner ok" style="margin-top:14px">הטיול אצל דנה. אפשר להמשיך לערוך, והשינויים ייכנסו.</div>'
              : `<div class="field" style="margin-top:14px"><label for="note">הערה לדנה <span class="muted">(רשות)</span></label><textarea id="note" class="inp" style="min-height:72px" placeholder="למשל: המטיילים טסים עם ילדה בת 12">${esc(r.note_to_dana || '')}</textarea></div>`}
          </div>
          ${r.status === 'submitted' ? '' : `<div class="sendbar"><button class="btn" type="button" data-act="submit"${t.stays.length ? '' : ' disabled'}>${ic('send')}${r.status === 'published' ? 'שליחה שוב לדנה' : 'שליחה לדנה לאישור'}</button>${left ? '<span class="small muted">אפשר לשלוח גם כך. דנה תראה מה פתוח.</span>' : ''}</div>`}
        </section>
        ${viewDocs()}
      </div>
      <aside class="card" style="padding:20px" aria-labelledby="h-next">
        <h2 id="h-next" class="h3" style="margin-bottom:16px">מה קורה אחר כך</h2>
        <div class="tl">${tl(0, 'pencil', 'טיוטה', stage === 0 ? 'את עובדת על הטיול. את כאן.' : 'את עובדת על הטיול')}${tl(1, 'users', 'אצל דנה', 'דנה בודקת ובונה את האפליקציה')}${tl(2, 'send', 'פורסם', 'הקישור וה-PDF מופיעים כאן')}</div>
        ${r.status === 'published' && S.priv.clientLink ? `<hr class="hr" style="margin:6px 0 16px"><div class="result">
          <div class="linkbox"><code>${esc(S.priv.clientLink.replace(/#.*/, '#…'))}</code><button class="btn sm" type="button" data-act="copy-link">${ic('copy', 16)}העתקה</button></div>
          ${pub.pdfName ? `<p class="small muted">ה-PDF: <span class="ltr">${esc(pub.pdfName)}</span></p>` : ''}
          ${r.changed_since_publish ? '<p class="banner warn">יש שינויים מאז הפרסום. כדי שייכנסו לאפליקציה, שולחים שוב לדנה.</p>' : ''}
        </div>` : ''}
      </aside>
    </div>`;
}

// ---------- documents for the travellers (tickets, vouchers, visas) ----------
function viewDocs() {
  const docs = S.priv.docs || [], opts = M.docBookings(S.t), kindName = Object.fromEntries(M.DOC_KINDS);
  const list = docs.length ? `<ul class="docs">${docs.map((d) => `<li>
      <span class="doc-ic" aria-hidden="true">${ic('file')}</span>
      <div class="grow"><b><bdi>${esc(d.name)}</bdi></b><div class="xs muted">${esc(kindName[d.kind] || 'מסמך')}${d.label ? ' · ' + esc(d.label) : ''}</div></div>
      <button class="btn quiet sm" type="button" data-act="doc-open" data-id="${esc(d.id)}">פתיחה</button>
      <button class="mini" type="button" data-act="doc-del" data-id="${esc(d.id)}" aria-label="מחיקת ${esc(d.name)}">${ic('trash')}</button></li>`).join('')}</ul>` : '';
  return `<section class="card" aria-labelledby="docs-h">
    <div class="card-h"><div><h2 id="docs-h">מסמכים למטיילים</h2><p class="small muted">כרטיסי טיסה, שוברי מלון, ויזות וכרטיסי כניסה. באפליקציה הם מופיעים במסך "מסמכים". PDF או תמונה, עד 8MB.</p></div><span class="badge num">${docs.length === 1 ? 'קובץ אחד' : docs.length + ' קבצים'}</span></div>
    <div class="card-b col" style="gap:16px">
      ${list}
      <div class="docs-add">
        <div class="field full"><span class="lbl" id="doc-file-l">קובץ</span><input id="doc-file" class="fpick" type="file" accept="application/pdf,image/*" data-f="doc-file" aria-labelledby="doc-file-l doc-file-name"><div class="filebtn"><label for="doc-file" class="btn ghost sm">${ic('upload', 16)}בחירת קובץ</label><span class="fname" id="doc-file-name">עוד לא נבחר קובץ</span></div></div>
        <div class="field"><label for="doc-booking">שיוך להזמנה</label><select id="doc-booking" class="inp" data-f="doc-booking">
          ${opts.map((o, i) => `<option value="${i}">${esc(o.label)}</option>`).join('')}<option value="other">הזמנה אחרת</option></select></div>
        <div class="field"><label for="doc-kind">סוג המסמך</label><select id="doc-kind" class="inp">
          ${M.DOC_KINDS.map(([k, l]) => `<option value="${k}"${opts[0] && opts[0].kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="doc-other">הזמנה אחרת (למשל שם המוזיאון)</label><input id="doc-other" class="inp" maxlength="80"></div>
        <div class="field"><label for="doc-name">השם שהמטיילים יראו (רשות)</label><input id="doc-name" class="inp" maxlength="80" placeholder="למשל כרטיס טיסה הלוך"></div>
        <div class="full"><button class="btn sm" type="button" data-act="doc-add">${ic('plus')}הוספת המסמך</button></div>
      </div>
    </div>
  </section>`;
}
async function docAdd() {
  const f = $('#doc-file'), file = f && f.files && f.files[0];
  if (!file) { toast('בוחרים קובץ קודם'); return; }
  if (file.size > 8 * 1024 * 1024) { toast('הקובץ גדול מ-8MB'); return; }
  if (!/^(application\/pdf|image\/)/.test(file.type || '')) { toast('רק PDF או תמונה'); return; }
  const opts = M.docBookings(S.t), sel = $('#doc-booking').value, other = $('#doc-other').value.trim();
  const o = sel === 'other' ? { booking: other, label: other } : opts[Number(sel)];
  if (!o || !o.booking) { toast('כותבים לאיזו הזמנה המסמך שייך'); $('#doc-other').focus(); return; }
  const name = $('#doc-name').value.trim() || file.name.replace(/\.[a-z0-9]+$/i, '');
  const btn = $('[data-act="doc-add"]'); if (btn) btn.disabled = true;
  try {
    const path = await S.store.uploadDoc(S.me.id, S.row.id, file);
    editPrivate((p) => { p.docs = p.docs || []; p.docs.push({ id: M.uid('doc'), name, path, size: file.size, booking: o.booking, label: o.label, kind: $('#doc-kind').value }); });
    render(); toast('המסמך נוסף');
  } catch (e) { if (btn) btn.disabled = false; toast(e.status === 403 || e.status === 400 ? 'המסמכים עוד לא מופעלים. כתבו לדנה.' : 'ההעלאה נכשלה. כדאי לנסות שוב.'); }
}

// ---------- dialogs ----------
function dialogShell(id, title, body, foot) {
  return `<div class="scrim on"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="${id}">
    <div class="dlg-h"><h2 id="${id}">${title}</h2><button class="mini" type="button" aria-label="סגירה" data-act="dlg-close">${ic('x')}</button></div>
    <form data-form="${S.dlg.type}"><div class="dlg-b">${body}</div><div class="dlg-f">${foot}<button class="btn ghost" type="button" data-act="dlg-close">ביטול</button></div></form></div></div>`;
}
function viewDialog() {
  const g = S.dlg;
  if (g.type === 'new') return dialogShell('dn-h', 'טיול חדש', `
      <div class="field"><label for="n-name">שם המשפחה או הקבוצה <span class="req" aria-hidden="true">*</span></label><input id="n-name" name="name" class="inp" required placeholder="למשל משפחת לוי" data-autofocus></div>
      <div class="g2">
        <div class="field"><label for="n-date">תאריך התחלה <span class="req" aria-hidden="true">*</span></label><input id="n-date" name="date" class="inp ltr" type="date" required></div>
        <div class="field"><label for="n-country">מדינה</label><input id="n-country" name="country" class="inp" placeholder="למשל יפן"></div>
      </div>
      <fieldset><legend>מי מטייל (רשות)</legend>
        <div class="g2"><div class="field"><label for="n-ad">מבוגרים</label><input id="n-ad" name="adults" class="inp ltr" type="number" min="0" max="30" value="2"></div><div class="field"><label for="n-kids">גילאי הילדים</label><input id="n-kids" name="kids" class="inp ltr" placeholder="12, 9"></div></div>
      </fieldset>
      ${g.error ? `<div class="err-box" role="alert">${esc(g.error)}</div>` : ''}`,
    `<button class="btn" type="submit">יצירת הטיול</button>`);
  if (g.type === 'clone') {
    const src = S.trips.find((x) => x.id === g.id);
    const box = (k, l, on) => `<label class="check"><input type="checkbox" name="${k}"${on ? ' checked' : ''}>${l}</label>`;
    return dialogShell('dc-h', 'שכפול: ' + esc(tripTitle(src.data)), `
      <div class="g2">
        <div class="field"><label for="c-name">שם המשפחה החדשה <span class="req" aria-hidden="true">*</span></label><input id="c-name" name="name" class="inp" required placeholder="למשל משפחת כהן" data-autofocus></div>
        <div class="field"><label for="c-date">תאריך התחלה חדש <span class="req" aria-hidden="true">*</span></label><input id="c-date" name="date" class="inp ltr" type="date" required></div>
      </div>
      <fieldset><legend>מה להעתיק</legend><div class="checks">
        ${box('structure', 'המבנה (יעדים ולילות)', 1)}${box('hotels', 'המלונות (בלי הזמנות)', 1)}${box('days', 'הימים והקטעים', 1)}${box('transfers', 'ההעברות (בלי הזמנות)', 1)}${box('prices', 'המחירים', 0)}
      </div></fieldset>
      <div class="never"><b style="font-size:14px">לא עובר אף פעם</b><ul><li>שמות המטיילים וטיסות</li><li>מספרי הזמנה, שוברים ומסמכים</li><li>הערות המטיילים, אישורים וקישורים</li></ul></div>
      <p class="muted" style="font-size:14px;margin:0">כל התאריכים זזים לתאריך החדש. מלון שהוזמן חוזר ל"נבחר", וקטעים שתלויים בעונה יסומנו "לבדוק תאריך".</p>
      ${g.error ? `<div class="err-box" role="alert">${esc(g.error)}</div>` : ''}`,
      `<button class="btn" type="submit">שכפול</button>`);
  }
  if (g.type === 'night') {
    const t = S.t, s = t.stays.find((x) => x.id === g.id);
    const opts = M.removableDays(t, g.id).reverse().map((d, j) => {
      const x = t.days[d];
      return `<label class="check"><input type="radio" name="day" value="${d}"${j === 0 ? ' checked' : ''}><span>יום ${d + 1} · <span class="ltr">${M.shortDate(M.dayInfo(t, d).date)}</span> · ${M.dayIsEmpty(x) ? 'ריק' : esc(he(x.title) || 'בלי כותרת') + ` (${x.items.length} קטעים)`}</span></label>`;
    }).join('');
    return dialogShell('dnt-h', 'פחות לילה ב' + esc(he(s.label)), `<p style="margin:0">יש תוכן בימים של ${esc(he(s.label))}. איזה יום להסיר?</p><fieldset><legend class="sr">היום להסרה</legend><div class="checks">${opts}</div></fieldset><p class="muted" style="font-size:14px;margin:0">כל התאריכים אחרי ${esc(he(s.label))} יזוזו יום אחד אחורה. אפשר לבטל אחרי ההסרה.</p>`,
      `<button class="btn" type="submit">הסרת היום</button>`);
  }
  if (g.type === 'dup') {
    const t = S.t;
    const empties = t.days.map((x, i) => (i !== S.day && M.dayIsEmpty(x) ? i : null)).filter((x) => x !== null);
    return dialogShell('dd-h', 'שכפול יום ' + (S.day + 1), `
      <div class="field"><label for="dd-where">לאן לשים את העותק</label><select id="dd-where" name="where" class="inp" data-autofocus>
        <option value="after">מיד אחרי יום ${S.day + 1} (עוד לילה)</option><option value="end">בסוף הטיול (עוד לילה)</option>
        ${empties.map((i) => `<option value="${i}">במקום יום ${i + 1}, ${M.shortDate(M.dayInfo(t, i).date)} (ריק)</option>`).join('')}
      </select></div>
      <label class="check"><input type="checkbox" name="times" checked>להעתיק גם את השעות</label>`,
      `<button class="btn" type="submit">שכפול</button>`);
  }
  if (g.type === 'move') {
    const t = S.t, it = findItem(g.id);
    return dialogShell('dm-h', 'העברת קטע', `
      <p style="margin:0"><b>${esc(he(it.title) || 'בלי כותרת')}</b></p>
      <div class="field"><label for="mv-day">ליום</label><select id="mv-day" name="day" class="inp" data-autofocus>${t.days.map((x, i) => `<option value="${i}"${i === S.day ? ' selected' : ''}>יום ${i + 1} · ${M.shortDate(M.dayInfo(t, i).date)} · ${esc(he(x.title) || destName(M.dayInfo(t, i).dest))}</option>`).join('')}</select></div>
      <div class="field"><label for="mv-part">לחלק ביום</label><select id="mv-part" name="part" class="inp">${M.PARTS.map((p) => `<option${M.itemPart(it) === p ? ' selected' : ''}>${p}</option>`).join('')}</select></div>`,
      `<button class="btn" type="submit">העברה</button>`);
  }
  if (g.type === 'lib-new') {
    const info = M.dayInfo(S.t, S.day);
    const sn = g.editId ? S.snippets.find((x) => x.id === g.editId) : null, sd = (sn && sn.data) || {};
    const dests = [...new Map(S.t.stays.map((x) => [x.dest, he(x.label) || x.dest])).entries()];
    if (sn && sn.dest !== 'all' && !dests.some(([k]) => k === sn.dest)) dests.push([sn.dest, sn.dest]);   // a destination from another trip stays as it was
    const def = sn ? sn.dest : info.dest2 || info.dest;
    const kind = sn && M.KINDS.includes(sd.kind) ? sd.kind : M.KINDS[0];
    return dialogShell('dl-h', sn ? 'עריכת קטע בספרייה' : 'קטע חדש לספרייה', `
      ${(() => { const cs = knownCountries(), cur = sn ? snipCountry(sn) : String(S.t.country || '').trim(); const sel = cur === null ? String(S.t.country || '').trim() : cur;
        return `<div class="field"><label for="ln-country">מדינה</label><select id="ln-country" name="country" class="inp">${cs.map((c) => `<option value="${esc(c)}"${normC(c) === normC(sel) && sel ? ' selected' : ''}>${esc(c)}</option>`).join('')}<option value=""${sel ? '' : ' selected'}>כל המדינות</option></select></div>`; })()}
      <div class="field"><label for="ln-dest">יעד</label><select id="ln-dest" name="dest" class="inp">${dests.map(([k, l]) => `<option value="${esc(k)}"${k === def ? ' selected' : ''}>${esc(l)}</option>`).join('')}<option value="all"${def === 'all' ? ' selected' : ''}>כללי (לכל היעדים)</option></select></div>
      <fieldset class="field"><legend>סוג</legend><div class="seg">${M.KINDS.map((k, i) => `<label style="display:inline-flex"><input class="sr" type="radio" name="kind" value="${k}"${k === kind ? ' checked' : ''}><span class="seg-opt">${KIND_HE[k]}</span></label>`).join('')}</div></fieldset>
      <div class="field"><label for="ln-title">כותרת <span class="req" aria-hidden="true">*</span></label><input id="ln-title" name="title" class="inp" required placeholder="למשל שוק צוקיג'י" value="${esc(he(sd.title))}" data-autofocus></div>
      <div class="field"><label for="ln-text">טקסט</label><textarea id="ln-text" name="text" class="inp" placeholder="מה חשוב לדעת">${esc(he(sd.text))}</textarea></div>
      <div class="g2">
        <div class="field"><label for="ln-place">מיקום במפות (שם המקום או קישור)</label><input id="ln-place" name="place" class="inp ltr" value="${esc(sd.place || '')}"></div>
        <div class="field"><label for="ln-url">קישור (רשות)</label><input id="ln-url" name="url" class="inp ltr" placeholder="https://" value="${esc(sd.url || '')}"></div>
      </div>
      ${g.error ? `<div class="err-box" role="alert">${esc(g.error)}</div>` : ''}`,
      `<button class="btn" type="submit">${sn ? 'שמירת השינויים' : 'שמירה לספרייה'}</button>`);
  }
  if (g.type === 'stay-del') {
    const s = S.t.stays.find((x) => x.id === g.id);
    return dialogShell('dsd-h', 'להסיר את ' + esc(he(s.label)) + '?', `<p style="margin:0">היעד יוסר עם ${Number(s.nights) || 0} הימים שלו. אפשר לבטל אחרי ההסרה.</p>`, `<button class="btn" type="submit">הסרה</button>`);
  }
  return '';
}
function closeDlg() {
  S.dlg = null; $('#dlg-root').innerHTML = ''; $('#app').inert = false;
  const back = S.dlgReturn && document.querySelector(S.dlgReturn); S.dlgReturn = null;
  if (back) back.focus();
}
function opener(el) {                                          // a selector that finds the same button again after a re-render
  if (!el || !el.dataset || !el.dataset.act) return null;
  let q = '[data-act="' + el.dataset.act + '"]';
  if (el.dataset.id) q += '[data-id="' + el.dataset.id + '"]';
  if (el.dataset.v) q += '[data-v="' + el.dataset.v + '"]';
  return q;
}

function findItem(id) { for (const d of S.t.days) { const it = d.items.find((x) => x.id === id); if (it) return it; } return null; }
function findItemDay(id) { return S.t.days.findIndex((d) => d.items.some((x) => x.id === id)); }

// ---------- actions ----------
const ACT = {
  filter: (el) => { S.filter = el.dataset.v; render(); },
  menu: (el) => { S.menuFor = S.menuFor === el.dataset.id ? null : el.dataset.id; render(); },
  'reload-page': () => location.reload(),
  'retry-save': () => { clearTimeout(S.saveTimer); clearTimeout(S.privTimer); if (S.dirty) saveNow(); if (S.privPending) savePrivNow(); },
  'nn-minus': () => { const f = $('#newnights'); f.value = Math.max(1, (parseInt(f.value, 10) || 1) - 1); },
  'nn-plus': () => { const f = $('#newnights'); f.value = Math.min(60, (parseInt(f.value, 10) || 1) + 1); },
  mtab: (el) => { const v = el.dataset.v; if (v === 'edit') S.mtab = 'edit'; else { S.mtab = 'side'; S.side = v === 'lib' ? 'lib' : 'preview'; } render(); },
  'all-days': () => { S.allDays = !S.allDays; render(); },
  'item-menu': (el) => { S.itemMenu = S.itemMenu === el.dataset.id ? null : el.dataset.id; render(); },
  'new-open': () => { S.dlg = { type: 'new' }; render(); },
  'clone-open': (el) => { S.menuFor = null; S.dlg = { type: 'clone', id: el.dataset.id }; render(); },
  archive: async (el) => {
    const id = el.dataset.id; S.menuFor = null;
    const old = S.trips.find((x) => x.id === id);
    try { await S.store.setStatus(id, 'archived'); } catch (e) { render(); toast('לא הועבר לארכיון. כדאי לנסות שוב.'); return; }
    S.trips = S.trips.filter((x) => x.id !== id); render();
    toast('הטיול עבר לארכיון', async () => {
      try { await S.store.setStatus(id, old.status === 'published' ? 'published' : old.status === 'submitted' ? 'submitted' : 'draft'); S.trips = await S.store.listTrips(); render(); }
      catch (e) { toast('לא הצלחנו להחזיר. כדאי לנסות שוב.'); }
    });
  },
  step: (el) => go('#/t/' + S.row.id + '/' + el.dataset.v),
  reload: async () => { S.row = null; S.conflict = false; S.dirty = false; await load(); },
  'dlg-close': () => closeDlg(),
  // structure
  'night-plus': (el) => tryCommit((t) => M.addNight(t, el.dataset.id), 'נוסף לילה, ויום ריק בסוף השהייה'),
  'night-minus': (el) => {
    const id = el.dataset.id, d = M.defaultDayToRemove(S.t, id);
    if (d === null) { S.dlg = { type: 'night', id }; render(); return; }
    tryCommit((t) => M.removeNight(t, id, d), `הוסר יום ${d + 1} (ריק)`);
  },
  'stay-up': (el) => moveStay(el.dataset.id, -1),
  'stay-down': (el) => moveStay(el.dataset.id, 1),
  'stay-del': (el) => {
    const id = el.dataset.id, owned = M.ownedDays(S.t, id).filter((d) => d !== 0);
    if (owned.every((d) => M.dayIsEmpty(S.t.days[d]))) return tryCommit((t) => M.removeStay(t, id), 'היעד הוסר');
    S.dlg = { type: 'stay-del', id }; render();
  },
  // hotels
  'hotel-state': (el) => {
    const s = S.t.stays.find((x) => x.id === el.dataset.id), v = el.dataset.v;
    const h = s.hotels.find((x) => x.id === el.dataset.hid) || s.hotels[0];
    let t = M.setHotel(S.t, s.id, Object.assign({}, h || { name: '' }, { state: v }));
    const id = h ? h.id : t.stays.find((x) => x.id === s.id).hotels[0].id;
    if (v !== 'proposed') {                                   // only one option is shown to the travellers: the others go back to "proposal"
      t.stays.find((x) => x.id === s.id).hotels.filter((x) => x.id !== id && x.state !== 'proposed').forEach((x) => { t = M.setHotel(t, s.id, Object.assign({}, x, { state: 'proposed' })); });
    }
    S.hopen[s.id] = id; commit(t);
  },
  'hotel-open': (el) => { S.hopen[el.dataset.id] = el.dataset.hid; render(); const f = document.getElementById('h-name-' + el.dataset.id); if (f) f.focus(); },
  'hotel-add': (el) => {
    const s = S.t.stays.find((x) => x.id === el.dataset.id); if (s.hotels.length >= 3) return;
    const t = M.setHotel(S.t, s.id, { name: '', state: 'proposed' });
    const hs = t.stays.find((x) => x.id === s.id).hotels; S.hopen[s.id] = hs[hs.length - 1].id;
    commit(t); const f = document.getElementById('h-name-' + s.id); if (f) f.focus();
  },
  'hotel-del': (el) => {
    const sid = el.dataset.id, hid = el.dataset.hid, s = S.t.stays.find((x) => x.id === sid), h = s.hotels.find((x) => x.id === hid);
    const t = clone(S.t); const st = t.stays.find((x) => x.id === sid); st.hotels = st.hotels.filter((x) => x.id !== hid);
    if (S.hopen[sid] === hid) delete S.hopen[sid];
    commit(t, 'נמחקה האפשרות ' + (h && h.name ? h.name : ''));
  },
  prices: () => commit(Object.assign({}, S.t, { showPrices: !S.t.showPrices })),
  // days
  day: (el) => { S.day = Number(el.dataset.v); S.editItem = null; S.itemMenu = null; S.libDest = ''; S.libMenu = null; S.addOpen = null; S.askLib = null; history.replaceState(null, '', '#/t/' + S.row.id + '/days/' + S.day); render(); if (window.innerWidth < 1100 && el.closest('.daynav')) { const h = $('.dayhero'); if (h) h.scrollIntoView({ block: 'start' }); } },
  'day-add': () => tryCommit((t) => M.insertDayAfter(t, t.days.length - 1), 'נוסף יום בסוף הטיול (עוד לילה ביעד האחרון)'),
  'day-dup': (el) => { const d = Number(el.dataset.v); tryCommit((t) => M.duplicateDay(t, d, { target: 'after' }), `יום ${d + 1} שוכפל. העותק אחריו, ונוסף לילה`); S.day = d + 1; render(); },
  'day-dup-opts': () => { S.dlg = { type: 'dup' }; render(); },
  'day-del': () => { const d = S.day; tryCommit((t) => M.deleteDay(t, d), `יום ${d + 1} נמחק`); },
  sugg: (el) => {
    const d = el.dataset.d !== undefined ? Number(el.dataset.d) : S.day;
    const s = M.suggestedTransfers(S.t).find((x) => x.d === d && x.suggest === el.dataset.v);
    if (!s) return;
    const next = M.applySuggestion(S.t, s);
    if (route().step === 'days') S.editItem = next.days[d].items[next.days[d].items.length - 1].id;
    commit(next);
    if (route().step === 'transfers') toast('נוסף קטע הגעה: ' + s.title + '. ממלאים את הפרטים למטה.');
  },
  'sugg-all': () => { let t = S.t; const all = M.suggestedTransfers(t); all.forEach((s) => { t = M.applySuggestion(t, s); }); commit(t, 'נוספו ' + all.length + ' קטעי הגעה. ממלאים את הפרטים ברשימה.'); },
  'add-open': (el) => { S.addOpen = el.dataset.v; S.pickQ = ''; S.askLib = null; render(); const f = $('.addpick [data-act="item-add"]'); if (f) f.focus(); },
  'add-close': () => { const p = S.addOpen; S.addOpen = null; render(); const f = $(`[data-act="add-open"][data-v="${p}"]`); if (f) f.focus(); },
  'ask-lib-no': () => { S.askLib = null; render(); },
  'item-add': (el) => { const it = M.newItem({ part: el.dataset.v }); S.editItem = it.id; S.addOpen = null; S.askLibFor = it.id; S.askLib = null; commit(M.addItem(S.t, S.day, it)); const f = document.getElementById('it-' + it.id); if (f) f.focus(); },
  'item-edit': (el) => { S.editItem = el.dataset.id; S.itemMenu = null; render(); const f = document.getElementById('it-' + el.dataset.id); if (f) f.focus(); },
  'item-done': () => {
    const id = S.editItem; S.editItem = null;
    if (id && S.askLibFor === id) { const it = findItem(id); if (it && he(it.title).trim() && it.src !== 'library') S.askLib = id; S.askLibFor = null; }   // a new item: offer to keep it in the library too
    render();
  },
  'item-dup': (el) => tryCommit((t) => M.duplicateItem(t, el.dataset.id), 'הקטע שוכפל'),
  'item-del': (el) => { if (S.editItem === el.dataset.id) S.editItem = null; S.itemMenu = null; tryCommit((t) => M.deleteItem(t, el.dataset.id), 'הקטע נמחק'); },
  'item-move': (el) => { S.itemMenu = null; S.dlg = { type: 'move', id: el.dataset.id }; render(); },
  'item-kind': (el) => {
    const it = findItem(el.dataset.id), k = el.dataset.v;
    const patch = { kind: k };
    if (k === 'transfer' && !it.transfer) patch.transfer = { from: '', to: '', mode: 'other' };
    commit(M.updateItem(S.t, it.id, patch));
  },
  'item-whenmode': (el) => {
    const it = findItem(el.dataset.id);
    const when = el.dataset.v === 'time' ? { from: (it.when && it.when.from) || '' } : { part: M.isTime(it.when && it.when.from) ? M.partOf(it.when.from) : M.itemPart({ when: { part: it.when && it.when.part } }) };
    const t = clone(S.t); setWhen(it.id, when, t); commit(t);
    const f = document.getElementById(el.dataset.v === 'time' ? 't-from-' + it.id : 't-part-' + it.id); if (f) f.focus();
  },
  'item-lib': async (el) => {
    const it = findItem(el.dataset.id), d = findItemDay(it.id);
    const info = M.dayInfo(S.t, d);
    const snip = M.snippetFromItem(it, info.dest);
    snip.data.country = String(S.t.country || '').trim();
    try { const row = await S.store.addSnippet(S.me.id, snip); S.snippets.unshift(row); if (S.askLib === it.id) S.askLib = null; render(); toast('נשמר בספרייה של ' + destName(info.dest)); }
    catch (e) { toast('לא נשמר בספרייה. כדאי לנסות שוב.'); }
  },
  pdf: async () => {
    if (!S.t.stays.length) { toast('קודם מוסיפים יעדים ולילות. ה-PDF נבנה מהם.'); return; }
    const pack = await loadPack(S.t.country);
    const html = buildPdfHtml(S.t, pack, { bar: false });
    const box = document.createElement('div');
    box.className = 'pdf-view'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'תצוגת PDF');
    box.innerHTML = `<div class="pdf-bar"><b>תצוגת PDF</b><span class="muted-on-dark">לפי מה שמולא עד עכשיו</span><div class="grow"></div>
      <button class="btn sm" type="button" data-pdf="print">הדפסה או שמירה כ-PDF</button><button class="btn sm ghost-dark" type="button" data-pdf="close">סגירה</button></div><iframe title="תצוגת PDF"></iframe>`;
    document.body.appendChild(box);
    $('#app').inert = true;
    const fr = box.querySelector('iframe'); fr.srcdoc = html;
    const close = () => { box.remove(); $('#app').inert = false; const b = [...document.querySelectorAll('[data-act="pdf"]')].find((x) => x.offsetParent); if (b) b.focus(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    box.addEventListener('click', (e) => { const b = e.target.closest('[data-pdf]'); if (!b) return; if (b.dataset.pdf === 'close') close(); else fr.contentWindow.print(); });
    box.querySelector('[data-pdf="print"]').focus();
  },
  'q-add': () => commit(M.addQuoteLine(S.t)),
  'q-del': (el) => commit(M.removeQuoteLine(S.t, el.dataset.id), 'השורה נמחקה'),
  'q-pp': () => commit(M.setQuote(S.t, { perPerson: !M.quoteOf(S.t).perPerson })),
  'q-fill': () => { const r = M.quoteFill(S.t); if (!r.added) { toast('כל מה שיש בטיול כבר בהצעה.'); return; } commit(r.trip, 'נוספו ' + r.added + ' שורות מהטיול'); },
  'q-preview': async () => {
    const pack = await loadPack(S.t.country);
    let t = S.t; if (!M.quoteOf(t).issued) { t = M.setQuote(t, { issued: new Date().toISOString().slice(0, 10) }); edit(t); }
    const html = buildQuoteHtml(t, pack); if (!html) { toast('קודם מוסיפים יעדים ולילות.'); return; }
    showDoc(html, 'הצעת מחיר', '[data-act="q-preview"]');
  },
  side: (el) => { S.side = el.dataset.v; try { localStorage.setItem('packandboard.agent.side', S.side); } catch (e) {} render(); },
  'lib-new': () => { S.dlg = { type: 'lib-new' }; render(); },
  'lib-edit': (el) => { S.dlg = { type: 'lib-new', editId: el.dataset.id }; render(); },
  'lib-dest': (el) => { S.libDest = el.dataset.v; render(); },
  'lib-pick': (el) => { S.libMenu = S.libMenu === el.dataset.id ? null : el.dataset.id; render(); const f = $('.lib .menu button'); if (f) f.focus(); },
  'lib-add': (el) => { S.libMenu = null; S.addOpen = null; addFromLibrary(el.dataset.id, el.dataset.v); },
  'lib-del': async (el) => {
    const s = S.snippets.find((x) => x.id === el.dataset.id);
    try { await S.store.deleteSnippet(s.id); } catch (e) { toast('לא נמחק. כדאי לנסות שוב.'); return; }
    S.snippets = S.snippets.filter((x) => x.id !== s.id); render();
    toast('נמחק מהספרייה', async () => { const row = await S.store.addSnippet(S.me.id, s).catch(() => null); if (row) { S.snippets.unshift(row); render(); } });
  },
  // publish
  submit: async () => {
    await flush();
    const note = ($('#note') || {}).value || null;
    try { S.row = Object.assign(S.row, await S.store.setStatus(S.row.id, 'submitted', { note_to_dana: note })); S.version = S.row.version; render(); toast('נשלח לדנה'); }
    catch (e) { toast('לא נשלח. כדאי לנסות שוב.'); }
  },
  'doc-add': () => docAdd(),
  'doc-open': async (el) => {
    const d = (S.priv.docs || []).find((x) => x.id === el.dataset.id); if (!d) return;
    const w = window.open('', '_blank');
    try { const u = await S.store.docLink(d.path); if (w) w.location.href = u; else location.href = u; } catch (e) { if (w) w.close(); toast('לא הצלחנו לפתוח את הקובץ'); }
  },
  'doc-del': async (el) => {
    const d = (S.priv.docs || []).find((x) => x.id === el.dataset.id); if (!d) return;
    if (!confirm('למחוק את "' + d.name + '"?')) return;
    editPrivate((p) => { p.docs = (p.docs || []).filter((x) => x.id !== d.id); });
    S.store.deleteDoc(d.path); render(); toast('המסמך נמחק');
  },
  'copy-link': async () => { try { await navigator.clipboard.writeText(S.priv.clientLink); toast('הקישור הועתק'); } catch (e) { toast('לא הצלחנו להעתיק'); } },
};
const clone = (o) => JSON.parse(JSON.stringify(o));
function setWhen(itemId, when, t = S.t) { for (const d of t.days) { const it = d.items.find((x) => x.id === itemId); if (it) { it.when = when; if (it.pending && when.from) delete it.pending; } } }
function moveStay(id, dir) {
  const ids = S.t.stays.map((s) => s.id), i = ids.indexOf(id), j = i + dir;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  tryCommit((t) => M.reorderStays(t, ids), 'סדר היעדים השתנה');
  const f = $(`[data-act="stay-${dir < 0 ? 'up' : 'down'}"][data-id="${id}"]`); if (f && !f.disabled) f.focus();
}

document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('scrim')) { closeDlg(); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) { if ((S.menuFor || S.itemMenu || S.libMenu) && !e.target.closest('.menu')) { S.menuFor = null; S.itemMenu = null; S.libMenu = null; render(); } return; }
  if (S.libMenu && el.dataset.act !== 'lib-pick' && !el.closest('.menu')) S.libMenu = null;
  if (S.itemMenu && el.dataset.act !== 'item-menu' && !el.closest('.menu')) S.itemMenu = null;
  const fn = ACT[el.dataset.act];
  if (fn) { if (el.tagName === 'A') return; e.preventDefault(); fn(el, e); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (S.dlg) closeDlg(); else if (S.menuFor || S.itemMenu || S.libMenu) { S.menuFor = null; S.itemMenu = null; S.libMenu = null; render(); } else if (S.addOpen) { ACT['add-close'](); } else if (S.editItem) { S.editItem = null; render(); } }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.target.closest('input,textarea') && toastUndo) { e.preventDefault(); $('#toast-undo').click(); }
});

// typing: update without re-rendering (keeps the cursor), save in the background
document.addEventListener('input', (e) => {
  const el = e.target, f = el.dataset.f; if (!f) return;
  const v = el.value;
  if (f === 'q') { S.q = v; render(); return; }
  if (f === 'libq') { S.libQuery = v; render(); return; }
  if (f === 'pickq') { S.pickQ = v; render(); const q = $('#pickq'); if (q) q.setSelectionRange(v.length, v.length); return; }
  if (f === 'day-title') return edit(M.setDayTitle(S.t, S.day, v));
  if (f === 'stay-name') { const t = clone(S.t); t.stays.find((s) => s.id === el.dataset.id).label = { he: v }; return edit(t); }
  if (f === 'country') return edit(Object.assign({}, S.t, { country: v }));
  if (f === 'hotel') {
    const s = S.t.stays.find((x) => x.id === el.dataset.id);
    const h = s.hotels.find((x) => x.id === el.dataset.hid) || s.hotels[0];          // no option yet: the first keystroke makes one
    const next = M.setHotel(S.t, s.id, Object.assign({}, h || { state: 'proposed' }, { [el.dataset.k]: v }));
    if (!h) { const nh = next.stays.find((x) => x.id === s.id).hotels[0]; S.hopen[s.id] = nh.id; document.querySelectorAll(`[data-f="hotel"][data-id="${s.id}"],[data-act="hotel-state"][data-id="${s.id}"]`).forEach((x) => { x.dataset.hid = nh.id; }); }
    return edit(next);
  }
  if (f === 'hotel-ref') { const id = el.dataset.id; return editPrivate((p) => { p.bookings = p.bookings || {}; p.bookings[id] = { ref: v }; }); }
  if (f === 'item') return itemInput(el);
  if (f === 'quote-line') { const k = el.dataset.k; edit(M.setQuoteLine(S.t, el.dataset.id, { [k]: v })); return paintQuote(); }
  if (f === 'quote') { const k = el.dataset.k; if (k === 'currency' || k === 'validUntil') return; edit(M.setQuote(S.t, { [k]: k === 'includes' || k === 'excludes' ? v.split('\n') : v })); return; }
});
function itemInput(el) {
  {
    const v = el.value;
    const it = findItem(el.dataset.id), k = el.dataset.k;
    if (k === 'from' || k === 'to' || k === 'part') return;        // handled on change (they move the item between parts)
    let patch;
    if (k === 'title' || k === 'text') patch = { [k]: Object.assign({}, it[k], { he: v }) };
    else if (k.startsWith('tr.')) {
      const key = k.slice(3), tr = Object.assign({}, it.transfer);
      if (key === 'distanceKm') { const n = parseFloat(v); if (isNaN(n)) delete tr.distanceKm; else tr.distanceKm = n; } else tr[key] = v;
      patch = { transfer: tr };
      if (it.pending && tr.from && tr.to) patch.pending = false;
    }
    else if (k === 'price') { const n = parseFloat(String(v).replace(/,/g, '')); patch = { price: v === '' || isNaN(n) ? undefined : n }; }
    else patch = { [k]: v || undefined };
    const next = M.updateItem(S.t, it.id, patch);
    for (const d of next.days) for (const x of d.items) if (x.id === it.id) Object.keys(x).forEach((kk) => { if (x[kk] === undefined || x[kk] === false && kk === 'pending') delete x[kk]; });
    return edit(next);
  }
}
document.addEventListener('change', (e) => {
  const el = e.target, f = el.dataset.f; if (!f) return;
  if (f === 'doc-file') { const n = el.files && el.files[0]; $('#doc-file-name').innerHTML = n ? '<bdi>' + esc(n.name) + '</bdi> · ' + Math.max(1, Math.round(n.size / 1024)) + 'KB' : 'עוד לא נבחר קובץ'; return; }
  if (f === 'doc-booking') { const o = M.docBookings(S.t)[Number(el.value)]; const k = $('#doc-kind'); if (o && k) k.value = o.kind; return; }
  if (f === 'start') { if (/^\d{4}-\d{2}-\d{2}$/.test(el.value)) commit(M.setStartDate(S.t, el.value), 'תאריך ההתחלה השתנה'); return; }
  if (f === 'item') {
    const it = findItem(el.dataset.id), k = el.dataset.k;
    if (k === 'part') { const t = clone(S.t); setWhen(it.id, { part: el.value }, t); commit(t); return; }
    if (k === 'from' || k === 'to') {
      const v = el.value.trim().replace(/^(\d):/, '0$1:').replace(/^(\d\d)(\d\d)$/, '$1:$2');
      if (v && !M.isTime(v)) { toast('השעה צריכה להיות בפורמט 09:30'); return; }
      const when = Object.assign({}, it.when); delete when.part;
      if (k === 'from') { if (v) when.from = v; else { commit((() => { const t = clone(S.t); setWhen(it.id, { part: M.itemPart(it) }, t); return t; })()); return; } }
      else { if (v) when.to = v; else delete when.to; }
      if (!when.from) return;
      const t = clone(S.t); setWhen(it.id, when, t); commit(t);
      return;
    }
    if (k === 'tr.mode' || k === 'currency') { itemInput(el); render(); }
  }
  if (f === 'hotel' && el.tagName === 'SELECT') render();
  if (f === 'quote' && (el.dataset.k === 'currency' || el.dataset.k === 'validUntil')) { commit(M.setQuote(S.t, { [el.dataset.k]: el.value })); }
});

// forms (dialogs and the add-destination row)
document.addEventListener('submit', async (e) => {
  const form = e.target, kind = form.dataset.form; if (!kind) return;
  e.preventDefault();
  const fd = new FormData(form);
  if (kind === 'add-stay') {
    const label = $('#newdest').value.trim(), nights = Math.max(1, Math.min(60, parseInt($('#newnights').value, 10) || 1));
    if (!label) return;
    const used = new Set(S.t.stays.map((s) => s.color));
    const color = PALETTE.find((c) => !used.has(c)) || PALETTE[S.t.stays.length % PALETTE.length];
    let dest = label.toLowerCase().replace(/\s+/g, '-');
    while (S.t.stays.some((s) => s.dest === dest)) dest += '-2';
    commit(M.addStay(S.t, { dest, label: { he: label }, color, nights }));
    const f = $('#newdest'); if (f) f.focus();
    return;
  }
  if (kind === 'new') {
    try {
      const kids = String(fd.get('kids') || '').split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => n >= 0 && n < 30);
      const b = S.me.branding || {};
      const data = M.newTrip({ clientName: fd.get('name'), startDate: fd.get('date'), adults: Math.max(0, parseInt(fd.get('adults'), 10) || 0), childAges: kids, country: String(fd.get('country') || '').trim(), agencyName: b.agencyName || S.me.name, logoUrl: b.logoUrl || null });
      const row = await S.store.createTrip(S.me.id, data);
      closeDlg(); go('#/t/' + row.id + '/structure');
    } catch (err) { S.dlg.error = /required/.test(err.message) ? 'חסרים שם המשפחה ותאריך ההתחלה.' : 'לא נוצר. כדאי לנסות שוב.'; render(); }
    return;
  }
  if (kind === 'clone') {
    try {
      const src = await S.store.getTrip(S.dlg.id);
      const copy = {}; ['structure', 'hotels', 'days', 'transfers', 'prices'].forEach((k) => { copy[k] = fd.get(k) === 'on'; });
      const data = M.cloneTrip(src.data, { clientName: fd.get('name'), startDate: fd.get('date'), copy });
      const row = await S.store.createTrip(S.me.id, data);
      closeDlg(); go('#/t/' + row.id + '/structure');
      toast('הטיול שוכפל');
    } catch (err) { S.dlg.error = /required/.test(err.message) ? 'חסרים שם המשפחה ותאריך ההתחלה.' : 'לא שוכפל. כדאי לנסות שוב.'; render(); }
    return;
  }
  if (kind === 'lib-new') {
    const fail = (m) => { let b = form.querySelector('.err-box'); if (!b) { b = document.createElement('div'); b.className = 'err-box'; b.setAttribute('role', 'alert'); form.querySelector('.dlg-b').appendChild(b); } b.textContent = m; };   // keeps what was typed
    const title = String(fd.get('title') || '').trim();
    if (!title) { fail('חסרה כותרת.'); return; }
    const k = M.KINDS.includes(fd.get('kind')) ? fd.get('kind') : 'activity';
    const data = { kind: k, title: { he: title }, text: { he: String(fd.get('text') || '').trim() } };
    const place = String(fd.get('place') || '').trim(), url = String(fd.get('url') || '').trim();
    if (place) data.place = place;
    if (url) { if (!M.safeUrl(url)) { fail('הקישור צריך להתחיל ב-https://'); return; } data.url = M.safeUrl(url); }
    const old = S.dlg.editId ? S.snippets.find((x) => x.id === S.dlg.editId) : null;
    if (k === 'transfer') data.transfer = (old && old.data.transfer) || { from: '', to: '', mode: 'other' };
    const dest = String(fd.get('dest') || 'all');
    data.country = String(fd.get('country') || '').trim();       // '' = shown in every country
    if (old) {                                                // editing: the fields in the form change, everything else in the item stays
      const merged = Object.assign({}, old.data, data);
      delete merged.part;                                     // library items no longer carry a part of the day
      if (!place) delete merged.place;
      if (!url) delete merged.url;
      if (k !== 'transfer') delete merged.transfer;
      try {
        const row = await S.store.updateSnippet(old.id, { dest, category: k, data: merged });
        S.snippets = S.snippets.map((x) => (x.id === old.id ? row || Object.assign({}, old, { dest, category: k, data: merged }) : x));
        closeDlg(); render(); toast('השינויים נשמרו בספרייה');
      } catch (err) { fail('לא נשמר. כדאי לנסות שוב.'); }
      return;
    }
    try {
      const row = await S.store.addSnippet(S.me.id, { dest, category: k, data });
      S.snippets.unshift(row); closeDlg(); S.side = 'lib'; render();
      toast('נשמר בספרייה של ' + (dest === 'all' ? 'כל היעדים' : destName(dest)));
    } catch (err) { fail('לא נשמר. כדאי לנסות שוב.'); }
    return;
  }
  if (kind === 'add-transfer') {
    const d = Number($('#at-day').value);
    commit(M.addItem(S.t, d, M.newItem({ kind: 'transfer', part: 'בוקר', title: '' })));
    toast(`נוסף קטע הגעה ביום ${d + 1}. ממלאים את הפרטים ברשימה.`);
    return;
  }
  if (kind === 'night') { const d = Number(fd.get('day')), id = S.dlg.id; closeDlg(); tryCommit((t) => M.removeNight(t, id, d), `יום ${d + 1} הוסר`); return; }
  if (kind === 'stay-del') { const id = S.dlg.id; closeDlg(); tryCommit((t) => M.removeStay(t, id), 'היעד הוסר עם הימים שלו'); return; }
  if (kind === 'dup') {
    const w = fd.get('where'), target = w === 'after' || w === 'end' ? w : Number(w), d = S.day;
    closeDlg();
    tryCommit((t) => M.duplicateDay(t, d, { target, copyTimes: fd.get('times') === 'on' }), 'היום שוכפל');
    S.day = target === 'after' ? d + 1 : target === 'end' ? S.t.days.length - 1 : target; render();
    return;
  }
  if (kind === 'move') { const id = S.dlg.id, d = Number(fd.get('day')), p = fd.get('part'); closeDlg(); tryCommit((t) => M.moveItem(t, id, d, p), `הקטע הועבר ליום ${d + 1}, ${p}`); return; }
});

// a library item into the open day, at the part of the day the agent chose (and before an item, when dropped on one)
function addFromLibrary(snipId, part, beforeId) {
  const s = S.snippets.find((x) => x.id === snipId); if (!s) return;
  const it = M.itemFromSnippet(s, s.id, part);
  tryCommit((t) => { const n = M.addItem(t, S.day, it); return beforeId ? M.moveItem(n, it.id, S.day, it.when.part, beforeId) : n; }, `"${he(s.data.title)}" נוסף ל${it.when.part}, יום ${S.day + 1}`);
}
// drag and drop: items between parts and days, library items into the day, stays to a new order
let drag = null;
document.addEventListener('dragstart', (e) => {
  const it = e.target.closest('[data-drag-item]'), st = e.target.closest('[data-drag-stay]'), sn = e.target.closest('[data-drag-snip]');
  if (e.target.closest('input,textarea,select')) { e.preventDefault(); return; }
  if (it) drag = { item: it.dataset.dragItem }; else if (st) drag = { stay: st.dataset.dragStay }; else if (sn) drag = { snip: sn.dataset.dragSnip }; else return;
  e.dataTransfer.effectAllowed = sn ? 'copy' : 'move';
  e.dataTransfer.setData('text/plain', 'pab');
});
function dropTarget(e) {
  if (!drag) return null;
  if (drag.item) return e.target.closest('[data-drop-part],[data-drop-day]');
  if (drag.stay) return e.target.closest('[data-drag-stay]');
  if (drag.snip) return e.target.closest('[data-drop-part]');
  return null;
}
document.addEventListener('dragover', (e) => { const t = dropTarget(e); if (!t) return; e.preventDefault(); document.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over')); t.classList.add('drag-over'); });
document.addEventListener('dragend', () => { drag = null; document.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over')); });
document.addEventListener('drop', (e) => {
  const t = dropTarget(e); if (!t) return;
  e.preventDefault();
  const dr = drag; drag = null;
  document.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over'));
  if (dr.snip) { const before = e.target.closest('[data-drag-item]'); addFromLibrary(dr.snip, t.dataset.dropPart, before ? before.dataset.dragItem : undefined); return; }
  if (dr.item) {
    const it = findItem(dr.item);
    if (t.dataset.dropPart) {
      const before = e.target.closest('[data-drag-item]');
      tryCommit((tr) => M.moveItem(tr, dr.item, S.day, t.dataset.dropPart, before && before.dataset.dragItem !== dr.item ? before.dataset.dragItem : undefined), 'הקטע הועבר ל' + t.dataset.dropPart);
    } else {
      const d = Number(t.dataset.dropDay);
      tryCommit((tr) => M.moveItem(tr, dr.item, d, M.itemPart(it)), `הקטע הועבר ליום ${d + 1}`);
    }
  } else if (dr.stay && t.dataset.dragStay !== dr.stay) {
    const ids = S.t.stays.map((s) => s.id).filter((x) => x !== dr.stay);
    ids.splice(ids.indexOf(t.dataset.dragStay) + (S.t.stays.findIndex((s) => s.id === dr.stay) < S.t.stays.findIndex((s) => s.id === t.dataset.dragStay) ? 1 : 0), 0, dr.stay);
    tryCommit((tr) => M.reorderStays(tr, ids), 'סדר היעדים השתנה');
  }
});

// ---------- start ----------
(async function start() {
  const secret = takeSecret();
  const gate = (icn, title, msg) => { $('#app').innerHTML = gatePage(icn, title, msg); };
  if (!secret) return gate('lock', 'צריך קישור אישי', 'הבונה נפתח רק מהקישור האישי שקיבלת מ-Pack &amp; Board. אם אין לך קישור, אפשר לפנות לדנה.');
  $('#app').innerHTML = loadingPage('list');
  S.store = createStore(secret);
  try { S.me = await S.store.me(); }
  catch (e) {
    if (e instanceof NoAccess) { forgetSecret(); return gate('link', 'הקישור כבר לא פעיל', 'אולי הוא הוחלף בקישור חדש. אפשר לבקש מדנה קישור חדש, והטיולים שלך נשמרים.'); }
    return gate('wifi-off', 'אין חיבור כרגע', 'כדאי לנסות שוב בעוד רגע.');
  }
  S.snippets = await S.store.listSnippets().catch(() => []);
  if (!/^#\/?$/.test(location.hash || '#')) S.trips = await S.store.listTrips().catch(() => []);   // the library needs to know which country each destination is in
  if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/');
  await load();
})();
