/**
 * Web版(Base64サムネなし)でのカード画像読み込み・デッキ画像出力・Service Workerのテスト。
 * fetch/Imageをモックし、実際のネットワークやピクセルデコードに依存せず、
 * 「base64が無い場合の外部fetch経路」「読み込み完了待ち」「失敗時のフォールバック」を検証する。
 * 実行: node scripts/build.mjs && node tests/web-images.test.js
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'dist/index.html'), 'utf-8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name); }
}

function makeFakeCtx() {
  const calls = [];
  return {
    calls, fillStyle: '', strokeStyle: '', font: '', textAlign: 'left', textBaseline: 'alphabetic', lineWidth: 1,
    fillRect(...a) { calls.push(['fillRect', this.fillStyle, ...a]); },
    strokeRect(...a) { calls.push(['strokeRect', this.strokeStyle, ...a]); },
    fillText(...a) { calls.push(['fillText', this.fillStyle, ...a]); },
    measureText(t) { return { width: String(t).length * 8 }; },
    drawImage(...a) { calls.push(['drawImage', ...a]); },
    beginPath() {}, arc() {}, fill() {}, stroke() {}, save() {}, restore() {},
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
  };
}

const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/ijinden-deckmaker/' });
const w = dom.window;
const d = w.document;
w.HTMLCanvasElement.prototype.getContext = function () { if (!this.__ctx) this.__ctx = makeFakeCtx(); return this.__ctx; };
w.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,AAAA'; };
w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob(['x'])); };
d.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));

check('Web版はBase64サムネを埋め込まない', w.eval('Object.keys(CARD_THUMB_B64).length') === 0);

// ---- サブパス配信でも画像URLが解決されること(相対パスであることの確認) ----
check('imageCandidatesは絶対URLをハードコードしない(images/からの相対パス)', w.eval(`
  App.allCards.every(c => imageCandidates(c).slice(0, 4).every(u => u.startsWith('images/')))
`));

// ---- fetchモック: base64なしでも外部画像を取得してCanvasを組み立てられること ----
// 1枚だけ「取得に完全失敗するカード」を用意し、フォールバック描画(プレースホルダ矩形)になることも確認する。
w.URL.createObjectURL = (blob) => `blob:mock#${blob && blob.__url ? blob.__url : 'ok'}`;
w.URL.revokeObjectURL = () => {};
class FakeImage {
  set src(v) {
    this._src = v;
    const fail = typeof v === 'string' && v.includes('__FAIL__');
    queueMicrotask(() => {
      if (fail) { if (this.onerror) this.onerror(new Error('mock load fail')); }
      else if (this.onload) this.onload();
    });
  }
  get src() { return this._src; }
}
w.Image = FakeImage;

const result = await w.eval(`
  (async function() {
    const entries = App.allCards.slice(0, 6);
    const failCard = entries[2]; // 3枚目を「完全に取得失敗するカード」として扱う
    const failUrls = new Set(imageCandidates(failCard));

    window.fetch = async (url) => {
      if (failUrls.has(url)) return { ok: false };
      return { ok: true, blob: async () => ({ __url: url }) };
    };
    // フォールバックでImageに直接urlを渡すケースも失敗させるため、失敗カードのcandidate urlに印を付ける
    const origCreate = window.__origCreateObjectURL || URL.createObjectURL;
    // loadCardThumbImageは失敗urlに対してfetchでok:falseを返した後、直接 <img src=url> を試みる。
    // FakeImageはsrcに'__FAIL__'を含む場合のみ失敗するため、失敗カードのcandidate url自体に印はつけられない
    // (実ファイル名のため)。そこで、直接読み込みのフォールバック分だけ個別に失敗させるオーバーライドを行う。
    const rawLoadImageEl = loadImageEl;
    window.loadImageEl = (src) => {
      if (typeof src === 'string' && failUrls.has(src)) {
        return new Promise((resolve) => { const img = new Image(); img.onerror = () => resolve(null); img.onload = () => resolve(null); img.src = '__FAIL__' + src; });
      }
      return rawLoadImageEl(src);
    };

    const deck = {
      mainCards: entries.map(c => ({ cardId: c.id, qty: 1 })),
      sideCards: [], leaderCards: [], trumpCard: null,
    };
    const imgMap = await preloadDeckThumbImages(deck);
    const canvas = buildDeckImageCanvas(deck, imgMap, true, null, null);
    const calls = canvas.getContext('2d').calls;
    const drawImageCount = calls.filter(x => x[0] === 'drawImage').length;
    const placeholderCount = calls.filter(x => x[0] === 'fillRect' && x[1] === '#eeeeee').length;
    return JSON.stringify({
      resolvedCount: Array.from(imgMap.values()).filter(Boolean).length,
      totalEntries: entries.length,
      failCardResolved: !!imgMap.get(failCard.id),
      drawImageCount, placeholderCount,
    });
  })()
`);
const r = JSON.parse(result);
check('preloadDeckThumbImagesは全カード読み込み完了を待ってから返る(例外を投げない)', r.totalEntries === 6);
check('取得成功したカードは正しくImageへ解決される', r.resolvedCount === 5);
check('取得に完全失敗したカードはnull(未解決)のまま処理が継続する', r.failCardResolved === false);
check('Canvas生成: 成功した5枚はdrawImageで描画される', r.drawImageCount === 5);
check('Canvas生成: 失敗した1枚は壊れた画像でなくプレースホルダ矩形になる', r.placeholderCount >= 1);

// ---- Service Worker: バージョン注入・カード画像を初回一括プリキャッシュしない ----
const swPath = join(ROOT, 'dist/sw.js');
const swExists = existsSync(swPath);
check('dist/sw.js が生成される', swExists);
if (swExists) {
  const sw = readFileSync(swPath, 'utf-8');
  check('CACHE_VERSIONのプレースホルダが実際の値に置換されている', !sw.includes('__CACHE_VERSION__') && /CACHE_VERSION = '[0-9a-f]{12}'/.test(sw));
  const expectedVersion = createHash('sha256').update(html).digest('hex').slice(0, 12);
  check('CACHE_VERSIONはビルド内容のハッシュと一致する(内容が変われば必ず変わる)', sw.includes(`CACHE_VERSION = '${expectedVersion}'`));
  check('SHELL_URLSはimages/を含まない(577枚を初回プリキャッシュしない)', !/SHELL_URLS[\s\S]*?\];/.exec(sw)[0].includes('images/'));
  check('カード画像はcache-firstのランタイムキャッシュ方式', /IMAGE_PATH_RE[\s\S]*caches\.match\(request\)/.test(sw));
  check('HTML本体はnetwork-first(オフライン時のみキャッシュへフォールバック)', /request\.mode === 'navigate'[\s\S]*fetch\(request\)/.test(sw));
  check('activate時に旧バージョンのキャッシュを削除する', /activate[\s\S]*caches\.delete/.test(sw));
}

// ---- SW登録スクリプト: file://や非対応環境で悪影響を与えないガードがあること ----
check("SW登録は'serviceWorker' in navigatorとfile:以外のガード付き", /serviceWorker' in navigator && location\.protocol !== 'file:'/.test(html));
check('SW登録失敗はcatchで握りつぶし、他の動作に影響させない', /navigator\.serviceWorker\.register\('sw\.js'\)\.catch/.test(html));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail > 0 ? 1 : 0);
