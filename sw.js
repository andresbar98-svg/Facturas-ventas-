/* Mi Negocio — service worker: la app abre y funciona sin señal.
   Sube este archivo junto a index.html (misma carpeta). Si cambias algo aquí, sube VERSION. */
const VERSION = "mi-negocio-v1";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
const LIBS = [
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"
];
const FUENTES = "https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700;800&display=swap";
const HOSTS = ["cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

async function cacheCss(url) {
  const c = await caches.open(VERSION);
  const r = await fetch(url);
  if (!r.ok) return;
  await c.put(url, r.clone());
  const css = await r.text();
  const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]);
  await Promise.all(urls.map(async u => {
    try { if (!(await c.match(u))) { const f = await fetch(u); if (f.ok) await c.put(u, f); } } catch {}
  }));
}

// Guarda un módulo de Firebase y todos los módulos que importa
async function cacheModulo(url, vistos = new Set()) {
  if (vistos.has(url)) return;
  vistos.add(url);
  const c = await caches.open(VERSION);
  let r = await c.match(url);
  if (!r) {
    r = await fetch(url);
    if (!r.ok) return;
    await c.put(url, r.clone());
  }
  const txt = await r.clone().text();
  const re = /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;
  let m;
  while ((m = re.exec(txt))) await cacheModulo(new URL(m[1], url).href, vistos);
}

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all([...SHELL, ...LIBS].map(u => c.add(u).catch(() => {})));
    await cacheCss(FUENTES).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => {
  const d = e.data || {};
  if (d.tipo === "precargar" && Array.isArray(d.urls))
    e.waitUntil(Promise.all(d.urls.map(u => cacheModulo(u).catch(() => {}))));
});

// La pantalla principal: primero internet (así siempre ves la última versión); sin señal, la copia guardada
async function navegar(req, url) {
  const c = await caches.open(VERSION);
  const clave = url.origin + url.pathname;      // ignora ?id=... del comprobante
  try {
    const r = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error("lento")), 4000))]);
    if (r.ok) c.put(clave, r.clone());
    return r;
  } catch {
    return (await c.match(clave)) || (await c.match("index.html")) || (await c.match("./")) || Response.error();
  }
}

// Archivos de apoyo: lo guardado al instante y se actualiza en segundo plano
async function apoyo(e) {
  const req = e.request, c = await caches.open(VERSION);
  const hit = await c.match(req);
  const red = fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) c.put(req, r.clone()); return r; }).catch(() => null);
  e.waitUntil(red);
  return hit || (await red) || Response.error();
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate" && url.origin === location.origin) { e.respondWith(navegar(req, url)); return; }
  const propio = url.origin === location.origin;
  const cdn = HOSTS.includes(url.hostname) || (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"));
  if (propio || cdn) e.respondWith(apoyo(e));   // Firestore/Auth (googleapis, firebaseapp) no se tocan
});
