// Pack & Board service worker: installable, works WITHOUT a connection (offline stage, 2026-11-08), plus push (appended below by add_offline.py).
//
// What is kept on the phone, per trip folder (the scope of this worker):
//   - the app page itself: network first (a fix of ours reaches people), the saved copy when there is no connection or the network is slower than 4 s
//   - fonts and /assets/ images: stale-while-revalidate
//   - the trip's data from Supabase (GET only): the saved checklist state, the document list, documents the traveller already opened (up to 8 MB each), messages
// Never cached: anything that is written (POST/PATCH/DELETE), maps, weather, exchange rates, translation (those need a connection; the app says so).
// Update: bump VERSION to drop every old copy; a changed sw.js installs itself and takes over at once.
var VERSION = 'v1';
var SCOPE = self.registration.scope;                                     // https://packandboard.com/<folder>/
var PREFIX = 'pab-off:' + new URL(SCOPE).pathname + ':';                 // one set of caches per trip folder, so one folder never deletes another's
var PAGES = PREFIX + VERSION + ':pages', STATIC = PREFIX + VERSION + ':static', DATA = PREFIX + VERSION + ':data';
var DB_HOST = 'ampynsmwdhouzfyyktfc.supabase.co';
var MAX_DOC = 8 * 1024 * 1024;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(PAGES).then(function (c) { return c.add(new Request(SCOPE, { cache: 'reload' })).catch(function () {}); })
      .then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf(PREFIX) === 0 && k.indexOf(PREFIX + VERSION + ':') !== 0; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); }));
});

function timeout(ms) { return new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms); }); }
function sizeOk(res, max) { var n = +res.headers.get('content-length') || 0; return !max || n <= max; }

/** network first; falls back to the saved copy when offline or slower than `ms`; the network answer keeps refreshing the saved copy */
function networkFirst(req, cacheName, key, ms, max, ignoreSearch) {
  var net = fetch(req).then(function (res) {
    if (res && res.ok && sizeOk(res, max)) { var copy = res.clone(); caches.open(cacheName).then(function (c) { return c.put(key, copy); }).catch(function () {}); }
    return res;
  });
  var saved = caches.open(cacheName).then(function (c) { return c.match(key, { ignoreSearch: !!ignoreSearch }); });
  return Promise.race([net, timeout(ms)]).catch(function () { return saved.then(function (hit) { return hit || net; }); });
}
function staleWhileRevalidate(req) {
  return caches.open(STATIC).then(function (c) {
    return c.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()).catch(function () {}); return res; })
        .catch(function () { return hit || Response.error(); });
      return hit || net;
    });
  });
}

/** "Save for the trip" asks for a fresh copy of the page */
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'save-page') e.waitUntil(caches.open(PAGES).then(function (c) { return c.add(new Request(SCOPE, { cache: 'reload' })); }).catch(function () {}));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (req.mode === 'navigate' && url.origin === location.origin && url.href.indexOf(SCOPE) === 0) { e.respondWith(networkFirst(req, PAGES, SCOPE, 4000, 0, true)); return; }
  if (url.hostname === DB_HOST) { e.respondWith(networkFirst(req, DATA, req.url, 4000, MAX_DOC)); return; }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || (url.origin === location.origin && url.pathname.indexOf('/assets/') === 0)) { e.respondWith(staleWhileRevalidate(req)); return; }
});

// pab-push
var PUSH_API = 'https://pab-push.dana-lees.workers.dev';
self.addEventListener('push', function(e){
  e.waitUntil((async function(){
    var title = 'עדכון על הטיול', body = 'נפתח עדכון חדש באפליקציה.', url = './';
    try{
      var sub = await self.registration.pushManager.getSubscription();
      if(sub){
        var r = await fetch(PUSH_API + '/msg', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({endpoint: sub.endpoint})});
        if(r.ok){ var m = await r.json(); title = m.title || title; body = m.body || body; if(m.url) url = m.url; }
      }
    }catch(err){}
    await self.registration.showNotification(title, {body: body, icon: '/assets/icon-192.png', badge: '/assets/icon-192.png', dir: 'rtl', lang: 'he', data: {url: url}});
  })());
});
self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(function(list){
    for(var i=0;i<list.length;i++){ if(list[i].url.indexOf(self.registration.scope)===0 && 'focus' in list[i]) return list[i].focus(); }
    return self.clients.openWindow(target);
  }));
});
