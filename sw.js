// sw.js — 和弦谱离线 PWA Service Worker
// 策略：
//   · 入口代码（index.html/app.js/style.css）→ NetworkFirst（保证拿到最新代码，离线回退缓存）
//     —— 代码更新频繁，CacheFirst 会锁住旧版导致刷新后行为异常
//   · 图标/manifest → CacheFirst（不变，离线秒开）
//   · songs.json（索引）+ songs/<id>.json（逐首分文件）→ NetworkFirst + 缓存回退；剥离 ?t= 时间戳
const CACHE = 'chord-chart-v2';
const SHELL = [
  './',
  'index.html',
  'app.js',
  'style.css',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
];
// 需要始终拿最新版本的入口代码（NetworkFirst），其余外壳资源走 CacheFirst
const NET_FIRST = new Set(['index.html', 'app.js', 'style.css', '']);

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
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))  // 清除所有旧版本缓存（含 v1）
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 只处理同源请求，第三方（如 GitHub API、统计脚本）直接放行
  if (url.origin !== self.location.origin) return;

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

  // —— 入口代码（HTML/JS/CSS）：NetworkFirst，保证刷新即拿到最新代码 ——
  const leaf = url.pathname.split('/').pop() || '';
  if (NET_FIRST.has(leaf)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const resp = await fetch(req, { cache: 'no-store' });
        if (resp && resp.ok) cache.put(req, resp.clone());
        return resp;
      } catch (err) {
        const cached = await cache.match(req);
        if (cached) return cached;            // 离线：回退缓存
        // 缓存也没有，再试不带查询串的纯净版（外壳预缓存用的是无查询串地址）
        const cleanResp = await cache.match(url.origin + url.pathname);
        if (cleanResp) return cleanResp;
        throw err;
      }
    })());
    return;
  }

  // —— 其余外壳资源（图标/manifest 等）：CacheFirst，回退网络 ——
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).catch(() => caches.match('./')))
  );
});
