const CACHE_NAME="way-more-fish-v1";
const APP_SHELL=[
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/suncalc@1.9.0/suncalc.js"
];

self.addEventListener("install",e=>{
  e.waitUntil(
    caches.open(CACHE_NAME).then(c=>
      Promise.allSettled(APP_SHELL.map(u=>c.add(u)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate",e=>{
  e.waitUntil(
    caches.keys().then(keys=>
      Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch",e=>{
  const r=e.request;
  if(r.method!=="GET") return;

  const u=new URL(r.url);

  if(r.mode==="navigate"){
    e.respondWith(
      fetch(r)
        .then(res=>{
          const x=res.clone();
          caches.open(CACHE_NAME).then(c=>c.put("/index.html",x));
          return res;
        })
        .catch(()=>caches.match("/index.html"))
    );
    return;
  }

  const data=
    u.hostname.includes("api.weather.gov") ||
    u.hostname.includes("tidesandcurrents.noaa.gov") ||
    u.hostname.includes("open-meteo.com") ||
    u.hostname.includes("waterservices.usgs.gov");

  if(data){
    e.respondWith(
      fetch(r)
        .then(res=>{
          if(res&&res.ok){
            const x=res.clone();
            caches.open(CACHE_NAME).then(c=>c.put(r,x));
          }
          return res;
        })
        .catch(()=>caches.match(r))
    );
    return;
  }

  e.respondWith(
    caches.match(r).then(cached=>
      cached ||
      fetch(r).then(res=>{
        if(res&&res.ok){
          const x=res.clone();
          caches.open(CACHE_NAME).then(c=>c.put(r,x));
        }
        return res;
      })
    )
  );
});
