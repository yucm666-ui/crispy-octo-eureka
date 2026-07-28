// sw.js — 和弦谱离线 PWA Service Worker
// 策略：
//   · 应用外壳（HTML/JS/CSS/manifest/图标）→ CacheFirst，离线秒开
//   · songs.json（索引）→ NetworkFirst + 缓存回退；剥离 ?t= 时间戳统一作缓存键
//   · songs/<id>.json（逐首分文件）→ NetworkFirst + 缓存回退；同样剥离 ?t=
//     使原本每次都带随机时间戳的请求也能命中同一份离线副本，离线可打开任意歌曲
const CACHE = 'chord-chart-v1';
const SHELL = [
  './',
  'index.html',
  'app.js',
  'style.css',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())   // 立即接管，避免等旧页面关闭
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 是否命中"数据文件"（索引 songs.json 或逐首 songs/<id>.json）
  const isData = url.pathname.endsWith('/songs.json') || /^\/songs\/\d+\.json$/.test(url.pathname);

  // —— 数据文件：剥离 ?t= 时间戳，NetworkFirst + 缓存回退 ——
  if (isData) {
    const clean = url.origin + url.pathname;   // 去掉查询串后的干净地址
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(clean);
      try {
        const resp = await fetch(clean, { cache: 'no-store' });
        if (resp && resp.ok) cache.put(clean, resp.clone());
        return resp;
      } catch (err) {
        if (cached) return cached;            // 离线：返回上次缓存的数据
        throw err;                            // 既无网又无缓存（极少：首装即离线）
      }
    })());
    return;
  }

  // —— 应用外壳：CacheFirst，回退网络 ——
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).catch(() => caches.match('./')))
  );
});
