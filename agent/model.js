// Trip model of the agent itinerary builder (agent-builder/SPEC.md section 5, PLAN.md task A2).
// Pure functions: every change returns a NEW trip and never touches the one it got, so the builder keeps old ones for "undo".
// Works in the browser (<script type="module">) and in node (tests: node --test agent-builder/tests/).
//
// Layout of days (the core rule):  the trip has N nights (sum of stays[].nights) and N+1 days, numbered 0..N.
//   Night k is spent in stayOfNight(k). Day d is the day that ends with night d (day N ends at home).
//   Day d is a TRANSITION day when d > 0 and stayOfNight(d-1) != stayOfNight(d): the travelers leave one destination and sleep in the next.
//   Day d (d >= 1) belongs to the stay of night d-1 ("the stay you wake up in"); day 0 belongs to the first stay.
//   So a stay with n nights owns n days (its full days plus the day it is left), and the first stay also owns day 0.
// days[] keeps only content (id, title, items, ...). dest / dest2 / date are always derived (relabel), never trusted from storage.

export const PARTS = ['בוקר', 'צהריים', 'ערב', 'לילה'];
const PART_ENDS = [[11, 30], [16, 0], [21, 0]];           // בוקר until 11:30, צהריים until 16:00, ערב until 21:00, then לילה

export const KINDS = ['activity', 'meal', 'tip', 'transfer'];
export const MODES = ['flight', 'train', 'shinkansen', 'driver', 'taxi', 'car', 'transit', 'walk', 'other'];
const TRAVELMODE = { train: 'transit', shinkansen: 'transit', transit: 'transit', driver: 'driving', taxi: 'driving', car: 'driving', walk: 'walking' };

// ---------- small helpers ----------
export function uid(prefix) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  const rnd = (globalThis.crypto && globalThis.crypto.getRandomValues) ? globalThis.crypto.getRandomValues(new Uint8Array(10)) : null;
  for (let i = 0; i < 10; i++) s += abc[(rnd ? rnd[i] : Math.floor(Math.random() * 256)) % abc.length];
  return (prefix || 'x') + '_' + s;
}
const clone = (o) => JSON.parse(JSON.stringify(o));

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
export function shortDate(iso) {                              // '2026-09-29' -> '29.9'
  const [, m, d] = iso.split('-').map(Number);
  return d + '.' + m;
}
// only web links become clickable (never javascript:, data: and the like)
export function safeUrl(u) { return typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u.trim()) ? u.trim() : ''; }
// "place" may be a name to search in Google Maps or a maps link the agent pasted
export function placeHref(place) { return safeUrl(place) || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place || ''); }
export function placeLabel(place) { return safeUrl(place) ? 'מיקום במפות' : (place || ''); }
export function isTime(s) { return typeof s === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(s); }

// ---------- structure ----------
export function totalNights(trip) { return trip.stays.reduce((s, st) => s + st.nights, 0); }
export function dayCount(trip) { return trip.stays.length ? totalNights(trip) + 1 : 0; }

// index of the stay in which night k is spent (k = 0..N-1); night N does not exist (home), it maps to the last stay
export function stayIndexOfNight(trip, k) {
  let acc = 0;
  for (let i = 0; i < trip.stays.length; i++) {
    acc += trip.stays[i].nights;
    if (k < acc) return i;
  }
  return trip.stays.length - 1;
}
export function stayStart(trip, i) {                       // first night index of stay i
  let s = 0;
  for (let j = 0; j < i; j++) s += trip.stays[j].nights;
  return s;
}
// which stay owns day d (see the layout rule at the top)
export function ownerStayIndex(trip, d) { return d === 0 ? 0 : stayIndexOfNight(trip, d - 1); }

// derived facts of day d: {index, date, dest, dest2, transition, stayId}
export function dayInfo(trip, d) {
  const N = totalNights(trip);
  const prev = d === 0 ? null : stayIndexOfNight(trip, d - 1);
  const cur = d >= N ? null : stayIndexOfNight(trip, d);
  const transition = prev !== null && cur !== null && prev !== cur;
  const main = d === 0 ? cur : prev;
  const st = trip.stays[main];
  return {
    index: d,
    date: trip.startDate ? addDays(trip.startDate, d) : null,
    dest: st.dest,
    dest2: transition ? trip.stays[cur].dest : undefined,
    transition,
    first: d === 0,
    last: d === N,
    stayId: st.id,
  };
}

