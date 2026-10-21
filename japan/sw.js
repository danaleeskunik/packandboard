// Pack & Board demo service worker (stage 1: installability only, no caching yet)
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(){ /* network as usual */ });

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
