// Pack & Board admin service worker: shows phone notifications for new trip requests (push without payload).
var PUSH_API = 'https://pab-push.dana-lees.workers.dev';
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(){ /* network as usual */ });
self.addEventListener('push', function(e){
  e.waitUntil((async function(){
    var title = 'חומרים חדשים לטיול', body = 'נפתח עדכון חדש בניהול הטיולים.', url = '/dana/trips/';
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
  var target = new URL((e.notification.data && e.notification.data.url) || '/dana/trips/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(function(list){
    for(var i=0;i<list.length;i++){ if(list[i].url.indexOf('/dana/trips/')>-1 && 'focus' in list[i]) return list[i].focus(); }
    return self.clients.openWindow(target);
  }));
});
