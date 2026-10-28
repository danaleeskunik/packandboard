// Pack & Board demo service worker (stage 1: installability only, no caching yet)
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(){ /* network as usual */ });
