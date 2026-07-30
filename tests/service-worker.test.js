/**
 * public/sw.js(Service Worker本体)のfetchハンドラのテスト。
 *
 * 背景: レビューで、カード画像のオフラインフォールバック `.catch(() => cached)` が、
 * スコープ上cachedが必ずfalsyであることを指摘された(コメント「キャッシュ無しのままresolve」と
 * 実装が食い違っていた)。`.catch(() => Response.error())` へ変更し、未キャッシュ・
 * ネットワーク取得失敗時にネットワークエラーであることを明示的に返すよう修正した。
 * このテストはその新しい挙動を検証する(他の分岐(navigate/html・SHELL_CACHE等)は
 * 変更していないため、リグレッション確認として最小限のみ含める)。
 *
 * 手法: dist/sw.js(ビルド後、CACHE_VERSIONが実値に置換済み)のソースをnode:vmで
 * 最小限のモック環境(self/caches/fetch)上で実行し、登録された'fetch'イベントリスナーを
 * 直接呼び出して event.respondWith() に渡された値を検証する。実際のブラウザService Worker
 * 環境そのものではないが、このSWのロジック(cache-first判定・catch節の分岐)はDOM/ネットワークに
 * 依存しない純粋なfetchハンドラであるため、この方法で意味のある検証ができる。
 *
 * 実行: node scripts/build.mjs && node tests/service-worker.test.js (npm testにも組み込み済み)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const swSource = readFileSync(join(ROOT, 'dist/sw.js'), 'utf-8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name); }
}

// ---- 最小限のCache Storage APIモック(caches.open/match/keys/deleteの必要最小限) ----
function createMockCaches() {
  const store = new Map(); // 全キャッシュストア共通のURL→Responseマップ(caches.match()のグローバル検索を模倣)
  const namedCaches = new Map();
  const keyFor = (reqOrUrl) => (typeof reqOrUrl === 'string' ? new URL(reqOrUrl, 'https://example.test/').href : reqOrUrl.url);
  const makeCacheHandle = () => ({
    match: async (reqOrUrl) => store.get(keyFor(reqOrUrl)),
    put: async (reqOrUrl, res) => { store.set(keyFor(reqOrUrl), res); },
  });
  return {
    open: async (name) => {
      if (!namedCaches.has(name)) namedCaches.set(name, makeCacheHandle());
      return namedCaches.get(name);
    },
    match: async (reqOrUrl) => store.get(keyFor(reqOrUrl)),
    keys: async () => [...namedCaches.keys()],
    delete: async (name) => namedCaches.delete(name),
    _store: store,
  };
}

// ---- sw.jsをvmサンドボックスで実行し、登録されたイベントリスナーを取り出す ----
function loadServiceWorker({ mockFetch }) {
  const listeners = {};
  const selfMock = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: () => {} },
    location: { origin: 'https://example.test' },
  };
  const caches = createMockCaches();
  const context = {
    self: selfMock,
    caches,
    fetch: mockFetch,
    Request,
    Response,
    URL,
    console,
  };
  vm.createContext(context);
  vm.runInContext(swSource, context, { filename: 'dist/sw.js' });
  return { listeners, caches, selfMock };
}

function makeFetchEvent(request) {
  let respondWithPromise = null;
  let called = false;
  return {
    request,
    respondWith(value) {
      called = true;
      respondWithPromise = Promise.resolve(value);
    },
    waitUntil() {},
    get called() { return called; },
    get result() { return respondWithPromise; },
  };
}

async function run() {
  // ---- ケース1: 画像がキャッシュ済みの場合、キャッシュを直接返す(既存挙動、回帰確認) ----
  {
    const cachedResponse = new Response('cached-image-bytes', { status: 200 });
    let fetchCalled = false;
    const { listeners, caches } = loadServiceWorker({
      mockFetch: async () => { fetchCalled = true; throw new Error('should not be called'); },
    });
    const req = new Request('https://example.test/images/01_001.png');
    (await caches.open('dummy'))._noop; // no-op, ensure caches usable
    caches._store.set(req.url, cachedResponse);

    const event = makeFetchEvent(req);
    listeners.fetch(event);
    check('画像キャッシュヒット時: respondWithが呼ばれる', event.called);
    const result = await event.result;
    check('画像キャッシュヒット時: キャッシュされたResponseがそのまま返る', result === cachedResponse);
    check('画像キャッシュヒット時: ネットワークfetchは呼ばれない', !fetchCalled);
  }

  // ---- ケース2: 未キャッシュだがネットワーク取得成功: 取得結果を返し、キャッシュへ保存する(既存挙動、回帰確認) ----
  {
    const networkResponse = new Response('fresh-image-bytes', { status: 200 });
    const { listeners, caches } = loadServiceWorker({
      mockFetch: async () => networkResponse.clone(),
    });
    const req = new Request('https://example.test/images/01_002.png');
    const event = makeFetchEvent(req);
    listeners.fetch(event);
    const result = await event.result;
    check('画像未キャッシュ+取得成功: レスポンスが返る(ok)', result && result.ok);
    // 非同期でcache.putされるため少し待つ
    await new Promise((r) => setTimeout(r, 0));
    check('画像未キャッシュ+取得成功: 取得結果がキャッシュへ保存される', caches._store.has(req.url));
  }

  // ---- ケース3(今回の修正対象): 未キャッシュ+ネットワーク取得失敗 → Response.error()を明示的に返す ----
  {
    const { listeners } = loadServiceWorker({
      mockFetch: async () => { throw new TypeError('network error (offline)'); },
    });
    const req = new Request('https://example.test/images/01_003.png');
    const event = makeFetchEvent(req);
    listeners.fetch(event);
    check('画像未キャッシュ+取得失敗: respondWithが呼ばれる', event.called);
    const result = await event.result;
    check('画像未キャッシュ+取得失敗: undefinedではなくResponseオブジェクトが返る', result instanceof Response);
    check("画像未キャッシュ+取得失敗: type === 'error'(Response.error()相当)のネットワークエラー応答が返る", result && result.type === 'error');
    check('画像未キャッシュ+取得失敗: okはfalse', result && result.ok === false);
  }

  // ---- ケース4: HTML(navigate)側の分岐は今回変更していないことの回帰確認 ----
  // オフライン時、キャッシュに一致がなければindex.htmlのキャッシュへフォールバックする挙動を維持していること。
  {
    const shellHtml = new Response('<html>shell</html>', { status: 200 });
    const { listeners, caches } = loadServiceWorker({
      mockFetch: async () => { throw new TypeError('network error (offline)'); },
    });
    caches._store.set('https://example.test/index.html', shellHtml);
    const req = new Request('https://example.test/cards/1-1/', { });
    // request.modeはブラウザ内部でのみ'navigate'になり得るため、ここではpathnameの'/'終わり判定を使う
    const event = makeFetchEvent(req);
    listeners.fetch(event);
    const result = await event.result;
    check('HTML系オフラインフォールバック: index.htmlキャッシュへフォールバックする(今回未変更の既存挙動)', result === shellHtml);
  }

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