// make days[] match the structure: right length, and dest/dest2/date written from the structure
export function relabel(trip) {
  const t = clone(trip);
  const n = dayCount(t);
  while (t.days.length < n) t.days.push(emptyDay());
  if (t.days.length > n) throw new Error('relabel: more days than the structure allows (' + t.days.length + ' > ' + n + ')');
  t.days.forEach((day, d) => {
    const info = dayInfo(t, d);
    day.dest = info.dest;
    if (info.dest2) day.dest2 = info.dest2; else delete day.dest2;
    day.date = info.date;
  });
  return t;
}

export function emptyDay() { return { id: uid('d'), title: { he: '' }, items: [] }; }
export function dayIsEmpty(day) { return !day.items.length && !(day.title && day.title.he && day.title.he.trim()); }

// ---------- new trip ----------
export function newTrip({ clientName, startDate, adults = 2, childAges = [], country = '', agencyName = '', logoUrl = null }) {
  if (!clientName || !clientName.trim()) throw new Error('newTrip: client name is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '')) throw new Error('newTrip: start date is required (YYYY-MM-DD)');
  const travelers = [];
  for (let i = 0; i < adults; i++) travelers.push({ type: 'adult' });
  childAges.forEach((age) => travelers.push({ type: 'child', age: Number(age) }));
  return {
    id: uid('trip'), status: 'draft', version: 1,
    client: { name: clientName.trim(), travelers },
    startDate, country, languages: ['he'], showPrices: false,
    branding: { agencyName, logoUrl, showPabLogo: true },
    flights: { out: null, back: null },
    stays: [], days: [],
  };
}

// ---------- structure changes ----------
export function addStay(trip, { dest, label, color, nights = 1 }) {
  if (nights < 1) throw new Error('addStay: at least one night');
  let t = clone(trip);
  t.stays.push({ id: uid('st'), dest, label: label || { he: dest }, color: color || null, nights, hotels: [] });
  return relabel(t);
}

export function setStartDate(trip, startDate) {
  const t = clone(trip); t.startDate = startDate; return relabel(t);
}

// one more night in stay i: a new empty day at the end of the stay (just before the day it is left)
export function addNight(trip, stayId) {
  const t = clone(trip);
  const i = t.stays.findIndex((s) => s.id === stayId);
  if (i < 0) throw new Error('addNight: no such stay');
  const at = stayStart(t, i) + t.stays[i].nights;           // index of the day the stay is left (or the last day)
  t.stays[i].nights += 1;
  t.days.splice(at, 0, emptyDay());
  return relabel(t);
}

// the days that may be removed when stay i loses a night (one of them must be chosen)
export function removableDays(trip, stayId) {
  const i = trip.stays.findIndex((s) => s.id === stayId);
  if (i < 0) throw new Error('removableDays: no such stay');
  if (trip.stays[i].nights <= 1) return [];
  const s = stayStart(trip, i), n = trip.stays[i].nights;
  const out = [];
  for (let d = s + 1; d <= s + n; d++) out.push(d);         // days whose previous night is in this stay
  if (i === 0) out.unshift(0);
  return out;
}
// the day that is removed without asking: the last EMPTY removable day; null = every candidate has content, ask the agent
export function defaultDayToRemove(trip, stayId) {
  const c = removableDays(trip, stayId);
  for (let j = c.length - 1; j >= 0; j--) if (dayIsEmpty(trip.days[c[j]])) return c[j];
  return null;
}

// delete day d. It always removes one night: the night before it (or night 0 for day 0). A stay that reaches 0 nights is removed.
export function deleteDay(trip, d) {
  const t = clone(trip);
  const N = totalNights(t);
  if (d < 0 || d > N) throw new Error('deleteDay: no such day');
  if (N <= 1 && t.stays.length <= 1) throw new Error('deleteDay: a trip keeps at least one night');
  const k = d === 0 ? 0 : d - 1;
  const i = stayIndexOfNight(t, k);
  t.stays[i].nights -= 1;
  t.days.splice(d, 1);
  if (t.stays[i].nights === 0) t.stays.splice(i, 1);
  return relabel(t);
}

export function removeNight(trip, stayId, dayIndex) {
  const c = removableDays(trip, stayId);
  if (!c.includes(dayIndex)) throw new Error('removeNight: day ' + dayIndex + ' is not a day of this stay');
  return deleteDay(trip, dayIndex);
}

// the days a stay owns (moved / removed together with it)
export function ownedDays(trip, stayId) {
  const i = trip.stays.findIndex((s) => s.id === stayId);
  const s = stayStart(trip, i), n = trip.stays[i].nights;
  const out = [];
  if (i === 0) out.push(0);
  for (let d = s + 1; d <= s + n; d++) out.push(d);
  return out;
}

// put the stays in a new order; every stay takes its own days along. Day 0 stays day 0 (arrival).
export function reorderStays(trip, newOrderIds) {
  const t = clone(trip);
  if (newOrderIds.length !== t.stays.length || !t.stays.every((s) => newOrderIds.includes(s.id))) throw new Error('reorderStays: bad order');
  const day0 = t.days[0];
  const owned = {};
  t.stays.forEach((s, i) => { owned[s.id] = ownedDays(t, s.id).filter((d) => d !== 0).map((d) => t.days[d]); });
  t.stays = newOrderIds.map((id) => t.stays.find((s) => s.id === id));
  t.days = [day0].concat(...newOrderIds.map((id) => owned[id]));
  return relabel(t);
}

// remove a whole stay with its days (the builder asks first and offers undo)
export function removeStay(trip, stayId) {
  const t = clone(trip);
  const i = t.stays.findIndex((s) => s.id === stayId);
  if (i < 0) throw new Error('removeStay: no such stay');
  if (t.stays.length === 1) { t.stays = []; t.days = []; return t; }
  // the stay's n owned days go (day 0 always stays: for the first stay it becomes the arrival in the next one)
  const drop = new Set(ownedDays(t, stayId).filter((d) => d !== 0));
  t.days = t.days.filter((_, d) => !drop.has(d));
  t.stays.splice(i, 1);
  return relabel(t);
}

// ---------- days ----------
export function insertDayAfter(trip, d, day) {
  // one more night in the stay that owns night d (or the last stay for the last day); the new day lands at d+1
  const t = clone(trip);
  const N = totalNights(t);
  const i = stayIndexOfNight(t, Math.min(d, N - 1));
  t.stays[i].nights += 1;
  t.days.splice(d + 1, 0, day || emptyDay());
  return relabel(t);
}

function copyItem(item, { keepTimes = true, newId = true } = {}) {
  const c = clone(item);
  if (newId) c.id = uid('i');
  if (!keepTimes && c.when && c.when.from) c.when = { part: partOf(c.when.from) };
  return c;
}

// duplicate day d. target: 'after' (adds a night) | 'end' (adds a night to the last stay) | a day index whose content is replaced
export function duplicateDay(trip, d, { target = 'after', copyTimes = true } = {}) {
  const src = trip.days[d];
  const copy = { id: uid('d'), title: clone(src.title), items: src.items.map((it) => copyItem(it, { keepTimes: copyTimes })) };
  if (target === 'after') return insertDayAfter(trip, d, copy);
  if (target === 'end') return insertDayAfter(trip, dayCount(trip) - 1, copy);
  if (Number.isInteger(target)) {
    const t = clone(trip);
    if (!t.days[target]) throw new Error('duplicateDay: no such target day');
    t.days[target] = Object.assign({}, t.days[target], { title: copy.title, items: copy.items });
    return relabel(t);
  }
  throw new Error('duplicateDay: bad target');
}

export function setDayTitle(trip, d, he) { const t = clone(trip); t.days[d].title = Object.assign({}, t.days[d].title, { he }); return t; }

// ---------- items and the four parts of the day ----------
export function partOf(time) {
  if (!isTime(time)) throw new Error('partOf: not a time: ' + time);
  const [h, m] = time.split(':').map(Number);
  for (let i = 0; i < PART_ENDS.length; i++) {
    const [eh, em] = PART_ENDS[i];
    if (h < eh || (h === eh && m < em)) return PARTS[i];
  }
  return PARTS[3];
}
export function itemPart(item) {
  if (item.when && item.when.from) return partOf(item.when.from);
  if (item.when && PARTS.includes(item.when.part)) return item.when.part;
  return PARTS[0];
}
// the label the existing app shows in the first column of a day row
export function itemLabel(item) {
  if (item.when && item.when.from) return item.when.to ? item.when.from + '–' + item.when.to : item.when.from;
  return itemPart(item);
}
const minutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

// the items of a day grouped by part, timed items in time order, untimed ones keep their order (after the timed ones)
export function itemsByPart(day) {
  const out = {}; PARTS.forEach((p) => { out[p] = []; });
  day.items.forEach((it, idx) => out[itemPart(it)].push({ it, idx }));
  PARTS.forEach((p) => {
    out[p].sort((a, b) => {
      const ta = a.it.when && a.it.when.from ? minutes(a.it.when.from) : null;
      const tb = b.it.when && b.it.when.from ? minutes(b.it.when.from) : null;
      if (ta !== null && tb !== null) return ta - tb || a.idx - b.idx;
      if (ta !== null) return -1;
      if (tb !== null) return 1;
      return a.idx - b.idx;
    });
    out[p] = out[p].map((x) => x.it);
  });
  return out;
}

export function newItem({ kind = 'activity', part, from, to, title = '', text = '', place, url, price, currency, transfer, src = 'free', libraryId } = {}) {
  if (!KINDS.includes(kind)) throw new Error('newItem: bad kind');
  const when = from ? (to ? { from, to } : { from }) : { part: PARTS.includes(part) ? part : PARTS[0] };
  if (from && !isTime(from)) throw new Error('newItem: bad time ' + from);
  if (to && !isTime(to)) throw new Error('newItem: bad end time ' + to);
  const it = { id: uid('i'), kind, when, title: { he: title }, text: { he: text }, src };
  if (place) it.place = place;
  if (url) it.url = url;
  if (price !== undefined && price !== null && price !== '') { it.price = price; if (currency) it.currency = currency; }
  if (kind === 'transfer') it.transfer = Object.assign({ from: '', to: '', mode: 'other' }, transfer || {});
  if (libraryId) it.libraryId = libraryId;
  return it;
}

function findItem(t, itemId) {
  for (let d = 0; d < t.days.length; d++) {
    const j = t.days[d].items.findIndex((it) => it.id === itemId);
    if (j >= 0) return { d, j };
  }
  return null;
}

export function addItem(trip, d, item) { const t = clone(trip); t.days[d].items.push(item); return t; }

export function updateItem(trip, itemId, patch) {
  const t = clone(trip);
  const at = findItem(t, itemId);
  if (!at) throw new Error('updateItem: no such item');
  const it = Object.assign({}, t.days[at.d].items[at.j], clone(patch));
  if (it.when && it.when.from && !isTime(it.when.from)) throw new Error('updateItem: bad time');
  t.days[at.d].items[at.j] = it;
  return t;
}

export function deleteItem(trip, itemId) {
  const t = clone(trip);
  const at = findItem(t, itemId);
  if (!at) throw new Error('deleteItem: no such item');
  t.days[at.d].items.splice(at.j, 1);
  return t;
}

export function duplicateItem(trip, itemId) {
  const t = clone(trip);
  const at = findItem(t, itemId);
  if (!at) throw new Error('duplicateItem: no such item');
  t.days[at.d].items.splice(at.j + 1, 0, copyItem(t.days[at.d].items[at.j]));
  return t;
}

// move an item to day toD and part toPart (optionally before another item). A time that does not fit the new part is dropped
// (the item keeps its text and gets the part); a time that fits is kept.
export function moveItem(trip, itemId, toD, toPart, beforeId) {
  if (!PARTS.includes(toPart)) throw new Error('moveItem: bad part');
  const t = clone(trip);
  const at = findItem(t, itemId);
  if (!at) throw new Error('moveItem: no such item');
  const [it] = t.days[at.d].items.splice(at.j, 1);
  if (!(it.when && it.when.from && partOf(it.when.from) === toPart)) it.when = { part: toPart };
  const list = t.days[toD].items;
  const b = beforeId ? list.findIndex((x) => x.id === beforeId) : -1;
  if (b >= 0) list.splice(b, 0, it); else list.push(it);
  return t;
}

// ---------- transfers ----------
export function navUrl(transfer) {
  if (!transfer || !transfer.from || !transfer.to || transfer.mode === 'flight') return null;
  let u = 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(transfer.from) + '&destination=' + encodeURIComponent(transfer.to);
  const tm = TRAVELMODE[transfer.mode];
  if (tm) u += '&travelmode=' + tm;
  return u;
}

// empty transfer items the builder offers (to confirm, never invented content):
// airport -> hotel on day 0, hotel -> airport on the last day, A -> B on every transition day. Only where none is there yet.
export function suggestedTransfers(trip) {
  const out = [];
  const n = dayCount(trip);
  const has = (d, key) => trip.days[d].items.some((it) => it.kind === 'transfer' && it.suggest === key);
  const label = (dest) => { const s = trip.stays.find((x) => x.dest === dest); return s && s.label && s.label.he ? s.label.he : dest; };
  for (let d = 0; d < n; d++) {
    const info = dayInfo(trip, d);
    if (info.first && !has(d, 'arrive')) out.push({ d, suggest: 'arrive', title: 'מהשדה למלון', part: 'צהריים' });
    if (info.transition && !has(d, 'move')) out.push({ d, suggest: 'move', title: 'מ' + label(info.dest) + ' ל' + label(info.dest2), part: 'בוקר' });
    if (info.last && n > 1 && !has(d, 'leave')) out.push({ d, suggest: 'leave', title: 'מהמלון לשדה', part: 'בוקר' });
  }
  return out;
}
export function applySuggestion(trip, s) {
  const it = newItem({ kind: 'transfer', part: s.part, title: s.title });
  it.suggest = s.suggest; it.pending = true;                 // "to confirm": shown until the agent fills it or deletes it
  return addItem(trip, s.d, it);
}

// ---------- library ----------
export function snippetFromItem(item, dest) {
  const it = copyItem(item, { newId: false });
  const data = { kind: it.kind, title: it.title, text: it.text };       // no part of the day: the agent picks it each time the item is used
  ['place', 'url', 'transfer'].forEach((k) => { if (it[k] !== undefined) data[k] = it[k]; });
  if (data.transfer) { delete data.transfer.ref; delete data.transfer.provider; }
  return { dest: dest || 'all', category: it.kind, data };
}
export function itemFromSnippet(snip, libraryId, part) {
  const d = clone(snip.data);
  const p = PARTS.includes(part) ? part : PARTS.includes(d.part) ? d.part : PARTS[0];   // the part chosen now; old items may still carry one
  const it = { id: uid('i'), kind: d.kind, when: { part: p }, title: d.title, text: d.text, src: 'library' };
  ['place', 'url', 'transfer'].forEach((k) => { if (d[k] !== undefined) it[k] = d[k]; });
  if (libraryId) it.libraryId = libraryId;
  return it;
}
// snippets for day d: the day's destinations + 'all', unless allDests
export function librarySubset(snippets, trip, d, { query = '', allDests = false } = {}) {
  const info = dayInfo(trip, d);
  const dests = new Set(['all', info.dest, info.dest2].filter(Boolean));
  const q = query.trim().toLowerCase();
  return snippets.filter((s) => (allDests || dests.has(s.dest)) &&
    (!q || JSON.stringify([s.data.title, s.data.text, s.data.place || '']).toLowerCase().includes(q)));
}

// ---------- hotels ----------
export const HOTEL_STATES = ['proposed', 'chosen', 'booked'];
export function setHotel(trip, stayId, hotel) {
  const t = clone(trip);
  const st = t.stays.find((s) => s.id === stayId);
  if (!st) throw new Error('setHotel: no such stay');
  const h = Object.assign({ id: uid('h'), state: 'proposed' }, clone(hotel));
  if (!HOTEL_STATES.includes(h.state)) throw new Error('setHotel: bad state');
  if ('ref' in h || 'voucher' in h) throw new Error('setHotel: booking numbers and vouchers belong in the private part');
  const j = st.hotels.findIndex((x) => x.id === h.id);
  if (j >= 0) st.hotels[j] = h; else st.hotels.push(h);
  return t;
}
export function shownHotel(stay) {                            // the one the app and the PDF show
  return stay.hotels.find((h) => h.state === 'booked') || stay.hotels.find((h) => h.state === 'chosen') || null;
}

// ---------- status of the six steps (empty / work / done) ----------
export function stepStates(trip) {
  const n = dayCount(trip);
  const filled = trip.days.filter((d) => !dayIsEmpty(d)).length;
  const withHotel = trip.stays.filter((s) => shownHotel(s)).length;
  const transfers = trip.days.reduce((a, d) => a.concat(d.items.filter((i) => i.kind === 'transfer')), []);
  const pending = transfers.filter((i) => i.pending).length + suggestedTransfers(trip).length;
  const st = (x, all) => (x === 0 ? 'empty' : x >= all ? 'done' : 'work');
  return {
    structure: trip.stays.length ? 'done' : 'empty',
    hotels: trip.stays.length ? st(withHotel, trip.stays.length) : 'empty',
    days: n ? st(filled, n) : 'empty',
    transfers: transfers.length === 0 && pending === 0 ? 'empty' : pending ? 'work' : 'done',
    counts: { days: n, filledDays: filled, stays: trip.stays.length, staysWithHotel: withHotel, pendingTransfers: pending },
  };
}

// ---------- duplicating a whole trip ----------
// Built from an ALLOW-list: only the fields named here are copied, so a field added later is NOT copied until someone adds it here.
// The private part (names, booking numbers, vouchers, links) is never even passed in.
const SEASONAL = /פריח|דובדב|סאקורה|שלכת|סתיו|אביב|חורף|קיץ|חג|פסטיבל|מתאריך|עד תאריך|עונ|sakura|cherry|blossom|festival|autumn|foliage/i;

function pickText(x) { return x && typeof x === 'object' ? { he: x.he || '', ...(x.en ? { en: x.en } : {}) } : { he: '' }; }

function cloneItem(it, prices) {
  const c = { id: uid('i'), kind: KINDS.includes(it.kind) ? it.kind : 'activity', title: pickText(it.title), text: pickText(it.text), src: it.src === 'library' ? 'library' : 'free' };
  if (it.when && it.when.from && isTime(it.when.from)) { c.when = { from: it.when.from }; if (isTime(it.when.to)) c.when.to = it.when.to; }
  else c.when = { part: PARTS.includes(it.when && it.when.part) ? it.when.part : PARTS[0] };
  if (typeof it.place === 'string') c.place = it.place;
  if (typeof it.url === 'string') c.url = it.url;
  if (typeof it.libraryId === 'string') c.libraryId = it.libraryId;
  if (typeof it.suggest === 'string') c.suggest = it.suggest;
  if (prices && typeof it.price === 'number') { c.price = it.price; if (typeof it.currency === 'string') c.currency = it.currency; }
  if (c.kind === 'transfer' && it.transfer) {
    const tr = it.transfer, o = {};
    ['from', 'to', 'mode', 'depart', 'duration'].forEach((k) => { if (typeof tr[k] === 'string') o[k] = tr[k]; });
    if (typeof tr.distanceKm === 'number') o.distanceKm = tr.distanceKm;
    c.transfer = o;                                           // provider and booking numbers are not copied
  }
  if (it.checkDate || SEASONAL.test(c.title.he + ' ' + c.text.he)) c.checkDate = true;
  return c;
}

export function cloneTrip(src, { clientName, startDate, copy = {} }) {
  const want = Object.assign({ structure: true, hotels: true, days: true, transfers: true, prices: false }, copy);
  if (!clientName || !clientName.trim()) throw new Error('cloneTrip: new client name is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '')) throw new Error('cloneTrip: new start date is required');
  const t = {
    id: uid('trip'), status: 'draft', version: 1,
    client: { name: clientName.trim(), travelers: [] },
    startDate, country: typeof src.country === 'string' ? src.country : '', languages: Array.isArray(src.languages) ? src.languages.filter((l) => l === 'he' || l === 'en') : ['he'],
    showPrices: want.prices ? !!src.showPrices : false,
    branding: { agencyName: (src.branding && src.branding.agencyName) || '', logoUrl: (src.branding && src.branding.logoUrl) || null, showPabLogo: !(src.branding && src.branding.showPabLogo === false) },
    flights: { out: null, back: null },
    stays: [], days: [],
    clonedFrom: src.id,
  };
  if (!want.structure) return t;
  t.stays = src.stays.map((s) => ({
    id: uid('st'), dest: s.dest, label: pickText(s.label), color: typeof s.color === 'string' ? s.color : null, nights: s.nights,
    hotels: !want.hotels ? [] : s.hotels.map((h) => {
      const o = { id: uid('h'), state: h.state === 'booked' ? 'chosen' : (HOTEL_STATES.includes(h.state) ? h.state : 'proposed') };
      ['name', 'area', 'url', 'maps', 'why', 'image'].forEach((k) => { if (typeof h[k] === 'string') o[k] = h[k]; });
      if (want.prices && (typeof h.pricePerNight === 'number' || typeof h.pricePerNight === 'string')) { o.pricePerNight = h.pricePerNight; if (typeof h.currency === 'string') o.currency = h.currency; }
      return o;
    }),
  }));
  t.days = src.days.map((d) => ({
    id: uid('d'),
    title: want.days ? pickText(d.title) : { he: '' },
    items: d.items.filter((it) => (it.kind === 'transfer' ? want.transfers : want.days)).map((it) => cloneItem(it, want.prices)),
  }));
  return relabel(t);
}

// every string inside a value (for the leak test)
export function allStrings(v, out = []) {
  if (typeof v === 'string') { if (v.trim()) out.push(v); }
  else if (typeof v === 'number') out.push(String(v));
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => allStrings(x, out));
  return out;
}

// ---------- the price quote for the client (Dana 2026-11-19) ----------
// trip.quote = { currency, lines: [{ id, label, note, qty, price, src }], includes: [..], excludes: [..], notes, validUntil, perPerson, number, issued }
// Prices are the agent's totals for the client; a line total is qty x price. Nothing here is a booking number or a private field.
export function travellersCount(trip) { return (trip.client && trip.client.travelers && trip.client.travelers.length) || 0; }

export function quoteOf(trip) {
  const q = trip.quote || {};
  return {
    currency: q.currency || 'ILS', lines: Array.isArray(q.lines) ? q.lines : [], includes: Array.isArray(q.includes) ? q.includes : [],
    excludes: Array.isArray(q.excludes) ? q.excludes : [], notes: q.notes || '', validUntil: q.validUntil || '', perPerson: q.perPerson !== false,
    number: q.number || '', issued: q.issued || '',
  };
}

export function quoteNum(v) { const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(n) ? null : n; }

export function quoteTotals(trip) {
  const q = quoteOf(trip);
  let total = 0, priced = 0;
  q.lines.forEach((l) => { const p = quoteNum(l.price), n = quoteNum(l.qty); if (p != null) { total += p * (n == null ? 1 : n); priced++; } });
  const pax = travellersCount(trip);
  return { total, priced, lines: q.lines.length, pax, perPerson: pax ? total / pax : null };
}

export function setQuote(trip, patch) { const t = clone(trip); t.quote = Object.assign(quoteOf(trip), patch); return t; }

export function setQuoteLine(trip, id, patch) {
  const q = quoteOf(trip);
  return setQuote(trip, { lines: q.lines.map((l) => (l.id === id ? Object.assign({}, l, patch) : l)) });
}

export function addQuoteLine(trip, line = {}) {
  const q = quoteOf(trip);
  return setQuote(trip, { lines: q.lines.concat([Object.assign({ id: uid('q'), label: '', note: '', qty: 1, price: '' }, line)]) });
}

export function removeQuoteLine(trip, id) { const q = quoteOf(trip); return setQuote(trip, { lines: q.lines.filter((l) => l.id !== id) }); }

// fills the lines the trip already knows: the flights (one per traveller), each chosen hotel (one per night), and priced
// activities and transfers. A line that is already there (same src) is not added again. Prices in another currency are left
// empty with a note, so the agent converts them (no exchange rate is guessed).
export function quoteFill(trip) {
  const q = quoteOf(trip), have = new Set(q.lines.map((l) => l.src).filter(Boolean)), add = [], cur = q.currency;
  const pax = travellersCount(trip) || 1;
  const fl = trip.flights || {};
  if (!have.has('flights')) {
    const route = [fl.out && fl.out.from, fl.out && fl.out.to].filter(Boolean).join('–');
    add.push({ label: 'טיסות הלוך וחזור' + (route ? ' ' + route : ''), note: 'כולל מזוודה ומיסים', qty: pax, price: '', src: 'flights' });
  }
  trip.stays.forEach((s) => {
    const h = shownHotel(s) || s.hotels[0];
    const key = 'stay:' + s.id; if (have.has(key)) return;
    const name = (s.label && s.label.he) || s.dest;
    const pr = h && h.pricePerNight != null && h.pricePerNight !== '' ? quoteNum(h.pricePerNight) : null;
    const same = !h || !h.currency || h.currency === cur;
    add.push({ label: (h && h.name ? h.name + ' · ' : 'מלון · ') + name, note: s.nights + ' לילות' + (pr != null && !same ? ' (במקור ' + pr + ' ' + h.currency + ' ללילה)' : ''),
      qty: s.nights, price: pr != null && same ? pr : '', src: key });
  });
  trip.days.forEach((d) => d.items.forEach((it) => {
    if (it.price == null || it.price === '' || it.kind === 'tip') return;
    const key = 'item:' + it.id; if (have.has(key)) return;
    const same = !it.currency || it.currency === cur;
    const title = (it.title && it.title.he) || (it.transfer && [it.transfer.from, it.transfer.to].filter(Boolean).join(' ← ')) || 'פעילות';
    add.push({ label: title, note: same ? '' : 'במקור ' + it.price + ' ' + it.currency, qty: pax, price: same ? it.price : '', src: key });
  }));
  const t = setQuote(trip, { lines: q.lines.concat(add.map((l) => Object.assign({ id: uid('q') }, l))) });
  return { trip: t, added: add.length };
}

// ---------- documents for the travellers (tickets, vouchers, visas) ----------
// The files sit in the private bucket agent-docs; the private part keeps the list: priv.docs = [{id, name, path, size, booking, label, kind}].
// When the trip becomes an app, scripts/agent_trip_docs.py copies them into the app's Documents. `booking` is text that is on
// the app's booking card (a flight number, a hotel name, the transfers card), so the file also opens from that card.
export const DOC_KINDS = [['flight', 'טיסה'], ['hotel', 'מלון'], ['train', 'רכבת'], ['entry', 'כניסה'], ['visa', 'ויזה'],
  ['car', 'רכב'], ['transfer', 'העברה'], ['insurance', 'ביטוח'], ['other', 'אחר']];
const TRANSFERS_CARD = 'ההעברות בטיול';                      // the title of the transfers card in the app (agent_trip_to_app.py)
const DOC_MODE = { flight: ['flight', 'טיסה'], train: ['train', 'רכבת'], shinkansen: ['train', 'שינקנסן'], driver: ['transfer', 'נהג פרטי'],
  taxi: ['transfer', 'מונית'], car: ['car', 'רכב שכור'], transit: ['transfer', 'תחבורה ציבורית'], other: ['transfer', 'העברה'] };
export function docBookings(trip) {
  const out = [], seen = new Set();
  const add = (o) => { const k = o.booking + '|' + o.label; if (!seen.has(k)) { seen.add(k); out.push(o); } };
  const fl = trip.flights || {};
  [['out', 'טיסה הלוך'], ['back', 'טיסה חזור']].forEach(([k, l]) => { const f = fl[k]; if (!f) return;
    const route = f.from && f.to ? f.from + ' ← ' + f.to : '';
    add({ booking: (f.number || '').trim() || 'טיסות', label: [l, f.number, route].filter(Boolean).join(' · '), kind: 'flight' }); });
  for (const s of trip.stays || []) { const h = shownHotel(s); if (h && h.name && h.name.trim()) add({ booking: h.name.trim(), label: 'מלון · ' + h.name.trim(), kind: 'hotel' }); }
  // trains and private drivers are booked leg by leg; a rental car is one booking, however many legs it drives (taxis, transit, walks are not booked)
  let car = false;
  (trip.days || []).forEach((d, i) => { for (const it of d.items || []) {
    const tr = it.transfer; if (!tr || !tr.from || !tr.to) continue;
    if (tr.mode === 'car') { car = true; continue; }
    if (!['train', 'shinkansen', 'driver', 'other'].includes(tr.mode)) continue;
    const m = DOC_MODE[tr.mode];
    add({ booking: TRANSFERS_CARD, label: m[1] + ' · ' + tr.from + ' ← ' + tr.to + ' (' + shortDate(addDays(trip.startDate, i)) + ')', kind: m[0] }); } });
  if (car) add({ booking: TRANSFERS_CARD, label: 'רכב שכור', kind: 'car' });
  return out;
}
