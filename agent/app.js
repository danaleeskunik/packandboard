// Agent itinerary builder: the screens (PLAN.md tasks A3-A8). Plain JS, no build step.
// State lives in S; every change to the trip goes through commit() (undo + autosave) or edit() (typing: autosave only).
import * as M from './model.js';
import { createStore, takeSecret, forgetSecret, Conflict, NoAccess } from './store.js';

const S = {
  store: null, me: null, trips: [], filter: 'all', q: '', menuFor: null,
  row: null, t: null, priv: {}, version: 0, history: [],
  snippets: [], libQuery: '', libAll: false,
  day: 0, editItem: null,
  save: 'saved', saveTimer: null, saving: false, dirty: false, privTimer: null,
  dlg: null, conflict: false,
};
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
function edit(next) { S.t = next; scheduleSave(); paintSaved(); }
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
  const el = $('#saved'); if (!el) return;
  el.className = 'saved' + (S.save === 'err' ? ' err' : S.save === 'busy' ? ' busy' : '');
  el.innerHTML = S.save === 'saved' ? icon(I.check) + 'נשמר' : S.save === 'busy' ? 'שומר…' : S.conflict ? 'לא נשמר' : 'לא נשמר, מנסה שוב';
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
        $('#app').innerHTML = '<div class="loading" role="status">טוען את הטיול…</div>';
        const row = await S.store.getTrip(r.id);
        S.row = row; S.t = M.relabel(row.data); S.version = row.version; S.history = []; S.conflict = false; S.save = 'saved'; S.dirty = false; S.privPending = null;
        S.priv = await S.store.getPrivate(r.id).catch(() => ({}));
        S.day = 0;
      }
      if (r.day !== null && r.day < S.t.days.length) S.day = r.day;
    }
  } catch (e) {
    $('#app').innerHTML = `<div class="gate-page"><div class="card"><h1 class="display" style="font-size:28px">לא הצלחנו לפתוח</h1><p class="muted">${e instanceof NoAccess ? 'הטיול לא נמצא, או שאין גישה אליו מהקישור הזה.' : 'אין חיבור כרגע. כדאי לנסות שוב בעוד רגע.'}</p><a class="btn" href="#/">לכל הטיולים</a></div></div>`;
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
  if (S.dlg) { const f = $('#dlg-root [data-autofocus]') || $('#dlg-root input, #dlg-root select, #dlg-root button'); if (f) f.focus(); }
  else if (focusId) { const el = document.getElementById(focusId); if (el) el.focus(); }
}

function topList() {
  const b = (S.me && S.me.branding) || {};
  return `<header class="top"><div class="wrap">
    <a class="brand" href="#/"><span class="display">Pack &amp; Board</span><small>בונה מסלולים</small></a>
    <div class="grow"></div>
    <div class="agency">${b.logoUrl ? `<img src="${esc(b.logoUrl)}" alt="" width="32" height="32" style="border-radius:6px;object-fit:contain">` : `<span class="logo" aria-hidden="true">${esc((S.me.name || '?').slice(0, 1))}</span>`}<span>${esc(b.agencyName || S.me.name)}</span></div>
  </div></header>`;
}

function viewList() {
  const q = S.q.trim();
  const trips = S.trips.filter((r) => (S.filter === 'all' || r.status === S.filter) && (!q || he(r.data.client && r.data.client.name).includes(q)));
  const chip = (v, l) => `<button class="chip" type="button" data-act="filter" data-v="${v}" aria-pressed="${S.filter === v}">${l}</button>`;
  const cards = trips.map((r) => {
    const d = r.data, st = STATUS[r.status] || STATUS.draft;
    const accent = (d.stays && d.stays[0] && d.stays[0].color) || 'var(--brand)';
    const where = d.country || (d.stays && d.stays[0] ? he(d.stays[0].label) : 'טיול חדש');
    return `<article class="pass tp" style="--accent:${esc(accent)}">
      <div class="pass-band"></div>
      <div class="pass-body">
        <div class="row"><span class="iata" style="color:var(--accent)">${esc(where)}</span><div class="grow"></div>
          <button class="icon-btn" type="button" data-act="menu" data-id="${r.id}" aria-label="פעולות על ${esc(he(d.client.name))}" aria-expanded="${S.menuFor === r.id}">${icon(I.more)}</button></div>
        <div class="who">${esc(he(d.client.name))}</div>
        <div class="muted" style="font-size:14px">${tripDates(d)}</div>
      </div>
      <div class="foot"><span class="badge ${st[1]}">${st[0]}${r.changed_since_publish ? ' · יש שינויים' : ''}</span><a class="btn ghost sm" href="#/t/${r.id}/structure">פתיחה</a></div>
      ${S.menuFor === r.id ? `<div class="menu" role="menu" aria-label="פעולות">
        <button role="menuitem" type="button" data-act="clone-open" data-id="${r.id}">${icon(I.copy)}שכפול טיול</button>
        <button role="menuitem" type="button" data-act="archive" data-id="${r.id}">${icon(I.trash)}העברה לארכיון</button></div>` : ''}
    </article>`;
  }).join('');
  return topList() + `<main><div class="wrap">
    <p class="eyebrow">שלום ${esc(S.me.name)}</p>
    <h1 class="display">הטיולים שלי</h1>
    <div class="toolbar">
      <button class="btn sm" type="button" data-act="new-open">${icon(I.plus)}טיול חדש</button>
      <div class="search"><label class="sr" for="q">חיפוש לפי שם הלקוח</label>${icon(I.search)}<input id="q" class="inp" type="search" placeholder="חיפוש לפי שם הלקוח" value="${esc(S.q)}" data-f="q"></div>
      <div class="row" role="group" aria-label="סינון לפי סטטוס">${chip('all', 'הכול')}${chip('draft', 'טיוטה')}${chip('submitted', 'אצל דנה')}${chip('published', 'פורסם')}</div>
    </div>
    ${cards ? `<div class="passes">${cards}</div>` : `<div class="empty-state">${S.trips.length ? 'אין טיולים שמתאימים לחיפוש.' : 'עוד אין כאן טיולים.'}<br>${S.trips.length ? '' : `<button class="btn" type="button" data-act="new-open">${icon(I.plus)}טיול ראשון</button>`}</div>`}
  </div></main>`;
}

