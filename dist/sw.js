/*
 * イジンデンラボ Service Worker (Web版のみで有効)
 *
 * 方針:
 *   - アプリ本体(index.html・manifest・アイコン類)だけを起動時にprecacheする。
 *     カード画像577枚は絶対に一括プリキャッシュしない。
 *   - カード画像(images/配下)は、実際に表示要求があったものだけをcache-firstで
 *     ランタイムキャッシュする(2回目以降のアクセスが速くなる/オフラインでも直近閲覧分は出る)。
 *   - HTML本体はnetwork-firstにして、新しいバージョンを公開したら次回アクセスで
 *     即座に反映されるようにする(オフライン時のみキャッシュへフォールバック)。
 *   - CACHE_VERSIONはビルドのたびにscripts/build.mjsが内容ハッシュへ置換する。
 *     新バージョンのSWがactivateされたタイミングで、旧バージョンのキャッシュ(shell/images
 *     どちらも)を確実に削除するため、「画像だけ古いキャッシュを永遠に返し続ける」事故を防げる。
 */
const CACHE_VERSION = '90e46a9edfe5';
const SHELL_CACHE = `ijinden-labo-shell-${CACHE_VERSION}`;
const IMAGE_CACHE = `ijinden-labo-images-${CACHE_VERSION}`;

// ここに列挙するのはアプリ本体まわりの最小限のみ。images/配下は含めない。
const SHELL_URLS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './favicon-16x16.png',
  './favicon-32x32.png',
  './favicon-48x48.png',
  './apple-touch-icon.png',
  './android-chrome-192x192.png',
  './android-chrome-512x512.png',
];

const IMAGE_PATH_RE = /\/images\/[^/]+\.(?:png|jpe?g|webp)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // 1件でも404/失敗があってもinstall全体を失敗させない(allSettled)。
      Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== IMAGE_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // 他オリジン(CDN等)には介入しない

  // カード画像: cache-first + ランタイムキャッシュ(見た分だけ段階的に保存)
  if (IMAGE_PATH_RE.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((res) => {
            if (res && res.ok) {
              const clone = res.clone();
              caches.open(IMAGE_CACHE).then((cache) => cache.put(request, clone));
            }
            return res;
          })
          .catch(() => cached); // オフライン等で取得不可 → キャッシュ無しのままresolve(呼び出し側のフォールバック表示に委ねる)
      })
    );
    return;
  }

  // ページ本体(HTML): network-firstで常に最新を優先。オフライン時のみキャッシュへフォールバック
  if (request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }
  // それ以外(manifest.json・アイコン等)は素通し(ブラウザの通常HTTPキャッシュに任せる)
});
