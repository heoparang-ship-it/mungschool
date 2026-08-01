/* 멍스쿨 모바일 SW — 네트워크 우선(배포 즉시 반영), 실패 시 캐시(오프라인).
   ★캐시 우선으로 바꾸지 말 것: 라이브 md5 검증 사이클이 낡은 캐시에 속는다. */
const C = 'mungschool-m-v8';
const CORE = ['./','./index.html','./dog.js','./signals.js','./course.js','./manifest.json',
              './face_atlas.webp','./body.webp',
              /* 훈련장 (v0.7) */
              './train.js','./voice.js','./content.js','./content-for-A.js','./context.js',
              './body_sit.webp','./body_down.webp'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r;
    }).catch(() =>
      caches.match(e.request, { ignoreSearch: true }).then(m => m || caches.match('./index.html'))
    )
  );
});