function topTrip() {
  const d = S.t, st = M.stepStates(d);
  const step = (key, code, name, state, sub, target) => {
    const cur = route().step === (target || key);
    const cls = state === 'done' ? 'done' : state === 'work' ? 'work' : '';
    return `<li><button type="button" data-act="step" data-v="${target || key}"${cur && !(key === 'transfers') ? ' aria-current="step"' : ''}><span class="state ${cls}" aria-hidden="true"></span><span><span class="code">${code}</span> <span class="nm">${name}</span><span class="st">${sub}</span></span></button></li>`;
  };
  const c = st.counts;
  const label = { empty: 'עוד לא', work: 'בעבודה', done: 'מוכן' };
  return `<header class="top"><div class="wrap">
    <a class="back" href="#/">${icon(I.back)}הטיולים שלי</a>
    <div class="trip-id"><b>${esc(tripTitle(d))}</b><span>${tripDates(d)}</span></div>
    <div class="grow"></div>
    <span class="saved" id="saved" role="status"></span>
  </div></header>
  ${S.conflict ? `<div class="wrap" style="padding-top:12px"><div class="err-box" role="alert">הטיול נשמר בחלון או במחשב אחר, ולכן השינויים האחרונים כאן לא נשמרו. <button class="btn sm" type="button" data-act="reload">לטעון את הגרסה השמורה</button></div></div>` : ''}
  <nav class="steps" aria-label="שלבי הטיול"><div class="wrap"><ol>
    ${step('structure', '01', 'מבנה', st.structure, label[st.structure])}
    ${step('hotels', '02', 'מלונות', st.hotels, c.stays ? c.staysWithHotel + ' מתוך ' + c.stays : label[st.hotels])}
    ${step('days', '03', 'ימים', st.days, c.days ? c.filledDays + ' מתוך ' + c.days : label[st.days])}
    ${step('transfers', '04', 'הגעה', st.transfers, c.pendingTransfers ? c.pendingTransfers + ' לאשר' : label[st.transfers], 'days')}
    <li class="later"><button type="button" disabled aria-describedby="later-5"><span class="state" aria-hidden="true"></span><span><span class="code">05</span> <span class="nm">אישור לקוח</span><span class="st" id="later-5">בקרוב</span></span></button></li>
    ${step('publish', '06', 'פרסום', S.row.status === 'published' ? 'done' : S.row.status === 'submitted' ? 'work' : 'empty', (STATUS[S.row.status] || STATUS.draft)[0])}
  </ol></div></nav>`;
}

function viewTrip(step) {
  const body = step === 'hotels' ? viewHotels() : step === 'days' ? viewDays() : step === 'publish' ? viewPublish() : viewStructure();
  return topTrip() + `<main><div class="wrap">${body}</div></main>`;
}

// ---------- structure ----------
function viewStructure() {
  const t = S.t, N = t.stays.length ? M.totalNights(t) : 0;
  const rows = t.stays.map((s, i) => {
    const start = M.stayStart(t, i);
    const range = t.startDate ? `${M.shortDate(M.addDays(t.startDate, start))} – ${M.shortDate(M.addDays(t.startDate, start + s.nights))}` : '';
    const name = he(s.label);
    return `<div class="stay" draggable="true" data-drag-stay="${s.id}">
      <div class="acts" style="flex-direction:column;gap:0">
        <button class="mini" type="button" data-act="stay-up" data-id="${s.id}" aria-label="הזזת ${esc(name)} למעלה"${i === 0 ? ' disabled' : ''}>${icon(I.up)}</button>
        <button class="mini" type="button" data-act="stay-down" data-id="${s.id}" aria-label="הזזת ${esc(name)} למטה"${i === t.stays.length - 1 ? ' disabled' : ''}>${icon(I.down)}</button>
      </div>
      <span class="bar" style="background:${esc(s.color || '#8A938D')}"></span>
      <div><label class="sr" for="stay-name-${s.id}">שם היעד</label><input id="stay-name-${s.id}" class="inp" style="font-weight:600;min-height:40px" value="${esc(name)}" data-f="stay-name" data-id="${s.id}"><div class="dt ltr">${range}</div></div>
      <div class="row" style="gap:6px">
        <div class="stepper" role="group" aria-label="לילות ב${esc(name)}"><button type="button" data-act="night-minus" data-id="${s.id}" aria-label="פחות לילה ב${esc(name)}"${s.nights <= 1 ? ' disabled' : ''}>−</button><output><b>${Number(s.nights) || 0}</b> ${s.nights === 1 ? 'לילה' : 'לילות'}</output><button type="button" data-act="night-plus" data-id="${s.id}" aria-label="עוד לילה ב${esc(name)}">+</button></div>
        <button class="mini" type="button" data-act="stay-del" data-id="${s.id}" aria-label="הסרת ${esc(name)} וכל הימים שלו">${icon(I.trash)}</button>
      </div>
    </div>`;
  }).join('');
  const strip = t.days.map((d, i) => {
    const info = M.dayInfo(t, i);
    return info.transition
      ? `<span class="tr" style="--a:${esc(destColor(info.dest))};--b:${esc(destColor(info.dest2))}" title="${esc(destName(info.dest) + ' ← ' + destName(info.dest2))}">${i + 1}</span>`
      : `<span style="background:${esc(destColor(info.dest))}" title="${esc(destName(info.dest))}">${i + 1}</span>`;
  }).join('');
  const trans = t.days.filter((d) => d.dest2).length;
  return `<p class="eyebrow">שלב 01</p><h1 class="display">מבנה ולילות</h1>
    <p class="sub">באיזה סדר עוברים בין היעדים, וכמה לילות בכל אחד. התאריכים מתעדכנים לבד.</p>
    <div class="layout2">
      <section class="stays" aria-label="היעדים לפי הסדר">
        ${rows || '<p class="muted" style="padding:16px 18px;margin:0">עוד אין יעדים. מתחילים מהיעד הראשון.</p>'}
        <form class="add-row" data-form="add-stay">
          <label class="sr" for="newdest">יעד חדש</label>
          <input id="newdest" class="inp" placeholder="הוספת יעד, למשל טוקיו" required>
          <label class="sr" for="newnights">לילות</label>
          <input id="newnights" class="inp ltr" type="number" min="1" max="60" value="2" style="width:84px">
          <button class="btn ghost sm" type="submit">הוספה</button>
        </form>
      </section>
      <aside class="card summary" aria-label="סיכום">
        <div class="row"><div><div class="big">${N}</div><div class="muted">לילות</div></div><div><div class="big">${t.days.length}</div><div class="muted">ימים</div></div><div><div class="big">${trans}</div><div class="muted">ימי מעבר</div></div></div>
        ${strip ? `<div class="strip" aria-label="${t.days.length} הימים לפי יעד">${strip}</div><p class="muted" style="font-size:14px;margin:12px 0 0">יום בשני צבעים הוא יום מעבר. בימים האלה תופיע הצעה לקטע הגעה בין היעדים.</p>` : ''}
        <hr class="hr" style="margin:16px 0">
        <div class="field"><label for="start">תאריך התחלה</label><input id="start" class="inp ltr" type="date" value="${esc(t.startDate)}" data-f="start"></div>
        <div class="field" style="margin-top:12px"><label for="country">שם הטיול (מדינה)</label><input id="country" class="inp" value="${esc(t.country)}" placeholder="למשל יפן" data-f="country"></div>
        ${t.stays.length ? `<a class="btn" style="margin-top:16px;width:100%" href="#/t/${S.row.id}/days">לבניית הימים</a>` : ''}
      </aside>
    </div>`;
}

// ---------- hotels ----------
function viewHotels() {
  const t = S.t;
  if (!t.stays.length) return `<p class="eyebrow">שלב 02</p><h1 class="display">מלונות</h1><div class="empty-state">קודם מוסיפים יעדים בשלב המבנה.<br><a class="btn" href="#/t/${S.row.id}/structure">למבנה</a></div>`;
  const cards = t.stays.map((s, i) => {
    const h = s.hotels[0] || {};
    const start = M.stayStart(t, i);
    const f = (k, label, ltr, ph) => `<div class="field"><label for="h-${k}-${s.id}">${label}</label><input id="h-${k}-${s.id}" class="inp${ltr ? ' ltr' : ''}" value="${esc(h[k] || '')}" placeholder="${ph || ''}" data-f="hotel" data-k="${k}" data-id="${s.id}"></div>`;
    const ref = ((S.priv.bookings || {})[s.id] || {}).ref || '';
    return `<section class="hcard" aria-labelledby="h-${s.id}">
      <div class="hh"><span class="dot" style="background:${esc(s.color || '#8A938D')}"></span><h2 id="h-${s.id}">${esc(he(s.label))}</h2><span class="muted" style="font-size:14px"><span class="ltr">${M.shortDate(M.addDays(t.startDate, start))} – ${M.shortDate(M.addDays(t.startDate, start + s.nights))}</span> · ${Number(s.nights) || 0} לילות</span></div>
      <div class="hb">
        ${f('name', 'שם המלון', true)}${f('area', 'אזור')}${f('url', 'קישור', true, 'https://')}${f('maps', 'מיקום במפות', true)}
        <div class="field"><label for="h-pricePerNight-${s.id}">מחיר ללילה (רשות)</label><div class="row" style="flex-wrap:nowrap"><input id="h-pricePerNight-${s.id}" class="inp ltr" value="${esc(h.pricePerNight || '')}" data-f="hotel" data-k="pricePerNight" data-id="${s.id}"><label class="sr" for="h-cur-${s.id}">מטבע</label><select id="h-cur-${s.id}" class="inp" style="width:100px" data-f="hotel" data-k="currency" data-id="${s.id}">${CURRENCIES.map((c) => `<option${(h.currency || 'ILS') === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div></div>
        <fieldset class="field"><legend>מצב</legend><div class="seg">${[['proposed', 'הצעה'], ['chosen', 'נבחר'], ['booked', 'הוזמן']].map(([v, l]) => `<button type="button" data-act="hotel-state" data-id="${s.id}" data-v="${v}" aria-pressed="${(h.state || 'proposed') === v}">${l}</button>`).join('')}</div></fieldset>
        <div class="field full"><label for="h-why-${s.id}">למה אני ממליצה</label><textarea id="h-why-${s.id}" class="inp" data-f="hotel" data-k="why" data-id="${s.id}">${esc(h.why || '')}</textarea></div>
        ${h.state === 'booked' ? `<div class="full lock">${icon(I.lock)}<div class="grow"><div class="field"><label for="h-ref-${s.id}">מספר הזמנה</label><input id="h-ref-${s.id}" class="inp ltr" value="${esc(ref)}" data-f="hotel-ref" data-id="${s.id}"></div><div style="margin-top:6px;color:var(--ink-2)">נשמר בנפרד מהטיול, לא עובר בשכפול, ובאפליקציה של הלקוח מוצג רק עם הקישור הסודי.</div></div></div>` : ''}
      </div></section>`;
  }).join('');
  return `<p class="eyebrow">שלב 02</p><h1 class="display">מלונות</h1>
    <p class="sub">מלון אחד לכל יעד. רק מלון "נבחר" או "הוזמן" מופיע אצל הלקוח.</p>
    <div class="card" style="padding:4px 18px;margin-bottom:16px"><div class="toggle"><button class="sw" type="button" role="switch" aria-checked="${!!t.showPrices}" aria-labelledby="sp-l" data-act="prices"></button><span id="sp-l"><b>להציג מחירים ללקוח</b><br><span class="muted" style="font-size:14px">${t.showPrices ? 'דלוק: המחירים יופיעו באפליקציה וב-PDF.' : 'כבוי: המחירים נשמרים אצלך, ולא נכנסים לאפליקציה ול-PDF.'}</span></span></div></div>
    <div class="hotels">${cards}</div>`;
}

// ---------- days ----------
function itemCard(it, d) {
  if (S.editItem === it.id) return itemEditor(it, d);
  const tr = it.transfer || {};
  const nav = it.kind === 'transfer' ? M.navUrl(tr) : null;
  const meta = [KIND_HE[it.kind]];
  if (it.kind === 'transfer') { if (tr.mode && tr.mode !== 'other') meta.push(MODE_HE[tr.mode]); if (tr.duration) meta.push(tr.duration); if (tr.distanceKm) meta.push(tr.distanceKm + ' ק״מ'); }
  if (it.src === 'library') meta.push('מהספרייה');
  const time = it.when && it.when.from;
  return `<div class="item${it.kind === 'transfer' ? ' transfer' : ''}${it.pending ? ' pending' : ''}" draggable="true" data-drag-item="${it.id}">
    <div class="tag${time ? ' ltr' : ' part'}">${esc(M.itemLabel(it))}</div>
    <div>
      <div class="kind">${esc(meta.join(' · '))}${it.pending ? '<span class="flag todo">לאשר</span>' : ''}${it.checkDate ? '<span class="flag">לבדוק תאריך</span>' : ''}</div>
      <div class="tt">${esc(he(it.title)) || '<span class="muted">בלי כותרת</span>'}</div>
      ${he(it.text) ? `<p>${esc(he(it.text))}</p>` : ''}
      <div class="links">
        ${it.place ? `<a class="lk" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(it.place)}">${icon(I.pin, 14)}<bdi>${esc(it.place)}</bdi></a>` : ''}
        ${nav ? `<a class="lk" target="_blank" rel="noopener" href="${esc(nav)}">${icon(I.nav, 14)}ניווט במפות</a>` : ''}
        ${M.safeUrl(it.url) ? `<a class="lk" target="_blank" rel="noopener" href="${esc(M.safeUrl(it.url))}">קישור</a>` : ''}
      </div>
    </div>
    <div class="acts">
      <button class="mini" type="button" data-act="item-edit" data-id="${it.id}" aria-label="עריכת הקטע ${esc(he(it.title))}">${icon(I.edit)}</button>
      <button class="mini" type="button" data-act="item-dup" data-id="${it.id}" aria-label="שכפול הקטע">${icon(I.copy)}</button>
      <button class="mini" type="button" data-act="item-move" data-id="${it.id}" aria-label="העברה ליום או לחלק אחר">${icon(I.move)}</button>
      <button class="mini" type="button" data-act="item-del" data-id="${it.id}" aria-label="מחיקת הקטע">${icon(I.trash)}</button>
    </div>
  </div>`;
}

function itemEditor(it) {
  const timed = !!(it.when && it.when.from !== undefined);
  const tr = it.transfer || {};
  const inp = (id, label, val, k, opt = {}) => `<div class="field${opt.grow ? ' grow' : ''}"><label for="${id}">${label}</label><input id="${id}" class="inp${opt.ltr ? ' ltr' : ''}" value="${esc(val || '')}" placeholder="${opt.ph || ''}" data-f="item" data-k="${k}" data-id="${it.id}"${opt.type ? ` type="${opt.type}"` : ''}></div>`;
  return `<div class="edit" role="group" aria-label="עריכת קטע">
    <fieldset class="field"><legend>סוג</legend><div class="seg">${M.KINDS.map((k) => `<button type="button" data-act="item-kind" data-id="${it.id}" data-v="${k}" aria-pressed="${it.kind === k}">${KIND_HE[k]}</button>`).join('')}</div></fieldset>
    <div class="g2" style="margin-top:12px">
      <fieldset class="field"><legend>מתי</legend><div class="seg"><button type="button" data-act="item-whenmode" data-id="${it.id}" data-v="part" aria-pressed="${!timed}">חלק ביום</button><button type="button" data-act="item-whenmode" data-id="${it.id}" data-v="time" aria-pressed="${timed}">שעה</button></div></fieldset>
      ${timed
        ? `<div class="row" style="flex-wrap:nowrap;align-items:flex-end">${inp('t-from-' + it.id, 'משעה', it.when.from, 'from', { ltr: 1, grow: 1, ph: '09:00' })}${inp('t-to-' + it.id, 'עד (רשות)', it.when.to, 'to', { ltr: 1, grow: 1, ph: '11:30' })}</div>`
        : `<div class="field"><label for="t-part-${it.id}">חלק ביום</label><select id="t-part-${it.id}" class="inp" data-f="item" data-k="part" data-id="${it.id}">${M.PARTS.map((p) => `<option${M.itemPart(it) === p ? ' selected' : ''}>${p}</option>`).join('')}</select></div>`}
    </div>
    <div style="margin-top:12px">${inp('it-' + it.id, 'כותרת', he(it.title), 'title')}</div>
    <div class="field" style="margin-top:12px"><label for="ix-${it.id}">טקסט</label><textarea id="ix-${it.id}" class="inp" data-f="item" data-k="text" data-id="${it.id}">${esc(he(it.text))}</textarea></div>
    ${it.kind === 'transfer' ? `<div class="g2" style="margin-top:12px">
        ${inp('tf-' + it.id, 'מאיפה', tr.from, 'tr.from', { ltr: 1, ph: 'Narita Airport' })}${inp('tt-' + it.id, 'לאן', tr.to, 'tr.to', { ltr: 1, ph: 'Hotel, Tokyo' })}
        <div class="field"><label for="tm-${it.id}">אמצעי</label><select id="tm-${it.id}" class="inp" data-f="item" data-k="tr.mode" data-id="${it.id}">${M.MODES.map((m) => `<option value="${m}"${(tr.mode || 'other') === m ? ' selected' : ''}>${MODE_HE[m]}</option>`).join('')}</select></div>
        ${inp('tdu-' + it.id, 'משך', tr.duration, 'tr.duration', { ph: 'שעה' })}
        ${inp('tkm-' + it.id, 'מרחק בק״מ', tr.distanceKm, 'tr.distanceKm', { ltr: 1 })}
        ${inp('tpr-' + it.id, 'ספק', tr.provider, 'tr.provider', { ph: 'למשל Narita Express' })}
      </div>` : ''}
    <div class="g2" style="margin-top:12px">
      ${inp('ip-' + it.id, 'מיקום במפות', it.place, 'place', { ltr: 1 })}
      ${inp('iu-' + it.id, 'קישור (רשות)', it.url, 'url', { ltr: 1, ph: 'https://' })}
      <div class="field"><label for="ipr-${it.id}">מחיר (רשות)</label><div class="row" style="flex-wrap:nowrap"><input id="ipr-${it.id}" class="inp ltr" value="${esc(it.price == null ? '' : it.price)}" data-f="item" data-k="price" data-id="${it.id}"><label class="sr" for="icu-${it.id}">מטבע</label><select id="icu-${it.id}" class="inp" style="width:100px" data-f="item" data-k="currency" data-id="${it.id}">${CURRENCIES.map((c) => `<option${(it.currency || 'ILS') === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div></div>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn sm" type="button" data-act="item-done">סיום</button><button class="btn ghost sm" type="button" data-act="item-lib" data-id="${it.id}">שמירה לספרייה</button>${timed && M.isTime(it.when.from) ? `<span class="muted" style="font-size:13px"><span class="ltr">${esc(it.when.from)}</span> נכנס ל${M.partOf(it.when.from)}</span>` : ''}</div>
  </div>`;
}

function viewDays() {
  const t = S.t;
  if (!t.stays.length) return `<p class="eyebrow">שלב 03</p><h1 class="display">ימים</h1><div class="empty-state">קודם מוסיפים יעדים ולילות בשלב המבנה. הימים נוצרים מהם.<br><a class="btn" href="#/t/${S.row.id}/structure">למבנה</a></div>`;
  const d = S.day, day = t.days[d], info = M.dayInfo(t, d);
  const list = t.days.map((x, i) => {
    const inf = M.dayInfo(t, i);
    const bar = inf.transition ? `linear-gradient(${esc(destColor(inf.dest))} 50%,${esc(destColor(inf.dest2))} 50%)` : esc(destColor(inf.dest));
    const pend = x.items.some((it) => it.pending) || M.suggestedTransfers(t).some((s) => s.d === i);
    const where = inf.transition ? destName(inf.dest) + ' ← ' + destName(inf.dest2) : destName(inf.dest);
    const empty = M.dayIsEmpty(x);
    return `<li><button class="drow" type="button" data-act="day" data-v="${i}" data-drop-day="${i}"${i === d ? ' aria-current="true"' : ''}><span class="bar" style="background:${bar}"></span><span class="n ltr">${M.shortDate(inf.date)}</span><span class="t${empty ? ' empty' : ''}">${empty ? 'יום ריק' : esc(he(x.title)) || 'בלי כותרת'}<small>${esc(where)}${x.items.length ? ' · ' + x.items.length + ' קטעים' : ''}${pend ? ' · הגעה לאשר' : ''}</small></span><span></span></button>
      <button class="mini rowdup" type="button" data-act="day-dup" data-v="${i}" aria-label="שכפול יום ${i + 1}">${icon(I.copy)}</button></li>`;
  }).join('');
  const groups = M.itemsByPart(day);
  const sugg = M.suggestedTransfers(t).filter((s) => s.d === d);
  const bands = M.PARTS.map((p) => `<div class="band" data-drop-part="${p}">
      <div class="band-h"><h3>${p} <span class="mono">${PART_RANGE[p]}</span></h3></div>
      ${groups[p].map((it) => itemCard(it, d)).join('')}
      <button class="addline" type="button" data-act="item-add" data-v="${p}">+ הוספה ל${p}</button>
    </div>`).join('');
  const lib = M.librarySubset(S.snippets, t, d, { query: S.libQuery, allDests: S.libAll });
  const libDests = [info.dest, info.dest2].filter(Boolean).map(destName).join(' + ');
  return `<div class="days3">
    <section class="panel" aria-labelledby="dl-h">
      <div class="panel-h"><h2 id="dl-h">${t.days.length} ימים</h2><button class="mini" type="button" data-act="day-add" aria-label="הוספת יום בסוף הטיול">${icon(I.plus)}</button></div>
      <ul class="dlist">${list}</ul>
    </section>
    <section class="panel" aria-labelledby="day-title-l">
      <div class="dayhead">
        <div class="field"><label id="day-title-l" for="day-title">יום ${d + 1} · <span class="ltr">${dayLabel(info.date)}</span> · ${esc(info.transition ? destName(info.dest) + ' ← ' + destName(info.dest2) : destName(info.dest))}</label><input id="day-title" class="inp" value="${esc(he(day.title))}" placeholder="כותרת היום, למשל אסאקוסה ואואנו" data-f="day-title"></div>
        <div class="row">
          <button class="btn ghost sm" type="button" data-act="day-dup" data-v="${d}">${icon(I.copy)}שכפול יום</button>
          <button class="icon-btn" type="button" data-act="day-dup-opts" aria-label="אפשרויות שכפול">${icon(I.down)}</button>
          <button class="icon-btn" type="button" data-act="day-del" aria-label="מחיקת יום ${d + 1}"${M.totalNights(t) <= 1 ? ' disabled' : ''}>${icon(I.trash)}</button>
        </div>
      </div>
      ${sugg.map((s) => `<div class="note" style="margin:12px 18px 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="grow">הצעה: קטע הגעה <b>${esc(s.title)}</b></span><button class="btn ghost sm" type="button" data-act="sugg" data-v="${esc(s.suggest)}">הוספה ל${esc(s.part)}</button></div>`).join('')}
      ${bands}
    </section>
    <section class="panel libcol" aria-labelledby="lib-h">
      <div class="panel-h"><h2 id="lib-h">הספרייה שלי</h2><span class="muted" style="font-size:13px">${S.snippets.length} קטעים</span></div>
      <div style="padding:10px 14px 0" class="search"><label class="sr" for="lq">חיפוש בספרייה</label><svg class="i" viewBox="0 0 24 24" aria-hidden="true" style="top:23px;inset-inline-start:26px"><path d="${I.search}"/></svg><input id="lq" class="inp" type="search" placeholder="חיפוש בספרייה" value="${esc(S.libQuery)}" data-f="libq"></div>
      <div class="libfilter" role="group" aria-label="סינון הספרייה">
        <button class="chip" type="button" data-act="lib-all" data-v="0" aria-pressed="${!S.libAll}"><span class="dot" style="background:${esc(destColor(info.dest))}"></span>${esc(libDests)} + כללי</button>
        <button class="chip" type="button" data-act="lib-all" data-v="1" aria-pressed="${S.libAll}">כל היעדים</button>
      </div>
      ${lib.length ? `<ul class="lib">${lib.map((s) => `<li><div><div class="mt">${esc(s.dest === 'all' ? 'כללי' : destName(s.dest))} · ${esc(s.data.part || '')} · ${esc(KIND_HE[s.data.kind] || '')}</div><div class="tt">${esc(he(s.data.title))}</div>${he(s.data.text) ? `<p>${esc(he(s.data.text))}</p>` : ''}</div>
        <div style="display:flex;flex-direction:column;gap:4px"><button class="plus" type="button" data-act="lib-add" data-id="${s.id}" aria-label="הוספת ${esc(he(s.data.title))} ל${esc(s.data.part || 'בוקר')}">${icon(I.plus)}</button><button class="mini" type="button" data-act="lib-del" data-id="${s.id}" aria-label="מחיקת ${esc(he(s.data.title))} מהספרייה">${icon(I.trash)}</button></div></li>`).join('')}</ul>`
        : `<p class="muted" style="padding:0 14px 14px;margin:0;font-size:14px">${S.snippets.length ? 'אין כאן קטעים שמתאימים.' : 'הספרייה ריקה. בכל קטע יש "שמירה לספרייה", וכך הוא יחכה לטיול הבא.'}</p>`}
    </section>
  </div>`;
}

// ---------- publish ----------
function viewPublish() {
  const t = S.t, st = M.stepStates(t), c = st.counts, r = S.row;
  const empty = t.days.map((x, i) => (M.dayIsEmpty(x) ? M.shortDate(M.dayInfo(t, i).date) : null)).filter(Boolean);
  const noHotel = t.stays.filter((s) => !M.shownHotel(s)).map((s) => he(s.label));
  const li = (good, title, sub, link, linkText) => `<li><span class="ck ${good ? 'ok' : 'no'}" aria-hidden="true">${good ? '✓' : '!'}</span><div class="grow"><b>${title}</b>${sub ? `<div class="muted" style="font-size:14px">${sub}</div>` : ''}</div>${!good && link ? `<a class="btn ghost sm" href="#/t/${r.id}/${link}">${linkText}</a>` : ''}</li>`;
  const pub = r.published || {};
  return `<p class="eyebrow">שלב 06</p><h1 class="display">פרסום</h1>
    <p class="sub">כשהכל מוכן שולחים לדנה. אחרי שהיא מאשרת, מקבלים כאן את הקישור לאפליקציה ואת ה-PDF.</p>
    <div class="layout2">
      <section class="card" style="padding:6px 18px" aria-labelledby="ck-h">
        <h2 id="ck-h" class="sr">מה בדקנו</h2>
        <ul class="checklist">
          ${li(!!t.stays.length, 'מבנה', t.stays.length ? `${t.stays.length} יעדים, ${M.totalNights(t)} לילות` : 'אין יעדים', 'structure', 'למבנה')}
          ${li(!empty.length, empty.length ? `${empty.length} ימים ריקים` : 'כל הימים מלאים', empty.length ? `<span class="ltr">${empty.slice(0, 6).join(', ')}</span>${empty.length > 6 ? '…' : ''}. אפשר לשלוח גם כך.` : '', 'days', 'לימים')}
          ${li(!c.pendingTransfers, c.pendingTransfers ? `${c.pendingTransfers} קטעי הגעה לאשר` : 'קטעי ההגעה', c.pendingTransfers ? 'הצעות שעוד לא מולאו' : '', 'days', 'לאישור')}
          ${li(!noHotel.length, noHotel.length ? 'אין מלון ב' + noHotel.map(esc).join(', ') : 'יש מלון בכל יעד', '', 'hotels', 'למלונות')}
          ${li(true, 'מחירים', t.showPrices ? 'מוצגים ללקוח' : 'לא מוצגים ללקוח')}
        </ul>
        ${r.status === 'submitted' ? `<div class="note" style="margin:12px 0 16px">הטיול אצל דנה. אפשר להמשיך לערוך, והשינויים ייכנסו.</div>`
          : `<div class="field" style="margin:8px 0 12px"><label for="note">הערה לדנה (רשות)</label><textarea id="note" class="inp" placeholder="למשל: הלקוחות טסים עם ילדה בת 12">${esc(r.note_to_dana || '')}</textarea></div>
             <div class="row" style="padding-bottom:16px"><button class="btn" type="button" data-act="submit"${t.stays.length ? '' : ' disabled'}>${r.status === 'published' ? 'שליחה שוב לדנה' : 'שליחה לדנה לאישור'}</button></div>`}
      </section>
      <aside class="card" style="padding:18px" aria-labelledby="tl-h">
        <h2 id="tl-h" style="margin-bottom:14px">מה קורה אחר כך</h2>
        <div class="timeline">
          <div class="tl"><span class="state done" aria-hidden="true"></span><div><b>טיוטה</b><span>את עובדת על הטיול</span></div></div>
          <div class="tl"><span class="state ${r.status === 'submitted' ? 'work' : r.status === 'published' ? 'done' : ''}" aria-hidden="true"></span><div><b>אצל דנה</b><span>דנה בודקת ובונה את האפליקציה</span></div></div>
          <div class="tl"><span class="state ${r.status === 'published' ? 'done' : ''}" aria-hidden="true"></span><div><b>פורסם</b><span>הקישור וה-PDF מופיעים כאן</span></div></div>
        </div>
        ${r.status === 'published' && S.priv.clientLink ? `<hr class="hr" style="margin:6px 0 16px"><div class="result">
          <div class="linkbox"><code>${esc(S.priv.clientLink.replace(/#.*/, '#…'))}</code><button class="btn sm" type="button" data-act="copy-link">העתקת הקישור</button></div>
          ${pub.pdfName ? `<p class="muted" style="font-size:13px;margin:0">ה-PDF: <span class="ltr">${esc(pub.pdfName)}</span></p>` : ''}
          ${r.changed_since_publish ? '<p class="note" style="margin:0">יש שינויים מאז הפרסום. כדי שייכנסו לאפליקציה, שולחים שוב לדנה.</p>' : ''}
        </div>` : ''}
      </aside>
    </div>`;
}

// ---------- dialogs ----------
function dialogShell(id, title, body, foot) {
  return `<div class="scrim on"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="${id}">
    <div class="dlg-h"><h2 id="${id}">${title}</h2><button class="icon-btn" type="button" aria-label="סגירה" data-act="dlg-close">${icon(I.close)}</button></div>
    <form data-form="${S.dlg.type}"><div class="dlg-b">${body}</div><div class="dlg-f">${foot}<button class="btn ghost" type="button" data-act="dlg-close">ביטול</button></div></form></div></div>`;
}
function viewDialog() {
  const g = S.dlg;
  if (g.type === 'new') return dialogShell('dn-h', 'טיול חדש', `
      <div class="field"><label for="n-name">שם הלקוח או המשפחה <span class="req" aria-hidden="true">*</span></label><input id="n-name" name="name" class="inp" required placeholder="למשל משפחת לוי" data-autofocus></div>
      <div class="g2">
        <div class="field"><label for="n-date">תאריך התחלה <span class="req" aria-hidden="true">*</span></label><input id="n-date" name="date" class="inp ltr" type="date" required></div>
        <div class="field"><label for="n-country">מדינה</label><input id="n-country" name="country" class="inp" placeholder="למשל יפן"></div>
      </div>
      <fieldset><legend>מי נוסע (רשות)</legend>
        <div class="g2"><div class="field"><label for="n-ad">מבוגרים</label><input id="n-ad" name="adults" class="inp ltr" type="number" min="0" max="30" value="2"></div><div class="field"><label for="n-kids">גילאי הילדים</label><input id="n-kids" name="kids" class="inp ltr" placeholder="12, 9"></div></div>
      </fieldset>
      ${g.error ? `<div class="err-box" role="alert">${esc(g.error)}</div>` : ''}`,
    `<button class="btn" type="submit">יצירת הטיול</button>`);
  if (g.type === 'clone') {
    const src = S.trips.find((x) => x.id === g.id);
    const box = (k, l, on) => `<label class="check"><input type="checkbox" name="${k}"${on ? ' checked' : ''}>${l}</label>`;
    return dialogShell('dc-h', 'שכפול: ' + esc(tripTitle(src.data)), `
      <div class="g2">
        <div class="field"><label for="c-name">שם הלקוח החדש <span class="req" aria-hidden="true">*</span></label><input id="c-name" name="name" class="inp" required placeholder="למשל משפחת כהן" data-autofocus></div>
        <div class="field"><label for="c-date">תאריך התחלה חדש <span class="req" aria-hidden="true">*</span></label><input id="c-date" name="date" class="inp ltr" type="date" required></div>
      </div>
      <fieldset><legend>מה להעתיק</legend><div class="checks">
        ${box('structure', 'המבנה (יעדים ולילות)', 1)}${box('hotels', 'המלונות (בלי הזמנות)', 1)}${box('days', 'הימים והקטעים', 1)}${box('transfers', 'ההעברות (בלי הזמנות)', 1)}${box('prices', 'המחירים', 0)}
      </div></fieldset>
      <div class="never"><b style="font-size:14px">לא עובר אף פעם</b><ul><li>שמות הנוסעים וטיסות</li><li>מספרי הזמנה, שוברים ומסמכים</li><li>הערות הלקוח, אישורים וקישורים</li></ul></div>
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
    const s = S.t.stays.find((x) => x.id === el.dataset.id);
    commit(M.setHotel(S.t, s.id, Object.assign({}, s.hotels[0] || { name: '' }, { state: el.dataset.v })));
  },
  prices: () => commit(Object.assign({}, S.t, { showPrices: !S.t.showPrices })),
  // days
  day: (el) => { S.day = Number(el.dataset.v); S.editItem = null; history.replaceState(null, '', '#/t/' + S.row.id + '/days/' + S.day); render(); const h = $('#day-title'); if (h && window.innerWidth < 860) h.scrollIntoView({ block: 'start' }); },
  'day-add': () => tryCommit((t) => M.insertDayAfter(t, t.days.length - 1), 'נוסף יום בסוף הטיול (עוד לילה ביעד האחרון)'),
  'day-dup': (el) => { const d = Number(el.dataset.v); tryCommit((t) => M.duplicateDay(t, d, { target: 'after' }), `יום ${d + 1} שוכפל. העותק אחריו, ונוסף לילה`); S.day = d + 1; render(); },
  'day-dup-opts': () => { S.dlg = { type: 'dup' }; render(); },
  'day-del': () => { const d = S.day; tryCommit((t) => M.deleteDay(t, d), `יום ${d + 1} נמחק`); },
  sugg: (el) => { const s = M.suggestedTransfers(S.t).find((x) => x.d === S.day && x.suggest === el.dataset.v); if (s) { const next = M.applySuggestion(S.t, s); S.editItem = next.days[S.day].items[next.days[S.day].items.length - 1].id; commit(next); } },
  'item-add': (el) => { const it = M.newItem({ part: el.dataset.v }); S.editItem = it.id; commit(M.addItem(S.t, S.day, it)); const f = document.getElementById('it-' + it.id); if (f) f.focus(); },
  'item-edit': (el) => { S.editItem = el.dataset.id; render(); const f = document.getElementById('it-' + el.dataset.id); if (f) f.focus(); },
  'item-done': () => { S.editItem = null; render(); },
  'item-dup': (el) => tryCommit((t) => M.duplicateItem(t, el.dataset.id), 'הקטע שוכפל'),
  'item-del': (el) => { if (S.editItem === el.dataset.id) S.editItem = null; tryCommit((t) => M.deleteItem(t, el.dataset.id), 'הקטע נמחק'); },
  'item-move': (el) => { S.dlg = { type: 'move', id: el.dataset.id }; render(); },
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
    try { const row = await S.store.addSnippet(S.me.id, snip); S.snippets.unshift(row); render(); toast('נשמר בספרייה של ' + destName(info.dest)); }
    catch (e) { toast('לא נשמר בספרייה. כדאי לנסות שוב.'); }
  },
  'lib-all': (el) => { S.libAll = el.dataset.v === '1'; render(); },
  'lib-add': (el) => {
    const s = S.snippets.find((x) => x.id === el.dataset.id);
    commit(M.addItem(S.t, S.day, M.itemFromSnippet(s, s.id)), `"${he(s.data.title)}" נוסף ל${s.data.part || 'בוקר'}`);
  },
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
  if (!el || el.disabled) { if (S.menuFor && !e.target.closest('.menu')) { S.menuFor = null; render(); } return; }
  const fn = ACT[el.dataset.act];
  if (fn) { if (el.tagName === 'A') return; e.preventDefault(); fn(el, e); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (S.dlg) closeDlg(); else if (S.menuFor) { S.menuFor = null; render(); } else if (S.editItem) { S.editItem = null; render(); } }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.target.closest('input,textarea') && toastUndo) { e.preventDefault(); $('#toast-undo').click(); }
});

// typing: update without re-rendering (keeps the cursor), save in the background
document.addEventListener('input', (e) => {
  const el = e.target, f = el.dataset.f; if (!f) return;
  const v = el.value;
  if (f === 'q') { S.q = v; render(); return; }
  if (f === 'libq') { S.libQuery = v; render(); return; }
  if (f === 'day-title') return edit(M.setDayTitle(S.t, S.day, v));
  if (f === 'stay-name') { const t = clone(S.t); t.stays.find((s) => s.id === el.dataset.id).label = { he: v }; return edit(t); }
  if (f === 'country') return edit(Object.assign({}, S.t, { country: v }));
  if (f === 'hotel') { const s = S.t.stays.find((x) => x.id === el.dataset.id); return edit(M.setHotel(S.t, s.id, Object.assign({}, s.hotels[0] || { state: 'proposed' }, { [el.dataset.k]: v }))); }
  if (f === 'hotel-ref') { const id = el.dataset.id; return editPrivate((p) => { p.bookings = p.bookings || {}; p.bookings[id] = { ref: v }; }); }
  if (f === 'item') return itemInput(el);
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
    } catch (err) { S.dlg.error = /required/.test(err.message) ? 'חסרים שם הלקוח ותאריך ההתחלה.' : 'לא נוצר. כדאי לנסות שוב.'; render(); }
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
    } catch (err) { S.dlg.error = /required/.test(err.message) ? 'חסרים שם הלקוח ותאריך ההתחלה.' : 'לא שוכפל. כדאי לנסות שוב.'; render(); }
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

// drag and drop: items between parts and days, stays to a new order
let drag = null;
document.addEventListener('dragstart', (e) => {
  const it = e.target.closest('[data-drag-item]'), st = e.target.closest('[data-drag-stay]');
  if (e.target.closest('input,textarea,select')) { e.preventDefault(); return; }
  if (it) drag = { item: it.dataset.dragItem }; else if (st) drag = { stay: st.dataset.dragStay }; else return;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'pab');
});
function dropTarget(e) {
  if (!drag) return null;
  if (drag.item) return e.target.closest('[data-drop-part],[data-drop-day]');
  if (drag.stay) return e.target.closest('[data-drag-stay]');
  return null;
}
document.addEventListener('dragover', (e) => { const t = dropTarget(e); if (!t) return; e.preventDefault(); document.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over')); t.classList.add('drag-over'); });
document.addEventListener('dragend', () => { drag = null; document.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over')); });
document.addEventListener('drop', (e) => {
  const t = dropTarget(e); if (!t) return;
  e.preventDefault();
  const dr = drag; drag = null;
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
  const gate = (msg) => { $('#app').innerHTML = `<div class="gate-page"><div class="card"><p class="eyebrow">Pack &amp; Board</p><h1 class="display" style="font-size:32px">בונה מסלולים</h1><p class="muted">${msg}</p></div></div>`; };
  if (!secret) return gate('הבונה נפתח מהקישור האישי שקיבלת מ-Pack &amp; Board. אם אין לך קישור, אפשר לפנות לדנה.');
  S.store = createStore(secret);
  try { S.me = await S.store.me(); }
  catch (e) {
    if (e instanceof NoAccess) { forgetSecret(); return gate('הקישור הזה כבר לא פעיל. אפשר לבקש מדנה קישור חדש.'); }
    return gate('אין חיבור כרגע. כדאי לנסות שוב בעוד רגע.');
  }
  S.snippets = await S.store.listSnippets().catch(() => []);
  if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/');
  await load();
})();
